import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir, uptime } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { buildSite, inspectIsolatedSource } from '@davidniessen/doctopus-cli';
import { readBuildPolicy } from '@davidniessen/doctopus-contracts';
import { verifyArtifact } from '@davidniessen/doctopus-compiler';
import { PostgresRepository } from '@davidniessen/doctopus-storage';
import { createServer } from '@davidniessen/doctopus-server';
import { readWorkerConfig } from '../apps/worker/dist/config.js';
import { createWorkerClient } from '../apps/worker/dist/protocol.js';
import {
  createIsolatedExecutor,
  createWorkerStorageAdmission,
} from '../apps/worker/dist/executor.js';
import { runWorker } from '../apps/worker/dist/worker.js';

const database = process.env.TEST_DATABASE_URL;
const image = process.env.ISOLATED_BUILD_IMAGE;
assert.ok(
  database,
  'TEST_DATABASE_URL must identify a disposable PostgreSQL fixture',
);
assert.match(
  image ?? '',
  /^(?:sha256:[a-f0-9]{64}|[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64})$/,
  'ISOLATED_BUILD_IMAGE must identify an approved immutable builder',
);
const exec = promisify(execFile);
const dockerEnvironment = { ...process.env };
for (const key of [
  'DOCKER_HOST',
  'DOCKER_CONTEXT',
  'DOCKER_TLS',
  'DOCKER_TLS_VERIFY',
  'DOCKER_CERT_PATH',
])
  delete dockerEnvironment[key];
const docker = async (...args) =>
  (
    await exec('docker', ['--host=unix:///var/run/docker.sock', ...args], {
      env: dockerEnvironment,
      timeout: 30000,
    })
  ).stdout.trim();
const resources = async () => ({
  jobs: await docker(
    'ps',
    '--all',
    '--quiet',
    '--no-trunc',
    '--filter',
    'label=io.doctopus.isolated-job',
  ),
  volumes: await docker(
    'volume',
    'ls',
    '--quiet',
    '--filter',
    'label=io.doctopus.isolated-output',
  ),
});
async function until(predicate, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    assert.ok(
      Date.now() < deadline,
      'Timed out waiting for owned worker state',
    );
    await delay(50);
  }
}
const before = await resources();
const root = await mkdtemp(join(tmpdir(), 'doctopus-worker-docker-'));
const artifactRoot = join(root, 'artifacts');
await mkdir(artifactRoot);
const repository = new PostgresRepository(database, { migrate: true });
const credential = randomBytes(32).toString('base64url');
let server, origin, project, child, exited;
const controllers = new Set();
const work = new Set();
const evidence = { checks: [], results: [], automaticPublication: false };
const headers = {
  Authorization: 'Bearer ' + credential,
  'Content-Type': 'application/json',
};
async function post(path, body = {}) {
  const result = await fetch(origin + path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
    redirect: 'error',
  });
  assert.ok(result.ok, `Owned fixture API returned HTTP ${result.status}`);
  return result.json();
}
async function prepare(label, plugin = '') {
  const directory = join(root, label);
  await mkdir(directory);
  await writeFile(
    join(directory, 'docs.config.yaml'),
    `name: Worker acceptance\nbasePath: /docs/${project.slug}\nspecs:\n  - id: fixture\n    path: openapi.json\n${plugin ? 'plugins:\n  - probe.mjs\n' : ''}`,
  );
  await writeFile(
    join(directory, 'openapi.json'),
    JSON.stringify({
      openapi: '3.1.0',
      info: { title: 'Worker acceptance', version: 'v1' },
      paths: {},
    }),
  );
  if (plugin) await writeFile(join(directory, 'probe.mjs'), plugin);
  const snapshot = await inspectIsolatedSource(directory);
  const policy = readBuildPolicy({
    image,
    trustPlugins: !!plugin,
    limits: {
      timeoutMs: 15000,
      memoryMiB: 512,
      cpus: 1,
      pids: 64,
      sourceMiB: 1,
      outputMiB: 32,
    },
  });
  const approved = await post(`/api/projects/${project.id}/build-sources`, {
    label,
    snapshot,
    policy,
    idempotencyKey: randomUUID(),
  });
  return {
    directory,
    projectId: project.id,
    id: approved.id,
    snapshot,
    policy,
  };
}
function config(source, workerId = 'docker-acceptance') {
  return readWorkerConfig({
    schemaVersion: 1,
    workerId,
    serverUrl: origin,
    insecureDevelopment: true,
    artifactRoot,
    maxCpus: 1,
    maxMemoryMiB: 512,
    pollMs: 1000,
    sources: [source],
  });
}
const enqueue = (source) =>
  post(`/api/projects/${project.id}/builds`, {
    sourceId: source.id,
    idempotencyKey: randomUUID(),
  });
