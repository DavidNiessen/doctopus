import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readBuildPolicy } from '@davidniessen/doctopus-contracts';
import {
  readCapabilities,
  readJob,
  readPage,
  readSource,
} from '../apps/studio/src/build-data.js';

const projectId = randomUUID();
const snapshot = {
  digestVersion: 2,
  digest: 'a'.repeat(64),
  files: 1,
  bytes: 1,
};
const source = {
  id: randomUUID(),
  projectId,
  label: '<img src=x onerror=alert(1)>',
  revision: null,
  snapshot,
  policy: readBuildPolicy({ image: 'sha256:' + 'b'.repeat(64) }),
  approvedBy: 'root',
  createdAt: new Date().toISOString(),
  revokedAt: null,
};
const job = {
  id: randomUUID(),
  projectId,
  sourceId: source.id,
  state: 'queued',
  attempts: 0,
  maxAttempts: 3,
  createdAt: source.createdAt,
  updatedAt: source.createdAt,
  workerId: null,
  artifactId: null,
  errorCode: null,
};
it('binds source and job data to the selected project and drops undisplayed fields', () => {
  expect(readSource({ ...source, hostPath: '/private' }, projectId)).toEqual(
    source,
  );
  expect(readJob({ ...job, token: 'private' }, projectId)).toEqual(job);
  for (const decode of [readSource, readJob])
    expect(() =>
      decode({ ...source, ...job, projectId: randomUUID() }, projectId),
    ).toThrow();
});
it('rejects malformed policies, snapshots and approval metadata', () => {
  for (const change of [
    { policy: { ...source.policy, image: 'latest' } },
    { snapshot: { ...snapshot, digest: 'invalid' } },
    { createdAt: 'tomorrow' },
    { revokedAt: false },
    { label: 'a'.repeat(121) },
    { revision: 5 },
  ])
    expect(() => readSource({ ...source, ...change }, projectId)).toThrow();
});
it('requires a successful artifact and bounded attempts, states and error codes', () => {
  for (const change of [
    { state: 'succeeded' },
    { state: 'unknown' },
    { attempts: -1 },
    { maxAttempts: 4 },
    { artifactId: '../private' },
    { errorCode: 'raw secret' },
  ])
    expect(() => readJob({ ...job, ...change }, projectId)).toThrow();
  expect(
    readJob(
      { ...job, state: 'succeeded', artifactId: 'c'.repeat(64) },
      projectId,
    ).state,
  ).toBe('succeeded');
});
it('bounds page sizes and cursors before displaying build history', () => {
  const decode = (value: unknown) => readJob(value, projectId);
  expect(
    readPage({ items: Array(100).fill(job), nextCursor: job.id }, decode).items,
  ).toHaveLength(100);
  for (const input of [
    { items: Array(101).fill(job), nextCursor: null },
    { items: [], nextCursor: '../../elsewhere' },
    { items: null, nextCursor: null },
  ])
    expect(() => readPage(input, decode)).toThrow();
});
it('requires explicit boolean capabilities for the current project', () => {
  const capabilities = {
    projectId,
    approveSource: false,
    enqueue: true,
    cancel: true,
    revokeSource: false,
    publish: false,
  };
  expect(readCapabilities(capabilities, projectId)).toEqual(capabilities);
  for (const change of [
    { enqueue: 'true' },
    { cancel: undefined },
    { projectId: randomUUID() },
  ])
    expect(() =>
      readCapabilities({ ...capabilities, ...change }, projectId),
    ).toThrow();
});
