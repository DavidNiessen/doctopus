import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { setImmediate as yieldLoop } from 'node:timers/promises';
import { PostgresRepository } from '@davidniessen/doctopus-storage';
import { createServer } from '@davidniessen/doctopus-server';
import {
  buildSite,
  inspectIsolatedSource,
  stageArtifact,
} from '@davidniessen/doctopus-cli';
import { readBuildPolicy, toolVersion } from '@davidniessen/doctopus-contracts';
import type {
  BuildJob,
  BuildLease,
  BuildResult,
  Project,
} from '@davidniessen/doctopus-domain';
import { readWorkerConfig } from '../../apps/worker/src/config.js';
import type { PreparedSource } from '../../apps/worker/src/config.js';
import { createWorkerClient } from '../../apps/worker/src/protocol.js';
import { runWorker } from '../../apps/worker/src/worker.js';
import type { BuildExecution } from '../../apps/worker/src/executor.js';
const database = process.env.TEST_DATABASE_URL;
if (!database)
  throw new Error(
    'TEST_DATABASE_URL is required for worker/control-plane acceptance',
  );
const repository = new PostgresRepository(database, { migrate: true });
const token = randomBytes(32).toString('base64url');
const policy = readBuildPolicy({
  image: 'sha256:' + 'a'.repeat(64),
  limits: { timeoutMs: 1000, memoryMiB: 512, cpus: 1 },
});
let server: Awaited<ReturnType<typeof createServer>>;
let root = '',
  sourceDirectory = '',
  artifactRoot = '',
  builtDirectory = '',
  artifactId = '',
  origin = '';
