import { beforeAll, afterAll, beforeEach, afterEach, expect, it } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import pg from 'pg';
import { PostgresRepository } from '@davidniessen/doctopus-storage';
import { readBuildPolicy, toolVersion } from '@davidniessen/doctopus-contracts';
import type {
  BuildSource,
  BuildLease,
  BuildResult,
  Project,
} from '@davidniessen/doctopus-domain';
import {
  BuildCapacityError,
  BuildLeaseLostError,
  ConflictError,
} from '@davidniessen/doctopus-domain';
const database = process.env.TEST_DATABASE_URL;
if (!database)
  throw new Error(
    'TEST_DATABASE_URL is required for durable build queue acceptance',
  );
const owner = new PostgresRepository(database, { migrate: true });
const sql = new pg.Client({ connectionString: database });
const queue = owner.buildJobs;
const projects: Project[] = [];
let project: Project, source: BuildSource;
const snapshot = {
  digestVersion: 2 as const,
  digest: 'b'.repeat(64),
  bytes: 100,
  files: 2,
};
const policy = readBuildPolicy({
  image: 'sha256:' + 'a'.repeat(64),
  limits: { timeoutMs: 1000 },
});
const result = (lease: BuildLease): BuildResult => ({
  artifactId: 'c'.repeat(64),
  source: lease.source.snapshot,
  requestedImage: lease.source.policy.image,
  resolvedImage: 'sha256:' + 'a'.repeat(64),
  toolVersion,
  durationMs: 10,
});
async function createProject() {
  const value = await owner.createProject({
    slug: 'queue-' + randomUUID(),
    name: 'Queue acceptance',
    visibility: 'private',
    subject: 'root',
  });
  projects.push(value);
  return value;
}
async function approve(id = project.id, key: string = randomUUID()) {
  return queue.approveSource(
    id,
    { label: 'Approved fixture', snapshot, policy },
    key,
    'root',
  );
}
async function enqueue(
  key: string = randomUUID(),
  id = project.id,
  sourceId = source.id,
) {
  return queue.enqueue(id, sourceId, key, 'root');
}
async function claim() {
  const value = await queue.claim('test-worker', [source.id]);
  expect(value).toBeDefined();
  return value!;
}
beforeAll(async () => {
  await owner.initialize();
  await sql.connect();
});
beforeEach(async () => {
  project = await createProject();
  source = await approve();
});
afterEach(async () => {
  await sql.query('ROLLBACK');
  for (const value of projects.splice(0)) {
    let cursor: string | undefined;
    do {
      const page = await queue.jobs(value.id, cursor);
      for (const job of page.items)
        if (['queued', 'running'].includes(job.state))
          await queue.cancel(value.id, job.id, 'root');
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }
});
afterAll(async () => {
  await Promise.all([sql.end(), owner.close()]);
});

it('serializes source approvals, fingerprints retries and keeps private keys out of read models', async () => {
  const key = 'private-approval-' + randomUUID();
  const approved = await Promise.all(
    Array.from({ length: 5 }, () => approve(project.id, key)),
  );
  expect(new Set(approved.map((item) => item.id)).size).toBe(1);
  await expect(
    queue.approveSource(
      project.id,
      { label: 'Different', snapshot, policy },
      key,
      'root',
    ),
  ).rejects.toBeInstanceOf(ConflictError);
  const page = await queue.sources(project.id);
  expect(page.items).toHaveLength(2);
  expect(page.nextCursor).toBe(null);
  expect(JSON.stringify(page)).not.toContain(key);
  expect(JSON.stringify(page)).not.toMatch(/key_hash|request_hash|matches/);
  expect(approved[0]!.createdAt).toMatch(/T.*Z$/);
  expect(
    (await owner.audit(project.id)).filter(
      (entry) => entry.action === 'build.source.approved',
    ),
  ).toHaveLength(2);
  const other = await createProject();
  expect(await queue.source(other.id, source.id)).toBeUndefined();
});
it('deduplicates concurrent enqueues and rejects cross-project approvals without activating content', async () => {
  const key = 'private-job-' + randomUUID();
  const jobs = await Promise.all(Array.from({ length: 8 }, () => enqueue(key)));
  expect(new Set(jobs.map((job) => job.id)).size).toBe(1);
  expect(jobs[0]).toMatchObject({
    state: 'queued',
    attempts: 0,
    artifactId: null,
    result: null,
  });
  await expect(
    queue.enqueue(project.id, source.id, key, 'someone-else'),
  ).rejects.toBeInstanceOf(ConflictError);
  const other = await createProject();
  await expect(
    queue.enqueue(other.id, source.id, randomUUID(), 'root'),
  ).rejects.toBeInstanceOf(ConflictError);
  expect(await queue.job(other.id, jobs[0]!.id)).toBeUndefined();
  expect(JSON.stringify(jobs)).not.toContain(key);
  expect(JSON.stringify(jobs)).not.toMatch(/token|key_hash|request_hash/);
  expect((await owner.project(project.id))!.activePublicationId).toBe(null);
});
it('enforces bounded pending work globally and per project while preserving idempotent retries', async () => {
  const store = new PostgresRepository(database!, {
    buildQueue: {
      maxPending: 2,
      maxPendingPerProject: 1,
      maxRunning: 2,
      maxRunningPerProject: 1,
    },
  });
  try {
    await store.initialize();
    const limited = store.buildJobs,
      key: string = randomUUID();
    const first = await limited.enqueue(project.id, source.id, key, 'root');
    expect((await limited.enqueue(project.id, source.id, key, 'root')).id).toBe(
      first.id,
    );
    await expect(
      limited.enqueue(project.id, source.id, randomUUID(), 'root'),
    ).rejects.toBeInstanceOf(BuildCapacityError);
    const other = await createProject(),
      otherSource = await approve(other.id);
    await limited.enqueue(other.id, otherSource.id, randomUUID(), 'root');
    const third = await createProject(),
      thirdSource = await approve(third.id);
    await expect(
      limited.enqueue(third.id, thirdSource.id, randomUUID(), 'root'),
    ).rejects.toBeInstanceOf(BuildCapacityError);
    await limited.cancel(project.id, first.id, 'root');
    expect(
      (await limited.enqueue(third.id, thirdSource.id, randomUUID(), 'root'))
        .state,
    ).toBe('queued');
  } finally {
    await store.close();
  }
});
it('leases distinct FIFO jobs under concurrent claimants and only accepts approved worker topics', async () => {
  const jobs = [];
  for (let index = 0; index < 4; index++) jobs.push(await enqueue());
  expect(await queue.claim('test-worker', [randomUUID()])).toBeUndefined();
  const claims = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      queue.claim('worker-' + i, [source.id]),
    ),
  );
  const leases = claims.filter((lease) => lease !== undefined);
  expect(leases).toHaveLength(2);
  expect(new Set(leases.map((lease) => lease.job.id)).size).toBe(2);
  expect(new Set(leases.map((lease) => lease.job.id))).toEqual(
    new Set(jobs.slice(0, 2).map((job) => job.id)),
  );
  for (const lease of leases) {
    expect(lease.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(lease.job)).not.toContain(lease.token);
    expect(JSON.stringify(lease.source)).not.toContain(lease.token);
    expect(
      (
        await sql.query(
          'SELECT strpos(row_to_json(j)::text,$2)::int AS position FROM docs_build_jobs j WHERE id=$1',
          [lease.job.id, lease.token],
        )
      ).rows[0].position,
    ).toBe(0);
    expect(JSON.stringify(await owner.audit(project.id))).not.toContain(
      lease.token,
    );
  }
});
it('enforces global running capacity across projects and resumes the next project after cancellation', async () => {
  const store = new PostgresRepository(database!, {
    buildQueue: { maxRunning: 1 },
  });
  try {
    await store.initialize();
    const first = await enqueue();
    const other = await createProject();
    const otherSource = await approve(other.id);
    const second = await enqueue(randomUUID(), other.id, otherSource.id);
    const allowed = [source.id, otherSource.id];
    const claims = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        store.buildJobs.claim('capacity-' + index, allowed),
      ),
    );
    const leases = claims.filter((lease) => lease !== undefined);
    expect(leases).toHaveLength(1);
    expect(leases[0]!.job.id).toBe(first.id);
    expect(
      await store.buildJobs.claim('capacity-next', allowed),
    ).toBeUndefined();
    await queue.cancel(project.id, first.id, 'root');
    expect(
      (await store.buildJobs.claim('capacity-next', allowed))?.job.id,
    ).toBe(second.id);
    expect(await queue.heartbeat(first.id, leases[0]!.token)).toBeUndefined();
  } finally {
    await store.close();
  }
});
it('heartbeats require current ownership and never extend past the attempt deadline', async () => {
  await enqueue();
  const lease = await claim();
  expect(
    await queue.heartbeat(lease.job.id, randomBytes(32).toString('base64url')),
  ).toBeUndefined();
  await sql.query(
    "UPDATE docs_build_jobs SET deadline_at=clock_timestamp()+interval '3 seconds' WHERE id=$1",
    [lease.job.id],
  );
  const renewed = await queue.heartbeat(lease.job.id, lease.token, 120);
  expect(renewed).toBeDefined();
  expect(renewed!.leaseExpiresAt).toBe(renewed!.deadlineAt);
  await queue.cancel(project.id, lease.job.id, 'root');
  expect(await queue.heartbeat(lease.job.id, lease.token)).toBeUndefined();
});
it('settles verified result metadata idempotently without publishing or exposing lease secrets', async () => {
  await enqueue();
  const lease = await claim(),
    output = result(lease);
  const done = await queue.complete(lease.job.id, lease.token, output);
  expect(done).toMatchObject({
    state: 'succeeded',
    artifactId: output.artifactId,
    result: output,
    leaseExpiresAt: null,
  });
  expect((await queue.complete(lease.job.id, lease.token, output)).id).toBe(
    done.id,
  );
  await expect(
    queue.complete(lease.job.id, lease.token, { ...output, durationMs: 11 }),
  ).rejects.toBeInstanceOf(ConflictError);
  expect((await owner.project(project.id))!.activePublicationId).toBe(null);
  expect(
    (
      await sql.query(
        'SELECT artifact_id FROM docs_artifacts WHERE project_id=$1',
        [project.id],
      )
    ).rows,
  ).toEqual([{ artifact_id: output.artifactId }]);
  const audit = await owner.audit(project.id);
  expect(
    audit.filter((entry) => entry.action === 'build.succeeded'),
  ).toHaveLength(1);
  expect(
    audit.filter((entry) => entry.action === 'artifact.registered'),
  ).toHaveLength(1);
  expect(JSON.stringify(done)).not.toContain(lease.token);
  await queue.revokeSource(project.id, source.id, 'root');
  expect((await queue.complete(lease.job.id, lease.token, output)).state).toBe(
    'succeeded',
  );
});
it('rejects result-policy mismatches atomically and permits a correct completion', async () => {
  await enqueue();
  const lease = await claim(),
    output = result(lease);
  for (const change of [
    { source: { ...output.source, digest: 'd'.repeat(64) } },
    { source: { ...output.source, files: 3 } },
    { requestedImage: 'sha256:' + 'e'.repeat(64) },
    { toolVersion: '99.0.0' },
    { durationMs: 121001 },
  ])
    await expect(
      queue.complete(lease.job.id, lease.token, { ...output, ...change }),
    ).rejects.toThrow();
  expect((await queue.job(project.id, lease.job.id))!.state).toBe('running');
  expect(
    (
      await sql.query(
        'SELECT artifact_id FROM docs_artifacts WHERE project_id=$1',
        [project.id],
      )
    ).rowCount,
  ).toBe(0);
  expect((await queue.complete(lease.job.id, lease.token, output)).state).toBe(
    'succeeded',
  );
});
it('records a controlled terminal failure once and does not permit revival or rewriting its cause', async () => {
  await enqueue();
  const lease = await claim();
  const failed = await queue.fail(lease.job.id, lease.token, 'source_changed');
  expect(failed).toMatchObject({
    state: 'failed',
    errorCode: 'source_changed',
    artifactId: null,
    result: null,
  });
  expect(
    (await queue.fail(lease.job.id, lease.token, 'source_changed')).id,
  ).toBe(failed.id);
  await expect(
    queue.fail(lease.job.id, lease.token, 'build_failed'),
  ).rejects.toBeInstanceOf(ConflictError);
  await expect(
    queue.complete(lease.job.id, lease.token, result(lease)),
  ).rejects.toBeInstanceOf(BuildLeaseLostError);
  await expect(
    queue.cancel(project.id, lease.job.id, 'root'),
  ).rejects.toBeInstanceOf(ConflictError);
  expect(
    (await owner.audit(project.id)).filter(
      (entry) => entry.action === 'build.failed',
    ),
  ).toHaveLength(1);
});
it('revoking an approval cancels unfinished work and invalidates its worker credentials', async () => {
  const key: string = randomUUID(),
    first = await enqueue(key);
  await enqueue();
  const lease = await claim();
  const revoked = await queue.revokeSource(project.id, source.id, 'root');
  expect(revoked.revokedAt).toBeTruthy();
  expect(
    (await queue.jobs(project.id)).items.every(
      (job) => job.state === 'cancelled' && job.errorCode === 'source_revoked',
    ),
  ).toBe(true);
  expect(
    (await queue.revokeSource(project.id, source.id, 'root')).revokedAt,
  ).toBe(revoked.revokedAt);
  expect((await enqueue(key)).id).toBe(first.id);
  await expect(enqueue()).rejects.toBeInstanceOf(ConflictError);
  expect(await queue.heartbeat(lease.job.id, lease.token)).toBeUndefined();
  await expect(
    queue.complete(lease.job.id, lease.token, result(lease)),
  ).rejects.toBeInstanceOf(BuildLeaseLostError);
  expect(
    (await queue.sources(project.id, { activeOnly: true })).items,
  ).toHaveLength(0);
  expect(
    (await owner.audit(project.id)).filter(
      (entry) => entry.action === 'build.source.revoked',
    ),
  ).toHaveLength(1);
});
it('cancels queued and running work idempotently and prevents cancelled artifacts from attaching', async () => {
  const first = await enqueue();
  expect((await queue.cancel(project.id, first.id, 'root')).attempts).toBe(0);
  expect((await queue.cancel(project.id, first.id, 'root')).state).toBe(
    'cancelled',
  );
  expect(await queue.claim('worker', [source.id])).toBeUndefined();
  await enqueue();
  const lease = await claim();
  await queue.cancel(project.id, lease.job.id, 'root');
  await expect(
    queue.complete(lease.job.id, lease.token, result(lease)),
  ).rejects.toBeInstanceOf(BuildLeaseLostError);
  expect(
    (
      await sql.query(
        'SELECT artifact_id FROM docs_artifacts WHERE project_id=$1',
        [project.id],
      )
    ).rowCount,
  ).toBe(0);
});
it('recovers expired leases after their safety window and rejects stale workers across bounded retries', async () => {
  await enqueue();
  const first = await claim();
  await sql.query(
    "UPDATE docs_build_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [first.job.id],
  );
  expect(await queue.recoverExpired()).toBe(1);
  const waiting = (await queue.job(project.id, first.job.id))!;
  expect(waiting).toMatchObject({
    state: 'queued',
    attempts: 1,
    errorCode: 'worker_lost',
  });
  expect(Date.parse(waiting.availableAt)).toBeGreaterThanOrEqual(
    Date.parse(first.job.deadlineAt!),
  );
  expect(await queue.claim('worker', [source.id])).toBeUndefined();
  await sql.query(
    "UPDATE docs_build_jobs SET available_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [first.job.id],
  );
  const second = await claim();
  expect(second.job.attempts).toBe(2);
  expect(second.token).not.toBe(first.token);
  await expect(
    queue.complete(first.job.id, first.token, result(first)),
  ).rejects.toBeInstanceOf(BuildLeaseLostError);
  expect(await queue.heartbeat(first.job.id, first.token)).toBeUndefined();
  for (let attempt = 2; attempt <= 3; attempt++) {
    await sql.query(
      "UPDATE docs_build_jobs SET lease_expires_at=clock_timestamp()-interval '1 second',deadline_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [first.job.id],
    );
    expect(await queue.recoverExpired()).toBe(1);
    if (attempt === 2) expect((await claim()).job.attempts).toBe(3);
  }
  expect((await queue.job(project.id, first.job.id))!).toMatchObject({
    state: 'failed',
    attempts: 3,
    errorCode: 'deadline_exceeded',
  });
  expect(await queue.claim('worker', [source.id])).toBeUndefined();
  expect(await queue.recoverExpired()).toBe(0);
});
it('skips locked expired jobs during recovery and reaps them after the owner releases its lock', async () => {
  await enqueue();
  const lease = await claim();
  await sql.query(
    "UPDATE docs_build_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [lease.job.id],
  );
  await sql.query('BEGIN');
  await sql.query('SELECT id FROM docs_build_jobs WHERE id=$1 FOR UPDATE', [
    lease.job.id,
  ]);
  try {
    expect(await queue.recoverExpired()).toBe(0);
  } finally {
    await sql.query('ROLLBACK');
  }
  expect(await queue.recoverExpired()).toBe(1);
});
it('does not deadlock artifact completion behind approval revocation and foreign-key checks', async () => {
  await enqueue();
  const lease = await claim();
  await sql.query('BEGIN');
  await sql.query('SELECT id FROM docs_build_sources WHERE id=$1 FOR UPDATE', [
    source.id,
  ]);
  const revoking = queue.revokeSource(project.id, source.id, 'root');
  const revokeOutcome = revoking.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  let completing: Promise<unknown> | undefined;
  try {
    await expect
      .poll(
        async () => {
          await sql.query('SELECT pg_stat_clear_snapshot()');
          return (
            await sql.query(
              "SELECT count(*)::int AS count FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%FROM docs_build_sources s WHERE project_id%FOR UPDATE%'",
            )
          ).rows[0].count;
        },
        { timeout: 3000, interval: 10 },
      )
      .toBeGreaterThan(0);
    completing = queue.complete(lease.job.id, lease.token, result(lease));
    let settled = false;
    const observed = completing.then(() => {
      settled = true;
    });
    await expect
      .poll(() => settled, { timeout: 3000, interval: 10 })
      .toBe(true);
    await observed;
  } finally {
    await sql.query('ROLLBACK');
    await Promise.allSettled([revokeOutcome, completing]);
  }
  expect(await revokeOutcome).toHaveProperty('value.revokedAt');
  expect((await queue.job(project.id, lease.job.id))!.state).toBe('succeeded');
});
it('pages complete job and approval histories and frees inventory capacity through revocation', async () => {
  await sql.query(
    "INSERT INTO docs_build_sources(id,project_id,label,snapshot,policy,approved_by,key_hash,request_hash) SELECT gen_random_uuid(),$1,'seed-'||n,$2::jsonb,$3::jsonb,'root',lpad(n::text,64,'0'),repeat('0',64) FROM generate_series(1,999) n",
    [project.id, JSON.stringify(snapshot), JSON.stringify(policy)],
  );
  await expect(approve()).rejects.toBeInstanceOf(BuildCapacityError);
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await queue.sources(project.id, {
      ...(cursor ? { after: cursor } : {}),
    });
    expect(page.items.length).toBeLessThanOrEqual(100);
    ids.push(...page.items.map((item) => item.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  expect(ids).toHaveLength(1000);
  expect(new Set(ids).size).toBe(1000);
  await sql.query(
    'UPDATE docs_build_sources SET revoked_at=clock_timestamp() WHERE project_id=$1',
    [project.id],
  );
  const fresh = await approve();
  expect(
    (await queue.sources(project.id, { activeOnly: true })).items.map(
      (item) => item.id,
    ),
  ).toEqual([fresh.id]);
  await sql.query(
    "INSERT INTO docs_build_jobs(id,project_id,source_id,state,requested_by,key_hash,request_hash,finished_at,error_code) SELECT gen_random_uuid(),$1,$2,'cancelled','root',lpad(n::text,64,'0'),repeat('0',64),clock_timestamp(),'cancelled' FROM generate_series(1,101) n",
    [project.id, fresh.id],
  );
  const first = await queue.jobs(project.id);
  expect(first.items).toHaveLength(100);
  expect(first.nextCursor).toBeTruthy();
  const second = await queue.jobs(project.id, first.nextCursor!);
  expect(second.items).toHaveLength(1);
  expect(second.nextCursor).toBe(null);
  expect(
    new Set([...first.items, ...second.items].map((item) => item.id)).size,
  ).toBe(101);
});
