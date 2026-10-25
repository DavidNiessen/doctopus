import { describe, expect, it } from 'vitest';
import express from 'express';
import Fastify from 'fastify';
import { createExpressDocs } from '@davidniessen/doctopus-node/express';
import { doctopusPlugin } from '@davidniessen/doctopus-node/fastify';
describe('direct integration hosting', () => {
  it('Express protects the shell/assets/deep links, leaves host routes usable and never downloads a spec on the server', async () => {
    const app = express();
    let rawSpecRequests = 0;
    app.get('/openapi.json', (_request, response) => {
      rawSpecRequests++;
      response.json({});
    });
    app.get('/host-owned', (_request, response) => response.send('host-owned'));
    const docs = await createExpressDocs({
      url: '/openapi.json',
      title: 'Runtime API',
      authenticate: (request, response, next) => {
        if (request.headers.authorization === 'Bearer fixture') next();
        else response.sendStatus(401);
      },
    });
    app.use(docs.mountPath, docs.router);
    const listener = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => listener.once('listening', resolve));
    const address = listener.address();
    if (!address || typeof address === 'string') throw new Error('No listener');
    const base = `http://127.0.0.1:${address.port}`;
    try {
      for (const path of [
        '/docs/',
        '/docs/assets/reader.js',
        '/docs/api/api/v1/hello/',
      ]) {
        const blocked = await fetch(base + path);
        expect(blocked.status).toBe(401);
        await blocked.text();
        const allowed = await fetch(base + path, {
          headers: { authorization: 'Bearer fixture' },
        });
        expect(allowed.status).toBe(200);
        await allowed.text();
      }
      expect(await (await fetch(base + '/host-owned')).text()).toBe(
        'host-owned',
      );
      expect(rawSpecRequests).toBe(0);
      const hidden = await fetch(base + '/docs/direct-assets.json', {
        headers: { authorization: 'Bearer fixture' },
      });
      expect(hidden.status).toBe(404);
      await hidden.text();
    } finally {
      listener.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        listener.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
  it('Fastify uses its registration prefix, protects all UI routes and retains host routes', async () => {
    const app = Fastify();
    let rawSpecRequests = 0;
    app.get('/openapi.json', async () => {
      rawSpecRequests++;
      return {};
    });
    app.get('/host-owned', async () => 'host-owned');
    await app.register(doctopusPlugin, {
      prefix: '/gateway',
      url: '/openapi.json',
      title: 'Gateway API',
      authenticate: async (request, reply) => {
        if (request.headers.authorization !== 'Bearer fixture')
          return reply.code(401).send('Authentication required');
      },
    });
    try {
      for (const path of [
        '/gateway/docs',
        '/gateway/docs/',
        '/gateway/docs/assets/reader.js',
        '/gateway/docs/api/api/v1/hello/',
      ]) {
        expect((await app.inject(path)).statusCode).toBe(401);
        const response = await app.inject({
          url: path,
          headers: { authorization: 'Bearer fixture' },
        });
        expect(response.statusCode).toBe(200);
        if (!path.endsWith('.js'))
          expect(response.body).toContain('/gateway/docs/assets/reader.css');
      }
      expect((await app.inject('/host-owned')).body).toBe('host-owned');
      expect(rawSpecRequests).toBe(0);
      expect(
        (
          await app.inject({
            url: '/gateway/docs/direct-assets.json',
            headers: { authorization: 'Bearer fixture' },
          })
        ).statusCode,
      ).toBe(404);
    } finally {
      await app.close();
    }
  });
  it('rejects direct configuration mixed with a prebuilt publication', async () => {
    await expect(
      createExpressDocs({ directory: '.', url: '/openapi.json' }),
    ).rejects.toThrow('not both');
    const app = Fastify();
    await expect(
      app.register(doctopusPlugin, { directory: '.', title: 'Unexpected' }),
    ).rejects.toThrow('not both');
    await app.close();
  });
  it('applies the existing request quota before authentication in direct mode', async () => {
    const app = Fastify();
    let authentications = 0;
    await app.register(doctopusPlugin, {
      url: '/openapi.json',
      rateLimit: { maxRequests: 1 },
      authenticate: async () => {
        authentications++;
      },
    });
    try {
      expect((await app.inject('/docs/')).statusCode).toBe(200);
      const blocked = await app.inject('/docs/assets/reader.js');
      expect(blocked.statusCode).toBe(429);
      expect(blocked.headers['retry-after']).toBeDefined();
      expect(authentications).toBe(1);
    } finally {
      await app.close();
    }
  });
});