let project: Project;
let snapshot: Awaited<ReturnType<typeof inspectIsolatedSource>>;
let executableClaim: (() => void) | undefined;
function untilAbort(signal: AbortSignal): Promise<void> {
  return new Promise((_, reject) => {
    const abort = () => reject(new Error('Owned fixture aborted'));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}
const wait = (_milliseconds: number, signal: AbortSignal) =>
  yieldLoop(undefined, { signal });
async function prepared() {
  const source = await repository.buildJobs.approveSource(
    project.id,
    { label: 'Prepared worker fixture', snapshot, policy },
    randomUUID(),
    'root',
  );
  const registry: PreparedSource = {
    id: source.id,
    projectId: project.id,
    directory: sourceDirectory,
    snapshot,
    policy: structuredClone(policy),
  };
  return registry;
}
function settings(source: PreparedSource, workerId = 'http-worker') {
  return readWorkerConfig({
    schemaVersion: 1,
    workerId,
    serverUrl: origin,
    insecureDevelopment: true,
    artifactRoot,
    pollMs: 1000,
    sources: [source],
  });
}
async function enqueue(source: PreparedSource) {
  return repository.buildJobs.enqueue(
    project.id,
    source.id,
    randomUUID(),
    'root',
  );
}
async function execute(job: BuildExecution): Promise<BuildResult> {
  expect('token' in job).toBe(false);
  return {
    artifactId: await stageArtifact(builtDirectory, artifactRoot),
    source: job.source.snapshot,
    requestedImage: job.source.policy.image,
    resolvedImage: 'sha256:' + 'a'.repeat(64),
    toolVersion,
    durationMs: 10,
  };
}
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'doctopus-worker-http-'));
  sourceDirectory = join(root, 'source');
  artifactRoot = join(root, 'artifacts');
  await repository.initialize();
  project = await repository.createProject({
    slug: 'worker-http-' + randomUUID(),
    name: 'Worker HTTP acceptance',
    visibility: 'private',
    subject: 'root',
  });
  await cp(resolve('examples/demo'), sourceDirectory, {
    recursive: true,
    filter: (file) =>
      !file.includes('.doctopus') && !file.includes('.api-docs'),
  });
  const configFile = join(sourceDirectory, 'docs.config.yaml');
  await writeFile(
    configFile,
    (await readFile(configFile, 'utf8')) +
      `\nbasePath: /docs/${project.slug}\n`,
  );
  snapshot = await inspectIsolatedSource(sourceDirectory);
  const built = await buildSite(sourceDirectory);
  builtDirectory = built.directory;
  artifactId = built.manifest.artifactDigest;
  server = await createServer({
    repository,
    artifactRoot,
    rootToken: token,
    publicUrl: 'http://127.0.0.1:8080',
    insecureDevelopment: true,
  });
  server.addHook('preHandler', async (request) => {
    if (
      request.url === '/api/build-workers/claim' &&
      (request.body as { workerId?: string } | undefined)?.workerId ===
        'executable-worker'
    )
      executableClaim?.();
  });
  origin = await server.listen({ host: '127.0.0.1', port: 0 });
});
afterEach(async () => {
  let after: string | undefined;
  do {
    const page = await repository.buildJobs.jobs(project.id, after);
    for (const job of page.items)
      if (job.state === 'queued' || job.state === 'running')
        await repository.buildJobs.cancel(project.id, job.id, 'root');
    after = page.nextCursor ?? undefined;
  } while (after);
});
afterAll(async () => {
  try {
    await server?.close();
  } finally {
    await repository.close();
    if (root) await rm(root, { recursive: true, force: true });
  }
});
it('claims, renews, stages verified bytes and settles a result over HTTP without publishing', async () => {
  const source = await prepared(),
    job = await enqueue(source),
    controller = new AbortController();
  const events: string[] = [];
  await runWorker({
    config: settings(source),
    control: createWorkerClient(origin, token, true),
    execute,
    signal: controller.signal,
    wait,
    report: (event) => {
      events.push(event);
      if (
        event === 'succeeded' ||
        event === 'failed' ||
        event === 'settlement_unconfirmed'
      )
        controller.abort();
    },
  });
  expect(events).toContain('succeeded');
  expect(await repository.buildJobs.job(project.id, job.id)).toMatchObject({
    state: 'succeeded',
    artifactId,
  });
  expect(
    (await repository.project(project.id))?.activePublicationId,
  ).toBeNull();
  expect(await repository.publications(project.id)).toEqual([]);
  const read = await server.inject({
    url: `/api/projects/${project.id}/builds/${job.id}`,
    headers: { authorization: 'Bearer ' + token },
  });
  expect(read.statusCode).toBe(200);
  expect(read.body).not.toContain(token);
});
it('aborts work after real API cancellation and never attaches a stale result', async () => {
  const source = await prepared(),
    job = await enqueue(source),
    controller = new AbortController();
  let aborted = false;
  await runWorker({
    config: settings(source),
    control: createWorkerClient(origin, token, true),
    signal: controller.signal,
    wait,
    execute: async (_job, _source, signal) => {
      const cancelled = await fetch(
        `${origin}/api/projects/${project.id}/builds/${job.id}/cancel`,
        { method: 'POST', headers: { Authorization: 'Bearer ' + token } },
      );
      expect(cancelled.status).toBe(200);
      await cancelled.body?.cancel();
      try {
        await untilAbort(signal);
      } finally {
        aborted = signal.aborted;
      }
      throw new Error('Cancelled fixture never produces a result');
    },
    report: (event) => {
      if (
        event === 'lease_lost' ||
        event === 'failed' ||
        event === 'settlement_unconfirmed'
      )
        controller.abort();
    },
  });
  expect(aborted).toBe(true);
  expect(await repository.buildJobs.job(project.id, job.id)).toMatchObject({
    state: 'cancelled',
    artifactId: null,
  });
});
it('rejects independently changed local approval before host execution and records the safe reason', async () => {
  const source = await prepared(),
    job = await enqueue(source),
    controller = new AbortController();
  source.policy.trustPlugins = true;
  let executions = 0;
  await runWorker({
    config: settings(source),
    control: createWorkerClient(origin, token, true),
    signal: controller.signal,
    wait,
    execute: async (execution) => {
      executions++;
      return execute(execution);
    },
    report: (event) => {
      if (
        event === 'failed' ||
        event === 'succeeded' ||
        event === 'settlement_unconfirmed'
      )
        controller.abort();
    },
  });
  expect(executions).toBe(0);
  expect(await repository.buildJobs.job(project.id, job.id)).toMatchObject({
    state: 'failed',
    errorCode: 'source_changed',
    artifactId: null,
  });
});
it('retries a lost successful completion acknowledgement against actual settled state', async () => {
  const source = await prepared(),
    job = await enqueue(source),
    controller = new AbortController();
  const client = createWorkerClient(origin, token, true);
  let attempts = 0;
  const control = {
    ...client,
    async complete(
      lease: BuildLease,
      result: BuildResult,
      signal: AbortSignal,
    ) {
      await client.complete(lease, result, signal);
      if (++attempts === 1)
        throw new Error('Owned network acknowledgement fixture');
    },
  };
  await runWorker({
    config: settings(source),
    control,
    execute,
    signal: controller.signal,
    wait,
    report: (event) => {
      if (
        event === 'succeeded' ||
        event === 'failed' ||
        event === 'settlement_unconfirmed'
      )
        controller.abort();
    },
  });
  expect(attempts).toBe(2);
  expect((await repository.buildJobs.job(project.id, job.id))?.state).toBe(
    'succeeded',
  );
  expect(
    (await repository.audit(project.id)).filter(
      (entry) =>
        entry.action === 'build.succeeded' &&
        (entry.metadata as { jobId: string }).jobId === job.id,
    ),
  ).toHaveLength(1);
});
it('starts the real executable with a file credential and exits cleanly during idle polling', async () => {
  const source = await prepared();
  const directory = join(root, 'control');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const credentialFile = join(directory, 'root-token');
  const configFile = join(directory, 'worker.json');
  await writeFile(credentialFile, token, { mode: 0o600 });
  await writeFile(
    configFile,
    JSON.stringify(settings(source, 'executable-worker')),
  );
  let seen!: () => void;
  const claimed = new Promise<void>((resolve) => {
    seen = resolve;
  });
  executableClaim = seen;
  const child = spawn(process.execPath, ['apps/worker/dist/main.js'], {
    env: {
      ...process.env,
      BUILD_WORKER_CONFIG_FILE: configFile,
      ROOT_TOKEN_FILE: credentialFile,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (value: Buffer) => {
    output += value.toString();
  });
  child.stderr.on('data', (value: Buffer) => {
    output += value.toString();
  });
  const finished = new Promise<{ code: number | null; signal: string | null }>(
    (resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    },
  );
  try {
    await Promise.race([
      claimed,
      finished.then(() => {
        throw new Error('Worker exited before its first claim');
      }),
    ]);
    child.kill('SIGTERM');
    expect(await finished).toEqual({ code: 0, signal: null });
    expect(output).not.toContain(token);
  } finally {
    executableClaim = undefined;
    child.kill('SIGKILL');
    await finished;
  }
  expect(
    (await repository.buildJobs.jobs(project.id)).items.some(
      (item: BuildJob) => item.sourceId === source.id,
    ),
  ).toBe(false);
});
