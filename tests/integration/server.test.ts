import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import type { ExecFileException } from 'node:child_process';
import { promisify } from 'node:util';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { PostgresRepository } from '@davidniessen/doctopus-storage';
import { createServer } from '@davidniessen/doctopus-server';
import { buildSite } from '@davidniessen/doctopus-cli';
import { verifyArtifact } from '@davidniessen/doctopus-compiler';
import type { Project, Publication } from '@davidniessen/doctopus-domain';
const database = process.env.TEST_DATABASE_URL;
if (!database)
  throw new Error(
    'TEST_DATABASE_URL is required: integration tests never silently skip the database',
  );
const repository = new PostgresRepository(database, { migrate: true });
const rootToken = randomBytes(32).toString('base64url');
const auth = { authorization: `Bearer ${rootToken}` };
let server: Awaited<ReturnType<typeof createServer>>;
let project: Project;
let artifactId: string;
let publication: Publication;
let viewer: { id: string; token: string };
const slug = `test-${randomUUID().slice(0, 8)}`;
let artifactRoot = '';
let testSource = '';
let fixtureRoot: string | undefined;
let provider: FastifyInstance;
let issuer = '';
let nonce = '';
beforeAll(async () => {
  const root = await mkdtemp(join(tmpdir(), 'doctopus-server-'));
  fixtureRoot = root;
  const source = join(root, 'source');
  const store = join(root, 'artifacts');
  artifactRoot = store;
  testSource = source;
  await cp(resolve('examples/demo'), source, {
    recursive: true,
    filter: (path) =>
      !path.includes('.doctopus') && !path.includes('.api-docs'),
  });
  const config = join(source, 'docs.config.yaml');
  await writeFile(
    config,
    (await readFile(config, 'utf8')) + `\nbasePath: /docs/${slug}\n`,
  );
  const build = await buildSite(source);
  artifactId = (await verifyArtifact(build.directory)).artifactDigest;
  await cp(build.directory, join(store, artifactId), { recursive: true });
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = {
    ...(await exportJWK(publicKey)),
    kid: 'test-key',
    alg: 'RS256',
    use: 'sig',
  };
  provider = Fastify();
  provider.get('/.well-known/openid-configuration', async () => ({
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/jwks`,
  }));
  provider.get('/jwks', async () => ({ keys: [jwk] }));
  provider.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request, body, done) => done(null, new URLSearchParams(String(body))),
  );
  provider.post('/token', async (request) => {
    const form = request.body as URLSearchParams;
    if (!form.get('code_verifier') || form.get('code') !== 'fixture-code')
      throw new Error('Invalid fixture exchange');
    return {
      id_token: await new SignJWT({ nonce })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setIssuer(issuer)
        .setAudience('test-client')
        .setSubject('reader-1')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey),
    };
  });
  issuer = await provider.listen({ host: '127.0.0.1', port: 0 });
  server = await createServer({
    repository,
    artifactRoot: store,
    rootToken,
    publicUrl: 'http://127.0.0.1:8080',
    insecureDevelopment: true,
    oidc: { issuer, clientId: 'test-client' },
  });
  const created = await server.inject({
    method: 'POST',
    url: '/api/projects',
    headers: auth,
    payload: { name: 'Integration', slug, visibility: 'private' },
  });
  expect(created.statusCode).toBe(201);
  project = created.json<Project>();
});
afterAll(async () => {
  try {
    const outcomes = await Promise.allSettled([
      server?.close(),
      provider?.close(),
      repository.close(),
    ]);
    const failures = outcomes.filter(
      (outcome) => outcome.status === 'rejected',
    );
    if (failures.length)
      throw new AggregateError(
        failures.map((outcome) => outcome.reason),
        'Fixture shutdown failed',
      );
  } finally {
    if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
  }
});
describe('self-hosted publication and authorization', () => {
  it('checks readiness and protects project creation', async () => {
    expect((await server.inject('/health/ready')).statusCode).toBe(200);
    expect(
      (
        await server.inject({
          method: 'POST',
          url: '/api/projects',
          payload: { name: 'No', slug: 'no', visibility: 'public' },
        })
      ).statusCode,
    ).toBe(403);
  });
  it('registers a verified artifact and publishes idempotently', async () => {
    expect(
      (
        await server.inject({
          method: 'POST',
          url: `/api/projects/${project.id}/artifacts`,
          headers: auth,
          payload: { artifactId },
        })
      ).statusCode,
    ).toBe(200);
    const payload = {
      artifactId,
      expectedPublicationId: null,
      idempotencyKey: 'first',
    };
    const result = await server.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/publications`,
      headers: auth,
      payload,
    });
    expect(result.statusCode).toBe(201);
    publication = result.json<Publication>();
    expect(
      (
        await server.inject({
          method: 'POST',
          url: `/api/projects/${project.id}/publications`,
          headers: auth,
          payload,
        })
      ).json<Publication>().id,
    ).toBe(publication.id);
    expect(
      (
        await server.inject({
          method: 'POST',
          url: `/api/projects/${project.id}/publications`,
          headers: auth,
          payload: { ...payload, idempotencyKey: 'stale' },
        })
      ).statusCode,
    ).toBe(409);
  });
  it('protects every artifact and limits/revokes scoped credentials', async () => {
    for (const path of [
      '',
      'site.json',
      'page-data.json',
      'search.json',
      'assets/reader.js',
      'guides/introduction/',
      'deprecations/',
      'deprecations/page-data.json',
    ])
      expect((await server.inject(`/docs/${slug}/${path}`)).statusCode).toBe(
        401,
      );
    const token = await server.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/tokens`,
      headers: auth,
      payload: { label: 'Reader', role: 'viewer', expiresInDays: 1 },
    });
    expect(token.statusCode).toBe(201);
    viewer = token.json();
    const headers = { authorization: `Bearer ${viewer.token}` };
    const page = await server.inject({ url: `/docs/${slug}/`, headers });
    expect(page.statusCode).toBe(200);
    expect(page.headers['cache-control']).toContain('no-store');
    expect(page.body).toContain('Introduction');
    for (const path of ['deprecations/', 'deprecations/page-data.json']) {
      const center = await server.inject({
        url: `/docs/${slug}/${path}`,
        headers,
      });
      expect(center.statusCode).toBe(200);
      expect(center.headers['cache-control']).toContain('no-store');
    }
    expect(
      (
        await server.inject({
          method: 'POST',
          url: `/api/projects/${project.id}/publications`,
          headers,
          payload: {
            artifactId,
            expectedPublicationId: publication.id,
            idempotencyKey: 'forbidden',
          },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await server.inject({
          method: 'DELETE',
          url: `/api/projects/${project.id}/tokens/${viewer.id}`,
          headers: auth,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await server.inject({ url: `/docs/${slug}/search.json`, headers }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await server.inject({
          url: `/docs/${slug}/deprecations/page-data.json`,
          headers,
        })
      ).statusCode,
    ).toBe(401);
  });
  it('prevents concurrent publishers from losing updates and records audit events', async () => {
    const results = await Promise.all(
      ['concurrent-a', 'concurrent-b'].map((key) =>
        server.inject({
          method: 'POST',
          url: `/api/projects/${project.id}/publications`,
          headers: auth,
          payload: {
            artifactId,
            expectedPublicationId: publication.id,
            idempotencyKey: key,
          },
        }),
      ),
    );
    expect(results.map((result) => result.statusCode).sort()).toEqual([
      201, 409,
    ]);
    const audit = await server.inject({
      url: `/api/projects/${project.id}/audit`,
      headers: auth,
    });
    expect(audit.statusCode).toBe(200);
    expect(audit.body).toContain('publication.activated');
    expect(audit.body).not.toContain(viewer.token);
  });
  it('completes OIDC with state/nonce/PKCE, enforces CSRF and applies role revocation', async () => {
    const login = await server.inject('/auth/login');
    expect(login.statusCode).toBe(302);
    const destination = new URL(String(login.headers.location));
    const state = destination.searchParams.get('state')!;
    nonce = destination.searchParams.get('nonce')!;
    expect(destination.searchParams.get('code_challenge_method')).toBe('S256');
    expect(
      (await server.inject(`/auth/callback?state=${state}&code=fixture-code`))
        .statusCode,
    ).toBe(400);
    const callback = await server.inject({
      url: `/auth/callback?state=${state}&code=fixture-code`,
      cookies: { docs_oidc: state },
    });
    expect(callback.statusCode).toBe(302);
    const session = callback.cookies.find(
      (cookie) => cookie.name === 'docs_session',
    );
    expect(session?.httpOnly).toBe(true);
    const cookies = { docs_session: session!.value };
    expect(
      (await server.inject({ url: `/docs/${slug}/`, cookies })).statusCode,
    ).toBe(403);
    await server.inject({
      method: 'PUT',
      url: `/api/projects/${project.id}/roles`,
      headers: auth,
      payload: { subject: `${issuer}|reader-1`, role: 'viewer' },
    });
    expect(
      (await server.inject({ url: `/docs/${slug}/search.json`, cookies }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await server.inject({
          method: 'POST',
          url: '/auth/logout',
          cookies,
          headers: { origin: 'https://attacker.example' },
        })
      ).statusCode,
    ).toBe(403);
    await server.inject({
      method: 'PUT',
      url: `/api/projects/${project.id}/roles`,
      headers: auth,
      payload: { subject: `${issuer}|reader-1`, role: null },
    });
    expect(
      (await server.inject({ url: `/docs/${slug}/site.json`, cookies }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await server.inject({
          method: 'POST',
          url: '/auth/logout',
          cookies,
          headers: { origin: 'http://127.0.0.1:8080' },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await server.inject({ url: '/api/me', cookies })).json().subject,
    ).toBe(null);
    expect(
      (
        await server.inject({
          url: `/auth/callback?state=${state}&code=fixture-code`,
          cookies: { docs_oidc: state },
        })
      ).statusCode,
    ).toBe(400);
  });
  it('fully invalidates operator sessions after root-token rotation', async () => {
    const exchange = await server.inject({
      method: 'POST',
      url: '/auth/token',
      headers: auth,
    });
    const session = exchange.cookies.find(
      (value) => value.name === 'docs_session',
    )!;
    const cookies = { docs_session: session.value };
    expect(
      (await server.inject({ url: '/api/me', cookies })).json().operator,
    ).toBe(true);
    const rotated = await createServer({
      repository,
      artifactRoot,
      rootToken: randomBytes(32).toString('base64url'),
      publicUrl: 'http://127.0.0.1:8080',
      insecureDevelopment: true,
    });
    try {
      expect(
        (await rotated.inject({ url: '/api/me', cookies })).json(),
      ).toMatchObject({ subject: null, operator: false });
      expect(
        (await rotated.inject({ url: `/docs/${slug}/search.json`, cookies }))
          .statusCode,
      ).toBe(401);
    } finally {
      await rotated.close();
    }
  });
  it('keeps reader traffic out of the management rate-limit bucket', async () => {
    for (let batch = 0; batch < 35; batch++) {
      const requests = await Promise.all(
        Array.from({ length: 10 }, () =>
          server.inject({ url: `/docs/${slug}/`, headers: auth }),
        ),
      );
      expect(requests.every((request) => request.statusCode === 200)).toBe(
        true,
      );
    }
    expect(
      (await server.inject({ url: '/api/projects', headers: auth })).statusCode,
    ).toBe(200);
  });
  it('uses fresh publication pointers when activating and rolling back cached artifacts', async () => {
    const path = join(testSource, 'guides/introduction.md');
    await writeFile(
      path,
      (await readFile(path, 'utf8')) + '\n\nNew publication marker.\n',
    );
    const build = await buildSite(testSource);
    const next = (await verifyArtifact(build.directory)).artifactDigest;
    await cp(build.directory, join(artifactRoot, next), { recursive: true });
    expect(
      (
        await server.inject({
          method: 'POST',
          url: `/api/projects/${project.id}/artifacts`,
          headers: auth,
          payload: { artifactId: next },
        })
      ).statusCode,
    ).toBe(200);
    const current = (await repository.project(project.id))!;
    const activated = await server.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/publications`,
      headers: auth,
      payload: {
        artifactId: next,
        expectedPublicationId: current.activePublicationId,
        idempotencyKey: 'cache-next',
      },
    });
    expect(activated.statusCode).toBe(201);
    expect(
      (await server.inject({ url: `/docs/${slug}/`, headers: auth })).body,
    ).toContain('New publication marker.');
    expect(
      (
        await server.inject({
          method: 'POST',
          url: `/api/projects/${project.id}/publications`,
          headers: auth,
          payload: {
            artifactId,
            expectedPublicationId: activated.json<Publication>().id,
            idempotencyKey: 'cache-rollback',
          },
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (await server.inject({ url: `/docs/${slug}/`, headers: auth })).body,
    ).not.toContain('New publication marker.');
  });
  it.each(['schema initialization', 'port binding'] as const)(
    'the real executable closes PostgreSQL pools after failed %s',
    async (failure) => {
      const unavailable = new URL(database!);
      // A nonexistent search_path forces an initialization error after connecting,
      // without changing the shared database or its installed migration history.
      if (failure === 'schema initialization')
        unavailable.searchParams.set(
          'options',
          '-csearch_path=absent_' + randomUUID().replaceAll('-', ''),
        );
      await promisify(execFile)(
        process.execPath,
        ['apps/server/dist/main.js'],
        {
          cwd: process.cwd(),
          timeout: 5000,
          killSignal: 'SIGKILL',
          env: {
            ...process.env,
            DATABASE_URL: unavailable.href,
            ROOT_TOKEN: rootToken,
            PUBLIC_URL: 'https://docs.example.test',
            ARTIFACT_ROOT: artifactRoot,
            LOG_LEVEL: 'silent',
            HOST: '127.0.0.1',
            PORT: failure === 'port binding' ? new URL(issuer).port : '0',
            SHUTDOWN_TIMEOUT_MS: '1000',
          },
        },
      ).then(
        () => {
          throw new Error('The initialization/binding fault must fail startup');
        },
        (error: ExecFileException & { stdout: string; stderr: string }) => {
          expect(error.code).toBe(1);
          expect(error.signal).toBe(null);
          expect(error.killed).toBe(false);
          expect(error.stderr).toContain('Server startup failed.');
          expect(error.stderr).not.toContain(unavailable.href);
          expect(error.stderr).not.toContain(rootToken);
          expect(error.stderr).not.toContain('docs_schema_migrations');
        },
      );
    },
  );
  it('fails closed for private cached content when repository reads fail', async () => {
    let unavailable = false;
    const faulted = new Proxy(repository, {
      get(target, key) {
        if (key === 'healthy') return async () => !unavailable;
        if (key === 'project' && unavailable)
          return async () => {
            throw new Error('Injected database outage');
          };
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const probe = await createServer({
      repository: faulted,
      artifactRoot,
      rootToken,
      publicUrl: 'http://127.0.0.1:8080',
      insecureDevelopment: true,
    });
    try {
      expect(
        (await probe.inject({ url: `/docs/${slug}/`, headers: auth }))
          .statusCode,
      ).toBe(200);
      unavailable = true;
      expect((await probe.inject('/health/ready')).statusCode).toBe(503);
      const denied = await probe.inject({
        url: `/docs/${slug}/`,
        headers: auth,
      });
      expect(denied.statusCode).toBe(500);
      expect(denied.body).not.toContain('Introduction');
      expect(denied.body).not.toContain('Injected database outage');
    } finally {
      await probe.close();
    }
  });
});
