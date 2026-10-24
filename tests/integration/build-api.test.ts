import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { PostgresRepository } from '@davidniessen/doctopus-storage';
import { createServer } from '@davidniessen/doctopus-server';
import { buildSite, inspectIsolatedSource } from '@davidniessen/doctopus-cli';
import { readBuildPolicy, toolVersion } from '@davidniessen/doctopus-contracts';
import type {
  BuildJob,
  BuildLease,
  BuildSource,
  Project,
  Role,
} from '@davidniessen/doctopus-domain';

const database = process.env.TEST_DATABASE_URL;
if (!database)
  throw new Error('TEST_DATABASE_URL is required for build API acceptance');
const repository = new PostgresRepository(database, { migrate: true });
const rootToken = randomBytes(32).toString('base64url');
const auth = { authorization: 'Bearer ' + rootToken };
const origin = 'http://127.0.0.1:8080';
const policy = readBuildPolicy({
  image: 'sha256:' + 'a'.repeat(64),
  limits: { timeoutMs: 1000 },
});
let app: Awaited<ReturnType<typeof createServer>>;
let root = '',
  artifactRoot = '',
  artifactId = '';
let project: Project, other: Project;
let snapshot: Awaited<ReturnType<typeof inspectIsolatedSource>>;
let viewer: Awaited<ReturnType<typeof credential>>;
let editor: Awaited<ReturnType<typeof credential>>;
let admin: Awaited<ReturnType<typeof credential>>;
let outsider: Awaited<ReturnType<typeof credential>>;
const projects: Project[] = [];
const path = () => `/api/projects/${project.id}`;
async function credential(role: Role, projectId = project.id) {
  const token = randomBytes(32).toString('base64url');
  const id = await repository.createToken(
    projectId,
    createHash('sha256').update(token).digest('hex'),
    'Build API fixture',
    role,
    new Date(Date.now() + 3600000),
    'root',
  );
  return { id, token, headers: { authorization: 'Bearer ' + token } };
}
async function approve(projectId = project.id) {
  const response = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/build-sources`,
    headers: auth,
    payload: {
      label: 'Prepared fixture',
      snapshot,
      policy,
      idempotencyKey: randomUUID(),
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json<BuildSource>();
}
async function enqueue(sourceId: string, projectId = project.id) {
  const response = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/builds`,
    headers: auth,
    payload: { sourceId, idempotencyKey: randomUUID() },
  });
  expect(response.statusCode).toBe(201);
  return response.json<BuildJob>();
}
async function claim(sourceId: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/build-workers/claim',
    headers: auth,
    payload: { workerId: 'api-test-worker', sourceIds: [sourceId] },
  });
  expect(response.statusCode).toBe(200);
  const lease = response.json<{ lease: BuildLease }>().lease;
  expect(lease).toBeTruthy();
  return lease;
}
function completion(lease: BuildLease) {
  return {
    token: lease.token,
    result: {
      artifactId,
      source: lease.source.snapshot,
      requestedImage: policy.image,
      resolvedImage: policy.image,
      toolVersion,
      durationMs: 1,
    },
  };
}
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'doctopus-build-api-'));
  artifactRoot = join(root, 'artifacts');
  await repository.initialize();
  project = await repository.createProject({
    slug: 'build-api-' + randomUUID(),
    name: 'Build API',
    visibility: 'private',
    subject: 'root',
  });
  other = await repository.createProject({
    slug: 'build-public-' + randomUUID(),
    name: 'Public metadata isolation',
    visibility: 'public',
    subject: 'root',
  });
  projects.push(project, other);
  [viewer, editor, admin, outsider] = await Promise.all([
    credential('viewer'),
    credential('editor'),
    credential('admin'),
    credential('viewer', other.id),
  ]);
  const source = join(root, 'source');
  await cp(resolve('examples/demo'), source, {
    recursive: true,
    filter: (file) =>
      !file.includes('.doctopus') && !file.includes('.api-docs'),
  });
  const config = join(source, 'docs.config.yaml');
  await writeFile(
    config,
    (await readFile(config, 'utf8')) + `\nbasePath: /docs/${project.slug}\n`,
  );
  snapshot = await inspectIsolatedSource(source);
  const built = await buildSite(source);
  artifactId = built.manifest.artifactDigest;
  await cp(built.directory, join(artifactRoot, artifactId), {
    recursive: true,
  });
  app = await createServer({
    repository,
    artifactRoot,
    rootToken,
    publicUrl: origin,
    insecureDevelopment: true,
  });
});
afterEach(async () => {
  for (const item of projects) {
    let after: string | undefined;
    do {
      const page = await repository.buildJobs.jobs(item.id, after);
      for (const job of page.items)
        if (job.state === 'queued' || job.state === 'running')
          await repository.buildJobs.cancel(item.id, job.id, 'root');
      after = page.nextCursor ?? undefined;
    } while (after);
  }
});
afterAll(async () => {
  try {
    await app?.close();
  } finally {
    await repository.close();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

it('keeps build metadata private even on public documentation and rechecks scoped membership', async () => {
  expect((await app.inject('/api/me')).json().builds).toBe(true);
  const source = await approve();
  const job = await enqueue(source.id);
  for (const suffix of [
    '/capabilities',
    '/build-capabilities',
    '/build-sources',
    `/build-sources/${source.id}`,
    '/builds',
    `/builds/${job.id}`,
  ]) {
    expect((await app.inject(path() + suffix)).statusCode).toBe(401);
    expect(
      (await app.inject({ url: path() + suffix, headers: outsider.headers }))
        .statusCode,
    ).toBe(403);
    const response = await app.inject({
      url: path() + suffix,
      headers: viewer.headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).not.toMatch(
      /key_hash|request_hash|lease_token|settled_lease|hostPath/,
    );
  }
  for (const suffix of ['/builds', '/build-capabilities', '/capabilities'])
    expect(
      (await app.inject(`/api/projects/${other.id}${suffix}`)).statusCode,
    ).toBe(401);
  expect(
    (
      await app.inject({
        url: `/api/projects/${other.id}/build-sources/${source.id}`,
        headers: outsider.headers,
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await app.inject({
        url: `/api/projects/${other.id}/builds/${job.id}`,
        headers: outsider.headers,
      })
    ).statusCode,
  ).toBe(404);
});
it('keeps embedded repositories without a queue usable and leaves build routes unavailable', async () => {
  let roleLookups = 0;
  const embedded = new Proxy(repository, {
    get(target, name) {
      if (name === 'buildJobs') return undefined;
      if (name === 'role')
        return (...args: Parameters<typeof target.role>) => {
          roleLookups++;
          return target.role(...args);
        };
      const value = Reflect.get(target, name);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const server = await createServer({
    repository: embedded,
    artifactRoot,
    rootToken,
    publicUrl: origin,
    insecureDevelopment: true,
  });
  try {
    expect((await server.inject('/health/ready')).statusCode).toBe(200);
    const listed = await server.inject({ url: '/api/projects', headers: auth });
    expect(listed.statusCode).toBe(200);
    expect(
      listed.json<Project[]>().some((item) => item.id === project.id),
    ).toBe(true);
    const scoped = await server.inject({
      url: '/api/projects',
      headers: viewer.headers,
    });
    expect(scoped.statusCode).toBe(200);
    expect(scoped.json<Project[]>().map((item) => item.id)).toEqual([
      project.id,
    ]);
    expect(roleLookups).toBe(0);
    expect((await server.inject('/api/me')).json().builds).toBe(false);
    expect(
      (
        await server.inject({ url: path() + '/capabilities', headers: auth })
      ).json(),
    ).toEqual({
      projectId: project.id,
      publish: true,
      manageAccess: true,
      readAudit: true,
    });
    expect(
      (
        await server.inject({
          url: path() + '/build-capabilities',
          headers: auth,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await server.inject({ url: path() + '/builds', headers: auth }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await server.inject({
          method: 'POST',
          url: '/api/build-workers/claim',
          headers: auth,
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
  } finally {
    await server.close();
  }
});
it('reserves executable-source approvals and worker operations for the operator', async () => {
  for (const headers of [
    undefined,
    viewer.headers,
    editor.headers,
    admin.headers,
  ]) {
    const requestHeaders = headers ?? {};
    expect(
      (
        await app.inject({
          method: 'POST',
          url: path() + '/build-sources',
          headers: requestHeaders,
          payload: {
            label: 'Denied',
            snapshot,
            policy,
            idempotencyKey: randomUUID(),
          },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/build-workers/claim',
          headers: requestHeaders,
          payload: { workerId: 'denied', sourceIds: [randomUUID()] },
        })
      ).statusCode,
    ).toBe(403);
    for (const suffix of ['heartbeat', 'complete', 'fail'])
      expect(
        (
          await app.inject({
            method: 'POST',
            url: path() + `/builds/${randomUUID()}/${suffix}`,
            headers: requestHeaders,
            payload: {},
          })
        ).statusCode,
      ).toBe(403);
  }
});
it('enqueues approved sources idempotently for editors, rejects changed retries and checks revocation before replay', async () => {
  const source = await approve();
  const payload = {
    sourceId: source.id,
    idempotencyKey: 'private-api-key-' + randomUUID(),
  };
  const denied = await app.inject({
    method: 'POST',
    url: path() + '/builds',
    headers: viewer.headers,
    payload,
  });
  expect(denied.statusCode).toBe(403);
  const first = await app.inject({
    method: 'POST',
    url: path() + '/builds',
    headers: editor.headers,
    payload,
  });
  expect(first.statusCode).toBe(201);
  expect(first.body).not.toContain(payload.idempotencyKey);
  const second = await app.inject({
    method: 'POST',
    url: path() + '/builds',
    headers: editor.headers,
    payload,
  });
  expect(second.json().id).toBe(first.json().id);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: path() + '/builds',
        headers: editor.headers,
        payload: { ...payload, sourceId: randomUUID() },
      })
    ).statusCode,
  ).toBe(409);
  const transient = await credential('editor');
  const retry = { sourceId: source.id, idempotencyKey: randomUUID() };
  expect(
    (
      await app.inject({
        method: 'POST',
        url: path() + '/builds',
        headers: transient.headers,
        payload: retry,
      })
    ).statusCode,
  ).toBe(201);
  await repository.revokeToken(project.id, transient.id, 'root');
  expect(
    (
      await app.inject({
        method: 'POST',
        url: path() + '/builds',
        headers: transient.headers,
        payload: retry,
      })
    ).statusCode,
  ).toBe(401);
});
it('rejects unknown, executable, unbounded and malformed approval inputs without reflecting them', async () => {
  const valid = {
    label: 'Prepared',
    snapshot,
    policy,
    idempotencyKey: randomUUID(),
  };
  for (const patch of [
    { hostPath: '/private/operator/path' },
    { policy: { ...policy, image: 'builder:latest' } },
    { policy: { ...policy, config: '../outside.yaml' } },
    { policy: { ...policy, trustPlugins: null } },
    {
      policy: {
        ...policy,
        environment: { PRIVATE_MARKER: 'must-not-reflect' },
      },
    },
    { policy: { ...policy, limits: { ...policy.limits, cpus: 99 } } },
    { snapshot: { ...snapshot, digest: 'changed' } },
    { idempotencyKey: '' },
    { label: '\u0000invalid' },
  ]) {
    const response = await app.inject({
      method: 'POST',
      url: path() + '/build-sources',
      headers: auth,
      payload: { ...valid, ...patch },
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toMatch(
      /must-not-reflect|PRIVATE_MARKER|\/private\/operator/,
    );
  }
  expect(
    (
      await app.inject({
        method: 'POST',
        url: path() + '/build-sources',
        headers: auth,
        payload: { ...valid, label: 'x'.repeat(65536) },
      })
    ).statusCode,
  ).toBe(413);
  expect(
    (await app.inject({ url: path() + '/builds?after=invalid', headers: auth }))
      .statusCode,
  ).toBe(400);
  expect(
    (
      await app.inject({
        url: path() + '/build-sources?activeOnly=maybe',
        headers: auth,
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (await app.inject({ url: path() + '/builds?unknown=true', headers: auth }))
      .statusCode,
  ).toBe(400);
});
it('requires the configured origin for cookie mutations, including worker leases', async () => {
  const login = await app.inject({
    method: 'POST',
    url: '/auth/token',
    headers: auth,
  });
  expect(login.statusCode).toBe(200);
  const cookies = {
    docs_session: login.cookies.find((item) => item.name === 'docs_session')!
      .value,
  };
  const payload = { workerId: 'cookie-worker', sourceIds: [randomUUID()] };
  for (const requestOrigin of [undefined, 'https://other.example.test']) {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/build-workers/claim',
          cookies,
          headers: requestOrigin ? { origin: requestOrigin } : {},
          payload,
        })
      ).statusCode,
    ).toBe(403);
  }
  const allowed = await app.inject({
    method: 'POST',
    url: '/api/build-workers/claim',
    cookies,
    headers: { origin },
    payload,
  });
  expect(allowed.statusCode).toBe(200);
  expect(allowed.json()).toEqual({ lease: null });
});
it('returns lease secrets only to the operator claim and fences cancelled owners', async () => {
  const source = await approve();
  const job = await enqueue(source.id);
  const lease = await claim(source.id);
  const url = path() + `/builds/${job.id}`;
  expect(lease.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(
    (await app.inject({ url, headers: viewer.headers })).body,
  ).not.toContain(lease.token);
  const heartbeat = await app.inject({
    method: 'POST',
    url: url + '/heartbeat',
    headers: auth,
    payload: { token: lease.token, leaseSeconds: 120 },
  });
  expect(heartbeat.json().owned).toBe(true);
  expect(heartbeat.body).not.toContain(lease.token);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: url + '/cancel',
        headers: viewer.headers,
        payload: {},
      })
    ).statusCode,
  ).toBe(403);
  const cancelled = await app.inject({
    method: 'POST',
    url: url + '/cancel',
    headers: editor.headers,
    payload: {},
  });
  expect(cancelled.json().state).toBe('cancelled');
  expect(
    (
      await app.inject({
        method: 'POST',
        url: url + '/heartbeat',
        headers: auth,
        payload: { token: lease.token },
      })
    ).json(),
  ).toEqual({ owned: false });
  expect(
    (
      await app.inject({
        method: 'POST',
        url: url + '/complete',
        headers: auth,
        payload: completion(lease),
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: url + '/fail',
        headers: auth,
        payload: { token: lease.token, code: 'build_failed' },
      })
    ).statusCode,
  ).toBe(409);
});
it('revokes a source for project administrators and cancels its unfinished work', async () => {
  const source = await approve();
  const job = await enqueue(source.id);
  const lease = await claim(source.id);
  const url = path() + `/build-sources/${source.id}/revoke`;
  expect(
    (
      await app.inject({
        method: 'POST',
        url,
        headers: editor.headers,
        payload: {},
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: 'POST',
        url,
        headers: admin.headers,
        payload: {},
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await app.inject({
        method: 'POST',
        url,
        headers: admin.headers,
        payload: {},
      })
    ).statusCode,
  ).toBe(200);
  expect((await repository.buildJobs.job(project.id, job.id))?.errorCode).toBe(
    'source_revoked',
  );
  expect(
    await repository.buildJobs.heartbeat(job.id, lease.token),
  ).toBeUndefined();
  const active = await app.inject({
    url: path() + '/build-sources?activeOnly=true',
    headers: viewer.headers,
  });
  expect(
    active.json().items.some((item: BuildSource) => item.id === source.id),
  ).toBe(false);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: path() + '/builds',
        headers: editor.headers,
        payload: { sourceId: source.id, idempotencyKey: randomUUID() },
      })
    ).statusCode,
  ).toBe(409);
});
it('verifies actual staged bytes before idempotent completion and never activates the build', async () => {
  const source = await approve();
  const job = await enqueue(source.id);
  const lease = await claim(source.id);
  const url = path() + `/builds/${job.id}/complete`;
  const payload = completion(lease);
  const missing = await app.inject({
    method: 'POST',
    url,
    headers: auth,
    payload: {
      ...payload,
      result: { ...payload.result, artifactId: '0'.repeat(64) },
    },
  });
  expect(missing.statusCode).toBe(400);
  expect(missing.body).not.toContain(artifactRoot);
  expect((await repository.buildJobs.job(project.id, job.id))?.state).toBe(
    'running',
  );
  const done = await app.inject({
    method: 'POST',
    url,
    headers: auth,
    payload,
  });
  expect(done.statusCode).toBe(200);
  expect(done.json()).toMatchObject({ state: 'succeeded', artifactId });
  expect(done.body).not.toContain(lease.token);
  expect(
    (await app.inject({ method: 'POST', url, headers: auth, payload }))
      .statusCode,
  ).toBe(200);
  const index = join(artifactRoot, artifactId, 'index.html');
  const original = await readFile(index);
  try {
    await writeFile(index, 'corrupted owned fixture');
    expect(
      (await app.inject({ method: 'POST', url, headers: auth, payload }))
        .statusCode,
    ).toBe(400);
  } finally {
    await writeFile(index, original);
  }
  expect(
    (await app.inject({ method: 'POST', url, headers: auth, payload }))
      .statusCode,
  ).toBe(200);
  const audit = await repository.audit(project.id);
  expect(
    audit.filter(
      (entry) =>
        entry.action === 'build.succeeded' &&
        (entry.metadata as { jobId: string }).jobId === job.id,
    ),
  ).toHaveLength(1);
  expect(JSON.stringify(audit)).not.toContain(lease.token);
  expect(
    (await repository.project(project.id))?.activePublicationId,
  ).toBeNull();
  expect(await repository.publications(project.id)).toEqual([]);
});
it('rejects receipt mismatches and cross-project artifact completion without settling a lease', async () => {
  const source = await approve();
  const job = await enqueue(source.id);
  const lease = await claim(source.id);
  const payload = completion(lease);
  const url = path() + `/builds/${job.id}/complete`;
  for (const result of [
    { ...payload.result, source: { ...snapshot, digest: 'd'.repeat(64) } },
    { ...payload.result, toolVersion: '999.0.0' },
    { ...payload.result, requestedImage: 'sha256:' + 'e'.repeat(64) },
    { ...payload.result, durationMs: 1020001 },
  ])
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: auth,
          payload: { token: lease.token, result },
        })
      ).statusCode,
    ).toBe(400);
  expect(
    (
      await app.inject({
        method: 'POST',
        url,
        headers: auth,
        payload: { ...payload, token: randomBytes(32).toString('base64url') },
      })
    ).statusCode,
  ).toBe(409);
  expect((await repository.buildJobs.job(project.id, job.id))?.state).toBe(
    'running',
  );
  const otherSource = await approve(other.id);
  const otherJob = await enqueue(otherSource.id, other.id);
  const otherLease = await claim(otherSource.id);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/api/projects/${other.id}/builds/${otherJob.id}/complete`,
        headers: auth,
        payload: completion(otherLease),
      })
    ).statusCode,
  ).toBe(400);
  expect((await repository.buildJobs.job(other.id, otherJob.id))?.state).toBe(
    'running',
  );
});
it('records bounded terminal failure codes idempotently and rejects stale or cross-project owners', async () => {
  const source = await approve();
  const job = await enqueue(source.id);
  const lease = await claim(source.id);
  const payload = { token: lease.token, code: 'build_failed' };
  const url = path() + `/builds/${job.id}/fail`;
  expect(
    (
      await app.inject({
        method: 'POST',
        url,
        headers: auth,
        payload: { ...payload, code: 'arbitrary-log' },
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/api/projects/${other.id}/builds/${job.id}/fail`,
        headers: auth,
        payload,
      })
    ).statusCode,
  ).toBe(409);
  const failed = await app.inject({
    method: 'POST',
    url,
    headers: auth,
    payload,
  });
  expect(failed.statusCode).toBe(200);
  expect(failed.json()).toMatchObject({
    state: 'failed',
    errorCode: 'build_failed',
  });
  expect(
    (await app.inject({ method: 'POST', url, headers: auth, payload }))
      .statusCode,
  ).toBe(200);
  expect(
    (
      await app.inject({
        method: 'POST',
        url,
        headers: auth,
        payload: { ...payload, code: 'source_changed' },
      })
    ).statusCode,
  ).toBe(409);
});
it('returns admission errors as 429 without breaking idempotent retries', async () => {
  const source = await approve();
  const limited = new PostgresRepository(database!, {
    buildQueue: { maxPending: 1 },
  });
  const server = await createServer({
    repository: limited,
    artifactRoot,
    rootToken,
    publicUrl: origin,
    insecureDevelopment: true,
  });
  try {
    const payload = { sourceId: source.id, idempotencyKey: randomUUID() };
    const request = {
      method: 'POST' as const,
      url: path() + '/builds',
      headers: editor.headers,
      payload,
    };
    const first = await server.inject(request);
    expect(first.statusCode).toBe(201);
    expect((await server.inject(request)).json().id).toBe(first.json().id);
    expect(
      (
        await server.inject({
          ...request,
          payload: { ...payload, idempotencyKey: randomUUID() },
        })
      ).statusCode,
    ).toBe(429);
  } finally {
    await server.close();
    await limited.close();
  }
});

