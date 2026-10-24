import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  readBuildPolicy,
  readSourceSnapshotInfo,
  isImmutableBuilderImage,
  toolVersion,
} from '@davidniessen/doctopus-contracts';
import type {
  BuildJob,
  BuildJobRepository,
  BuildLease,
  BuildQueueLimits,
  BuildResult,
  BuildSource,
  BuildPage,
  BuildSourceListOptions,
} from '@davidniessen/doctopus-domain';
import {
  BuildCapacityError,
  BuildInputError,
  BuildLeaseLostError,
  BuildNotFoundError,
  ConflictError,
} from '@davidniessen/doctopus-domain';
import type { SqlClient, SqlDatabase } from './sql.js';

const defaults: BuildQueueLimits = {
  maxPending: 1000,
  maxPendingPerProject: 20,
  maxRunning: 16,
  maxRunningPerProject: 2,
};
export function readBuildQueueLimits(
  input: Partial<BuildQueueLimits> = {},
): BuildQueueLimits {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !Object.hasOwn(defaults, key))
  )
    throw new BuildInputError('Invalid build queue limits');
  const result = { ...defaults };
  for (const key of Object.keys(result) as (keyof BuildQueueLimits)[]) {
    const value = Object.hasOwn(input, key) ? input[key] : defaults[key];
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > defaults[key]
    )
      throw new BuildInputError('Invalid build queue limits');
    result[key] = value;
  }
  if (!Object.hasOwn(input, 'maxPendingPerProject'))
    result.maxPendingPerProject = Math.min(
      result.maxPendingPerProject,
      result.maxPending,
    );
  if (!Object.hasOwn(input, 'maxRunning'))
    result.maxRunning = Math.min(result.maxRunning, result.maxPending);
  if (!Object.hasOwn(input, 'maxRunningPerProject'))
    result.maxRunningPerProject = Math.min(
      result.maxRunningPerProject,
      result.maxRunning,
      result.maxPendingPerProject,
    );
  if (
    result.maxPendingPerProject > result.maxPending ||
    result.maxRunningPerProject > result.maxRunning ||
    result.maxRunningPerProject > result.maxPendingPerProject ||
    result.maxRunning > result.maxPending
  )
    throw new BuildInputError('Inconsistent build queue limits');
  return result;
}
const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
function uuid(value: string): string {
  if (
    typeof value !== 'string' ||
    !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value)
  )
    throw new BuildInputError('Invalid build identifier');
  return value.toLowerCase();
}
function actor(value: string): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 4096 ||
    value.includes('\0')
  )
    throw new BuildInputError('Invalid build actor');
  return value;
}
function keyHash(value: string): string {
  if (typeof value !== 'string' || !value || value.length > 100)
    throw new BuildInputError(
      'Build idempotency keys must contain 1–100 characters',
    );
  return hash(value);
}
function label(value: unknown, limit: number): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim().length > limit ||
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  )
    throw new BuildInputError('Invalid build source label or revision');
  return value.trim();
}
function leaseHash(value: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value))
    throw new BuildInputError('Invalid build lease token');
  return hash(value);
}
function seconds(value = 60): number {
  if (!Number.isSafeInteger(value) || value < 10 || value > 120)
    throw new BuildInputError('Build leases must last 10–120 seconds');
  return value;
}
const jobNames = {
  id: 'id',
  projectId: 'project_id',
  sourceId: 'source_id',
  state: 'state',
  requestedBy: 'requested_by',
  attempts: 'attempts',
  maxAttempts: 'max_attempts',
  workerId: 'worker_id',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  availableAt: 'available_at',
  startedAt: 'started_at',
  finishedAt: 'finished_at',
  leaseExpiresAt: 'lease_expires_at',
  deadlineAt: 'deadline_at',
  artifactId: 'artifact_id',
  errorCode: 'error_code',
  result: 'result',
};
const sourceNames = {
  id: 'id',
  projectId: 'project_id',
  label: 'label',
  revision: 'revision',
  snapshot: 'snapshot',
  policy: 'policy',
  approvedBy: 'approved_by',
  createdAt: 'created_at',
  revokedAt: 'revoked_at',
};
const columns = (names: Record<string, string>, alias: string) =>
  Object.entries(names)
    .map(([name, column]) => `${alias}.${column} AS "${name}"`)
    .join(',');
