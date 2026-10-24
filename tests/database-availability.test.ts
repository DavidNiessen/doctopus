import { expect, it } from 'vitest';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createServer as createTcpServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  RepositoryUnavailableError,
  type Repository,
} from '@davidniessen/doctopus-domain';
import { PostgresRepository } from '@davidniessen/doctopus-storage';
import { databaseError } from '../packages/storage/src/database-error.js';
import { createServer } from '../apps/server/src/index.js';

it.each([
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'EAI_AGAIN',
  'ENOTFOUND',
  '08000',
  '08006',
  '08P01',
  '53200',
  '53300',
  '57014',
  '57P01',
  '57P02',
  '57P03',
])(
  'preserves the cause and diagnostic code of database availability failure %s',
  (code) => {
    const cause = Object.assign(new Error('private database diagnostic'), {
      code,
    });
    const error = databaseError(cause);
    expect(error).toBeInstanceOf(RepositoryUnavailableError);
    expect(error).toMatchObject({ code, cause, message: cause.message });
    expect(databaseError(error)).toBe(error);
  },
);

it.each([
  'Query read timeout',
  'timeout exceeded when trying to connect',
  'Connection terminated',
  'Connection terminated unexpectedly',
  'Connection terminated due to connection timeout',
])('recognizes the pinned driver availability diagnostic %s', (message) => {
  const cause = new Error(message);
  expect(databaseError(cause)).toMatchObject({
    name: 'RepositoryUnavailableError',
    message,
    cause,
  });
});

it.each([
  '23505',
  '23503',
  '42601',
  '28P01',
  '42501',
  'XX000',
  '0800',
  '08bad',
])(
  'does not classify SQL, authentication or unknown failure %s as temporary',
  (code) => {
    const error = Object.assign(new Error('SQL failure'), { code });
    expect(databaseError(error)).toBe(error);
  },
);

it('does not classify arbitrary thrown values or approximate driver messages', () => {
  for (const value of [
    null,
    undefined,
    'Connection terminated',
    {},
    new TypeError('bug'),
    new Error('Query read timeout with unrelated context'),
  ])
    expect(databaseError(value)).toBe(value);
});

it('classifies real transport failures on reads, transactions and worker claims without retrying', async () => {
  let connections = 0;
  const server = createTcpServer((socket) => {
    connections++;
    socket.destroy();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing listener');
  const repository = new PostgresRepository(
    `postgresql://fixture:fixture@127.0.0.1:${address.port}/fixture`,
  );
  try {
    const operations = [
      () => repository.projects(),
      () =>
        repository.createProject({
          slug: 'outage',
          name: 'Outage',
          visibility: 'private',
          subject: 'fixture',
        }),
      () => repository.buildJobs.claim('fixture', [randomUUID()], 30),
    ];
    for (const [index, operation] of operations.entries()) {
      await expect(operation()).rejects.toBeInstanceOf(
        RepositoryUnavailableError,
      );
      expect(connections).toBe(index + 1);
    }
  } finally {
    await repository.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it.each([
  {
    error: new RepositoryUnavailableError(
      'postgresql://private-user:private-password@private-host/private-db',
    ),
    status: 503,
  },
  { error: new Error('unexpected private internal diagnostic'), status: 500 },
])(
  'returns generic HTTP $status without exposing database details or retrying',
  async ({ error, status }) => {
    const root = await mkdtemp(join(tmpdir(), 'doctopus-availability-'));
    let calls = 0;
    const unavailable = async () => {
      calls++;
      throw error;
    };
    const repository = {
      initialize: async () => {},
      healthy: async () => false,
      projects: unavailable,
      project: unavailable,
      createProject: unavailable,
      buildJobs: { claim: unavailable },
    } as unknown as Repository;
    const credential = 'a'.repeat(32);
    const app = await createServer({
      repository,
      artifactRoot: root,
      rootToken: credential,
      publicUrl: 'https://docs.example.test',
    });
    try {
      const requests = [
        { method: 'GET' as const, url: '/api/projects' },
        { method: 'GET' as const, url: '/docs/private/index.html' },
        {
          method: 'POST' as const,
          url: '/api/projects',
          payload: { slug: 'outage', name: 'Outage', visibility: 'private' },
        },
        {
          method: 'POST' as const,
          url: '/api/build-workers/claim',
          payload: { workerId: 'fixture', sourceIds: [randomUUID()] },
        },
      ];
      for (const [index, request] of requests.entries()) {
        const response = await app.inject({
          ...request,
          headers: { authorization: 'Bearer ' + credential },
        });
        expect(response.statusCode, request.url + ': ' + response.body).toBe(
          status,
        );
        expect(response.json()).toEqual({
          error: 'The request could not be completed',
        });
        expect(response.headers['cache-control']).toBe('no-store');
        expect(calls).toBe(index + 1);
      }
      expect((await app.inject('/health/ready')).statusCode).toBe(503);
      expect((await app.inject('/health/live')).statusCode).toBe(200);
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