it('reports project-scoped build controls from current operator, token and assigned permissions', async () => {
  const publisher = await credential('publisher');
  for (const [headers, expected] of [
    [
      viewer.headers,
      {
        approveSource: false,
        enqueue: false,
        cancel: false,
        revokeSource: false,
        publish: false,
      },
    ],
    [
      editor.headers,
      {
        approveSource: false,
        enqueue: true,
        cancel: true,
        revokeSource: false,
        publish: false,
      },
    ],
    [
      publisher.headers,
      {
        approveSource: false,
        enqueue: true,
        cancel: true,
        revokeSource: false,
        publish: true,
      },
    ],
    [
      admin.headers,
      {
        approveSource: false,
        enqueue: true,
        cancel: true,
        revokeSource: true,
        publish: true,
      },
    ],
    [
      auth,
      {
        approveSource: true,
        enqueue: true,
        cancel: true,
        revokeSource: true,
        publish: true,
      },
    ],
  ] as const) {
    const response = await app.inject({
      url: path() + '/build-capabilities',
      headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ projectId: project.id, ...expected });
    expect(response.headers['cache-control']).toBe('no-store');
    const management = await app.inject({
      url: path() + '/capabilities',
      headers,
    });
    expect(management.statusCode).toBe(200);
    expect(management.json()).toEqual({
      projectId: project.id,
      publish: expected.publish,
      manageAccess: expected.revokeSource,
      readAudit: expected.revokeSource,
    });
    expect(management.headers['cache-control']).toBe('no-store');
  }
  expect(
    (
      await app.inject({
        url: path() + '/build-capabilities?role=admin',
        headers: viewer.headers,
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await app.inject({
        url: path() + '/capabilities?role=admin',
        headers: viewer.headers,
      })
    ).statusCode,
  ).toBe(400);
  const subject = 'https://id.example.test|build-controls-' + randomUUID();
  const session = randomBytes(32).toString('base64url');
  await repository.createSession(
    createHash('sha256').update(session).digest('hex'),
    subject,
    new Date(Date.now() + 60000),
  );
  await repository.setRole(project.id, subject, 'editor', 'root');
  const headers = { cookie: 'docs_session=' + session };
  expect(
    (await app.inject({ url: path() + '/build-capabilities', headers })).json()
      .enqueue,
  ).toBe(true);
  await repository.setRole(project.id, subject, 'publisher', 'root');
  expect(
    (await app.inject({ url: path() + '/capabilities', headers })).json(),
  ).toEqual({
    projectId: project.id,
    publish: true,
    manageAccess: false,
    readAudit: false,
  });
  await repository.setRole(project.id, subject, 'viewer', 'root');
  expect(
    (await app.inject({ url: path() + '/build-capabilities', headers })).json()
      .enqueue,
  ).toBe(false);
  expect(
    (await app.inject({ url: path() + '/capabilities', headers })).json()
      .publish,
  ).toBe(false);
  await repository.setRole(project.id, subject, null, 'root');
  expect(
    (await app.inject({ url: path() + '/build-capabilities', headers }))
      .statusCode,
  ).toBe(403);
  expect(
    (await app.inject({ url: path() + '/capabilities', headers })).statusCode,
  ).toBe(403);
});
