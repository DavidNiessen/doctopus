import {
  readBuildPolicy,
  readSourceSnapshotInfo,
} from '@davidniessen/doctopus-contracts';
import type {
  BuildJob,
  BuildSource,
  BuildPage,
  ProjectBuildCapabilities,
} from '@davidniessen/doctopus-domain';
export type SourceRow = Pick<
  BuildSource,
  | 'id'
  | 'projectId'
  | 'label'
  | 'revision'
  | 'snapshot'
  | 'policy'
  | 'createdAt'
  | 'revokedAt'
  | 'approvedBy'
>;
export type JobRow = Pick<
  BuildJob,
  | 'id'
  | 'projectId'
  | 'sourceId'
  | 'state'
  | 'attempts'
  | 'maxAttempts'
  | 'createdAt'
  | 'updatedAt'
  | 'workerId'
  | 'artifactId'
  | 'errorCode'
>;
const uuidPattern = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
function invalid(): never {
  throw new Error(
    'The server returned invalid build data. Refresh to try again.',
  );
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum: number) {
  if (typeof value !== 'string' || !value || value.length > maximum) invalid();
  return value;
}
function uuid(value: unknown) {
  const result = text(value, 36);
  if (!uuidPattern.test(result)) invalid();
  return result;
}
function date(value: unknown) {
  const result = text(value, 40);
  if (!Number.isFinite(Date.parse(result))) invalid();
  return result;
}
function integer(value: unknown, minimum: number, maximum: number) {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  )
    invalid();
  return value;
}
function project(value: unknown, expected: string) {
  const id = uuid(value);
  if (id !== expected) invalid();
  return id;
}
function choice<T extends string>(value: unknown, options: readonly T[]): T {
  if (!options.includes(value as T)) invalid();
  return value as T;
}
export function readCapabilities(
  value: unknown,
  projectId: string,
): ProjectBuildCapabilities {
  const input = record(value);
  const result: ProjectBuildCapabilities = {
    projectId: project(input.projectId, projectId),
    approveSource: false,
    enqueue: false,
    cancel: false,
    revokeSource: false,
    publish: false,
  };
  for (const key of [
    'approveSource',
    'enqueue',
    'cancel',
    'revokeSource',
    'publish',
  ] as const) {
    if (typeof input[key] !== 'boolean') invalid();
    result[key] = input[key];
  }
  return result;
}
export function readSource(value: unknown, projectId: string): SourceRow {
  const input = record(value);
  return {
    id: uuid(input.id),
    projectId: project(input.projectId, projectId),
    label: text(input.label, 120),
    revision: input.revision === null ? null : text(input.revision, 200),
    snapshot: readSourceSnapshotInfo(input.snapshot),
    policy: readBuildPolicy(input.policy),
    createdAt: date(input.createdAt),
    revokedAt: input.revokedAt === null ? null : date(input.revokedAt),
    approvedBy: text(input.approvedBy, 4096),
  };
}
export function readJob(value: unknown, projectId: string): JobRow {
  const input = record(value);
  const artifactId =
    input.artifactId === null ? null : text(input.artifactId, 64);
  if (artifactId !== null && !/^[a-f0-9]{64}$/.test(artifactId)) invalid();
  const state = choice(input.state, [
    'queued',
    'running',
    'succeeded',
    'failed',
    'cancelled',
  ] as const);
  if (state === 'succeeded' && !artifactId) invalid();
  return {
    id: uuid(input.id),
    projectId: project(input.projectId, projectId),
    sourceId: uuid(input.sourceId),
    state,
    attempts: integer(input.attempts, 0, 3),
    maxAttempts: integer(input.maxAttempts, 3, 3),
    createdAt: date(input.createdAt),
    updatedAt: date(input.updatedAt),
    workerId: input.workerId === null ? null : text(input.workerId, 64),
    artifactId,
    errorCode:
      input.errorCode === null
        ? null
        : choice(input.errorCode, [
            'build_failed',
            'worker_lost',
            'source_changed',
            'deadline_exceeded',
            'source_revoked',
            'cancelled',
          ] as const),
  };
}
export function readPage<T>(
  value: unknown,
  decode: (value: unknown) => T,
): BuildPage<T> {
  const input = record(value);
  if (!Array.isArray(input.items) || input.items.length > 100) invalid();
  return {
    items: input.items.map(decode),
    nextCursor: input.nextCursor === null ? null : uuid(input.nextCursor),
  };
}
