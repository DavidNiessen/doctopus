import type { BuildLease, BuildResult } from '@davidniessen/doctopus-domain';
import {
  readBuildPolicy,
  readSourceSnapshotInfo,
} from '@davidniessen/doctopus-contracts';
import { identifier, record, readWorkerOrigin } from './config.js';
export interface WorkerControlPlane {
  claim(
    workerId: string,
    sourceIds: string[],
    signal: AbortSignal,
  ): Promise<BuildLease | undefined>;
  heartbeat(lease: BuildLease, signal: AbortSignal): Promise<boolean>;
  complete(
    lease: BuildLease,
    result: BuildResult,
    signal: AbortSignal,
  ): Promise<void>;
  fail(
    lease: BuildLease,
    code: 'build_failed' | 'source_changed' | 'deadline_exceeded',
    signal: AbortSignal,
  ): Promise<void>;
}
function text(value: unknown, limit: number): string {
  if (typeof value !== 'string' || !value || value.length > limit)
    throw new Error('Invalid worker control-plane response');
  return value;
}
function date(value: unknown): string {
  const valueText = text(value, 40);
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(valueText) ||
    !Number.isFinite(Date.parse(valueText))
  )
    throw new Error('Invalid worker lease date');
  return valueText;
}
/** A malformed or future protocol cannot select source paths or execution policy. */
export function readLease(value: unknown, workerId: string): BuildLease {
  const lease = record(value, ['job', 'source', 'token']);
  const token = text(lease.token, 43);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new Error('Invalid worker lease token');
  const source = record(lease.source, [
    'id',
    'projectId',
    'label',
    'revision',
    'snapshot',
    'policy',
    'approvedBy',
    'createdAt',
    'revokedAt',
  ]);
  const job = record(lease.job, [
    'id',
    'projectId',
    'sourceId',
    'state',
    'requestedBy',
    'attempts',
    'maxAttempts',
    'workerId',
    'createdAt',
    'updatedAt',
    'availableAt',
    'startedAt',
    'finishedAt',
    'leaseExpiresAt',
    'deadlineAt',
    'artifactId',
    'result',
    'errorCode',
  ]);
  const sourceId = identifier(source.id),
    projectId = identifier(source.projectId);
  if (
    job.state !== 'running' ||
    job.workerId !== workerId ||
    identifier(job.projectId) !== projectId ||
    identifier(job.sourceId) !== sourceId ||
    source.revokedAt !== null ||
    job.finishedAt !== null ||
    job.artifactId !== null ||
    job.result !== null ||
    job.errorCode !== null ||
    typeof job.attempts !== 'number' ||
    !Number.isSafeInteger(job.attempts) ||
    typeof job.maxAttempts !== 'number' ||
    !Number.isSafeInteger(job.maxAttempts) ||
    job.maxAttempts < 1 ||
    job.maxAttempts > 3 ||
    job.attempts < 1 ||
    job.attempts > job.maxAttempts
  )
    throw new Error('Invalid worker lease ownership');
  return {
    token,
    source: {
      id: sourceId,
      projectId,
      label: text(source.label, 120),
      revision: source.revision === null ? null : text(source.revision, 200),
      snapshot: readSourceSnapshotInfo(source.snapshot),
      policy: readBuildPolicy(source.policy),
      approvedBy: text(source.approvedBy, 4096),
      createdAt: date(source.createdAt),
      revokedAt: null,
    },
    job: {
      id: identifier(job.id),
      projectId,
      sourceId,
      state: 'running',
      requestedBy: text(job.requestedBy, 4096),
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      workerId,
      createdAt: date(job.createdAt),
      updatedAt: date(job.updatedAt),
      availableAt: date(job.availableAt),
      startedAt: date(job.startedAt),
      finishedAt: null,
      leaseExpiresAt: date(job.leaseExpiresAt),
      deadlineAt: date(job.deadlineAt),
      artifactId: null,
      result: null,
      errorCode: null,
    },
  };
}
export class ControlPlaneError extends Error {
  constructor(readonly status: number) {
    super('Worker control-plane request failed');
  }
}
export function createWorkerClient(
  origin: string,
  credential: string,
  insecureDevelopment = false,
): WorkerControlPlane {
  origin = readWorkerOrigin(origin, insecureDevelopment);
  if (typeof credential !== 'string' || !/^[!-~]{32,1000}$/.test(credential))
    throw new Error('Worker requires a valid operator credential');
  async function request(
    path: string,
    payload: unknown,
    signal: AbortSignal,
    timeoutMs = 10000,
  ) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(new URL(path, origin), {
        method: 'POST',
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        headers: {
          Authorization: 'Bearer ' + credential,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.any([signal, controller.signal]),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new ControlPlaneError(response.status);
      }
      if (
        response.headers
          .get('content-type')
          ?.split(';')[0]
          ?.trim()
          .toLowerCase() !== 'application/json'
      ) {
        await response.body?.cancel().catch(() => {});
        throw new Error('Worker control plane did not return JSON');
      }
      if (!response.body) throw new Error('Worker response body unavailable');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          length += next.value.byteLength;
          if (length > 4 * 1024 * 1024)
            throw new Error('Worker response exceeds budget');
          chunks.push(next.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      return JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
      ) as unknown;
    } finally {
      clearTimeout(timeout);
    }
  }
  const path = (lease: BuildLease, action: string) =>
    `/api/projects/${identifier(lease.job.projectId)}/builds/${identifier(lease.job.id)}/${action}`;
  return {
    async claim(workerId, sourceIds, signal) {
      const response = record(
        await request(
          '/api/build-workers/claim',
          { workerId, sourceIds },
          signal,
        ),
        ['lease'],
      );
      return response.lease === null
        ? undefined
        : readLease(response.lease, workerId);
    },
    async heartbeat(lease, signal) {
      const response = record(
        await request(path(lease, 'heartbeat'), { token: lease.token }, signal),
        ['owned', 'job'],
      );
      if (typeof response.owned !== 'boolean')
        throw new Error('Invalid worker ownership response');
      return response.owned;
    },
    async complete(lease, result, signal) {
      const response = await request(
        path(lease, 'complete'),
        { token: lease.token, result },
        signal,
        60000,
      );
      if (
        !response ||
        typeof response !== 'object' ||
        !('id' in response) ||
        response.id !== lease.job.id ||
        !('state' in response) ||
        response.state !== 'succeeded' ||
        !('artifactId' in response) ||
        response.artifactId !== result.artifactId
      )
        throw new Error('Invalid worker completion acknowledgement');
    },
    async fail(lease, code, signal) {
      const response = await request(
        path(lease, 'fail'),
        { token: lease.token, code },
        signal,
      );
      if (
        !response ||
        typeof response !== 'object' ||
        !('id' in response) ||
        response.id !== lease.job.id ||
        !('state' in response) ||
        response.state !== 'failed' ||
        !('errorCode' in response) ||
        response.errorCode !== code
      )
        throw new Error('Invalid worker failure acknowledgement');
    },
  };
}
