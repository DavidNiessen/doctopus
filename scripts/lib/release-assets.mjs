import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { valid } from 'semver';
import { auditReleaseVersions } from './release-versions.mjs';
import { readRegularFile } from './read-regular-file.mjs';

const exec = promisify(execFile);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = async (path) =>
  JSON.parse(await readRegularFile(path, 16 * 1024 * 1024));
const filename = (value) => {
  assert(
    typeof value === 'string' &&
      /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(value),
    'Invalid release asset filename.',
  );
  assert(!value.includes('..'), 'Invalid release asset filename.');
  return value;
};

/** A release candidate must be a clean, aligned tag already reviewed on master. */
export async function releaseSource(
  root,
  env = process.env,
  { workflow = 'release-candidate.yml' } = {},
) {
  assert(['release-candidate.yml', 'release-publish.yml'].includes(workflow));
  const git = async (...args) =>
    (
      await exec('git', args, {
        cwd: root,
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      })
    ).stdout.trim();
  const versions = await auditReleaseVersions(root, { release: true });
  assert.equal(
    env.GITHUB_REPOSITORY,
    'DavidNiessen/doctopus',
    'Use the trusted upstream repository.',
  );
  assert.equal(
    env.GITHUB_REF,
    `refs/tags/v${versions.version}`,
    'Dispatch from the canonical release tag.',
  );
  assert.equal(
    env.GITHUB_WORKFLOW_REF,
    `${env.GITHUB_REPOSITORY}/.github/workflows/${workflow}@${env.GITHUB_REF}`,
    'Use the expected release workflow at the tag.',
  );
  assert.match(env.GITHUB_SHA ?? '', /^[a-f0-9]{40}$/);
  for (const key of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT'])
    assert.match(env[key] ?? '', /^[1-9][0-9]{0,19}$/);
  assert.equal(
    await git('rev-parse', '--is-shallow-repository'),
    'false',
    'Release verification requires full history.',
  );
  assert.equal(await git('rev-parse', 'HEAD'), env.GITHUB_SHA);
  assert.equal(
    await git('rev-parse', `${env.GITHUB_REF}^{commit}`),
    env.GITHUB_SHA,
    'Release tag changed.',
  );
  assert.equal(
    await git('status', '--porcelain'),
    '',
    'Release source must remain clean.',
  );
  await git(
    'merge-base',
    '--is-ancestor',
    'HEAD',
    'refs/remotes/origin/master',
  );
  return {
    repository: env.GITHUB_REPOSITORY,
    commit: env.GITHUB_SHA,
    ref: env.GITHUB_REF,
    version: versions.version,
    runId: env.GITHUB_RUN_ID,
    runAttempt: env.GITHUB_RUN_ATTEMPT,
  };
}

export function validateReleaseContext(context) {
  assert.equal(context.repository, 'DavidNiessen/doctopus');
  assert.match(context.commit, /^[a-f0-9]{40}$/);
  assert.equal(valid(context.version), context.version);
  assert(!context.version.includes('+') && context.version.length <= 100);
  assert.equal(context.ref, `refs/tags/v${context.version}`);
  for (const value of [context.runId, context.runAttempt])
    assert.match(value, /^[1-9][0-9]{0,19}$/);
}

/** Never select a stale or ambiguous previous candidate from a reused checkout. */
export async function singleCandidate(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  assert.equal(entries.length, 1, 'Expected exactly one fresh candidate.');
  assert(entries[0].isDirectory() && !entries[0].isSymbolicLink());
  return join(directory, entries[0].name);
}

function requireSource(report, context) {
  assert.equal(report.schemaVersion, 1);
  assert.equal(
    report.commit ?? report.sourceCommit,
    context.commit,
    'Candidate source differs.',
  );
  assert.equal(
    report.sourceWorkingTreeDirty,
    false,
    'Dirty candidates cannot be promoted.',
  );
}

/** Copy and check the same bounded bytes; caller supplies trusted expected names/hashes. */
export async function stageReleaseAssets(
  kind,
  source,
  destination,
  context,
  expectedPackages = [],
) {
  validateReleaseContext(context);
  assert(['npm', 'java'].includes(kind));
  await mkdir(destination, { recursive: false });
  const files = [];
  const add = async (name, expected, maximum = 64 * 1024 * 1024) => {
    filename(name);
    assert(
      !files.some((entry) => entry.name === name),
      'Duplicate release asset.',
    );
    const bytes = await readRegularFile(join(source, name), maximum);
    const hash = sha256(bytes);
    if (expected !== undefined)
      assert.equal(hash, expected, 'Release asset checksum differs.');
    await writeFile(join(destination, name), bytes, { flag: 'wx' });
    files.push({ name, bytes: bytes.length, sha256: hash });
    return bytes;
  };
  if (kind === 'npm') {
    const reportBytes = await readRegularFile(
      join(source, 'manifest.json'),
      16 * 1024 * 1024,
    );
    const report = JSON.parse(reportBytes);
    requireSource(report, context);
    assert(
      Array.isArray(report.packages) &&
        report.packages.length > 0 &&
        report.packages.length <= 64,
    );
    assert.deepEqual(
      report.packages.map((pkg) => pkg.name).sort(),
      [...expectedPackages].sort(),
      'Package set differs from the reviewed workspace.',
    );
    assert.equal(new Set(expectedPackages).size, expectedPackages.length);
    const consumerBytes = await readRegularFile(
      join(source, 'consumer-result.json'),
      16 * 1024 * 1024,
    );
    const consumer = JSON.parse(consumerBytes);
    assert.equal(consumer.passed, true, 'Installed package validation failed.');
    assert.equal(consumer.packages, report.packages.length);
    for (const check of [
      'offline-cache-lockfile-reinstall',
      'public-types',
      'dependency-audit',
      'express-authenticated-subpath',
      'fastify-authenticated-subpath',
    ])
      assert(
        consumer.checks.includes(check),
        `Missing consumer check: ${check}`,
      );
    for (const pkg of report.packages) {
      assert.equal(pkg.version, context.version);
      assert.equal(
        pkg.filename,
        `${pkg.name.replace(/^@/, '').replace('/', '-')}-${context.version}.tgz`,
      );
      const bytes = await add(pkg.filename, pkg.sha256);
      assert.equal(bytes.length, pkg.bytes);
      assert.equal(
        `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
        pkg.integrity,
      );
    }
    await add('manifest.json', sha256(reportBytes), 16 * 1024 * 1024);
    await add('consumer-result.json', sha256(consumerBytes), 16 * 1024 * 1024);
    for (const name of ['consumer-package-lock.json', 'consumer-sbom.cdx.json'])
      await add(name, undefined, 16 * 1024 * 1024);
  } else {
    const reportBytes = await readRegularFile(
      join(source, 'report.json'),
      16 * 1024 * 1024,
    );
    const report = JSON.parse(reportBytes);
    requireSource(report, context);
    assert.equal(
      report.version,
      context.version,
      'Java release version differs.',
    );
    assert.equal(report.passed, true);
    assert.equal(report.targetJava, 17);
    assert.equal(report.baselineBoot, '3.5.16');
    assert.equal(report.expectedConsumers, 2);
    assert.equal(report.consumers.length, 2);
    assert.deepEqual(report.consumers.map((entry) => entry.mode).sort(), [
      'mvc',
      'reactive',
    ]);
    assert(
      report.consumers.every(
        (entry) => entry.passed && entry.offlineCompilationPassed === true,
      ),
      'Installed Java consumers must pass online and offline.',
    );
    assert.equal(report.artifacts.length, 2);
    assert.equal(report.distributions.length, 4);
    assert.equal(
      report.parentPom.filename,
      `doctopus-parent-${context.version}.pom`,
    );
    await add(report.parentPom.filename, report.parentPom.sha256);
    for (const artifact of ['doctopus-core', 'doctopus-spring-boot-starter']) {
      const entry = report.artifacts.find((item) => item.artifact === artifact);
      assert(entry, 'Missing Java module.');
      const stem = `${artifact}-${context.version}`;
      assert.equal(entry.filename, `${stem}.jar`);
      await add(entry.filename, entry.sha256);
      await add(`${stem}.pom`, entry.pomSha256);
      for (const classifier of ['sources', 'javadoc']) {
        const distribution = report.distributions.find(
          (item) =>
            item.artifact === artifact && item.classifier === classifier,
        );
        assert(distribution, 'Missing Java documentation archive.');
        assert.equal(distribution.filename, `${stem}-${classifier}.jar`);
        await add(distribution.filename, distribution.sha256);
      }
    }
    assert.equal(report.javaSbom.filename, 'java-bom.cdx.json');
    assert.equal(report.javaSbom.testScopeExcluded, true);
    await add(
      report.javaSbom.filename,
      report.javaSbom.sha256,
      4 * 1024 * 1024,
    );
    await add('report.json', sha256(reportBytes), 16 * 1024 * 1024);
  }
  return await writeReleaseAssetManifest(destination, kind, context, files);
}

export async function writeReleaseAssetManifest(
  directory,
  kind,
  context,
  files,
  image,
) {
  validateReleaseContext(context);
  assert(['npm', 'java', 'container'].includes(kind));
  if (kind === 'container') assert.match(image, /^sha256:[a-f0-9]{64}$/);
  const manifest = {
    schemaVersion: 1,
    kind,
    ...context,
    ...(image ? { image } : {}),
    publicationApproved: false,
    files: [...files].sort((a, b) => a.name.localeCompare(b.name)),
  };
  await writeFile(
    join(directory, 'release-assets.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    { flag: 'wx' },
  );
  return manifest;
}

/** Hash large Docker archives through one inspected descriptor, with a hard bound. */
export async function hashReleaseAsset(path, maximum = 4 * 1024 * 1024 * 1024) {
  assert(
    Number.isSafeInteger(maximum) &&
      maximum > 0 &&
      maximum <= 4 * 1024 * 1024 * 1024,
  );
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = await file.stat();
    assert(
      stat.isFile() && stat.size > 0 && stat.size <= maximum,
      'Invalid or oversized release file.',
    );
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const chunk of file.createReadStream({ autoClose: false })) {
      bytes += chunk.length;
      assert(bytes <= maximum, 'Release file grew beyond its bound.');
      hash.update(chunk);
    }
    assert.equal(bytes, stat.size, 'Release file changed while hashing.');
    return { bytes, sha256: hash.digest('hex') };
  } finally {
    await file.close();
  }
}

export async function verifyReleaseAssets(directory, expectedContext, kind) {
  const manifest = await json(join(directory, 'release-assets.json'));
  validateReleaseContext(manifest);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.kind, kind);
  assert.equal(manifest.publicationApproved, false);
  for (const [key, value] of Object.entries(expectedContext))
    assert.equal(manifest[key], value, `Release context differs: ${key}`);
  assert(
    Array.isArray(manifest.files) &&
      manifest.files.length > 0 &&
      manifest.files.length <= 128,
  );
  const names = manifest.files.map((entry) => filename(entry.name));
  assert(!names.includes('release-assets.json'));
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(
    (await readdir(directory)).sort(),
    [...names, 'release-assets.json'].sort(),
    'Unlisted or missing release assets.',
  );
  for (const entry of manifest.files) {
    assert(Number.isSafeInteger(entry.bytes) && entry.bytes > 0);
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      await hashReleaseAsset(join(directory, entry.name)),
      { bytes: entry.bytes, sha256: entry.sha256 },
      'Release file checksum differs.',
    );
  }
  if (kind === 'container')
    assert.match(manifest.image, /^sha256:[a-f0-9]{64}$/);
  return manifest;
}
