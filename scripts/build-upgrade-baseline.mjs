import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { upgradeBaselineCommit } from './lib/server-upgrade-fixture.mjs';

const env = { ...process.env };
for (const name of [
  'DOCKER_HOST',
  'DOCKER_CONTEXT',
  'DOCKER_TLS',
  'DOCKER_TLS_VERIFY',
  'DOCKER_CERT_PATH',
])
  delete env[name];
const root = await mkdtemp(join(tmpdir(), 'doctopus-baseline-build-'));
const run = (file, args, input) =>
  new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      env,
      stdio: ['pipe', 'ignore', 'inherit'],
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error('Historical baseline command failed: ' + file)),
    );
    child.stdin.on('error', reject);
    child.stdin.end(input);
  });
try {
  // A full trusted checkout is required; the pinned historical source is never fetched here.
  await promisify(execFile)(
    'git',
    ['merge-base', '--is-ancestor', upgradeBaselineCommit, 'HEAD'],
    { env, timeout: 10000 },
  );
  const archive = (
    await promisify(execFile)('git', ['archive', upgradeBaselineCommit], {
      env,
      timeout: 30000,
      encoding: 'buffer',
      maxBuffer: 64 * 1024 * 1024,
    })
  ).stdout;
  const context = join(root, 'source');
  await mkdir(context);
  await run('tar', ['-x', '-C', context], archive);
  const imageFile = join(root, 'server.id');
  await run('docker', [
    '--host=unix:///var/run/docker.sock',
    'build',
    '--target',
    'server',
    '--label',
    'org.opencontainers.image.revision=' + upgradeBaselineCommit,
    ...(process.env.CODEX_PROXY_CERT
      ? ['--secret', 'id=proxy_ca,src=' + process.env.CODEX_PROXY_CERT]
      : []),
    '--iidfile',
    imageFile,
    context,
  ]);
  const image = (await readFile(imageFile, 'utf8')).trim();
  assert.match(image, /^sha256:[a-f0-9]{64}$/);
  await mkdir('.doctopus', { recursive: true });
  await writeFile(resolve('.doctopus/upgrade-baseline.id'), image + '\n');
  console.log(
    JSON.stringify(
      {
        schemaVersion: 1,
        baselineCommit: upgradeBaselineCommit,
        image,
        signed: false,
        publicationApproved: false,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
