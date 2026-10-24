import { expect, it } from 'vitest';
import {
  readBuildPolicy,
  readIsolatedBuildLimits,
  readSourceSnapshotInfo,
  defaultIsolatedBuildLimits,
} from '@davidniessen/doctopus-contracts';
import { PostgresRepository } from '@davidniessen/doctopus-storage';
const image = 'sha256:' + 'a'.repeat(64);
it('materializes independent conservative policies without evaluating configuration', () => {
  const input = { image, limits: { sourceMiB: 1 } };
  const before = JSON.stringify(input),
    policy = readBuildPolicy(input);
  expect(policy).toEqual({
    schemaVersion: 1,
    image,
    config: 'docs.config.yaml',
    trustPlugins: false,
    trustContent: false,
    limits: { ...defaultIsolatedBuildLimits, sourceMiB: 1 },
  });
  policy.limits.memoryMiB = 512;
  expect(readBuildPolicy(input).limits.memoryMiB).toBe(2048);
  expect(JSON.stringify(input)).toBe(before);
  expect(
    readBuildPolicy(
      Object.assign(Object.create({ trustPlugins: true }), { image }),
    ).trustPlugins,
  ).toBe(false);
});
it('rejects unbounded or ambiguous execution policies and source identities', () => {
  for (const input of [
    null,
    [],
    { image: 'worker:latest' },
    { image, config: '../outside' },
    { image, config: 'a/.hidden/config.yaml' },
    { image, config: null },
    { image, trustPlugins: null },
    { image, trustContent: 'yes' },
    { image, schemaVersion: 2 },
    { image, environment: { TOKEN: 'fixture' } },
    { image, limits: { cpus: 0 } },
    { image, limits: { memoryMiB: 4097 } },
  ])
    expect(() => readBuildPolicy(input)).toThrow();
  for (const input of [
    { timeoutMs: null },
    { timeoutMs: NaN },
    { cpus: 1.5 },
    { sourceMiB: 0 },
    { outputMiB: 1025 },
    { network: true },
  ])
    expect(() => readIsolatedBuildLimits(input)).toThrow('limits');
  const info = {
    digestVersion: 2,
    digest: 'b'.repeat(64),
    bytes: 10,
    files: 1,
  };
  expect(readSourceSnapshotInfo(info)).toEqual(info);
  for (const update of [
    { digestVersion: 1 },
    { digest: 'B'.repeat(64) },
    { bytes: 2 ** 31 },
    { files: 30001 },
    { files: NaN },
    { paths: ['not part of public metadata'] },
  ])
    expect(() => readSourceSnapshotInfo({ ...info, ...update })).toThrow();
});
it('validates queue budgets before opening database resources', async () => {
  for (const buildQueue of [
    null,
    [],
    { maxPending: 0 },
    { maxRunning: 17 },
    { maxRunning: 1, maxRunningPerProject: 2 },
    { maxPending: 2, maxPendingPerProject: 3 },
    { unknown: 1 },
  ])
    expect(
      () =>
        new PostgresRepository('postgresql://fixture@127.0.0.1/unused', {
          buildQueue: buildQueue as never,
        }),
    ).toThrow();
  const store = new PostgresRepository(
    'postgresql://fixture@127.0.0.1/unused',
    { buildQueue: { maxPending: 1 } },
  );
  expect(store.buildJobs).toBeDefined();
  await store.close();
});
