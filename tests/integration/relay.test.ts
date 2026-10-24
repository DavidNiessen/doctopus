import {
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
  expect,
  it,
  vi,
} from 'vitest';
import {
  createServer as createHttpServer,
  request as httpRequest,
} from 'node:http';
import type { Server, ServerResponse } from 'node:http';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import pg from 'pg';
import { createServer } from '@davidniessen/doctopus-server';
import type { ServerOptions } from '@davidniessen/doctopus-server';
import { PostgresRepository } from '@davidniessen/doctopus-storage';
import type { Project } from '@davidniessen/doctopus-domain';
import type { RelayConfiguration } from '../../apps/server/src/relay-policy.js';

if (!process.env.TEST_DATABASE_URL)
  throw new Error(
    'TEST_DATABASE_URL is required for real relay authorization/audit integration tests',
  );
const repository = new PostgresRepository(process.env.TEST_DATABASE_URL, {
  migrate: true,
});
const rootToken = randomBytes(32).toString('hex'),
  auth = { authorization: 'Bearer ' + rootToken };
const publicUrl = 'http://127.0.0.1:8080';
let app: Awaited<ReturnType<typeof createServer>>,
  upstream: Server,
  project: Project,
  other: Project,
  origin = '',
  root = '';
let mode = 'normal',
  requests = 0,
  closed = 0;
const waiting = new Set<ServerResponse>();
function configuration(
  extra: Partial<RelayConfiguration> = {},
): RelayConfiguration {
  return {
    projects: {
      [project.slug]: {
        destinations: [
          {
            origin,
            pathPrefix: '/allowed/',
            methods: ['GET', 'HEAD', 'POST'],
            allowHttp: true,
            allowPrivateNetwork: true,
          },
        ],
        requestHeaders: [
          'Accept',
          'Content-Type',
          'Authorization',
          'X-Fixture',
        ],
      },
    },
    perMinute: 60,
    ...extra,
  };
}
async function server(
  relay: RelayConfiguration | undefined = configuration(),
  store: ServerOptions['repository'] = repository,
) {
  return createServer({
    repository: store,
    rootToken,
    artifactRoot: root,
    publicUrl,
    insecureDevelopment: true,
    ...(relay ? { relay } : {}),
  });
}
const payload = (extra: Record<string, unknown> = {}) => ({
  url: origin + '/allowed/resource?api_key=private-query',
  method: 'POST',
  headers: [
    ['Authorization', 'Bearer target-secret'],
    ['Content-Type', 'application/octet-stream'],
  ],
  bodyBase64: Buffer.from([0, 255, 128]).toString('base64'),
  ...extra,
});
const call = (
  data: Record<string, unknown> = payload(),
  headers: Record<string, string> = auth,
) =>
  app.inject({
    method: 'POST',
    url: '/api/projects/' + project.slug + '/relay',
    headers,
    payload: data,
  });
