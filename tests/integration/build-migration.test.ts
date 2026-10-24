import { beforeAll, afterAll, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { randomUUID, randomBytes } from 'node:crypto';
import pg from 'pg';
import { PostgresRepository } from '@davidniessen/doctopus-storage';
import { readBuildPolicy } from '@davidniessen/doctopus-contracts';
const database = process.env.TEST_DATABASE_URL;
if (!database)
  throw new Error(
    'TEST_DATABASE_URL is required for migration and runtime-grant acceptance',
  );
const sql = new pg.Client({ connectionString: database });
const schema = 'queue_upgrade_' + randomUUID().replaceAll('-', '');
const scoped = new URL(database);
scoped.searchParams.set('options', '-csearch_path=' + schema);
const upgrade = new PostgresRepository(scoped.href, { migrate: true }),
  runtime = new PostgresRepository(scoped.href);
const runtimeRole = 'queue_runtime_' + randomUUID().replaceAll('-', '');
const password = randomBytes(24).toString('base64url');
let roleCreated = false;
let runtimeClient: pg.Client | undefined;
let runtimeStore: PostgresRepository | undefined;
const quoted = (value: string) => '"' + value.replaceAll('"', '""') + '"';
beforeAll(async () => {
  await sql.connect();
  await sql.query(`CREATE SCHEMA ${quoted(schema)}`);
});
afterAll(async () => {
  await Promise.all([
    upgrade.close(),
    runtime.close(),
    runtimeStore?.close(),
    runtimeClient?.end(),
  ]);
  await sql.query(`DROP SCHEMA IF EXISTS ${quoted(schema)} CASCADE`);
  if (roleCreated) {
    await sql.query(`DROP OWNED BY ${quoted(runtimeRole)}`);
    await sql.query(`DROP ROLE ${quoted(runtimeRole)}`);
  }
  await sql.end();
});
it('upgrades the historical v1 schema atomically while preserving projects, roles and audit history', async () => {
  const old = new pg.Client({ connectionString: scoped.href });
  await old.connect();
  try {
    await old.query(await readFile('tests/fixtures/schema-v1.sql', 'utf8'));
    const id = randomUUID();
    await old.query(
      'INSERT INTO docs_projects(id,slug,name,visibility) VALUES($1,$2,$3,$4)',
      [id, 'historical', 'Historical project', 'private'],
    );
    await old.query(
      'INSERT INTO docs_roles(project_id,subject,role) VALUES($1,$2,$3)',
      [id, 'historical-user', 'editor'],
    );
    await old.query(
      'INSERT INTO docs_audit(project_id,actor,action) VALUES($1,$2,$3)',
      [id, 'historical-user', 'historical.event'],
    );
    await expect(runtime.initialize()).rejects.toThrow(
      'Unsupported database schema',
    );
    await upgrade.initialize();
    await runtime.initialize();
    await upgrade.initialize();
    expect(
      (
        await old.query(
          'SELECT version FROM docs_schema_migrations ORDER BY version',
        )
      ).rows,
    ).toEqual([{ version: 1 }, { version: 2 }]);
    expect((await runtime.project(id))!).toMatchObject({
      id,
      slug: 'historical',
      activePublicationId: null,
    });
    expect(await runtime.role(id, 'historical-user')).toBe('editor');
    expect((await runtime.audit(id)).map((entry) => entry.action)).toEqual([
      'historical.event',
    ]);
    const policy = readBuildPolicy({ image: 'sha256:' + 'a'.repeat(64) });
    const source = await runtime.buildJobs.approveSource(
      id,
      {
        label: 'Migrated source',
        snapshot: {
          digestVersion: 2,
          digest: 'a'.repeat(64),
          bytes: 100,
          files: 1,
        },
        policy,
      },
      randomUUID(),
      'root',
    );
    expect(
      (await runtime.buildJobs.enqueue(id, source.id, randomUUID(), 'root'))
        .state,
    ).toBe('queued');
  } finally {
    await old.end();
  }
});
it('rejects future or incomplete migration histories instead of rewriting them', async () => {
  const old = new pg.Client({ connectionString: scoped.href });
  await old.connect();
  try {
    await old.query('INSERT INTO docs_schema_migrations(version) VALUES(3)');
    await expect(runtime.initialize()).rejects.toThrow(
      'Unsupported database schema',
    );
    await expect(upgrade.initialize()).rejects.toThrow(
      'Unsupported database schema',
    );
    expect(
      (
        await old.query(
          'SELECT version FROM docs_schema_migrations ORDER BY version',
        )
      ).rows,
    ).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }]);
    await old.query(
      'DELETE FROM docs_schema_migrations WHERE version IN (1,3)',
    );
    await expect(runtime.initialize()).rejects.toThrow(
      'Unsupported database schema',
    );
    await expect(upgrade.initialize()).rejects.toThrow(
      'Unsupported database schema',
    );
    expect(
      (
        await old.query(
          'SELECT version FROM docs_schema_migrations ORDER BY version',
        )
      ).rows,
    ).toEqual([{ version: 2 }]);
    await old.query('INSERT INTO docs_schema_migrations(version) VALUES(1)');
  } finally {
    await old.end();
  }
});
it('rolls back a failed new migration and retains the v1 recovery point', async () => {
  const failing = 'queue_partial_' + randomUUID().replaceAll('-', '');
  await sql.query(`CREATE SCHEMA ${quoted(failing)}`);
  const link = new URL(database!);
  link.searchParams.set('options', '-csearch_path=' + failing);
  const prior = new pg.Client({ connectionString: link.href }),
    owner = new PostgresRepository(link.href, { migrate: true });
  await prior.connect();
  try {
    await prior.query(await readFile('tests/fixtures/schema-v1.sql', 'utf8'));
    // A conflicting operator-owned object makes v2 fail after its first DDL.
    await prior.query('CREATE TABLE docs_build_jobs(marker text)');
    await expect(owner.initialize()).rejects.toThrow();
    expect(
      (
        await prior.query(
          'SELECT version FROM docs_schema_migrations ORDER BY version',
        )
      ).rows,
    ).toEqual([{ version: 1 }]);
    expect(
      (await prior.query("SELECT to_regclass('docs_build_sources') AS name"))
        .rows[0].name,
    ).toBe(null);
    expect(
      (
        await prior.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='docs_build_jobs'",
          [failing],
        )
      ).rows,
    ).toEqual([{ column_name: 'marker' }]);
  } finally {
    await owner.close();
    await prior.end();
    await sql.query(`DROP SCHEMA ${quoted(failing)} CASCADE`);
  }
});
it('grants the new queue tables to a separate runtime role and preserves append-only audit and read-only history', async () => {
  const capability = (
    await sql.query(
      'SELECT rolcreaterole,rolsuper FROM pg_roles WHERE rolname=current_user',
    )
  ).rows[0];
  if (!capability.rolcreaterole && !capability.rolsuper)
    throw new Error(
      'The disposable integration owner needs CREATEROLE for runtime-grant acceptance; production migration roles do not.',
    );
  await sql.query(
    `CREATE ROLE ${quoted(runtimeRole)} LOGIN PASSWORD '${password}'`,
  );
  roleCreated = true;
  const ownerName = (await sql.query('SELECT current_user AS name')).rows[0]
    .name as string;
  await sql.query(`GRANT ${quoted(runtimeRole)} TO ${quoted(ownerName)}`);
  const publicOwner = new PostgresRepository(database!, { migrate: true });
  try {
    await publicOwner.initialize();
    await publicOwner.grantRuntimeRole(runtimeRole);
    const connection = new URL(database!);
    connection.username = runtimeRole;
    connection.password = password;
    runtimeStore = new PostgresRepository(connection.href);
    runtimeClient = new pg.Client({ connectionString: connection.href });
    await runtimeClient.connect();
    await runtimeStore.initialize();
    const project = await runtimeStore.createProject({
      slug: 'runtime-' + randomUUID(),
      name: 'Runtime grant',
      visibility: 'private',
      subject: 'root',
    });
    const source = await runtimeStore.buildJobs.approveSource(
      project.id,
      {
        label: 'Runtime source',
        snapshot: {
          digestVersion: 2,
          digest: 'a'.repeat(64),
          bytes: 100,
          files: 1,
        },
        policy: readBuildPolicy({ image: 'sha256:' + 'a'.repeat(64) }),
      },
      randomUUID(),
      'root',
    );
    const job = await runtimeStore.buildJobs.enqueue(
      project.id,
      source.id,
      randomUUID(),
      'root',
    );
    expect(job.state).toBe('queued');
    const lease = await runtimeStore.buildJobs.claim('runtime-worker', [
      source.id,
    ]);
    expect(lease!.job.id).toBe(job.id);
    await runtimeStore.buildJobs.fail(job.id, lease!.token, 'build_failed');
    for (const statement of [
      'DELETE FROM docs_audit WHERE false',
      "UPDATE docs_audit SET action='rewritten' WHERE false",
      'DELETE FROM docs_schema_migrations WHERE false',
      'INSERT INTO docs_schema_migrations(version) VALUES(99)',
    ]) {
      await expect(runtimeClient.query(statement)).rejects.toMatchObject({
        code: '42501',
      });
    }
    expect(await runtimeStore.healthy()).toBe(true);
  } finally {
    await publicOwner.close();
  }
});
