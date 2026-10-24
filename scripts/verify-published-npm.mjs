import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  inspectNpmVersion,
  loadNpmPublication,
} from './lib/npm-publication.mjs';
import { releaseSource } from './lib/release-assets.mjs';
import { readRegularFile } from './lib/read-regular-file.mjs';
import {
  githubPackageRegistries,
  githubNpmVisibility,
} from './lib/github-packages.mjs';
import { verifyProducerSubject } from './lib/provenance-verification.mjs';

assert.equal(process.argv.length, 2);
const root = process.cwd();
const source = await releaseSource(root, process.env, {
  workflow: 'release-publish.yml',
});
const plan = JSON.parse(
  await readRegularFile(join(root, '.doctopus/publication/plan.json')),
);
const context = { ...source, runId: plan.runId, runAttempt: plan.runAttempt };
const candidate = await loadNpmPublication(root, context, plan);
const registries = githubPackageRegistries(context.repository);
assert.equal(candidate.registry, registries.npm);
const consumer = await mkdtemp(join(tmpdir(), 'doctopus-public-npm-consumer-'));
const destination = join(root, '.doctopus/published-consumers/npm');
await mkdir(destination, { recursive: true });
const exec = promisify(execFile);
const metadata = JSON.parse(await readRegularFile(join(root, 'package.json')));
const config = [
  '--registry',
  'https://registry.npmjs.org',
  '--cache',
  join(consumer, 'empty-cache'),
  '--userconfig',
  join(consumer, 'npmrc'),
];
const run = async (file, args, timeout = 180_000) => {
  try {
    return await exec(file, args, {
      cwd: consumer,
      timeout,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, NODE_PATH: '' },
    });
  } catch {
    throw new Error(
      'Fresh GitHub npm consumer command failed. Inspect package visibility, authorization and the retained verification receipts.',
    );
  }
};
try {
  await writeFile(
    join(consumer, 'npmrc'),
    registries.scope +
      ':registry=' +
      registries.npm +
      '\n//npm.pkg.github.com/:_authToken=${GITHUB_PACKAGES_TOKEN}\n',
    { mode: 0o600, flag: 'wx' },
  );
  const visibility = [];
  for (const pkg of candidate.packages) {
    const result = await inspectNpmVersion(pkg, {
      registry: registries.npm,
      acceptArchive: async (bytes) => {
        const path = join(consumer, pkg.filename);
        await writeFile(path, bytes, { flag: 'wx' });
        const proof = await verifyProducerSubject(path, context);
        await writeFile(
          join(destination, pkg.filename + '.provenance.json'),
          JSON.stringify(proof, null, 2) + '\n',
          { flag: 'wx' },
        );
      },
    });
    assert(result.exists, `GitHub npm package is missing: ${pkg.name}.`);
    visibility.push(await githubNpmVisibility(pkg.name, context.repository));
  }
  await writeFile(
    join(consumer, 'package.json'),
    JSON.stringify(
      {
        name: 'doctopus-public-registry-consumer',
        version: '0.0.0',
        private: true,
        type: 'module',
        dependencies: {
          ...Object.fromEntries(
            candidate.packages.map((pkg) => [pkg.name, pkg.version]),
          ),
          express: metadata.devDependencies.express,
          fastify: metadata.devDependencies.fastify,
        },
        devDependencies: Object.fromEntries(
          ['typescript', '@types/node', '@types/express'].map((name) => [
            name,
            metadata.devDependencies[name],
          ]),
        ),
        overrides: metadata.overrides,
      },
      null,
      2,
    ),
  );
  await run('npm', [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    ...config,
  ]);
  const lockBytes = await readFile(join(consumer, 'package-lock.json'));
  const lock = JSON.parse(lockBytes);
  for (const pkg of candidate.packages) {
    const installed = lock.packages[`node_modules/${pkg.name}`];
    assert.equal(installed?.version, pkg.version);
    assert.equal(installed.integrity, pkg.integrity);
    assert.equal(new URL(installed.resolved).origin, registries.npm);
    assert.notEqual(
      installed.link,
      true,
      'Registry acceptance cannot use workspace links.',
    );
  }
  await run('npm', ['audit', '--audit-level=moderate', ...config], 60_000);
  await run('npm', [
    'ci',
    '--offline',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    ...config,
  ]);
  await cp(
    join(root, 'scripts/fixtures/npm-consumer.mjs'),
    join(consumer, 'smoke.mjs'),
  );
  const smoke = await run(process.execPath, ['smoke.mjs'], 90_000);
  await writeFile(join(destination, 'consumer-output.txt'), smoke.stdout);
  await writeFile(join(destination, 'package-lock.json'), lockBytes);
  const sbom = await run(
    'npm',
    ['sbom', '--sbom-format', 'cyclonedx', '--omit', 'dev', ...config],
    60_000,
  );
  assert.equal(JSON.parse(sbom.stdout).bomFormat, 'CycloneDX');
  await writeFile(join(destination, 'sbom.cdx.json'), sbom.stdout);
  await writeFile(
    join(destination, 'result.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        ...context,
        passed: true,
        packages: candidate.packages.length,
        registry: registries.npm,
        visibility,
        checks: [
          'fresh-empty-cache-authenticated-github-registry-install',
          'registry-archive-hashes',
          'exact-github-producer-attestations',
          'public-repository-linked-package-visibility',
          'dependency-audit',
          'offline-lockfile-reinstall',
          'public-types-cli-and-authenticated-adapters',
        ],
        packageHashes: candidate.packages.map(
          ({ name, version, sha256, integrity }) => ({
            name,
            version,
            sha256,
            integrity,
          }),
        ),
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  console.log(
    'Fresh authenticated GitHub npm consumer, producer provenance, public visibility, audit and offline reinstall passed.',
  );
} finally {
  await rm(consumer, { recursive: true, force: true });
}
