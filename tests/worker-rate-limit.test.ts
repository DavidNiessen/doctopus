import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type {
  Repository,
  BuildJobRepository,
} from '@davidniessen/doctopus-domain';
import { createServer } from '../apps/server/src/index.js';

it('separates authenticated worker traffic from management and unauthenticated request budgets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'doctopus-worker-rates-'));
  const credential = 'a'.repeat(32);
  const repository = {
    initialize: async () => {},
    token: async () => undefined,
    projects: async () => [],
    buildJobs: { claim: async () => undefined },
  } as unknown as Repository & { buildJobs: BuildJobRepository };
  const app = await createServer({
    repository,
    artifactRoot: root,
    rootToken: credential,
    publicUrl: 'https://docs.example.test',
  });
  const claim = (token: string) =>
    app.inject({
      method: 'POST',
      url: '/api/build-workers/claim',
      headers: { authorization: 'Bearer ' + token },
      payload: { workerId: 'rate-fixture', sourceIds: [randomUUID()] },
    });
  const management = () =>
    app.inject({
      url: '/api/projects',
      headers: { authorization: 'Bearer ' + credential },
    });
  try {
    for (let i = 0; i < 300; i++)
      expect((await claim('invalid')).statusCode).toBe(401);
    expect((await claim('invalid')).statusCode).toBe(429);
    for (let i = 0; i < 1200; i++)
      expect((await claim(credential)).statusCode).toBe(200);
    const limited = await claim(credential);
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
    // Invalid requests exhausted management, while valid worker renewals had their own allowance.
    expect((await management()).statusCode).toBe(429);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

it('does not let ordinary operator routes consume the worker allowance or adopt its larger budget', async () => {
  const root = await mkdtemp(join(tmpdir(), 'doctopus-management-rates-'));
  const credential = 'b'.repeat(32);
  const repository = {
    initialize: async () => {},
    projects: async () => [],
    buildJobs: { claim: async () => undefined },
  } as unknown as Repository & { buildJobs: BuildJobRepository };
  const app = await createServer({
    repository,
    artifactRoot: root,
    rootToken: credential,
    publicUrl: 'https://docs.example.test',
  });
  try {
    for (let i = 0; i < 300; i++)
      expect(
        (
          await app.inject({
            url: '/api/projects',
            headers: { authorization: 'Bearer ' + credential },
          })
        ).statusCode,
      ).toBe(200);
    expect(
      (
        await app.inject({
          url: '/api/projects',
          headers: { authorization: 'Bearer ' + credential },
        })
      ).statusCode,
    ).toBe(429);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/build-workers/claim',
          headers: { authorization: 'Bearer ' + credential },
          payload: { workerId: 'rate-fixture', sourceIds: [randomUUID()] },
        })
      ).statusCode,
    ).toBe(200);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
