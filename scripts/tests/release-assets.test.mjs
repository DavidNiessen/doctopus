import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  hashReleaseAsset,
  releaseSource,
  singleCandidate,
  stageReleaseAssets,
  verifyReleaseAssets,
} from '../lib/release-assets.mjs';
import { createReleasePlan } from '../lib/release-plan.mjs';
import { prepareRelease } from '../lib/release-prepare.mjs';
import {
  BASE_VERSION,
  fixtureGit,
  gitFixture,
} from './helpers/release-fixture.mjs';

const context = {
  repository: 'DavidNiessen/doctopus',
  commit: 'a'.repeat(40),
  ref: 'refs/tags/v0.2.0',
  version: '0.2.0',
  runId: '1234',
  runAttempt: '2',
};
const hash = (bytes, algorithm = 'sha256', encoding = 'hex') =>
  createHash(algorithm).update(bytes).digest(encoding);
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'doctopus-release-assets-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
const save = (directory, name, value) =>
  writeFile(join(directory, name), JSON.stringify(value));
async function npmFixture(t) {
  const root = await fixture(t),
    source = join(root, 'source');
  await mkdir(source);
  const packages = [];
  for (const name of ['@davidniessen/first', '@davidniessen/second']) {
    const filename = `${name.slice(1).replace('/', '-')}-0.2.0.tgz`,
      bytes = Buffer.from(name);
    await writeFile(join(source, filename), bytes);
    packages.push({
      name,
      filename,
      version: '0.2.0',
      bytes: bytes.length,
      sha256: hash(bytes),
      integrity: 'sha512-' + hash(bytes, 'sha512', 'base64'),
    });
  }
  const manifest = {
    schemaVersion: 1,
    commit: context.commit,
    sourceWorkingTreeDirty: false,
    packages,
  };
  const consumer = {
    passed: true,
    packages: 2,
    checks: [
      'offline-cache-lockfile-reinstall',
      'public-types',
      'dependency-audit',
      'express-authenticated-subpath',
      'fastify-authenticated-subpath',
    ],
  };
  await save(source, 'manifest.json', manifest);
  await save(source, 'consumer-result.json', consumer);
  for (const name of ['consumer-package-lock.json', 'consumer-sbom.cdx.json'])
    await save(source, name, { fixture: true });
  return {
    root,
    source,
    manifest,
    consumer,
    names: packages.map((entry) => entry.name),
  };
}

test('release source accepts a clean aligned ancestor tag and refuses other identities, dirty source and moved tags', async (t) => {
  const root = await gitFixture(t);
  const plan = await createReleasePlan(root, {
    initial: true,
    date: '2026-10-23',
  });
  await prepareRelease(root, plan, { apply: true });
  await fixtureGit(root, ['add', '.']);
  await fixtureGit(root, [
    'commit',
    '-m',
    'chore(release): prepare test release',
  ]);
  const commit = (await fixtureGit(root, ['rev-parse', 'HEAD'])).trim();
  await fixtureGit(root, ['update-ref', 'refs/remotes/origin/master', commit]);
  await fixtureGit(root, ['tag', 'v' + BASE_VERSION]);
  const env = {
    GITHUB_REPOSITORY: context.repository,
    GITHUB_REF: `refs/tags/v${BASE_VERSION}`,
    GITHUB_SHA: commit,
    GITHUB_RUN_ID: '1234',
    GITHUB_RUN_ATTEMPT: '2',
    GITHUB_WORKFLOW_REF: `${context.repository}/.github/workflows/release-candidate.yml@refs/tags/v${BASE_VERSION}`,
  };
  assert.equal((await releaseSource(root, env)).commit, commit);
  const publication = {
    ...env,
    GITHUB_WORKFLOW_REF: `${context.repository}/.github/workflows/release-publish.yml@refs/tags/v${BASE_VERSION}`,
  };
  assert.equal(
    (
      await releaseSource(root, publication, {
        workflow: 'release-publish.yml',
      })
    ).commit,
    commit,
  );
  await assert.rejects(releaseSource(root, publication));
  await assert.rejects(releaseSource(root, env, { workflow: 'untrusted.yml' }));
  for (const override of [
    { GITHUB_REPOSITORY: 'untrusted/fork' },
    { GITHUB_REF: 'refs/heads/master' },
    { GITHUB_REF: 'refs/tags/v$(touch injected)' },
    { GITHUB_SHA: 'b'.repeat(40) },
    {
      GITHUB_WORKFLOW_REF: `${context.repository}/.github/workflows/quality.yml@refs/heads/master`,
    },
    { GITHUB_RUN_ID: '' },
    { GITHUB_RUN_ATTEMPT: '0' },
  ])
    await assert.rejects(releaseSource(root, { ...env, ...override }));
  await writeFile(join(root, 'unreviewed.txt'), 'dirty');
  await assert.rejects(releaseSource(root, env), /clean/);
  await unlink(join(root, 'unreviewed.txt'));
  await fixtureGit(root, ['update-ref', 'refs/remotes/origin/master', 'HEAD^']);
  await assert.rejects(releaseSource(root, env));
  await fixtureGit(root, ['update-ref', 'refs/remotes/origin/master', commit]);
  await fixtureGit(root, ['tag', '-f', 'v' + BASE_VERSION, 'HEAD^']);
  await assert.rejects(releaseSource(root, env), /tag changed/);
});

test('unprepared Java snapshots cannot enter the clean release path', async (t) => {
  await assert.rejects(
    releaseSource(await gitFixture(t), {}),
    /without SNAPSHOT/,
  );
});