const jobColumns = columns(jobNames, 'j'),
  sourceColumns = columns(sourceNames, 's');
type SourceRow = Omit<BuildSource, 'createdAt' | 'revokedAt'> & {
  createdAt: Date;
  revokedAt: Date | null;
};
type JobDate =
  | 'createdAt'
  | 'updatedAt'
  | 'availableAt'
  | 'startedAt'
  | 'finishedAt'
  | 'leaseExpiresAt'
  | 'deadlineAt';
type JobRow = Omit<BuildJob, JobDate> & {
  createdAt: Date;
  updatedAt: Date;
  availableAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  leaseExpiresAt: Date | null;
  deadlineAt: Date | null;
};
const iso = (value: Date | null) => value?.toISOString() ?? null;
function sourceRow(row: SourceRow): BuildSource {
  return {
    id: row.id,
    projectId: row.projectId,
    label: row.label,
    revision: row.revision,
    snapshot: readSourceSnapshotInfo(row.snapshot),
    policy: readBuildPolicy(row.policy),
    approvedBy: row.approvedBy,
    createdAt: row.createdAt.toISOString(),
    revokedAt: iso(row.revokedAt),
  };
}
function jobRow(row: JobRow): BuildJob {
  return {
    id: row.id,
    projectId: row.projectId,
    sourceId: row.sourceId,
    state: row.state,
    requestedBy: row.requestedBy,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    workerId: row.workerId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    availableAt: row.availableAt.toISOString(),
    startedAt: iso(row.startedAt),
    finishedAt: iso(row.finishedAt),
    leaseExpiresAt: iso(row.leaseExpiresAt),
    deadlineAt: iso(row.deadlineAt),
    artifactId: row.artifactId,
    errorCode: row.errorCode,
    result: row.result,
  };
}
function resultInput(value: BuildResult): BuildResult {
  if (
    !value ||
    typeof value !== 'object' ||
    Object.keys(value).some(
      (key) =>
        ![
          'artifactId',
          'source',
          'requestedImage',
          'resolvedImage',
          'toolVersion',
          'durationMs',
        ].includes(key),
    ) ||
    typeof value.artifactId !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.artifactId) ||
    !isImmutableBuilderImage(value.requestedImage) ||
    typeof value.resolvedImage !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(value.resolvedImage) ||
    typeof value.toolVersion !== 'string' ||
    value.toolVersion.length > 128 ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
      value.toolVersion,
    ) ||
    !Number.isSafeInteger(value.durationMs) ||
    value.durationMs < 0 ||
    value.durationMs > 1020000
  )
    throw new BuildInputError('Invalid build result metadata');
  return {
    artifactId: value.artifactId,
    source: readSourceSnapshotInfo(value.source),
    requestedImage: value.requestedImage,
    resolvedImage: value.resolvedImage,
    toolVersion: value.toolVersion,
    durationMs: value.durationMs,
  };
}
async function audit(
  sql: SqlClient,
  projectId: string,
  subject: string,
  action: string,
  metadata: Record<string, unknown>,
) {
  await sql.query(
    'INSERT INTO docs_audit(project_id,actor,action,metadata) VALUES($1,$2,$3,$4)',
    [projectId, subject, action, JSON.stringify(metadata)],
  );
}
async function projectLock(sql: SqlClient, projectId: string) {
  if (
    !(
      await sql.query(
        'SELECT id FROM docs_projects WHERE id=$1 FOR NO KEY UPDATE',
        [projectId],
      )
    ).rowCount
  )
    throw new BuildNotFoundError('Build project not found');
}
/** Shared bounded SQL connection; no Docker, source access or additional pools. */
export class PostgresBuildJobs implements BuildJobRepository {
  private readonly limits: BuildQueueLimits;
  constructor(
    private readonly sql: SqlDatabase,
    limits: BuildQueueLimits,
  ) {
    this.limits = { ...limits };
  }
  async approveSource(
    projectId: string,
    input: Parameters<BuildJobRepository['approveSource']>[1],
    key: string,
    subject: string,
  ): Promise<BuildSource> {
    projectId = uuid(projectId);
    subject = actor(subject);
    const keyDigest = keyHash(key);
    if (
      !input ||
      typeof input !== 'object' ||
      Object.keys(input).some(
        (key) => !['label', 'revision', 'snapshot', 'policy'].includes(key),
      )
    )
      throw new BuildInputError('Invalid build source approval');
    const name = label(input.label, 120),
      revision =
        input.revision === undefined ? null : label(input.revision, 200),
      snapshot = readSourceSnapshotInfo(input.snapshot),
      policy = readBuildPolicy(input.policy);
    if (
      snapshot.files < 1 ||
      snapshot.bytes < 1 ||
      snapshot.bytes > policy.limits.sourceMiB * 1024 * 1024
    )
      throw new BuildInputError(
        'Source snapshot does not fit its approved policy',
      );
    const fingerprint = hash(
      JSON.stringify({ name, revision, snapshot, policy, subject }),
    );
    return this.sql.transaction(async (sql) => {
      await projectLock(sql, projectId);
      const existing = (
        await sql.query<SourceRow & { matches: boolean }>(
          `SELECT ${sourceColumns},s.request_hash=$3 AS matches FROM docs_build_sources s WHERE project_id=$1 AND key_hash=$2`,
          [projectId, keyDigest, fingerprint],
        )
      ).rows[0];
      if (existing) {
        if (!existing.matches)
          throw new ConflictError('Build source idempotency key already used');
        return sourceRow(existing);
      }
      const count = (
        await sql.query<{ count: number }>(
          'SELECT count(*)::int AS count FROM docs_build_sources WHERE project_id=$1 AND revoked_at IS NULL',
          [projectId],
        )
      ).rows[0]!.count;
      if (count >= 1000)
        throw new BuildCapacityError('Build source inventory limit reached');
      const created = (
        await sql.query<SourceRow>(
          `INSERT INTO docs_build_sources AS s(id,project_id,label,revision,snapshot,policy,approved_by,key_hash,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${sourceColumns}`,
          [
            randomUUID(),
            projectId,
            name,
            revision,
            JSON.stringify(snapshot),
            JSON.stringify(policy),
            subject,
            keyDigest,
            fingerprint,
          ],
        )
      ).rows[0]!;
      await audit(sql, projectId, subject, 'build.source.approved', {
        sourceId: created.id,
        sourceDigest: snapshot.digest,
        digestVersion: snapshot.digestVersion,
      });
      return sourceRow(created);
    });
  }
  async sources(
    projectId: string,
    options: BuildSourceListOptions = {},
  ): Promise<BuildPage<BuildSource>> {
    projectId = uuid(projectId);
    if (
      !options ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      Object.keys(options).some(
        (key) => !['after', 'activeOnly'].includes(key),
      ) ||
      (options.activeOnly !== undefined &&
        typeof options.activeOnly !== 'boolean')
    )
      throw new BuildInputError('Invalid build source pagination');
    const after = options.after === undefined ? null : uuid(options.after);
    const rows = (
      await this.sql.query<SourceRow>(
        `SELECT ${sourceColumns} FROM docs_build_sources s WHERE project_id=$1 AND ($2::boolean=false OR revoked_at IS NULL) AND ($3::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM docs_build_sources WHERE project_id=$1 AND id=$3)) ORDER BY created_at DESC,id DESC LIMIT 101`,
        [projectId, options.activeOnly === true, after],
      )
    ).rows;
    return {
      items: rows.slice(0, 100).map(sourceRow),
      nextCursor: rows.length > 100 ? rows[99]!.id : null,
    };
  }
  async source(
    projectId: string,
    sourceId: string,
  ): Promise<BuildSource | undefined> {
    const row = (
      await this.sql.query<SourceRow>(
        `SELECT ${sourceColumns} FROM docs_build_sources s WHERE project_id=$1 AND id=$2`,
        [uuid(projectId), uuid(sourceId)],
      )
    ).rows[0];
    return row ? sourceRow(row) : undefined;
  }
  async revokeSource(
    projectId: string,
    sourceId: string,
    subject: string,
  ): Promise<BuildSource> {
    projectId = uuid(projectId);
    sourceId = uuid(sourceId);
    subject = actor(subject);
    return this.sql.transaction(async (sql) => {
      await projectLock(sql, projectId);
      const row = (
        await sql.query<SourceRow>(
          `SELECT ${sourceColumns} FROM docs_build_sources s WHERE project_id=$1 AND id=$2 FOR UPDATE`,
          [projectId, sourceId],
        )
      ).rows[0];
      if (!row) throw new BuildNotFoundError('Approved build source not found');
      if (row.revokedAt) return sourceRow(row);
      const revoked = (
        await sql.query<SourceRow>(
          `UPDATE docs_build_sources s SET revoked_at=clock_timestamp() WHERE id=$1 RETURNING ${sourceColumns}`,
          [sourceId],
        )
      ).rows[0]!;
      const jobs = (
        await sql.query<JobRow>(
          `UPDATE docs_build_jobs j SET state='cancelled',error_code='source_revoked',finished_at=clock_timestamp(),updated_at=clock_timestamp(),lease_token_hash=NULL,lease_expires_at=NULL,settled_lease_hash=NULL WHERE project_id=$1 AND source_id=$2 AND state IN ('queued','running') RETURNING ${jobColumns}`,
          [projectId, sourceId],
        )
      ).rows;
      for (const job of jobs)
        await audit(sql, projectId, subject, 'build.cancelled', {
          jobId: job.id,
          sourceId,
          errorCode: 'source_revoked',
        });
      await audit(sql, projectId, subject, 'build.source.revoked', {
        sourceId,
      });
      return sourceRow(revoked);
    });
  }
  async enqueue(
    projectId: string,
    sourceId: string,
    key: string,
    subject: string,
  ): Promise<BuildJob> {
    projectId = uuid(projectId);
    sourceId = uuid(sourceId);
    subject = actor(subject);
    const keyDigest = keyHash(key),
      fingerprint = hash(JSON.stringify({ sourceId, subject }));
    return this.sql.transaction(async (sql) => {
      await sql.query('SELECT pg_advisory_xact_lock(193272)');
      await projectLock(sql, projectId);
      const existing = (
        await sql.query<JobRow & { matches: boolean }>(
          `SELECT ${jobColumns},j.request_hash=$3 AS matches FROM docs_build_jobs j WHERE project_id=$1 AND key_hash=$2`,
          [projectId, keyDigest, fingerprint],
        )
      ).rows[0];
      if (existing) {
        if (!existing.matches)
          throw new ConflictError('Build job idempotency key already used');
        return jobRow(existing);
      }
      const source = (
        await sql.query(
          'SELECT id FROM docs_build_sources WHERE project_id=$1 AND id=$2 AND revoked_at IS NULL',
          [projectId, sourceId],
        )
      ).rows[0];
      if (!source)
        throw new ConflictError('Build source approval is missing or revoked');
      const counts = (
        await sql.query<{ total: number; project: number }>(
          "SELECT count(*)::int AS total,count(*) FILTER(WHERE project_id=$1)::int AS project FROM docs_build_jobs WHERE state IN ('queued','running')",
          [projectId],
        )
      ).rows[0]!;
      if (
        counts.total >= this.limits.maxPending ||
        counts.project >= this.limits.maxPendingPerProject
      )
        throw new BuildCapacityError('Build queue capacity reached');
      const created = (
        await sql.query<JobRow>(
          `INSERT INTO docs_build_jobs AS j(id,project_id,source_id,state,requested_by,key_hash,request_hash) VALUES($1,$2,$3,'queued',$4,$5,$6) RETURNING ${jobColumns}`,
          [randomUUID(), projectId, sourceId, subject, keyDigest, fingerprint],
        )
      ).rows[0]!;
      await audit(sql, projectId, subject, 'build.queued', {
        jobId: created.id,
        sourceId,
      });
      return jobRow(created);
    });
  }
  async job(projectId: string, jobId: string): Promise<BuildJob | undefined> {
    const row = (
      await this.sql.query<JobRow>(
        `SELECT ${jobColumns} FROM docs_build_jobs j WHERE project_id=$1 AND id=$2`,
        [uuid(projectId), uuid(jobId)],
      )
    ).rows[0];
    return row ? jobRow(row) : undefined;
  }
  async jobs(projectId: string, after?: string): Promise<BuildPage<BuildJob>> {
    projectId = uuid(projectId);
    const cursor = after === undefined ? null : uuid(after);
    const rows = (
      await this.sql.query<JobRow>(
        `SELECT ${jobColumns} FROM docs_build_jobs j WHERE project_id=$1 AND ($2::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM docs_build_jobs WHERE project_id=$1 AND id=$2)) ORDER BY created_at DESC,id DESC LIMIT 101`,
        [projectId, cursor],
      )
    ).rows;
    return {
      items: rows.slice(0, 100).map(jobRow),
      nextCursor: rows.length > 100 ? rows[99]!.id : null,
    };
  }
  private async recover(sql: SqlClient): Promise<number> {
    const expired = (
      await sql.query<JobRow>(
        `SELECT ${jobColumns} FROM docs_build_jobs j WHERE state='running' AND (lease_expires_at<=clock_timestamp() OR deadline_at<=clock_timestamp()) ORDER BY lease_expires_at,id LIMIT 32 FOR UPDATE SKIP LOCKED`,
      )
    ).rows;
    for (const job of expired) {
      const terminal = job.attempts >= job.maxAttempts;
      const updated = (
        await sql.query<JobRow>(
          `UPDATE docs_build_jobs j SET state=$2,error_code=CASE WHEN deadline_at<=clock_timestamp() THEN 'deadline_exceeded' ELSE 'worker_lost' END,available_at=GREATEST(clock_timestamp(),deadline_at),finished_at=CASE WHEN $2='failed' THEN clock_timestamp() ELSE NULL END,updated_at=clock_timestamp(),worker_id=NULL,lease_token_hash=NULL,lease_expires_at=NULL,deadline_at=NULL,settled_lease_hash=NULL WHERE id=$1 RETURNING ${jobColumns}`,
          [job.id, terminal ? 'failed' : 'queued'],
        )
      ).rows[0]!;
      await audit(
        sql,
        job.projectId,
        'system:build-queue',
        terminal ? 'build.failed' : 'build.recovered',
        {
          jobId: job.id,
          attempt: job.attempts,
          workerId: job.workerId,
          errorCode: updated.errorCode,
          availableAt: updated.availableAt.toISOString(),
        },
      );
    }
    return expired.length;
  }
  async recoverExpired(): Promise<number> {
    return this.sql.transaction(async (sql) => {
      await sql.query('SELECT pg_advisory_xact_lock(193272)');
      return this.recover(sql);
    });
  }
  async claim(
    workerId: string,
    sourceIds: readonly string[],
    leaseSeconds = 60,
  ): Promise<BuildLease | undefined> {
    if (
      typeof workerId !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(workerId) ||
      !Array.isArray(sourceIds) ||
      !sourceIds.length ||
      sourceIds.length > 1000
    )
      throw new BuildInputError('Invalid worker or approved source list');
    const allowed = [...new Set(sourceIds.map(uuid))],
      ttl = seconds(leaseSeconds),
      token = randomBytes(32).toString('base64url');
    return this.sql.transaction(async (sql) => {
      await sql.query('SELECT pg_advisory_xact_lock(193272)');
      await this.recover(sql);
      const active = (
        await sql.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM docs_build_jobs WHERE state='running'",
        )
      ).rows[0]!.count;
      if (active >= this.limits.maxRunning) return undefined;
      const selected = (
        await sql.query<JobRow>(
          `SELECT ${jobColumns} FROM docs_build_jobs j JOIN docs_build_sources s ON s.id=j.source_id AND s.project_id=j.project_id WHERE j.state='queued' AND j.available_at<=clock_timestamp() AND j.source_id=ANY($1::uuid[]) AND s.revoked_at IS NULL AND (SELECT count(*) FROM docs_build_jobs active WHERE active.project_id=j.project_id AND active.state='running')<$2 ORDER BY j.created_at,j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED`,
          [allowed, this.limits.maxRunningPerProject],
        )
      ).rows[0];
      if (!selected) return undefined;
      const source = (
        await sql.query<SourceRow>(
          `SELECT ${sourceColumns} FROM docs_build_sources s WHERE id=$1`,
          [selected.sourceId],
        )
      ).rows[0]!;
      const policy = readBuildPolicy(source.policy);
      const claimed = (
        await sql.query<JobRow>(
          `UPDATE docs_build_jobs j SET state='running',attempts=attempts+1,worker_id=$2,lease_token_hash=$3,settled_lease_hash=NULL,lease_expires_at=clock_timestamp()+$4*interval '1 second',deadline_at=clock_timestamp()+$5*interval '1 millisecond',started_at=COALESCE(started_at,clock_timestamp()),updated_at=clock_timestamp(),error_code=NULL WHERE id=$1 RETURNING ${jobColumns}`,
          [
            selected.id,
            workerId,
            hash(token),
            ttl,
            policy.limits.timeoutMs + 120000,
          ],
        )
      ).rows[0]!;
      await audit(
        sql,
        claimed.projectId,
        'worker:' + workerId,
        'build.claimed',
        {
          jobId: claimed.id,
          sourceId: claimed.sourceId,
          attempt: claimed.attempts,
        },
      );
      return { job: jobRow(claimed), source: sourceRow(source), token };
    });
  }
  async heartbeat(
    jobId: string,
    token: string,
    leaseSeconds = 60,
  ): Promise<BuildJob | undefined> {
    const row = (
      await this.sql.query<JobRow>(
        `UPDATE docs_build_jobs j SET lease_expires_at=LEAST(clock_timestamp()+$3*interval '1 second',deadline_at),updated_at=clock_timestamp() WHERE id=$1 AND lease_token_hash=$2 AND state='running' AND lease_expires_at>clock_timestamp() AND deadline_at>clock_timestamp() RETURNING ${jobColumns}`,
        [uuid(jobId), leaseHash(token), seconds(leaseSeconds)],
      )
    ).rows[0];
    return row ? jobRow(row) : undefined;
  }
  async complete(
    jobId: string,
    token: string,
    result: BuildResult,
  ): Promise<BuildJob> {
    jobId = uuid(jobId);
    const digest = leaseHash(token),
      output = resultInput(result);
    return this.sql.transaction(async (sql) => {
      const job = (
        await sql.query<JobRow>(
          `SELECT ${jobColumns} FROM docs_build_jobs j WHERE id=$1 AND ((state='running' AND lease_token_hash=$2 AND lease_expires_at>clock_timestamp() AND deadline_at>clock_timestamp()) OR (state='succeeded' AND settled_lease_hash=$2)) FOR UPDATE`,
          [jobId, digest],
        )
      ).rows[0];
      if (!job) throw new BuildLeaseLostError('Build lease is no longer owned');
      if (job.state === 'succeeded') {
        if (JSON.stringify(resultInput(job.result!)) !== JSON.stringify(output))
          throw new ConflictError(
            'Build result already settled with different metadata',
          );
        return jobRow(job);
      }
      const source = (
        await sql.query<SourceRow>(
          `SELECT ${sourceColumns} FROM docs_build_sources s WHERE id=$1`,
          [job.sourceId],
        )
      ).rows[0]!;
      const approved = sourceRow(source);
      if (
        approved.revokedAt ||
        JSON.stringify(output.source) !== JSON.stringify(approved.snapshot) ||
        output.requestedImage !== approved.policy.image ||
        output.toolVersion !== toolVersion ||
        output.durationMs > approved.policy.limits.timeoutMs + 120000
      )
        throw new BuildInputError(
          'Build result does not match its source approval',
        );
      await sql.query(
        'INSERT INTO docs_artifacts(project_id,artifact_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [job.projectId, output.artifactId],
      );
      const updated = (
        await sql.query<JobRow>(
          `UPDATE docs_build_jobs j SET state='succeeded',artifact_id=$3,result=$4,finished_at=clock_timestamp(),updated_at=clock_timestamp(),lease_token_hash=NULL,lease_expires_at=NULL,settled_lease_hash=$2 WHERE id=$1 AND state='running' AND lease_token_hash=$2 AND lease_expires_at>clock_timestamp() AND deadline_at>clock_timestamp() RETURNING ${jobColumns}`,
          [jobId, digest, output.artifactId, JSON.stringify(output)],
        )
      ).rows[0];
      if (!updated)
        throw new BuildLeaseLostError('Build lease expired before completion');
      await audit(
        sql,
        job.projectId,
        'worker:' + job.workerId,
        'artifact.registered',
        { jobId, artifactId: output.artifactId },
      );
      await audit(
        sql,
        job.projectId,
        'worker:' + job.workerId,
        'build.succeeded',
        {
          jobId,
          artifactId: output.artifactId,
          sourceId: job.sourceId,
          attempt: job.attempts,
        },
      );
      return jobRow(updated);
    });
  }
  async fail(
    jobId: string,
    token: string,
    code: Parameters<BuildJobRepository['fail']>[2],
  ): Promise<BuildJob> {
    jobId = uuid(jobId);
    const digest = leaseHash(token);
    if (!['build_failed', 'source_changed', 'deadline_exceeded'].includes(code))
      throw new BuildInputError('Invalid worker build failure code');
    return this.sql.transaction(async (sql) => {
      const row = (
        await sql.query<JobRow>(
          `SELECT ${jobColumns} FROM docs_build_jobs j WHERE id=$1 AND ((state='running' AND lease_token_hash=$2 AND lease_expires_at>clock_timestamp() AND deadline_at>clock_timestamp()) OR (state='failed' AND settled_lease_hash=$2)) FOR UPDATE`,
          [jobId, digest],
        )
      ).rows[0];
      if (!row) throw new BuildLeaseLostError('Build lease is no longer owned');
      if (row.state === 'failed') {
        if (row.errorCode !== code)
          throw new ConflictError(
            'Build failure already settled with a different code',
          );
        return jobRow(row);
      }
      const failed = (
        await sql.query<JobRow>(
          `UPDATE docs_build_jobs j SET state='failed',error_code=$3,finished_at=clock_timestamp(),updated_at=clock_timestamp(),settled_lease_hash=$2,lease_token_hash=NULL,lease_expires_at=NULL WHERE id=$1 AND state='running' AND lease_token_hash=$2 AND lease_expires_at>clock_timestamp() AND deadline_at>clock_timestamp() RETURNING ${jobColumns}`,
          [jobId, digest, code],
        )
      ).rows[0]!;
      if (!failed)
        throw new BuildLeaseLostError(
          'Build lease expired before failure was recorded',
        );
      await audit(
        sql,
        row.projectId,
        'worker:' + row.workerId,
        'build.failed',
        { jobId, errorCode: code, attempt: row.attempts },
      );
      return jobRow(failed);
    });
  }
  async cancel(
    projectId: string,
    jobId: string,
    subject: string,
  ): Promise<BuildJob> {
    projectId = uuid(projectId);
    jobId = uuid(jobId);
    subject = actor(subject);
    return this.sql.transaction(async (sql) => {
      const row = (
        await sql.query<JobRow>(
          `SELECT ${jobColumns} FROM docs_build_jobs j WHERE project_id=$1 AND id=$2 FOR UPDATE`,
          [projectId, jobId],
        )
      ).rows[0];
      if (!row) throw new BuildNotFoundError('Build job not found');
      if (row.state === 'cancelled') return jobRow(row);
      if (!['queued', 'running'].includes(row.state))
        throw new ConflictError('A finished build cannot be cancelled');
      const cancelled = (
        await sql.query<JobRow>(
          `UPDATE docs_build_jobs j SET state='cancelled',error_code='cancelled',finished_at=clock_timestamp(),updated_at=clock_timestamp(),lease_token_hash=NULL,lease_expires_at=NULL,settled_lease_hash=NULL WHERE id=$1 RETURNING ${jobColumns}`,
          [jobId],
        )
      ).rows[0]!;
      await audit(sql, projectId, subject, 'build.cancelled', {
        jobId,
        sourceId: row.sourceId,
      });
      return jobRow(cancelled);
    });
  }
}
