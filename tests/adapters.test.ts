import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  mkdtemp,
  cp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import express from 'express';
import Fastify from 'fastify';
import { createExpressDocs } from '@davidniessen/doctopus-node/express';
import { doctopusPlugin } from '@davidniessen/doctopus-node/fastify';
import { buildSite } from '@davidniessen/doctopus-cli';
import { artifactIdentity } from '@davidniessen/doctopus-compiler';
import type { ArtifactManifest } from '@davidniessen/doctopus-contracts';
describe.each(['', '/docs'])('framework adapters at %j', (prefix) => {
  let directory: string;
  let project: string;
  const server = Fastify();
  const headers = { authorization: 'Bearer fixture' };
  const blocked = [
    '/private.txt',
    '/assets/private.txt',
    '/extra/',
    '/extra/index.html',
    '/manifest.json',
    '/outside-link.txt',
  ];
  beforeAll(async () => {
    const root = (project = await mkdtemp(join(tmpdir(), 'doctopus-adapter-')));
    await cp(resolve('examples/demo'), root, {
      recursive: true,
      filter: (path) =>
        !path.includes('.doctopus') && !path.includes('.api-docs'),
    });
    const config = join(root, 'docs.config.yaml');
    await writeFile(
      config,
      (await readFile(config, 'utf8')) +
        '\nbasePath: ' +
        JSON.stringify(prefix) +
        '\n',
    );
    directory = (await buildSite(root)).directory;
    await mkdir(join(directory, 'extra'));
    for (const path of [
      'private.txt',
      'assets/private.txt',
      'extra/index.html',
    ])
      await writeFile(join(directory, path), 'unlisted-fixture-content');
    await writeFile(join(root, 'outside.txt'), 'outside-fixture-content');
    await symlink(
      join(root, 'outside.txt'),
      join(directory, 'outside-link.txt'),
    );
    server.get('/host-owned', async () => 'host-owned');
  });
  afterAll(async () => {
    await server.close();
    await rm(project, { recursive: true, force: true });
  });
  it('limits Express documentation before authentication and leaves host routes usable', async () => {
    let authentications = 0;
    const app = express();
    app.get('/host-owned', (_request, response) => response.send('host-owned'));
    const docs = await createExpressDocs({
      directory,
      rateLimit: { maxRequests: 2, maxClients: 1 },
      authenticate: (request, response, next) => {
        authentications++;
        if (request.headers.authorization !== 'Bearer fixture')
          response.sendStatus(401);
        else next();
      },
    });
    app.use(docs.mountPath, docs.router);
    const listener = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => listener.once('listening', resolve));
    const address = listener.address();
    if (!address || typeof address === 'string')
      throw new Error('No TCP listener');
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const unauthorized = await fetch(base + prefix + '/index.html');
      expect(unauthorized.status).toBe(401);
      await unauthorized.text();
      const allowed = await fetch(base + prefix + '/index.html', { headers });
      expect(allowed.status).toBe(200);
      expect(await allowed.text()).toContain('Introduction');
      const limited = await fetch(base + prefix + '/index.html', { headers });
      expect(limited.status).toBe(429);
      expect(limited.headers.get('cache-control')).toBe('no-store');
      expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
      expect(Number(limited.headers.get('retry-after'))).toBeLessThanOrEqual(
        60,
      );
      expect(await limited.text()).not.toContain('Introduction');
      expect(authentications).toBe(2);
      expect(await (await fetch(base + '/host-owned')).text()).toBe(
        'host-owned',
      );
      expect(authentications).toBe(2);
    } finally {
      listener.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        listener.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('limits Fastify documentation before authentication and keeps rate responses uncacheable', async () => {
    let authentications = 0;
    const app = Fastify();
    app.get('/host-owned', async () => 'host-owned');
    await app.register(doctopusPlugin, {
      directory,
      rateLimit: { maxRequests: 2, maxClients: 1 },
      authenticate: async (request, reply) => {
        authentications++;
        if (request.headers.authorization !== 'Bearer fixture')
          return reply.code(401).send();
      },
    });
    try {
      expect((await app.inject(prefix + '/index.html')).statusCode).toBe(401);
      expect(
        (await app.inject({ url: prefix + '/index.html', headers })).statusCode,
      ).toBe(200);
      const limited = await app.inject({
        url: prefix + '/index.html',
        headers,
      });
      expect(limited.statusCode).toBe(429);
      expect(limited.headers['cache-control']).toBe('no-store');
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
      expect(limited.body).not.toContain('Introduction');
      expect(authentications).toBe(2);
      expect((await app.inject('/host-owned')).body).toBe('host-owned');
      expect(authentications).toBe(2);
    } finally {
      await app.close();
    }
  });

  it('groups neighboring IPv6 clients into one documentation quota', async () => {
    const app = Fastify();
    await app.register(doctopusPlugin, {
      directory,
      rateLimit: { maxRequests: 1 },
    });
    try {
      expect(
        (
          await app.inject({
            url: prefix + '/index.html',
            remoteAddress: '2001:db8::1',
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            url: prefix + '/index.html',
            remoteAddress: '2001:db8::2',
          })
        ).statusCode,
      ).toBe(429);
    } finally {
      await app.close();
    }
  });

  it('keeps distinct IPv4 clients separate and normalizes mapped IPv4 identities', async () => {
    const app = Fastify();
    await app.register(doctopusPlugin, {
      directory,
      rateLimit: { maxRequests: 1 },
    });
    try {
      expect(
        (
          await app.inject({
            url: prefix + '/index.html',
            remoteAddress: '::ffff:192.0.2.1',
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            url: prefix + '/index.html',
            remoteAddress: '192.0.2.1',
          })
        ).statusCode,
      ).toBe(429);
      expect(
        (
          await app.inject({
            url: prefix + '/index.html',
            remoteAddress: '::ffff:192.0.2.2',
          })
        ).statusCode,
      ).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('mounts Fastify docs at a subpath and applies authentication to every asset', async () => {
    await server.register(doctopusPlugin, {
      directory,
      authenticate: async (request, reply) => {
        if (request.headers.authorization !== 'Bearer fixture')
          return reply.code(401).send({ error: 'Authentication required' });
      },
    });
    expect((await server.inject(prefix + '/assets/reader.js')).statusCode).toBe(
      401,
    );
    const response = await server.inject({
      url: prefix + '/guides/introduction/',
      headers: { authorization: 'Bearer fixture' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain(prefix + '/assets/reader.js');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect((await server.inject('/host-owned')).body).toBe('host-owned');
    for (const path of blocked) {
      expect((await server.inject(prefix + path)).statusCode).toBe(401);
      for (const method of ['GET', 'HEAD'] as const) {
        const rejected = await server.inject({
          url: prefix + path,
          method,
          headers,
        });
        expect(rejected.statusCode).toBe(404);
        expect(rejected.body).not.toContain('unlisted-fixture-content');
        expect(rejected.body).not.toContain('outside-fixture-content');
      }
    }
    expect(
      (
        await server.inject({
          url: prefix + '/assets/%72eader.js?version=1',
          headers,
        })
      ).statusCode,
    ).toBe(200);
    const redirect = await server.inject({
      url: prefix + '/guides/quickstart?from=fixture',
      headers,
    });
    expect(redirect.statusCode).toBe(301);
    expect(redirect.headers.location).toBe(
      prefix + '/guides/quickstart/?from=fixture',
    );
    for (const path of [
      '/assets//private.txt',
      '/assets/%2e%2e/private.txt',
      '/assets%2f..%2fprivate.txt',
      '/private%2etxt',
      '/private%252etxt',
      '/assets/%5cprivate.txt',
    ]) {
      const rejected = await server.inject({ url: prefix + path, headers });
      expect(rejected.statusCode).toBeGreaterThanOrEqual(400);
      expect(rejected.statusCode).toBeLessThan(500);
      expect(rejected.body).not.toContain('unlisted-fixture-content');
    }
  });
  it('mounts Express docs behind host middleware and rejects mismatched paths', async () => {
    await expect(
      createExpressDocs({ directory, mountPath: '/wrong' }),
    ).rejects.toThrow(/basePath/);
    const app = express();
    const docs = await createExpressDocs({
      directory,
      authenticate: (request, response, next) => {
        if (request.headers.authorization !== 'Bearer fixture')
          response.sendStatus(401);
        else next();
      },
    });
    app.get('/host-owned', (_request, response) => response.send('host-owned'));
    app.use(docs.mountPath, docs.router);
    const listener = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => listener.once('listening', resolve));
    const address = listener.address();
    if (!address || typeof address === 'string')
      throw new Error('No TCP listener');
    const base = `http://127.0.0.1:${address.port}`;
    try {
      expect((await fetch(base + prefix + '/search.json')).status).toBe(401);
      const page = await fetch(base + prefix + '/guides/quickstart/', {
        headers: { authorization: 'Bearer fixture' },
      });
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('Quickstart');
      expect(await (await fetch(base + '/host-owned')).text()).toBe(
        'host-owned',
      );
      for (const path of blocked) {
        expect((await fetch(base + prefix + path)).status).toBe(401);
        for (const method of ['GET', 'HEAD']) {
          const rejected = await fetch(base + prefix + path, {
            headers,
            method,
          });
          expect(rejected.status).toBe(404);
          const content = await rejected.text();
          expect(content).not.toContain('unlisted-fixture-content');
          expect(content).not.toContain('outside-fixture-content');
        }
      }
      expect(
        (
          await fetch(base + prefix + '/assets/%72eader.js?version=1', {
            headers,
          })
        ).status,
      ).toBe(200);
      const redirect = await fetch(
        base + prefix + '/guides/quickstart?from=fixture',
        { headers, redirect: 'manual' },
      );
      expect(redirect.status).toBe(301);
      expect(redirect.headers.get('location')).toBe(
        prefix + '/guides/quickstart/?from=fixture',
      );
      for (const path of [
        '/assets//private.txt',
        '/assets%2f..%2fprivate.txt',
        '/private%2etxt',
        '/private%252etxt',
        '/assets/%5cprivate.txt',
        '/%zz',
      ]) {
        const rejected = await fetch(base + prefix + path, { headers });
        expect(rejected.status).toBeGreaterThanOrEqual(400);
        expect(rejected.status).toBeLessThan(500);
        expect(await rejected.text()).not.toContain('unlisted-fixture-content');
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        listener.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('rejects publication configuration that is not covered by the manifest', async () => {
    const filename = join(directory, 'manifest.json');
    const source = await readFile(filename, 'utf8');
    const manifest = JSON.parse(source) as ArtifactManifest;
    delete manifest.files['site.json'];
    manifest.artifactDigest = artifactIdentity(manifest);
    await writeFile(filename, JSON.stringify(manifest));
    const probe = Fastify();
    try {
      await expect(createExpressDocs({ directory })).rejects.toThrow(
        /configuration must be listed/,
      );
      await expect(
        probe.register(doctopusPlugin, { directory }).ready(),
      ).rejects.toThrow(/configuration must be listed/);
    } finally {
      await probe.close();
      await writeFile(filename, source);
    }
  });
  it('does not serve an unlisted custom error page or recurse through the not-found handler', async () => {
    const filename = join(directory, 'manifest.json');
    const source = await readFile(filename, 'utf8');
    const manifest = JSON.parse(source) as ArtifactManifest;
    delete manifest.files['404.html'];
    manifest.artifactDigest = artifactIdentity(manifest);
    await writeFile(filename, JSON.stringify(manifest));
    const probe = Fastify();
    let listener: ReturnType<ReturnType<typeof express>['listen']> | undefined;
    try {
      await probe.register(doctopusPlugin, { directory });
      const fastifyResult = await probe.inject(prefix + '/404.html');
      expect(fastifyResult.statusCode).toBe(404);
      expect(fastifyResult.body).toBe('Not found');
      const app = express();
      const docs = await createExpressDocs({ directory });
      app.use(docs.mountPath, docs.router);
      listener = app.listen(0, '127.0.0.1');
      await new Promise<void>((resolve) =>
        listener!.once('listening', resolve),
      );
      const address = listener.address();
      if (!address || typeof address === 'string')
        throw new Error('No listener');
      const response = await fetch(
        `http://127.0.0.1:${address.port}${prefix}/404.html`,
      );
      expect(response.status).toBe(404);
      expect(await response.text()).toBe('Not found');
    } finally {
      await probe.close();
      if (listener)
        await new Promise<void>((resolve, reject) =>
          listener!.close((error) => (error ? reject(error) : resolve())),
        );
      await writeFile(filename, source);
    }
  });
});
