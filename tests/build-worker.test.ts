import { expect, it } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { setImmediate as yieldLoop } from 'node:timers/promises';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readBuildPolicy, toolVersion } from '@davidniessen/doctopus-contracts';
import type { BuildLease, BuildResult } from '@davidniessen/doctopus-domain';
import {
  readWorkerConfig,
  loadWorkerConfig,
} from '../apps/worker/src/config.js';
import type { PreparedSource } from '../apps/worker/src/config.js';
import {
  readLease,
  createWorkerClient,
  ControlPlaneError,
} from '../apps/worker/src/protocol.js';
import type { WorkerControlPlane } from '../apps/worker/src/protocol.js';
import {
  BuildExecutionDeadline,
  SourceApprovalChanged,
  sameApproval,
} from '../apps/worker/src/executor.js';
import type { BuildExecution } from '../apps/worker/src/executor.js';
import { runWorker } from '../apps/worker/src/worker.js';
function prepared(): PreparedSource {
  return {
    id: randomUUID(),
    projectId: randomUUID(),
    directory: '/prepared/docs',
    snapshot: { digestVersion: 2, digest: 'b'.repeat(64), bytes: 10, files: 1 },
    policy: readBuildPolicy({
      image: 'sha256:' + 'a'.repeat(64),
      limits: { timeoutMs: 1000 },
    }),
  };
}
function config(source = prepared()) {
  return readWorkerConfig({
    schemaVersion: 1,
    workerId: 'unit-worker',
    serverUrl: 'https://docs.example.test',
    artifactRoot: '/artifacts',
    sources: [source],
  });
}
function lease(source: PreparedSource): BuildLease {
  const date = new Date().toISOString();
  return {
    token: randomBytes(32).toString('base64url'),
    source: {
      id: source.id,
      projectId: source.projectId,
      label: 'Prepared',
      revision: null,
      snapshot: structuredClone(source.snapshot),
      policy: structuredClone(source.policy),
      approvedBy: 'root',
      createdAt: date,
      revokedAt: null,
    },
    job: {
      id: randomUUID(),
      projectId: source.projectId,
      sourceId: source.id,
      state: 'running',
      requestedBy: 'root',
      attempts: 1,
      maxAttempts: 3,
      workerId: 'unit-worker',
      createdAt: date,
      updatedAt: date,
      availableAt: date,
      startedAt: date,
      finishedAt: null,
      leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
      deadlineAt: new Date(Date.now() + 121000).toISOString(),
      artifactId: null,
      result: null,
      errorCode: null,
    },
  };
}
function output(value: BuildExecution): BuildResult {
  return {
    artifactId: 'c'.repeat(64),
    source: value.source.snapshot,
    requestedImage: value.source.policy.image,
    resolvedImage: 'sha256:' + 'a'.repeat(64),
    toolVersion,
    durationMs: 10,
  };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function untilAbort(signal: AbortSignal): Promise<void> {
  return new Promise((_, reject) => {
    const abort = () => reject(new Error('Aborted owned fixture'));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}
const wait = (milliseconds: number, signal: AbortSignal) =>
  milliseconds === 10000
    ? untilAbort(signal)
    : yieldLoop(undefined, { signal });
function fixture(source = prepared()) {
  const settings = config(source),
    job = lease(source),
    controller = new AbortController();
  const events: string[] = [],
    failures: string[] = [],
    results: BuildResult[] = [];
  let pending = true;
  const control: WorkerControlPlane = {
    async claim(_workerId, ids) {
      if (!pending || !ids.includes(source.id)) return undefined;
      pending = false;
      return job;
    },
    async heartbeat() {
      return true;
    },
    async complete(_lease, result) {
      results.push(result);
    },
    async fail(_lease, code) {
      failures.push(code);
    },
  };
  const options = {
    config: settings,
    control,
    signal: controller.signal,
    execute: async (value: BuildExecution) => output(value),
    wait,
    report: (event: string) => {
      events.push(event);
      if (
        [
          'succeeded',
          'failed',
          'lease_lost',
          'settlement_unconfirmed',
        ].includes(event)
      )
        controller.abort();
    },
  };
  return {
    source,
    job,
    controller,
    options,
    control,
    events,
    failures,
    results,
  };
}
it('reads an independent closed registry with conservative host limits and project-bound source policies', () => {
  const source = prepared(),
    settings = config(source);
  expect(settings).toMatchObject({
    maxConcurrency: 1,
    maxMemoryMiB: 2048,
    maxCpus: 2,
    pollMs: 2000,
  });
  settings.sources[0]!.policy.limits.cpus = 1;
  expect(source.policy.limits.cpus).toBe(2);
  const original = config(source);
  for (const patch of [
    { schemaVersion: 2 },
    { rootToken: 'must-not-be-configured-here' },
    { maxConcurrency: 5 },
    { maxConcurrency: null },
    { maxMemoryMiB: 512 },
    { maxCpus: 1 },
    { pollMs: 0 },
    { workerId: '../worker' },
    { artifactRoot: 'relative' },
    { sources: [] },
    { sources: [source, source] },
    { sources: [{ ...source, projectId: 'invalid' }] },
    { sources: [{ ...source, directory: 'relative' }] },
    {
      sources: [
        { ...source, policy: { ...source.policy, image: 'builder:latest' } },
      ],
    },
    { sources: [{ ...source, snapshot: { ...source.snapshot, files: 0 } }] },
    { sources: [{ ...source, environment: { TOKEN: 'denied' } }] },
  ])
    expect(() => readWorkerConfig({ ...original, ...patch })).toThrow();
});
it('requires HTTPS origins and explicit loopback development independently in the client', () => {
  const original = config();
  for (const serverUrl of [
    'http://docs.example.test',
    'http://127.0.0.1:8080',
    'https://docs.example.test/path',
    'https://docs.example.test/?query=1',
    'https://docs.example.test/#fragment',
    'https://user:password@docs.example.test',
    'file:///tmp/socket',
  ])
    expect(() => readWorkerConfig({ ...original, serverUrl })).toThrow();
  expect(
    readWorkerConfig({
      ...original,
      serverUrl: 'http://127.0.0.1:8080',
      insecureDevelopment: true,
    }).serverUrl,
  ).toBe('http://127.0.0.1:8080');
  expect(() =>
    createWorkerClient('http://docs.example.test', 'a'.repeat(32), true),
  ).toThrow();
  expect(() =>
    createWorkerClient('http://127.0.0.1:8080', 'a'.repeat(32)),
  ).toThrow();
  expect(() =>
    createWorkerClient('https://docs.example.test', 'short'),
  ).toThrow();
  expect(() =>
    createWorkerClient('https://docs.example.test', 'a'.repeat(32) + '\n'),
  ).toThrow();
});
it('resolves local data without importing source code and rejects control/storage paths inside prepared input', async () => {
  const root = await mkdtemp(join(tmpdir(), 'doctopus-worker-config-'));
  try {
    const source = prepared();
    source.directory = join(root, 'source');
    await mkdir(source.directory);
    const secret = join(root, 'operator-token');
    const file = join(root, 'worker.json');
    const marker = join(root, 'executed');
    await writeFile(secret, 'private-fixture-token');
    await writeFile(
      join(source.directory, 'plugin.mjs'),
      `import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(marker)},'bad');`,
    );
    await writeFile(
      join(source.directory, 'docs.config.yaml'),
      'not valid project configuration',
    );
    const input = { ...config(source), artifactRoot: join(root, 'artifacts') };
    await writeFile(file, JSON.stringify(input));
    expect((await loadWorkerConfig(file, secret)).sources[0]!.directory).toBe(
      source.directory,
    );
    await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' });
    for (const artifactRoot of [
      source.directory,
      root,
      join(source.directory, 'output'),
    ]) {
      await writeFile(file, JSON.stringify({ ...input, artifactRoot }));
      await expect(loadWorkerConfig(file, secret)).rejects.toThrow();
    }
    await writeFile(file, JSON.stringify(input));
    const innerSecret = join(source.directory, 'token');
    await writeFile(innerSecret, 'fixture');
    await expect(loadWorkerConfig(file, innerSecret)).rejects.toThrow(
      'outside prepared sources',
    );
    const innerConfig = join(source.directory, 'worker.json');
    await writeFile(innerConfig, JSON.stringify(input));
    await expect(loadWorkerConfig(innerConfig, secret)).rejects.toThrow(
      'outside prepared sources',
    );
    const large = join(root, 'large.json');
    await writeFile(large, ' '.repeat(4 * 1024 * 1024 + 1));
    await expect(loadWorkerConfig(large)).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it('decodes full ownership without trusting remote paths, policy versions or malformed leases', () => {
  const source = prepared(),
    original = lease(source);
  const decoded = readLease(original, 'unit-worker');
  expect(decoded).toEqual(original);
  decoded.source.policy.limits.cpus = 1;
  expect(original.source.policy.limits.cpus).toBe(2);
  const changes = [
    { token: 'bad' },
    { hostPath: '/outside' },
    { job: { ...original.job, projectId: randomUUID() } },
    { job: { ...original.job, state: 'cancelled' } },
    { job: { ...original.job, workerId: 'other' } },
    { job: { ...original.job, attempts: 4 } },
    { job: { ...original.job, deadlineAt: 'invalid' } },
    { source: { ...original.source, revokedAt: new Date().toISOString() } },
    { source: { ...original.source, directory: '/outside' } },
    {
      source: {
        ...original.source,
        policy: { ...source.policy, image: 'worker:latest' },
      },
    },
  ];
  for (const change of changes)
    expect(() =>
      readLease({ ...original, ...change }, 'unit-worker'),
    ).toThrow();
});
it('renews ownership before executing and reports success without sending credentials to the executor', async () => {
  const value = fixture();
  let renewed = false,
    ran = false;
  value.control.heartbeat = async () => {
    renewed = true;
    return true;
  };
  value.options.execute = async (job) => {
    expect('token' in job).toBe(false);
    expect(renewed).toBe(true);
    ran = true;
    return output(job);
  };
  await runWorker(value.options);
  expect(ran).toBe(true);
  expect(value.events).toEqual(['claimed', 'succeeded']);
  expect(value.results).toHaveLength(1);
  expect(value.failures).toEqual([]);
});
it('never executes or settles a lease rejected by the initial renewal', async () => {
  const value = fixture();
  let executions = 0;
  value.control.heartbeat = async () => false;
  value.options.execute = async (job) => {
    executions++;
    return output(job);
  };
  await runWorker(value.options);
  expect(executions).toBe(0);
  expect(value.events).toContain('lease_lost');
  expect(value.results).toEqual([]);
  expect(value.failures).toEqual([]);
});
it('aborts active execution on lost heartbeat ownership without reporting a stale failure', async () => {
  const value = fixture();
  let renewals = 0,
    aborted = false;
  value.control.heartbeat = async () => ++renewals === 1;
  value.options.wait = (_milliseconds, signal) =>
    yieldLoop(undefined, { signal });
  await runWorker({
    ...value.options,
    execute: async (_job, _source, signal) => {
      try {
        await untilAbort(signal);
      } finally {
        aborted = signal.aborted;
      }
      throw new Error('Unreachable');
    },
  });
  expect(aborted).toBe(true);
  expect(value.events).toContain('lease_lost');
  expect(value.results).toEqual([]);
  expect(value.failures).toEqual([]);
});
it('rejects changed project/source/image/trust approval before executing', async () => {
  for (const update of [
    (job: BuildLease) => {
      job.source.projectId = randomUUID();
    },
    (job: BuildLease) => {
      job.source.snapshot.digest = 'd'.repeat(64);
    },
    (job: BuildLease) => {
      job.source.policy.image = 'sha256:' + 'e'.repeat(64);
    },
    (job: BuildLease) => {
      job.source.policy.trustPlugins = true;
    },
    (job: BuildLease) => {
      job.source.policy.limits.cpus = 4;
    },
  ]) {
    const value = fixture();
    let executed = false;
    update(value.job);
    value.options.execute = async (job) => {
      executed = true;
      return output(job);
    };
    await runWorker(value.options);
    expect(executed).toBe(false);
    expect(value.failures).toEqual(['source_changed']);
  }
});
it('reports safe terminal codes for executor failures and deadlines', async () => {
  for (const [error, code] of [
    [new Error('private source log'), 'build_failed'],
    [new SourceApprovalChanged('private source path'), 'source_changed'],
    [new BuildExecutionDeadline('private runtime data'), 'deadline_exceeded'],
  ] as const) {
    const value = fixture();
    value.options.execute = async () => {
      throw error;
    };
    await runWorker(value.options);
    expect(value.failures).toEqual([code]);
    expect(JSON.stringify(value.events)).not.toContain('private');
  }
});
it('retries uncertain completion after an acknowledgement loss, including a settled heartbeat', async () => {
  const value = fixture();
  let committed = false,
    attempts = 0;
  value.control.heartbeat = async () => !committed;
  value.control.complete = async () => {
    attempts++;
    if (!committed) {
      committed = true;
      throw new Error('Lost acknowledgement');
    }
  };
  value.options.wait = (_milliseconds, signal) =>
    yieldLoop(undefined, { signal });
  value.options.report = (event) => {
    value.events.push(event);
    if (event === 'succeeded' || event === 'settlement_unconfirmed')
      value.controller.abort();
  };
  await runWorker(value.options);
  expect(attempts).toBe(2);
  expect(value.events).toContain('succeeded');
  expect(value.failures).toEqual([]);
});
it('leaves uncertain settlement for recovery and treats a rejected artifact as a terminal failure', async () => {
  for (const [error, expected] of [
    [new ControlPlaneError(503), []],
    [new ControlPlaneError(400), ['build_failed']],
  ] as const) {
    const value = fixture();
    let attempts = 0;
    value.control.complete = async () => {
      attempts++;
      throw error;
    };
    await runWorker(value.options);
    expect(attempts).toBe(error.status === 400 ? 1 : 3);
    expect(value.failures).toEqual(expected);
  }
});
it('enforces aggregate CPU/memory budgets while filling slots across prepared sources', async () => {
  const sources = Array.from({ length: 3 }, () => {
    const source = prepared();
    source.policy.limits.memoryMiB = 1024;
    source.policy.limits.cpus = 1;
    return source;
  });
  const settings = readWorkerConfig({
    ...config(sources[0]!),
    sources,
    maxConcurrency: 4,
  });
  const jobs = sources.map(lease),
    started = deferred(),
    release = deferred(),
    controller = new AbortController();
  let active = 0,
    peak = 0,
    completed = 0;
  const control: WorkerControlPlane = {
    async claim(_id, ids) {
      const index = jobs.findIndex((job) => ids.includes(job.source.id));
      return index < 0 ? undefined : jobs.splice(index, 1)[0];
    },
    async heartbeat() {
      return true;
    },
    async complete() {
      completed++;
      if (completed === 3) controller.abort();
    },
    async fail() {
      throw new Error('Unexpected failure');
    },
  };
  const running = runWorker({
    config: settings,
    control,
    signal: controller.signal,
    wait,
    execute: async (job) => {
      active++;
      peak = Math.max(peak, active);
      if (active === 2) started.resolve();
      await release.promise;
      active--;
      return output(job);
    },
  });
  try {
    await started.promise;
    expect(peak).toBe(2);
    release.resolve();
    await running;
  } finally {
    release.resolve();
    controller.abort();
    await running;
  }
  expect(completed).toBe(3);
  expect(peak).toBe(2);
});
it('does not claim work without storage headroom, then recovers when storage is available', async () => {
  const value = fixture();
  let checks = 0,
    claims = 0;
  const original = value.control.claim;
  value.control.claim = async (...args) => {
    claims++;
    expect(checks).toBeGreaterThan(1);
    return original(...args);
  };
  await runWorker({ ...value.options, canStart: async () => ++checks > 1 });
  expect(claims).toBe(1);
  expect(value.events).toContain('storage_unavailable');
});
it('stops on rejected operator authentication and survives transient control-plane failures', async () => {
  const rejected = fixture();
  rejected.control.claim = async () => {
    throw new ControlPlaneError(401);
  };
  await expect(runWorker(rejected.options)).rejects.toMatchObject({
    status: 401,
  });
  expect(rejected.results).toEqual([]);
  const transient = fixture();
  let attempts = 0;
  const original = transient.control.claim;
  transient.control.claim = async (...args) => {
    if (++attempts === 1) throw new ControlPlaneError(503);
    return original(...args);
  };
  await runWorker(transient.options);
  expect(transient.events).toContain('control_unavailable');
  expect(transient.events).toContain('succeeded');
});
it('aborts running work during shutdown without marking it as a permanent source failure', async () => {
  const value = fixture();
  let aborted = false;
  await runWorker({
    ...value.options,
    execute: async (_job, _source, signal) => {
      value.controller.abort();
      try {
        await untilAbort(signal);
      } finally {
        aborted = signal.aborted;
      }
      throw new Error('Unreachable');
    },
  });
  expect(aborted).toBe(true);
  expect(value.failures).toEqual([]);
  expect(value.results).toEqual([]);
});

it('backs off idle and unavailable control planes to at most thirty seconds', async () => {
  for (const unavailable of [false, true]) {
    const value = fixture();
    const intervals: number[] = [];
    value.control.claim = async () => {
      if (unavailable) throw new ControlPlaneError(503);
      return undefined;
    };
    await runWorker({
      ...value.options,
      wait: async (milliseconds, signal) => {
        intervals.push(milliseconds);
        if (intervals.length === 6) value.controller.abort();
        await yieldLoop(undefined, { signal });
      },
    });
    expect(intervals).toEqual([2000, 4000, 8000, 16000, 30000, 30000]);
    expect(value.results).toEqual([]);
  }
});

it('compares approved metadata by value across differently ordered JSON round trips', () => {
  const source = prepared(),
    claimed = lease(source);
  claimed.source.snapshot = {
    files: source.snapshot.files,
    bytes: source.snapshot.bytes,
    digest: source.snapshot.digest,
    digestVersion: 2,
  };
  claimed.source.policy = {
    ...source.policy,
    limits: Object.fromEntries(
      Object.entries(source.policy.limits).reverse(),
    ) as typeof source.policy.limits,
  };
  expect(sameApproval(claimed, source)).toBe(true);
  claimed.source.snapshot.bytes++;
  expect(sameApproval(claimed, source)).toBe(false);
});