async function run(source, onEvent) {
  const controller = new AbortController();
  controllers.add(controller);
  let terminal;
  const task = runWorker({
    config: config(source),
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(90000)]),
    control: createWorkerClient(origin, credential, true),
    execute: createIsolatedExecutor(artifactRoot),
    canStart: createWorkerStorageAdmission(artifactRoot, controller.signal),
    // Preserve actual HTTP/leases/containers; shorten only the heartbeat cadence for cancellation acceptance.
    wait: (milliseconds, signal) =>
      delay(milliseconds === 10000 ? 200 : 50, undefined, { signal }),
    report: (event, id) => {
      onEvent?.(event, id);
      if (
        [
          'succeeded',
          'failed',
          'lease_lost',
          'settlement_unconfirmed',
        ].includes(event)
      ) {
        terminal = event;
        controller.abort();
      }
    },
  });
  work.add(task);
  try {
    await task;
    return terminal;
  } finally {
    work.delete(task);
    controllers.delete(controller);
  }
}
async function runningContainer() {
  const current = (await resources()).jobs
    .split('\n')
    .filter((id) => id && !before.jobs.split('\n').includes(id));
  for (const id of current) {
    try {
      if (
        (await docker('inspect', '--format', '{{.State.Running}}', id)) ===
        'true'
      )
        return true;
    } catch {
      /* Watchdogs may finish an owned job during inspection. */
    }
  }
  return false;
}
try {
  await repository.initialize();
  project = await repository.createProject({
    slug: 'worker-docker-' + randomUUID(),
    name: 'Worker Docker acceptance',
    visibility: 'private',
    subject: 'root',
  });
  server = await createServer({
    repository,
    artifactRoot,
    rootToken: credential,
    publicUrl: 'http://127.0.0.1:8080',
    insecureDevelopment: true,
  });
  origin = await server.listen({ host: '127.0.0.1', port: 0 });

  const source = await prepare('success');
  const native = await buildSite(source.directory);
  const job = await enqueue(source);
  assert.equal(await run(source), 'succeeded');
  const succeeded = await repository.buildJobs.job(project.id, job.id);
  assert.equal(succeeded.state, 'succeeded');
  assert.equal(succeeded.artifactId, native.manifest.artifactDigest);
  assert.equal(
    (await verifyArtifact(join(artifactRoot, succeeded.artifactId)))
      .artifactDigest,
    native.manifest.artifactDigest,
  );
  assert.equal(
    (await repository.project(project.id)).activePublicationId,
    null,
  );
  assert.deepEqual(await repository.publications(project.id), []);
  assert.deepEqual(
    await readdir(join(source.directory, '.doctopus/worker-jobs')),
    [],
  );
  evidence.checks.push(
    'real-http-docker-native-parity',
    'immutable-artifact-registration-without-publication',
  );
  evidence.results.push(succeeded.result);

  // A changed prepared input must fail before Docker is invoked and retain its prior output.
  await writeFile(
    join(source.directory, 'changed.txt'),
    'Unapproved visible input',
  );
  const changed = await enqueue(source);
  assert.equal(await run(source), 'failed');
  const rejected = await repository.buildJobs.job(project.id, changed.id);
  assert.equal(rejected.errorCode, 'source_changed');
  assert.equal(rejected.artifactId, null);
  assert.deepEqual(await resources(), before);
  assert.equal(
    JSON.parse(await readFile(join(native.directory, 'manifest.json'), 'utf8'))
      .artifactDigest,
    native.manifest.artifactDigest,
  );
  evidence.checks.push('changed-source-rejected-and-prior-output-retained');

  const plugin = `import {definePlugin} from '@davidniessen/doctopus-plugin-sdk';\nawait new Promise(resolve=>setTimeout(resolve,2000));\nexport default definePlugin({name:'worker-acceptance',version:'0.1.0',pluginApi:'1',capabilities:['transform'],transform(site){return site}});\n`;
  const cancellable = await prepare('cancellation', plugin);
  const cancelling = await enqueue(cancellable);
  const cancellationTask = run(cancellable);
  await until(runningContainer);
  await post(`/api/projects/${project.id}/builds/${cancelling.id}/cancel`);
  assert.equal(await cancellationTask, 'lease_lost');
  assert.equal(
    (await repository.buildJobs.job(project.id, cancelling.id)).state,
    'cancelled',
  );
  assert.deepEqual(
    await readdir(join(cancellable.directory, '.doctopus/worker-jobs')),
    [],
  );
  await until(
    async () => JSON.stringify(await resources()) === JSON.stringify(before),
  );
  evidence.checks.push(
    'api-cancellation-aborts-real-container-and-cleans-workspace',
  );

  const recoverable = await prepare('recovery', plugin);
  const abandoned = await enqueue(recoverable);
  const configFile = join(root, 'worker.json'),
    credentialFile = join(root, 'operator-token');
  await writeFile(
    configFile,
    JSON.stringify(config(recoverable, 'killed-worker')),
    { mode: 0o600 },
  );
  await writeFile(credentialFile, credential, { mode: 0o600 });
  child = spawn(process.execPath, [resolve('apps/worker/dist/main.js')], {
    env: {
      ...process.env,
      BUILD_WORKER_CONFIG_FILE: configFile,
      ROOT_TOKEN_FILE: credentialFile,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (part) => {
      if (output.length < 16384) output += part.toString();
    });
  exited = new Promise((done, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => done({ code, signal }));
  });
  await until(async () => {
    assert.equal(
      child.exitCode,
      null,
      'Worker exited before its container started',
    );
    return runningContainer();
  });
  child.kill('SIGKILL');
  assert.equal((await exited).signal, 'SIGKILL');
  assert.ok(
    !output.includes(credential),
    'Worker output must not contain its credential',
  );
  await until(
    async () => JSON.stringify(await resources()) === JSON.stringify(before),
  );
  const lost = await repository.buildJobs.job(project.id, abandoned.id);
  assert.equal(lost.state, 'running');
  const orphanedDirectories = await readdir(
    join(recoverable.directory, '.doctopus/worker-jobs'),
  );
  assert.equal(orphanedDirectories.length, 1);
  await readFile(
    join(
      recoverable.directory,
      '.doctopus/worker-jobs',
      orphanedDirectories[0],
      '.build.lock',
    ),
  );
  assert.deepEqual(
    (await readdir(join(recoverable.directory, '.doctopus'))).filter((name) =>
      /^(?:isolated|previous)-/.test(name),
    ),
    [],
  );
  const orphanOwner = JSON.parse(
    await readFile(
      join(
        recoverable.directory,
        '.doctopus/worker-jobs',
        orphanedDirectories[0],
        'worker-owner.json',
      ),
      'utf8',
    ),
  );
  // Wait the real hard recovery window: never advance PostgreSQL clocks or shorten the old owner's budget.
  const remaining = Date.parse(lost.deadlineAt) - Date.now();
  assert.ok(remaining > 0 && remaining <= 135000);
  await until(
    async () =>
      Date.now() > Date.parse(lost.deadlineAt) + 100 &&
      Math.floor(uptime() * 1000) > orphanOwner.safeAfterUptimeMs + 100,
    remaining + 30000,
  );
  assert.equal(await run(recoverable), 'succeeded');
  const recovered = await repository.buildJobs.job(project.id, abandoned.id);
  assert.equal(recovered.state, 'succeeded');
  assert.equal(recovered.attempts, 2);
  assert.equal(recovered.workerId, 'docker-acceptance');
  assert.deepEqual(
    await readdir(join(recoverable.directory, '.doctopus/worker-jobs')),
    [],
  );
  assert.equal(
    (await repository.project(project.id)).activePublicationId,
    null,
  );
  await until(
    async () => JSON.stringify(await resources()) === JSON.stringify(before),
  );
  evidence.checks.push(
    'killed-executable-watchdog-cleanup',
    'real-hard-deadline-expiry-and-second-attempt',
    'expired-owned-workspace-and-lock-reclaimed-before-retry',
  );
  evidence.results.push(recovered.result);
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  for (const controller of controllers) controller.abort();
  await Promise.allSettled(work);
  if (child && child.exitCode === null && child.signalCode === null)
    child.kill('SIGKILL');
  if (exited) await exited;
  try {
    await server?.close();
  } finally {
    await repository.close();
    await rm(root, { recursive: true, force: true });
  }
}
