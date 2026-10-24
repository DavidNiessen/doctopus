import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createServer, connect } from 'node:net';
import type { Socket } from 'node:net';
import { once } from 'node:events';
import pg from 'pg';
import { PostgresRepository } from '@davidniessen/doctopus-storage';

const database = process.env.TEST_DATABASE_URL;
if (!database)
  throw new Error(
    'TEST_DATABASE_URL is required for database deadline acceptance',
  );
const owner = new PostgresRepository(database, { migrate: true });
const bounded = new PostgresRepository(database, {
  statementTimeoutMs: 200,
  queryTimeoutMs: 600,
});
const blocker = new pg.Client({ connectionString: database });
beforeAll(async () => {
  await owner.initialize();
  await blocker.connect();
  await bounded.initialize();
});
afterAll(async () => {
  await Promise.all([owner.close(), bounded.close(), blocker.end()]);
});

async function proxy() {
  const target = new URL(database!);
  const backendHost = target.hostname;
  const backendPort = Number(target.port || 5432);
  const sockets = new Set<Socket>();
  const upstreams = new Set<Socket>();
  let blocked = false;
  const server = createServer((client) => {
    const upstream = connect({
      host: backendHost,
      port: backendPort,
    });
    sockets.add(client);
    sockets.add(upstream);
    upstreams.add(upstream);
    client.on('error', () => upstream.destroy());
    upstream.on('error', () => client.destroy());
    client.on('close', () => {
      sockets.delete(client);
      upstream.destroy();
    });
    upstream.on('close', () => {
      sockets.delete(upstream);
      upstreams.delete(upstream);
      client.destroy();
    });
    client.pipe(upstream).pipe(client);
    if (blocked) upstream.pause();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Proxy listener missing');
  target.hostname = '127.0.0.1';
  target.port = String(address.port);
  return {
    url: target,
    freeze() {
      blocked = true;
      for (const upstream of upstreams) upstream.pause();
    },
    restore() {
      blocked = false;
      for (const upstream of upstreams) upstream.resume();
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

it('bounds real lock waits and recovers ordinary reads after releasing the lock', async () => {
  await blocker.query('BEGIN');
  try {
    await blocker.query('LOCK TABLE docs_projects IN ACCESS EXCLUSIVE MODE');
    const began = Date.now();
    await expect(bounded.projects()).rejects.toMatchObject({
      name: 'RepositoryUnavailableError',
      code: '57014',
    });
    expect(Date.now() - began).toBeLessThan(4000);
  } finally {
    await blocker.query('ROLLBACK');
  }
  expect(await bounded.projects()).toEqual(expect.any(Array));
  expect(await bounded.healthy()).toBe(true);
});
it('rolls back project and role writes when audit insertion times out, then supports a clean retry', async () => {
  const slug = 'deadline-' + randomUUID();
  const input = {
    slug,
    name: 'Bounded transaction',
    visibility: 'private' as const,
    subject: slug,
  };
  await blocker.query('BEGIN');
  try {
    await blocker.query('LOCK TABLE docs_audit IN ACCESS EXCLUSIVE MODE');
    await expect(bounded.createProject(input)).rejects.toMatchObject({
      name: 'RepositoryUnavailableError',
      code: '57014',
    });
    expect(await bounded.project(slug)).toBeUndefined();
    expect(
      (
        await blocker.query(
          'SELECT count(*)::int AS count FROM docs_roles WHERE subject=$1',
          [slug],
        )
      ).rows[0].count,
    ).toBe(0);
  } finally {
    await blocker.query('ROLLBACK');
  }
  const project = await bounded.createProject(input);
  expect(await bounded.role(project.id, slug)).toBe('admin');
  expect(
    (await bounded.audit(project.id)).map((entry) => entry.action),
  ).toEqual(['project.created']);
  await expect(bounded.createProject(input)).rejects.toThrow(
    'Project slug already exists',
  );
  expect(await bounded.healthy()).toBe(true);
});
it('bounds a blackholed response on an authenticated connection and restores health after transport recovery', async () => {
  const link = await proxy();
  link.url.searchParams.set('query_timeout', '0');
  const store = new PostgresRepository(link.url.href, {
    statementTimeoutMs: 200,
    queryTimeoutMs: 600,
  });
  try {
    await store.initialize();
    expect(await store.healthy()).toBe(true);
    link.freeze();
    const began = Date.now();
    expect(await store.healthy()).toBe(false);
    expect(Date.now() - began).toBeLessThan(4000);
    link.restore();
    expect(await store.healthy()).toBe(true);
  } finally {
    link.restore();
    await store.close();
    await link.close();
  }
});
it('discards an indeterminate transaction client when the timeout response is lost', async () => {
  const link = await proxy();
  const application = 'timeout_' + randomUUID();
  link.url.searchParams.set('application_name', application);
  const store = new PostgresRepository(link.url.href, {
    statementTimeoutMs: 1000,
    queryTimeoutMs: 1500,
  });
  const slug = 'wire-' + randomUUID();
  let pending: Promise<unknown> | undefined;
  try {
    await store.initialize();
    await blocker.query('BEGIN');
    await blocker.query('LOCK TABLE docs_audit IN ACCESS EXCLUSIVE MODE');
    pending = store.createProject({
      slug,
      name: 'Interrupted transaction',
      visibility: 'private',
      subject: slug,
    });
    // Observe rejection immediately while inspecting the real backend.
    const outcome = pending.then(
      () => null,
      (error: unknown) => error,
    );
    await expect
      .poll(
        async () => {
          await blocker.query('SELECT pg_stat_clear_snapshot()');
          return (
            await blocker.query(
              'SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type=$2',
              [application, 'Lock'],
            )
          ).rows[0].count;
        },
        { interval: 10, timeout: 900 },
      )
      .toBe(1);
    link.freeze();
    expect(await outcome).toMatchObject({
      name: 'RepositoryUnavailableError',
      message: 'Query read timeout',
    });
    link.restore();
    await blocker.query('ROLLBACK');
    expect(await owner.project(slug)).toBeUndefined();
    expect(
      (
        await blocker.query(
          'SELECT count(*)::int AS count FROM docs_roles WHERE subject=$1',
          [slug],
        )
      ).rows[0].count,
    ).toBe(0);
    expect(await store.healthy()).toBe(true);
    const retry = await store.createProject({
      slug,
      name: 'Retried transaction',
      visibility: 'private',
      subject: slug,
    });
    expect(await store.role(retry.id, slug)).toBe('admin');
  } finally {
    link.restore();
    await blocker.query('ROLLBACK');
    await pending?.catch(() => {});
    await store.close();
    await link.close();
  }
});
