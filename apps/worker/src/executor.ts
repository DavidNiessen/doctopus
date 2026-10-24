import { mkdtemp, rm, statfs } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { buildIsolatedSite, stageArtifact } from '@davidniessen/doctopus-cli';
import { safeOutput } from '@davidniessen/doctopus-compiler';
import type { BuildLease, BuildResult } from '@davidniessen/doctopus-domain';
import type { PreparedSource } from './config.js';
import { markWorkerWorkspace, reclaimWorkerWorkspaces } from './workspaces.js';
export class SourceApprovalChanged extends Error {}
export class BuildExecutionDeadline extends Error {}
export type BuildExecution = Pick<BuildLease, 'job' | 'source'>;
export type BuildExecutor = (
  lease: BuildExecution,
  source: PreparedSource,
  signal: AbortSignal,
) => Promise<BuildResult>;
export function sameApproval(
  lease: BuildExecution,
  source: PreparedSource,
): boolean {
  return (
    lease.source.id === source.id &&
    lease.source.projectId === source.projectId &&
    isDeepStrictEqual(lease.source.snapshot, source.snapshot) &&
    isDeepStrictEqual(lease.source.policy, source.policy)
  );
}
/** Conservative headroom for snapshot, export and immutable staging, separate from Docker storage. */
export async function hasBuildStorage(
  source: PreparedSource,
  artifactRoot: string,
  reservedMiB: number,
): Promise<boolean> {
  const required =
    (source.policy.limits.sourceMiB +
      2 * source.policy.limits.outputMiB +
      reservedMiB +
      64) *
    1024 *
    1024;
  const spaces = await Promise.all([
    statfs(source.directory),
    statfs(artifactRoot),
  ]);
  return spaces.every((space) => space.bavail * space.bsize >= required);
}
/** Periodic local reclamation precedes storage admission, including idle recovery. */
export function createWorkerStorageAdmission(
  artifactRoot: string,
  signal: AbortSignal,
) {
  const swept = new Map<string, number>();
  return async (source: PreparedSource, reservedMiB: number) => {
    const now = performance.now();
    const previous = swept.get(source.directory);
    if (previous === undefined || now - previous >= 60000) {
      await reclaimWorkerWorkspaces(source.directory, signal);
      swept.set(source.directory, now);
    }
    return hasBuildStorage(source, artifactRoot, reservedMiB);
  };
}
export function createIsolatedExecutor(artifactRoot: string): BuildExecutor {
  return async (lease, source, signal) => {
    if (!sameApproval(lease, source))
      throw new SourceApprovalChanged(
        'Source approval does not match local registry',
      );
    signal.throwIfAborted();
    const parent = await safeOutput(source.directory, '.doctopus/worker-jobs');
    const directory = await mkdtemp(
      join(parent, `job-${lease.job.id}-${lease.job.attempts}-`),
    );
    try {
      await markWorkerWorkspace(
        directory,
        lease.job.id,
        lease.job.attempts,
        source.policy.limits.timeoutMs,
      );
      const build = await buildIsolatedSite(source.directory, {
        image: source.policy.image,
        expectedSourceDigest: source.snapshot.digest,
        config: source.policy.config,
        trustPlugins: source.policy.trustPlugins,
        trustContent: source.policy.trustContent,
        ...source.policy.limits,
        output: `.doctopus/worker-jobs/${basename(directory)}/site`,
        signal,
      });
      signal.throwIfAborted();
      if (!isDeepStrictEqual(build.receipt.source, source.snapshot))
        throw new SourceApprovalChanged(
          'Executed source receipt does not match approval',
        );
      const staged = await stageArtifact(build.directory, artifactRoot);
      signal.throwIfAborted();
      const resolvedImage = build.receipt.image;
      if (
        typeof resolvedImage !== 'string' ||
        !/^sha256:[a-f0-9]{64}$/.test(resolvedImage)
      )
        throw new Error('Isolated runner did not attest its resolved image');
      return {
        artifactId: staged,
        source: build.receipt.source,
        requestedImage: source.policy.image,
        resolvedImage,
        toolVersion: build.receipt.toolVersion,
        durationMs: build.receipt.durationMs,
      };
    } catch (error) {
      if (!signal.aborted && error instanceof Error) {
        if (error.message.includes('during source digest verification'))
          throw new SourceApprovalChanged(
            'Visible source no longer matches its approved digest',
          );
        if (
          error.message.startsWith(
            'Isolated build cancelled or exceeded its deadline',
          )
        )
          throw new BuildExecutionDeadline(
            'Isolated runner exceeded its deadline',
          );
      }
      throw error;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  };
}
