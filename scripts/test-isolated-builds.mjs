import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  buildSite,
  buildIsolatedSite,
  inspectIsolatedSource,
} from '../packages/cli/dist/index.js';

const image = process.env.ISOLATED_BUILD_IMAGE;
assert.match(
  image ?? '',
  /^(?:sha256:[a-f0-9]{64}|[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64})$/,
  'Set ISOLATED_BUILD_IMAGE to an explicitly approved immutable local image',
);
const exec = promisify(execFile);
const environment = { ...process.env };
for (const name of [
  'DOCKER_HOST',
  'DOCKER_CONTEXT',
  'DOCKER_TLS',
  'DOCKER_TLS_VERIFY',
  'DOCKER_CERT_PATH',
])
  delete environment[name];
async function docker(...args) {
  return (
    await exec('docker', ['--host=unix:///var/run/docker.sock', ...args], {
      env: environment,
      timeout: 30000,
    })
  ).stdout.trim();
}
const jobs = () =>
  docker(
    'ps',
    '--all',
    '--quiet',
    '--no-trunc',
    '--filter',
    'label=io.doctopus.isolated-job',
  );
const volumes = () =>
  docker(
    'volume',
    'ls',
    '--quiet',
    '--filter',
    'label=io.doctopus.isolated-output',
  );
const beforeJobs = await jobs(),
  beforeVolumes = await volumes();
const root = await mkdtemp(join(tmpdir(), 'doctopus-isolated-jobs-'));
const project = join(root, 'project');
await mkdir(project);
const config =
  'name: Isolation fixture\nspecs:\n  - id: fixture\n    path: openapi.json\n';
await writeFile(join(project, 'docs.config.yaml'), config);
await writeFile(
  join(project, 'openapi.json'),
  JSON.stringify({
    openapi: '3.1.0',
    info: { title: 'Isolated fixture', version: 'v1' },
    paths: {},
  }),
);
const receipts = [];
let child;
try {
  const native = await buildSite(project);
  const approvedSource = await inspectIsolatedSource(project);
  const isolated = await buildIsolatedSite(project, {
    image,
    expectedSourceDigest: approvedSource.digest,
    timeoutMs: 45000,
  });
  assert.equal(
    isolated.manifest.artifactDigest,
    native.manifest.artifactDigest,
    'Native and isolated outputs must agree',
  );
  assert.deepEqual(isolated.receipt.source, approvedSource);
  await assert.rejects(
    buildIsolatedSite(project, { image, expectedSourceDigest: '0'.repeat(64) }),
    /source digest verification/,
  );
  receipts.push(isolated.receipt);
  const sentinel = join(root, 'host-only-' + randomUUID());
  await writeFile(sentinel, 'host-only fixture');
  process.env.DOCTOPUS_ISOLATION_TEST_SECRET = 'host-only-marker';
  const plugin = `
import assert from 'node:assert/strict';
import { access, writeFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { spawn } from 'node:child_process';
import { definePlugin } from '@davidniessen/doctopus-plugin-sdk';
assert.equal(process.env.DOCTOPUS_ISOLATION_TEST_SECRET, undefined);
for (const name of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy']) assert.equal(process.env[name] ?? '', '');
await assert.rejects(access(${JSON.stringify(sentinel)}));
await assert.rejects(writeFile('/work/project/host-write', 'blocked'));
await assert.rejects(writeFile('/root-write', 'blocked'));
assert.deepEqual(Object.keys(networkInterfaces()), ['lo']);
export default definePlugin({ name: 'isolation-fixture', version: '0.1.0', pluginApi: '1', capabilities: ['transform'], transform(site) {
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { detached: true, stdio: 'ignore' });
  child.unref();
  return site;
}});
`;
  await writeFile(join(project, 'probe.mjs'), plugin);
  await writeFile(
    join(project, 'docs.config.yaml'),
    config + 'plugins:\n  - probe.mjs\n',
  );
  receipts.push(
    (
      await buildIsolatedSite(project, {
        image,
        trustPlugins: true,
        timeoutMs: 45000,
      })
    ).receipt,
  );
  const published = await readFile(
    join(isolated.directory, 'manifest.json'),
    'utf8',
  );
  await assert.rejects(
    buildIsolatedSite(project, { image, timeoutMs: 45000 }),
    /prior publication retained/,
  );
  assert.equal(
    await readFile(join(isolated.directory, 'manifest.json'), 'utf8'),
    published,
  );
  await writeFile(
    join(project, 'probe.mjs'),
    'await new Promise(resolve=>setTimeout(resolve,60000));\n' + plugin,
  );
  await assert.rejects(
    buildIsolatedSite(project, { image, trustPlugins: true, timeoutMs: 2000 }),
    /deadline/,
  );
  const controller = new AbortController();
  const cancelling = buildIsolatedSite(project, {
    image,
    trustPlugins: true,
    timeoutMs: 45000,
    signal: controller.signal,
  });
  const cancellation = setTimeout(() => controller.abort(), 2000);
  try {
    await assert.rejects(cancelling, /cancelled/);
  } finally {
    clearTimeout(cancellation);
  }
  assert.equal(
    await readFile(join(isolated.directory, 'manifest.json'), 'utf8'),
    published,
  );
  const runner = join(root, 'parent.mjs');
  await writeFile(
    runner,
    `import {buildIsolatedSite} from ${JSON.stringify(pathToFileURL(resolve('packages/cli/dist/isolation.js')).href)}; await buildIsolatedSite(${JSON.stringify(project)}, {image:${JSON.stringify(image)},trustPlugins:true,timeoutMs:45000});`,
  );
  child = spawn(process.execPath, [runner], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let childError = '';
  child.stderr.on('data', (chunk) => {
    if (childError.length < 8192) childError += chunk.toString();
  });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  const waitFor = async (predicate, deadline = 15000) => {
    const start = Date.now();
    while (!(await predicate())) {
      assert.ok(
        Date.now() - start < deadline,
        'Timed out waiting for owned job cleanup',
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };
  await waitFor(async () => {
    assert.equal(child.exitCode, null, childError);
    const current = (await jobs())
      .split('\n')
      .filter((id) => id && !beforeJobs.split('\n').includes(id));
    if (current.length !== 1) return false;
    try {
      return (
        (await docker(
          'inspect',
          '--format',
          '{{.State.Running}}',
          current[0],
        )) === 'true'
      );
    } catch {
      return false;
    }
  });
  child.kill('SIGKILL');
  await exited;
  await waitFor(
    async () =>
      (await jobs()) === beforeJobs && (await volumes()) === beforeVolumes,
    45000,
  );
  assert.equal(
    await readFile(join(isolated.directory, 'manifest.json'), 'utf8'),
    published,
  );
  console.log(
    JSON.stringify(
      {
        checks: 6,
        receipts,
        parentDeathCleanup: true,
        priorPublicationRetained: true,
      },
      null,
      2,
    ),
  );
} finally {
  child?.kill('SIGKILL');
  delete process.env.DOCTOPUS_ISOLATION_TEST_SECRET;
  await rm(root, { recursive: true, force: true });
}