beforeAll(async () => {
  await repository.initialize();
  root = await mkdtemp(join(tmpdir(), 'doctopus-relay-integration-'));
  project = await repository.createProject({
    slug: 'relay-' + randomUUID().slice(0, 8),
    name: 'Relay fixture',
    visibility: 'public',
    subject: 'root',
  });
  other = await repository.createProject({
    slug: 'other-' + randomUUID().slice(0, 8),
    name: 'Other fixture',
    visibility: 'public',
    subject: 'root',
  });
  upstream = createHttpServer(async (request, response) => {
    requests++;
    const chunks: Buffer[] = [];
    try {
      for await (const chunk of request) chunks.push(chunk);
    } catch {
      response.destroy();
      return;
    }
    if (mode === 'hang') {
      waiting.add(response);
      response.once('close', () => {
        waiting.delete(response);
        closed++;
      });
      return;
    }
    if (mode === 'redirect') {
      response
        .writeHead(302, {
          Location: origin + '/not-allowed/?secret=redirect-private',
        })
        .end();
      return;
    }
    if (mode === 'large') {
      response.end('x'.repeat(2048));
      return;
    }
    if (mode === 'gzip') {
      response.setHeader('Content-Encoding', 'gzip');
      response.end('compressed');
      return;
    }
    if (mode === 'binary') {
      response
        .writeHead(200, { 'Content-Type': 'application/octet-stream' })
        .end(Buffer.from([0, 255, 13, 10]));
      return;
    }
    response
      .writeHead(201, {
        'Content-Type': 'application/json',
        'Set-Cookie': 'upstream-private=cookie-value',
        'X-Request-Id': 'target-request',
        'X-Unapproved': 'private-header',
      })
      .end(
        JSON.stringify({
          method: request.method,
          authorization: request.headers.authorization,
          cookie: request.headers.cookie ?? null,
          origin: request.headers.origin ?? null,
          userAgent: request.headers['user-agent'],
          bodyBase64: Buffer.concat(chunks).toString('base64'),
        }),
      );
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const address = upstream.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing upstream fixture address');
  origin = `http://127.0.0.1:${address.port}`;
});
beforeEach(async () => {
  mode = 'normal';
  requests = 0;
  closed = 0;
  const noProxy = [
    process.env.NO_PROXY ?? process.env.no_proxy ?? '',
    '127.0.0.1',
  ]
    .filter(Boolean)
    .join(',');
  vi.stubEnv('NO_PROXY', noProxy);
  vi.stubEnv('no_proxy', noProxy);
  vi.stubEnv('LOG_LEVEL', 'silent');
  app = await server();
});
afterEach(async () => {
  await app.close();
  for (const response of waiting) response.destroy();
  upstream.closeAllConnections();
  await vi.waitFor(() => expect(waiting.size).toBe(0));
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await repository.close();
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
});

it('has no relay routes by default and requires an audit writer when configured', async () => {
  await app.close();
  app = await createServer({
    repository,
    rootToken,
    artifactRoot: root,
    publicUrl,
    insecureDevelopment: true,
  });
  expect(
    (
      await app.inject({
        url: '/api/projects/' + project.slug + '/relay',
        headers: auth,
      })
    ).statusCode,
  ).toBe(404);
  const noAudit = Object.create(repository) as ServerOptions['repository'];
  Object.defineProperty(noAudit, 'recordRelay', { value: undefined });
  await expect(
    createServer({
      repository: noAudit,
      rootToken,
      artifactRoot: root,
      publicUrl,
      insecureDevelopment: true,
      relay: configuration(),
    }),
  ).rejects.toThrow(/RelayAuditWriter/);
});
it('denies anonymous and unassigned identities even on a public project', async () => {
  expect(
    (await app.inject({ url: '/api/projects/' + project.slug + '/relay' }))
      .statusCode,
  ).toBe(401);
  const token = randomBytes(32).toString('hex');
  await repository.createSession(
    createHash('sha256').update(token).digest('hex'),
    'unassigned',
    new Date(Date.now() + 60000),
  );
  expect(
    (
      await app.inject({
        url: '/api/projects/' + project.slug + '/relay',
        headers: { cookie: 'docs_session=' + token },
      })
    ).statusCode,
  ).toBe(403);
  expect(requests).toBe(0);
});
it('returns bounded project policy only to members and refuses projects without an operator rule', async () => {
  const result = await app.inject({
    url: '/api/projects/' + project.slug + '/relay',
    headers: auth,
  });
  expect(result.statusCode).toBe(200);
  expect(result.headers['cache-control']).toBe('no-store');
  expect(result.json()).toMatchObject({
    schemaVersion: 1,
    project: project.slug,
    destinations: [
      { origin, pathPrefix: '/allowed/', methods: ['GET', 'HEAD', 'POST'] },
    ],
  });
  expect(JSON.stringify(result.json())).not.toContain('allowPrivateNetwork');
  expect(
    (
      await app.inject({
        url: '/api/projects/' + other.slug + '/relay',
        headers: auth,
      })
    ).statusCode,
  ).toBe(404);
});
it('relays exact bytes and only explicit target credentials, with filtered response headers', async () => {
  const result = await call();
  expect(result.statusCode).toBe(200);
  const returned = result.json();
  expect(returned.status).toBe(201);
  expect(returned.headers).toEqual({
    'content-type': 'application/json',
    'x-request-id': 'target-request',
  });
  expect(result.headers['set-cookie']).toBeUndefined();
  expect(
    JSON.parse(Buffer.from(returned.bodyBase64, 'base64').toString()),
  ).toMatchObject({
    authorization: 'Bearer target-secret',
    cookie: null,
    origin: null,
    bodyBase64: Buffer.from([0, 255, 128]).toString('base64'),
  });
  expect(requests).toBe(1);
  expect(result.headers['x-doctopus-relay-id']).toBeTypeOf('string');
  const records = (await repository.audit(project.id)).filter(
    (record) =>
      (record.metadata as { requestId: string }).requestId ===
      result.headers['x-doctopus-relay-id'],
  );
  expect(records.map((record) => record.action).sort()).toEqual([
    'relay.completed',
    'relay.started',
  ]);
  for (const secret of [
    'target-secret',
    'private-query',
    rootToken,
    'cookie-value',
    'private-header',
  ])
    expect(JSON.stringify(records)).not.toContain(secret);
  mode = 'binary';
  const binary = await call();
  expect(binary.statusCode).toBe(200);
  expect(Buffer.from(binary.json().bodyBase64, 'base64')).toEqual(
    Buffer.from([0, 255, 13, 10]),
  );
});
it('keeps documentation cookies out of target headers and enforces mutation origin', async () => {
  const login = await app.inject({
    method: 'POST',
    url: '/auth/token',
    headers: auth,
  });
  const cookie = String(login.headers['set-cookie']).split(';')[0]!;
  expect(
    (await call(payload(), { cookie, origin: 'https://wrong.example.test' }))
      .statusCode,
  ).toBe(403);
  const result = await call(payload(), { cookie, origin: publicUrl });
  expect(result.statusCode).toBe(200);
  expect(
    JSON.parse(Buffer.from(result.json().bodyBase64, 'base64').toString())
      .cookie,
  ).toBeNull();
  expect(requests).toBe(1);
});
it('checks token project scope and revocation on every request', async () => {
  const token = await app.inject({
    method: 'POST',
    url: '/api/projects/' + project.id + '/tokens',
    headers: auth,
    payload: { label: 'Relay reader', role: 'viewer', expiresInDays: 1 },
  });
  expect(token.statusCode).toBe(201);
  const issued = token.json(),
    headers = { authorization: 'Bearer ' + issued.token };
  expect((await call(payload(), headers)).statusCode).toBe(200);
  expect(
    (
      await app.inject({
        url: '/api/projects/' + other.slug + '/relay',
        headers,
      })
    ).statusCode,
  ).toBe(403);
  await repository.revokeToken(project.id, issued.id, 'root');
  expect((await call(payload(), headers)).statusCode).toBe(401);
  expect(requests).toBe(1);
});
it('honors configured minimum roles and fresh cookie-identity role revocation', async () => {
  await app.close();
  const config = configuration();
  config.projects[project.slug]!.minimumRole = 'editor';
  app = await server(config);
  const token = randomBytes(32).toString('hex'),
    subject = 'relay-reader-' + randomUUID();
  await repository.createSession(
    createHash('sha256').update(token).digest('hex'),
    subject,
    new Date(Date.now() + 60000),
  );
  const headers = { cookie: 'docs_session=' + token, origin: publicUrl };
  await repository.setRole(project.id, subject, 'viewer', 'root');
  expect((await call(payload(), headers)).statusCode).toBe(403);
  await repository.setRole(project.id, subject, 'editor', 'root');
  expect((await call(payload(), headers)).statusCode).toBe(200);
  await repository.setRole(project.id, subject, null, 'root');
  expect((await call(payload(), headers)).statusCode).toBe(403);
  expect(requests).toBe(1);
});
it.each([
  { url: 'http://169.254.169.254/latest/meta-data/' },
  { url: 'http://127.0.0.1:1/allowed/' },
  { url: () => origin + '/outside/' },
  { url: () => origin + '/allowed/%252foutside' },
  { method: 'DELETE' },
  { headers: [['Cookie', 'docs_session=private']] },
  {
    headers: [
      ['Authorization', 'one'],
      ['authorization', 'two'],
    ],
  },
])(
  'rejects destination/method/header violations before contact %#',
  async (overrides) => {
    const extra: Record<string, unknown> = { ...overrides };
    if (typeof extra.url === 'function') extra.url = extra.url();
    expect((await call(payload(extra))).statusCode).toBe(403);
    expect(requests).toBe(0);
  },
);
it('rejects unknown fields, coerced types, excessive bytes and noncanonical base64', async () => {
  for (const data of [
    payload({ allowPrivateNetwork: true }),
    payload({ headers: { Authorization: 'private' } }),
    payload({ bodyBase64: 'YQ=' }),
    payload({ bodyBase64: 'YR==' }),
    payload({ bodyBase64: '!bad' }),
  ])
    expect([400, 403]).toContain((await call(data)).statusCode);
  await app.close();
  app = await server({ ...configuration(), maxRequestBytes: 2 });
  expect((await call()).statusCode).toBe(403);
  expect(requests).toBe(0);
});
it('enforces network policy even when the origin/path is listed', async () => {
  await app.close();
  const config = configuration();
  config.projects[project.slug]!.destinations[0]!.allowPrivateNetwork = false;
  app = await server(config);
  expect((await call()).statusCode).toBe(502);
  expect(requests).toBe(0);
});
it.each(['redirect', 'gzip', 'large'])(
  'does not follow redirects or return unsupported/excessive response data: %s',
  async (value) => {
    await app.close();
    app = await server({ ...configuration(), maxResponseBytes: 1024 });
    mode = value;
    const result = await call();
    expect(result.statusCode).toBe(502);
    expect(JSON.stringify(result.json())).not.toContain('private');
    expect(requests).toBe(1);
  },
);
it('times out a slow target and frees the lease for a subsequent call', async () => {
  await app.close();
  app = await server({
    ...configuration(),
    timeoutMs: 100,
    maxConcurrent: 1,
    maxConcurrentPerMember: 1,
  });
  mode = 'hang';
  const timedOut = await call();
  expect(timedOut.statusCode).toBe(504);
  await vi.waitFor(async () => {
    const records = await repository.audit(project.id);
    expect(
      records.some(
        (record) =>
          record.action === 'relay.failed' &&
          (record.metadata as { requestId: string }).requestId ===
            timedOut.headers['x-doctopus-relay-id'],
      ),
    ).toBe(true);
  });
  mode = 'normal';
  expect((await call()).statusCode).toBe(200);
});
it('limits active requests and retains the lease until response completion', async () => {
  await app.close();
  app = await server({
    ...configuration(),
    maxConcurrent: 1,
    maxConcurrentPerMember: 1,
  });
  mode = 'hang';
  const first = call();
  await vi.waitFor(() => expect(requests).toBe(1));
  expect((await call()).statusCode).toBe(429);
  for (const response of waiting) response.end('completed');
  expect((await first).statusCode).toBe(200);
  mode = 'normal';
  expect((await call()).statusCode).toBe(200);
});
it('applies a separate bounded relay rate bucket', async () => {
  await app.close();
  app = await server({ ...configuration(), perMinute: 1 });
  expect(
    (
      await app.inject({
        url: '/api/projects/' + project.slug + '/relay',
        headers: auth,
      })
    ).statusCode,
  ).toBe(200);
  expect((await call()).statusCode).toBe(429);
  expect(
    (
      await app.inject({
        url: '/api/projects/%72' + project.slug.slice(1) + '/relay',
        headers: auth,
      })
    ).statusCode,
  ).toBe(429);
  expect(
    (
      await app.inject({
        url: '/api/projects/' + project.slug + '/relay',
        headers: { authorization: 'Bearer invalid' },
      })
    ).statusCode,
  ).toBe(429);
  expect(requests).toBe(0);
});
it('cancels the target exchange when the real HTTP client disconnects', async () => {
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  mode = 'hang';
  const controller = new AbortController();
  const pending = fetch(base + '/api/projects/' + project.slug + '/relay', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify(payload()),
    signal: controller.signal,
  }).catch((error) => error);
  await vi.waitFor(() => expect(waiting.size).toBe(1));
  controller.abort();
  await pending;
  await vi.waitFor(() => expect(closed).toBe(1));
  mode = 'normal';
  expect((await call()).statusCode).toBe(200);
});
it('fails closed before contact when the required start audit cannot be recorded', async () => {
  await app.close();
  const store = Object.create(repository) as PostgresRepository;
  store.recordRelay = async () => {
    throw new Error('private-audit-error');
  };
  app = await server({ ...configuration(), maxConcurrent: 1 }, store);
  const result = await call();
  expect(result.statusCode).toBe(502);
  expect(JSON.stringify(result.json())).not.toContain('private');
  expect(requests).toBe(0);
  store.recordRelay = (...args) => repository.recordRelay(...args);
  expect((await call()).statusCode).toBe(200);
});
it('cancels a locked audit statement before contact and recovers after unlock', async () => {
  const lock = new pg.Client({
    connectionString: process.env.TEST_DATABASE_URL,
  });
  await lock.connect();
  try {
    await lock.query('BEGIN');
    await lock.query('LOCK TABLE docs_audit IN ACCESS EXCLUSIVE MODE');
    const result = await call();
    expect(result.statusCode).toBe(502);
    expect(requests).toBe(0);
    const pending = await lock.query<{ count: string }>(
      `SELECT count(*) FROM pg_stat_activity WHERE usename=current_user
       AND wait_event_type='Lock' AND query LIKE 'INSERT INTO docs_audit%'`,
    );
    expect(pending.rows[0]?.count).toBe('0');
  } finally {
    await lock.query('ROLLBACK');
    await lock.end();
  }
  expect((await call()).statusCode).toBe(200);
});
it('reports a failed completion audit without repeating an upstream mutation', async () => {
  await app.close();
  const store = Object.create(repository) as PostgresRepository;
  store.recordRelay = (project, subject, event) =>
    event.phase === 'completed'
      ? Promise.reject(new Error('private-audit-error'))
      : repository.recordRelay(project, subject, event);
  app = await server(configuration(), store);
  const result = await call();
  expect(result.statusCode).toBe(502);
  expect(requests).toBe(1);
  await app.close();
  const records = (await repository.audit(project.id)).filter(
    (record) =>
      (record.metadata as { requestId: string }).requestId ===
      result.headers['x-doctopus-relay-id'],
  );
  expect(records.map((record) => record.action).sort()).toEqual([
    'relay.failed',
    'relay.started',
  ]);
  expect(JSON.stringify(records)).not.toContain('private-audit-error');
});
it('bounds a stalled start audit and sends no request after its deadline', async () => {
  await app.close();
  const store = Object.create(repository) as PostgresRepository;
  store.recordRelay = () => new Promise(() => {});
  app = await server({ ...configuration(), timeoutMs: 50 }, store);
  expect((await call()).statusCode).toBe(504);
  expect(requests).toBe(0);
});
it('reserves the global/member slot before parsing a stalled upload', async () => {
  await app.close();
  app = await server({
    ...configuration(),
    timeoutMs: 5000,
    maxConcurrent: 1,
    maxConcurrentPerMember: 1,
  });
  let entered: () => void = () => {};
  const parsing = new Promise<void>((resolve) => {
    entered = resolve;
  });
  app.addHook('preParsing', async (request, _reply, payload) => {
    if (request.headers['x-slow-fixture']) entered();
    return payload;
  });
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  const upload = httpRequest(
    base + '/api/projects/' + project.slug + '/relay',
    {
      method: 'POST',
      headers: {
        ...auth,
        'content-type': 'application/json',
        'content-length': '1000',
        'x-slow-fixture': 'yes',
      },
    },
  );
  const closed = new Promise<void>((resolve) => {
    upload.once('close', resolve);
  });
  upload.on('error', () => {});
  upload.write('{"url":');
  await parsing;
  expect((await call()).statusCode).toBe(429);
  expect(requests).toBe(0);
  upload.destroy();
  await closed;
  await vi.waitFor(async () => expect((await call()).statusCode).toBe(200));
});
it('closes a stalled upload at its deadline without sending target data', async () => {
  await app.close();
  app = await server({ ...configuration(), timeoutMs: 100 });
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  const upload = httpRequest(
    base + '/api/projects/' + project.slug + '/relay',
    {
      method: 'POST',
      headers: {
        ...auth,
        'content-type': 'application/json',
        'content-length': '1000',
      },
    },
  );
  let failure = '';
  upload.on('error', (error) => {
    failure = error.message;
  });
  const closed = new Promise<void>((resolve) => upload.once('close', resolve));
  const guard = setTimeout(
    () => upload.destroy(new Error('Fixture guard timeout')),
    2000,
  );
  upload.write('{"url":');
  try {
    await closed;
  } finally {
    clearTimeout(guard);
  }
  expect(failure).not.toBe('Fixture guard timeout');
  expect(requests).toBe(0);
});
it('retains the lease for a pending audit after its client disconnects', async () => {
  await app.close();
  const store = Object.create(repository) as PostgresRepository;
  let entered: () => void = () => {},
    acknowledge: () => void = () => {};
  const auditing = new Promise<void>((resolve) => {
    entered = resolve;
  });
  store.recordRelay = () => {
    entered();
    return new Promise<void>((resolve) => {
      acknowledge = resolve;
    });
  };
  app = await server(
    { ...configuration(), maxConcurrent: 1, maxConcurrentPerMember: 1 },
    store,
  );
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  const disconnected = new Promise<void>((resolve) =>
    app.server.once('connection', (socket) =>
      socket.once('close', () => resolve()),
    ),
  );
  const controller = new AbortController();
  const pending = fetch(base + '/api/projects/' + project.slug + '/relay', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify(payload()),
    signal: controller.signal,
  }).catch((error) => error);
  await auditing;
  controller.abort();
  await pending;
  await disconnected;
  expect((await call()).statusCode).toBe(429);
  expect(requests).toBe(0);
  store.recordRelay = (...args) => repository.recordRelay(...args);
  acknowledge();
  await vi.waitFor(async () => expect((await call()).statusCode).toBe(200));
});
it('aborts active exchanges during shutdown', async () => {
  mode = 'hang';
  const pending = call();
  await vi.waitFor(() => expect(requests).toBe(1));
  await app.close();
  const result = await pending;
  expect(result.statusCode).toBe(504);
  await vi.waitFor(() => expect(closed).toBe(1));
  const records = (await repository.audit(project.id)).filter(
    (record) =>
      (record.metadata as { requestId: string }).requestId ===
      result.headers['x-doctopus-relay-id'],
  );
  expect(records.map((record) => record.action).sort()).toEqual([
    'relay.failed',
    'relay.started',
  ]);
});
