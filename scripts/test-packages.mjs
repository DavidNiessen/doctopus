import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { packNpmCandidates, repository } from './pack-npm.mjs';

const exec = promisify(execFile);
const candidate = await packNpmCandidates();
const consumer = await mkdtemp(join(tmpdir(), 'doctopus-installed-consumer-'));
const root = JSON.parse(
  await readFile(join(repository, 'package.json'), 'utf8'),
);
try {
  const dependencies = Object.fromEntries(
    candidate.manifest.packages.map((item) => [
      item.name,
      `file:${join(candidate.directory, item.filename)}`,
    ]),
  );
  await writeFile(
    join(consumer, 'package.json'),
    JSON.stringify(
      {
        name: 'doctopus-installed-consumer',
        version: '0.0.0',
        private: true,
        type: 'module',
        dependencies: {
          ...dependencies,
          express: root.devDependencies.express,
          fastify: '5.12.7',
        },
        devDependencies: {
          typescript: root.devDependencies.typescript,
          '@types/node': root.devDependencies['@types/node'],
          '@types/express': root.devDependencies['@types/express'],
        },
        overrides: root.overrides,
      },
      null,
      2,
    ),
  );
  console.log(
    `Installing ${candidate.manifest.packages.length} packed components outside the workspace.`,
  );
  await exec(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund'],
    { cwd: consumer, timeout: 180_000, maxBuffer: 4 * 1024 * 1024 },
  );
  await exec('npm', ['audit', '--audit-level=moderate'], {
    cwd: consumer,
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  await exec(
    'npm',
    ['ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'],
    { cwd: consumer, timeout: 180_000, maxBuffer: 4 * 1024 * 1024 },
  );
  await cp(
    join(repository, 'scripts/fixtures/npm-consumer.mjs'),
    join(consumer, 'smoke.mjs'),
  );
  const result = await exec(process.execPath, ['smoke.mjs'], {
    cwd: consumer,
    timeout: 90_000,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, NODE_PATH: '' },
  });
  console.log(result.stdout.trim());
  await writeFile(
    join(candidate.directory, 'consumer-package-lock.json'),
    await readFile(join(consumer, 'package-lock.json')),
  );
  const sbom = await exec(
    'npm',
    ['sbom', '--sbom-format', 'cyclonedx', '--omit', 'dev'],
    { cwd: consumer, timeout: 60_000, maxBuffer: 16 * 1024 * 1024 },
  );
  assert.equal(JSON.parse(sbom.stdout).bomFormat, 'CycloneDX');
  await writeFile(
    join(candidate.directory, 'consumer-sbom.cdx.json'),
    sbom.stdout,
  );
  await writeFile(
    join(candidate.directory, 'consumer-result.json'),
    JSON.stringify(
      {
        passed: true,
        node: process.version,
        packages: candidate.manifest.packages.length,
        checks: [
          'offline-cache-lockfile-reinstall',
          'archive-contents-and-integrity',
          'installed-module-origins',
          'public-types',
          'cli-init',
          'remote-spec-import-and-isolated-validation',
          'pinned-reference-cli-worker-and-offline-build',
          'trusted-mdx-and-plugin-workers',
          'doctor-strict',
          'artifact-verification',
          'static-server',
          'static-server-manifest-allowlist-and-reload',
          'express-authenticated-subpath',
          'fastify-authenticated-subpath',
          'node-manifest-allowlist',
          'dependency-audit',
        ],
        namespaceOwnershipVerified: false,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `Candidate archives, package inventory, consumer lockfile and SBOM: ${candidate.directory}`,
  );
} finally {
  await rm(consumer, { recursive: true, force: true });
}
