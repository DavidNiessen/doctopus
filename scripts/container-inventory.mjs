import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { toolVersion } from '@davidniessen/doctopus-contracts';
import {
  scanner,
  sha256,
  inventoryContext,
  validateContainerInventory,
  verifyScanner,
} from './lib/container-inventory.mjs';

assert(
  process.platform === 'linux' && process.arch === 'x64',
  'Use a local Linux x64 Docker host',
);
const requestedImage = process.argv[2];
assert(
  process.argv.length === 3,
  'Usage: node scripts/container-inventory.mjs IMMUTABLE_SERVER_IMAGE',
);
assert.match(
  requestedImage,
  /^(?:sha256:[a-f0-9]{64}|[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64})$/,
  'Select an immutable server image',
);
const environment = { ...process.env };
for (const name of [
  'DOCKER_HOST',
  'DOCKER_CONTEXT',
  'DOCKER_TLS',
  'DOCKER_TLS_VERIFY',
  'DOCKER_CERT_PATH',
])
  delete environment[name];
async function command(file, args, env = environment) {
  try {
    return (
      await promisify(execFile)(file, args, {
        env,
        timeout: 180000,
        maxBuffer: 32 * 1024 * 1024,
      })
    ).stdout;
  } catch {
    throw new Error(
      'Container inventory command failed. Check local Docker, the verified scanner and available disk space.',
    );
  }
}
const docker = (args) =>
  command('docker', ['--host=unix:///var/run/docker.sock', ...args]);
const image = (
  await docker(['image', 'inspect', requestedImage, '--format', '{{.Id}}'])
).trim();
assert.match(image, /^sha256:[a-f0-9]{64}$/);
assert.deepEqual(
  JSON.parse(
    await docker([
      'image',
      'inspect',
      image,
      '--format',
      '{{json .Config.Cmd}}',
    ]),
  ),
  ['node', 'apps/server/dist/main.js'],
  'Select the shipped server target',
);
const executable = resolve(
  '.doctopus/tools',
  `syft-${scanner.version}`,
  'syft',
);
await verifyScanner(executable);
const parent = resolve('.doctopus/container-candidates');
await mkdir(parent, { recursive: true });
const directory = await mkdtemp(join(parent, image.slice(7, 19) + '-'));
await writeFile(
  join(directory, '.incomplete'),
  'Container inventory is incomplete.\n',
  { flag: 'wx' },
);
const cache = await mkdtemp(join(parent, '.scan-'));
try {
  const text = await command(
    executable,
    ['scan', '--from', 'docker', image, '-o', 'cyclonedx-json'],
    {
      ...environment,
      DOCKER_HOST: 'unix:///var/run/docker.sock',
      SYFT_CHECK_FOR_APP_UPDATE: 'false',
      SYFT_JAVA_USE_NETWORK: 'false',
      SYFT_CACHE_DIR: cache,
      TMPDIR: cache,
    },
  );
  const bom = JSON.parse(text);
  const counts = validateContainerInventory(
    bom,
    await inventoryContext(image, toolVersion),
  );
  const path = join(directory, 'server.cdx.json');
  await writeFile(path, text, { flag: 'wx' });
  const report = {
    schemaVersion: 1,
    toolVersion,
    requestedImage,
    resolvedImage: image,
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim(),
    sourceWorkingTreeDirty:
      execFileSync('git', ['status', '--porcelain'], {
        encoding: 'utf8',
      }).trim().length > 0,
    scanner,
    directory: relative(resolve('.'), directory),
    inventory: {
      file: 'server.cdx.json',
      sha256: await sha256(path),
      format: bom.bomFormat,
      specVersion: bom.specVersion,
      components: bom.components.length,
      ...counts,
    },
    signed: false,
    publicationApproved: false,
  };
  await writeFile(
    join(directory, 'report.json'),
    JSON.stringify(report, null, 2) + '\n',
    { flag: 'wx' },
  );
  await unlink(join(directory, '.incomplete'));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await rm(cache, { recursive: true, force: true });
}
