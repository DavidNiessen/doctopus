import type {
  BuildPolicy,
  SourceSnapshotInfo,
} from '@davidniessen/doctopus-contracts';
export interface ProjectBuildCapabilities {
  projectId: string;
  approveSource: boolean;
  enqueue: boolean;
  cancel: boolean;
  revokeSource: boolean;
  publish: boolean;
}
export type BuildJobState =
  'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type BuildJobErrorCode =
  | 'build_failed'
  | 'worker_lost'
  | 'source_changed'
  | 'deadline_exceeded'
  | 'source_revoked'
  | 'cancelled';
export interface BuildSource {
  id: string;
  projectId: string;
  label: string;
  revision: string | null;
  snapshot: SourceSnapshotInfo;
  policy: BuildPolicy;
  approvedBy: string;
  createdAt: string;
  revokedAt: string | null;
}
export interface BuildJob {
  id: string;
  projectId: string;
  sourceId: string;
  state: BuildJobState;
  requestedBy: string;
  attempts: number;
  maxAttempts: number;
  workerId: string | null;
  createdAt: string;
  updatedAt: string;
  availableAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  leaseExpiresAt: string | null;
  deadlineAt: string | null;
  artifactId: string | null;
  result: BuildResult | null;
  errorCode: BuildJobErrorCode | null;
}
export interface BuildLease {
  job: BuildJob;
  source: BuildSource;
  token: string;
}
export interface BuildResult {
  artifactId: string;
  source: SourceSnapshotInfo;
  requestedImage: string;
  resolvedImage: string;
  toolVersion: string;
  durationMs: number;
}
export interface BuildQueueLimits {
  maxPending: number;
  maxPendingPerProject: number;
  maxRunning: number;
  maxRunningPerProject: number;
}
export interface BuildPage<T> {
  items: T[];
  nextCursor: string | null;
}
export interface BuildSourceListOptions {
  after?: string;
  activeOnly?: boolean;
}
export interface BuildJobRepository {
  approveSource(
    projectId: string,
    input: {
      label: string;
      revision?: string;
      snapshot: SourceSnapshotInfo;
      policy: BuildPolicy;
    },
    key: string,
    actor: string,
  ): Promise<BuildSource>;
  sources(
    projectId: string,
    options?: BuildSourceListOptions,
  ): Promise<BuildPage<BuildSource>>;
  source(projectId: string, sourceId: string): Promise<BuildSource | undefined>;
  revokeSource(
    projectId: string,
    sourceId: string,
    actor: string,
  ): Promise<BuildSource>;
  enqueue(
    projectId: string,
    sourceId: string,
    key: string,
    actor: string,
  ): Promise<BuildJob>;
  job(projectId: string, jobId: string): Promise<BuildJob | undefined>;
  jobs(projectId: string, after?: string): Promise<BuildPage<BuildJob>>;
  claim(
    workerId: string,
    sourceIds: readonly string[],
    leaseSeconds?: number,
  ): Promise<BuildLease | undefined>;
  heartbeat(
    jobId: string,
    token: string,
    leaseSeconds?: number,
  ): Promise<BuildJob | undefined>;
  complete(
    jobId: string,
    token: string,
    result: BuildResult,
  ): Promise<BuildJob>;
  fail(
    jobId: string,
    token: string,
    code: Exclude<
      BuildJobErrorCode,
      'source_revoked' | 'cancelled' | 'worker_lost'
    >,
  ): Promise<BuildJob>;
  cancel(projectId: string, jobId: string, actor: string): Promise<BuildJob>;
  recoverExpired(): Promise<number>;
}
export class BuildInputError extends Error {}
export class BuildLeaseLostError extends Error {}
export class BuildCapacityError extends Error {}

export class BuildNotFoundError extends Error {}