test('stages the exact installed npm candidate and binds every file to source and run attempt', async (t) => {
  const { root, source, manifest, names } = await npmFixture(t),
    destination = join(root, 'output');
  const staged = await stageReleaseAssets(
    'npm',
    source,
    destination,
    context,
    names,
  );
  assert.equal(staged.files.length, 6);
  assert.equal(staged.publicationApproved, false);
  assert.equal(staged.runAttempt, '2');
  assert.deepEqual(
    await verifyReleaseAssets(destination, context, 'npm'),
    staged,
  );
  for (const pkg of manifest.packages)
    assert.deepEqual(
      await readFile(join(source, pkg.filename)),
      await readFile(join(destination, pkg.filename)),
    );
});

test('refuses stale, dirty, incomplete, altered and escaping npm candidates', async (t) => {
  const { root, source, manifest, consumer, names } = await npmFixture(t);
  let index = 0;
  for (const mutate of [
    (r) => {
      r.commit = 'b'.repeat(40);
    },
    (r) => {
      r.sourceWorkingTreeDirty = true;
    },
    (r) => {
      r.packages.pop();
    },
    (r) => {
      r.packages[0].version = '0.1.0';
    },
    (r) => {
      r.packages[0].filename = '../escaped.tgz';
    },
    (r) => {
      r.packages[0].sha256 = 'f'.repeat(64);
    },
    (r) => {
      r.packages[0].integrity = 'sha512-wrong';
    },
    (r) => {
      r.packages[0].bytes++;
    },
  ]) {
    const changed = structuredClone(manifest);
    mutate(changed);
    await save(source, 'manifest.json', changed);
    await assert.rejects(
      stageReleaseAssets(
        'npm',
        source,
        join(root, 'bad-' + index++),
        context,
        names,
      ),
    );
  }
  await save(source, 'manifest.json', manifest);
  for (const changed of [
    { ...consumer, passed: false },
    { ...consumer, checks: [] },
  ]) {
    await save(source, 'consumer-result.json', changed);
    await assert.rejects(
      stageReleaseAssets(
        'npm',
        source,
        join(root, 'bad-' + index++),
        context,
        names,
      ),
    );
  }
});

test('stages baseline Java binaries, documentation, POMs and SBOM only after both installed hosts pass', async (t) => {
  const root = await fixture(t),
    source = join(root, 'source');
  await mkdir(source);
  const add = async (filename) => {
    await writeFile(join(source, filename), filename);
    return { filename, sha256: hash(filename) };
  };
  const report = {
    schemaVersion: 1,
    commit: context.commit,
    sourceWorkingTreeDirty: false,
    version: context.version,
    passed: true,
    targetJava: 17,
    baselineBoot: '3.5.16',
    expectedConsumers: 2,
    consumers: ['mvc', 'reactive'].map((mode) => ({
      mode,
      passed: true,
      offlineCompilationPassed: true,
    })),
    parentPom: await add('doctopus-parent-0.2.0.pom'),
    artifacts: [],
    distributions: [],
    javaSbom: { ...(await add('java-bom.cdx.json')), testScopeExcluded: true },
  };
  for (const artifact of ['doctopus-core', 'doctopus-spring-boot-starter']) {
    const stem = `${artifact}-0.2.0`;
    report.artifacts.push({
      artifact,
      ...(await add(stem + '.jar')),
      pomSha256: (await add(stem + '.pom')).sha256,
    });
    for (const classifier of ['sources', 'javadoc'])
      report.distributions.push({
        artifact,
        classifier,
        ...(await add(`${stem}-${classifier}.jar`)),
      });
  }
  await save(source, 'report.json', report);
  await stageReleaseAssets('java', source, join(root, 'good'), context);
  assert.equal(
    (await verifyReleaseAssets(join(root, 'good'), context, 'java')).files
      .length,
    11,
  );
  report.consumers[1].offlineCompilationPassed = false;
  await save(source, 'report.json', report);
  await assert.rejects(
    stageReleaseAssets('java', source, join(root, 'bad'), context),
    /online and offline/,
  );
});

test('download verification rejects another run attempt, additional files, tampering and symlinks', async (t) => {
  const { root, source, names, manifest } = await npmFixture(t),
    destination = join(root, 'output');
  await stageReleaseAssets('npm', source, destination, context, names);
  await assert.rejects(
    verifyReleaseAssets(destination, { ...context, runAttempt: '3' }, 'npm'),
    /runAttempt/,
  );
  await writeFile(join(destination, 'extra.txt'), 'unlisted');
  await assert.rejects(
    verifyReleaseAssets(destination, context, 'npm'),
    /Unlisted/,
  );
  await unlink(join(destination, 'extra.txt'));
  const name = manifest.packages[0].filename;
  await writeFile(join(destination, name), 'modified');
  await assert.rejects(
    verifyReleaseAssets(destination, context, 'npm'),
    /checksum/,
  );
  await unlink(join(destination, name));
  await symlink(join(source, name), join(destination, name));
  await assert.rejects(verifyReleaseAssets(destination, context, 'npm'));
});

test('large-file hashing enforces descriptor bounds and candidate selection refuses stale extra directories', async (t) => {
  const root = await fixture(t),
    path = join(root, 'archive');
  await writeFile(path, 'large archive fixture');
  assert.equal(
    (await hashReleaseAsset(path)).sha256,
    hash('large archive fixture'),
  );
  await assert.rejects(hashReleaseAsset(path, 1), /oversized/);
  await symlink(path, join(root, 'alias'));
  await assert.rejects(hashReleaseAsset(join(root, 'alias')));
  const candidates = join(root, 'candidates');
  await mkdir(candidates);
  await mkdir(join(candidates, 'first'));
  assert.equal(await singleCandidate(candidates), join(candidates, 'first'));
  await mkdir(join(candidates, 'old'));
  await assert.rejects(singleCandidate(candidates), /exactly one/);
});
