import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { readWorkspacePackages } from './lib/workspaces.mjs';
import { readRegularFile } from './lib/read-regular-file.mjs';
import {
  hashReleaseAsset,
  releaseSource,
  singleCandidate,
  stageReleaseAssets,
  verifyReleaseAssets,
  writeReleaseAssetManifest,
} from './lib/release-assets.mjs';

const kind = process.argv[2];
assert(
  process.argv.length === 3 && ['npm', 'java', 'container'].includes(kind),
  'Use stage-release-assets.mjs npm|java|container.',
);
const root = process.cwd();
const context = await releaseSource(root);
const parent = join(root, '.doctopus/release-assets');
const destination = join(parent, kind);
await mkdir(parent, { recursive: true });
if (kind !== 'container') {
  const source = await singleCandidate(
    join(root, `.doctopus/${kind}-candidates`),
  );
  const packages = (await readWorkspacePackages(root))
    .filter((pkg) => pkg.path && pkg.metadata.private !== true)
    .map((pkg) => pkg.metadata.name);
  await stageReleaseAssets(kind, source, destination, context, packages);
} else {
  const exec = promisify(execFile);
  const run = (file, args, env = process.env) =>
    exec(file, args, { env, timeout: 300_000, maxBuffer: 4 * 1024 * 1024 });
  const read = async (path) =>
    JSON.parse(await readRegularFile(path, 16 * 1024 * 1024));
  const deployment = await read('.doctopus/server-container-evidence.json');
  const image = deployment.resolvedImage;
  assert.match(image, /^sha256:[a-f0-9]{64}$/);
  // Reassess the exact raw inventory/finding bytes and freshness before export.
  await run(process.execPath, ['scripts/check-container-security.mjs', image]);
  const inventory = await read('.doctopus/container-inventory-evidence.json');
  const security = await read('.doctopus/container-security-evidence.json');
  for (const report of [inventory, security]) {
    assert.equal(report.sourceCommit, context.commit);
    assert.equal(report.sourceWorkingTreeDirty, false);
    assert.equal(report.toolVersion, context.version);
    assert.equal(report.resolvedImage, image);
  }
  assert.equal(deployment.toolVersion, context.version);
  assert.equal(deployment.runtime.toolVersion, context.version);
  assert.equal(deployment.runtime.packageManagersAbsent, true);
  assert.equal(deployment.resolvedImage, image);
  assert.equal(deployment.cleanupVerified, true);
  assert(deployment.checks.length >= 9);
  for (const name of ['proxy', 'recovery', 'offline', 'upgrade'])
    assert.equal(deployment[name].cleanupVerified, true);
  assert.equal(security.assessment.passed, true);
  await mkdir(destination);
  const files = [];
  const add = async (source, name, expected) => {
    const bytes = await readRegularFile(source, 64 * 1024 * 1024);
    const target = join(destination, name);
    await writeFile(target, bytes, { flag: 'wx' });
    const hashed = await hashReleaseAsset(target);
    if (expected) assert.equal(hashed.sha256, expected);
    files.push({ name, ...hashed });
  };
  await add(
    join(inventory.directory, 'server.cdx.json'),
    'server.cdx.json',
    inventory.inventory.sha256,
  );
  await add(
    join(security.directory, 'server.grype.json'),
    'server.grype.json',
    security.findings.sha256,
  );
  for (const name of [
    'container-inventory-evidence.json',
    'container-security-evidence.json',
    'server-container-evidence.json',
    'upgrade-baseline-evidence.json',
    'build-worker-evidence.json',
    'isolated-build-evidence.json',
  ])
    await add(join('.doctopus', name), name);
  const environment = { ...process.env };
  for (const name of [
    'DOCKER_HOST',
    'DOCKER_CONTEXT',
    'DOCKER_TLS',
    'DOCKER_TLS_VERIFY',
    'DOCKER_CERT_PATH',
  ])
    delete environment[name];
  const archive = join(destination, 'server.tar');
  // Export the accepted local image, preserving its config ID; never rebuild here.
  await run(
    'docker',
    [
      '--host=unix:///var/run/docker.sock',
      'image',
      'save',
      '--output',
      archive,
      image,
    ],
    environment,
  );
  await run('gzip', ['-n', archive]);
  files.push({
    name: 'server.tar.gz',
    ...(await hashReleaseAsset(archive + '.gz')),
  });
  await writeReleaseAssetManifest(destination, kind, context, files, image);
}
assert.deepEqual(
  await releaseSource(root),
  context,
  'Source changed while collecting release assets.',
);
await verifyReleaseAssets(destination, context, kind);
console.log(
  `Verified exact ${kind} candidates from ${context.ref}; publication is not approved.`,
);
