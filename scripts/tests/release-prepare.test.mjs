import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readFile,
  writeFile,
  chmod,
  lstat,
  symlink,
  unlink,
  rm,
} from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { inc } from 'semver';
import { parse } from 'yaml';
import { createReleasePlan, git } from '../lib/release-plan.mjs';
import { prepareRelease } from '../lib/release-prepare.mjs';
import {
  auditReleaseVersions,
  readJavaVersionPaths,
} from '../lib/release-versions.mjs';
import { readWorkspacePackages } from '../lib/workspaces.mjs';
import {
  BASE_VERSION,
  gitFixture,
  fixtureGit,
} from './helpers/release-fixture.mjs';

const TARGET = inc(BASE_VERSION, 'major');
const planFor = async (root, options = {}) =>
  JSON.parse(
    JSON.stringify(
      await createReleasePlan(root, {
        initial: true,
        date: '2026-10-22',
        ...options,
      }),
    ),
  );
const clean = async (root) =>
  assert.equal(
    (
      await git(root, ['status', '--porcelain', '--untracked-files=all'])
    ).trim(),
    '',
  );
async function commit(root, message = 'chore: adjust fixture metadata') {
  await fixtureGit(root, ['add', '.']);
  await fixtureGit(root, ['commit', '--allow-empty', '-m', message]);
}

test('stages and audits an initial release without changing files, tags or the index', async (t) => {
  const root = await gitFixture(t),
    plan = await planFor(root),
    before = await readFile(join(root, 'package-lock.json'), 'utf8');
  const result = await prepareRelease(root, plan);
  assert.equal(result.applied, false);
  assert.equal(result.version, BASE_VERSION);
  assert.equal(result.audit.mode, 'release');
  assert.equal(result.audit.javaVersion, BASE_VERSION);
  assert.deepEqual(
    result.files.map((file) => file.path),
    [
      'integrations/java/pom.xml',
      'integrations/java/core/pom.xml',
      'integrations/java/spring-boot-starter/pom.xml',
      'CHANGELOG.md',
    ],
  );
  assert(
    result.files.some(
      (file) => file.path === 'CHANGELOG.md' && file.beforeSha256 === null,
    ),
  );
  assert.equal(await readFile(join(root, 'package-lock.json'), 'utf8'), before);
  await assert.rejects(
    lstat(join(root, 'CHANGELOG.md')),
    (error) => error.code === 'ENOENT',
  );
  await clean(root);
  assert.equal((await git(root, ['tag', '--list'])).trim(), '');
  assert.deepEqual(await prepareRelease(root, plan), result);
});

test('applies unified versions to every npm/lock/runtime/Java reference while preserving external dependencies', async (t) => {
  const root = await gitFixture(t),
    plan = await planFor(root, { version: TARGET });
  const before = JSON.parse(
    await readFile(join(root, 'package-lock.json'), 'utf8'),
  );
  const pnpmBefore = parse(
    await readFile(join(root, 'pnpm-lock.yaml'), 'utf8'),
  );
  await chmod(join(root, 'packages/contracts/src/version.ts'), 0o640);
  const result = await prepareRelease(root, plan, { apply: true });
  assert(result.applied);
  assert.equal(
    (await auditReleaseVersions(root, { release: true })).version,
    TARGET,
  );
  assert.equal(
    (await lstat(join(root, 'packages/contracts/src/version.ts'))).mode & 0o777,
    0o640,
  );
  const after = JSON.parse(
    await readFile(join(root, 'package-lock.json'), 'utf8'),
  );
  for (const [path, metadata] of Object.entries(before.packages))
    if (path.split('/').includes('node_modules'))
      assert.deepEqual(after.packages[path], metadata);
  const pnpmAfter = parse(await readFile(join(root, 'pnpm-lock.yaml'), 'utf8'));
  assert.deepEqual(pnpmAfter.packages, pnpmBefore.packages);
  assert.deepEqual(pnpmAfter.snapshots, pnpmBefore.snapshots);
  assert.deepEqual(pnpmAfter.overrides, pnpmBefore.overrides);
  assert.equal(
    pnpmAfter.importers['apps/reader'].dependencies[
      '@davidniessen/doctopus-contracts'
    ].specifier,
    TARGET,
  );
  assert.equal(
    pnpmAfter.importers['apps/reader'].dependencies[
      '@davidniessen/doctopus-contracts'
    ].version,
    'link:../../packages/contracts',
  );
  for (const pkg of await readWorkspacePackages(root))
    assert.equal(pkg.metadata.version, TARGET);
  for (const path of await readJavaVersionPaths(root))
    assert(
      (await readFile(join(root, path), 'utf8')).includes(
        '<version>' + TARGET + '</version>',
      ),
    );
  const notes = await readFile(join(root, 'CHANGELOG.md'), 'utf8');
  assert(notes.startsWith('# Changelog\n\n## ' + TARGET + ' - 2026-10-22'));
  assert.equal(
    (await git(root, ['rev-parse', 'HEAD'])).trim(),
    plan.sourceCommit,
  );
  assert.equal(
    (await git(root, ['diff', '--cached', '--name-only'])).trim(),
    '',
  );
  assert.equal((await git(root, ['tag', '--list'])).trim(), '');
  await assert.rejects(
    prepareRelease(root, plan, { apply: true }),
    /clean checkout/,
  );
});

test('applies initial release metadata and creates an untracked changelog for review', async (t) => {
  const root = await gitFixture(t),
    plan = await planFor(root);
  await prepareRelease(root, plan, { apply: true });
  await auditReleaseVersions(root, { release: true });
  assert(
    (await git(root, ['status', '--porcelain'])).includes('?? CHANGELOG.md'),
  );
  assert.equal(
    (await git(root, ['rev-parse', 'HEAD'])).trim(),
    plan.sourceCommit,
  );
});

test('generated lockfile remains npm-canonical without resolving a new dependency tree', async (t) => {
  const root = await gitFixture(t),
    plan = await planFor(root, { version: TARGET });
  await prepareRelease(root, plan, { apply: true });
  const path = join(root, 'package-lock.json'),
    before = await readFile(path, 'utf8');
  await promisify(execFile)(
    'npm',
    [
      'install',
      '--package-lock-only',
      '--offline',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--cache=' + join(root, '.npm-cache'),
    ],
    { cwd: root, timeout: 60000 },
  );
  assert.equal(await readFile(path, 'utf8'), before);
  await auditReleaseVersions(root, { release: true });
});

test('prepends notes while preserving changelog introduction and earlier releases', async (t) => {
  const root = await gitFixture(t);
  const path = join(root, 'CHANGELOG.md');
  await writeFile(
    path,
    '# Changelog\n\nMaintainer release history.\n\n## 0.0.0 - 2025-01-01\n\nEarlier changes.\n',
  );
  await commit(root);
  await prepareRelease(root, await planFor(root, { version: TARGET }), {
    apply: true,
  });
  const notes = await readFile(path, 'utf8');
  assert(
    notes.startsWith(
      '# Changelog\n\nMaintainer release history.\n\n## ' + TARGET,
    ),
  );
  assert(notes.indexOf('## ' + TARGET) < notes.indexOf('## 0.0.0'));
  assert(notes.includes('Earlier changes.'));
});

for (const [name, mutate] of [
  [
    'target version',
    (plan) => {
      plan.targetVersion = TARGET;
    },
  ],
  [
    'release notes',
    (plan) => {
      plan.notes += '\nUnreviewed inserted notes.\n';
    },
  ],
  [
    'source commit',
    (plan) => {
      plan.sourceCommit = 'a'.repeat(40);
    },
  ],
  [
    'commit classification',
    (plan) => {
      plan.commits[0].description = 'Changed content';
    },
  ],
  [
    'schema',
    (plan) => {
      plan.schemaVersion = 999;
    },
  ],
])
  test('rejects a changed plan ' + name + ' before writing', async (t) => {
    const root = await gitFixture(t),
      plan = await planFor(root);
    mutate(plan);
    await assert.rejects(
      prepareRelease(root, plan, { apply: true }),
      /stale|changed|Unsupported/,
    );
    await clean(root);
  });

test('rejects dirty source plans, later local edits, stale commits and an empty release target', async (t) => {
  const root = await gitFixture(t),
    plan = await planFor(root);
  await writeFile(join(root, 'local.txt'), 'local change');
  await assert.rejects(
    prepareRelease(root, plan, { apply: true }),
    /clean checkout/,
  );
  const dirty = await planFor(root);
  await unlink(join(root, 'local.txt'));
  await assert.rejects(
    prepareRelease(root, dirty, { apply: true }),
    /plan from a clean/,
  );
  await commit(root, 'docs: later commit');
  await assert.rejects(
    prepareRelease(root, plan, { apply: true }),
    /stale|changed/,
  );
  await fixtureGit(root, ['tag', 'v' + BASE_VERSION]);
  const empty = await createReleasePlan(root, { date: '2026-10-22' });
  await assert.rejects(
    prepareRelease(root, empty, { apply: true }),
    /select a release version/,
  );
  await clean(root);
});

for (const [name, contents, error] of [
  [
    'duplicate version',
    '# Changelog\n\n## ' + TARGET + ' - 2026-01-01\n',
    /already has a changelog/,
  ],
  [
    'unsupported heading',
    '# Changelog\n\n## Unreleased\n',
    /Existing changelog entries/,
  ],
  ['missing title', '# History\n', /Use a # Changelog/],
])
  test('rejects changelog ' + name + ' without version changes', async (t) => {
    const root = await gitFixture(t);
    await writeFile(join(root, 'CHANGELOG.md'), contents);
    await commit(root);
    await assert.rejects(
      prepareRelease(root, await planFor(root, { version: TARGET }), {
        apply: true,
      }),
      error,
    );
    await clean(root);
  });

test('refuses metadata symlinks even when they resolve inside the clean repository', async (t) => {
  const root = await gitFixture(t),
    path = join(root, 'packages/contracts/src/version.ts');
  await writeFile(join(root, 'runtime-copy.ts'), await readFile(path));
  await unlink(path);
  await symlink('../../../runtime-copy.ts', path);
  await commit(root);
  const plan = await planFor(root);
  await assert.rejects(
    prepareRelease(root, plan, { apply: true }),
    /cannot traverse symlinks/,
  );
  await clean(root);
});

test('a failed replacement restores already installed metadata byte-for-byte', async (t) => {
  const root = await gitFixture(t),
    plan = await planFor(root, { version: TARGET });
  const before = await readFile(join(root, 'package.json'), 'utf8');
  let count = 0;
  await assert.rejects(
    prepareRelease(root, plan, {
      apply: true,
      install: async (root, path, content, mode) => {
        if (++count === 3) throw new Error('Injected filesystem failure.');
        await writeFile(join(root, path), content, { mode });
      },
    }),
    /rolled back/,
  );
  assert(count >= 3);
  assert.equal(await readFile(join(root, 'package.json'), 'utf8'), before);
  await clean(root);
  await auditReleaseVersions(root);
});

test('concurrent edits survive rollback, a new changelog is removed and recovery originals are retained', async (t) => {
  const root = await gitFixture(t),
    plan = await planFor(root, { version: TARGET }),
    runtime = 'packages/contracts/src/version.ts';
  const original = await readFile(join(root, runtime), 'utf8');
  let failure;
  try {
    await prepareRelease(root, plan, {
      apply: true,
      install: async (root, path, content, mode) => {
        await writeFile(join(root, path), content, { mode });
        if (path === 'CHANGELOG.md')
          await writeFile(
            join(root, runtime),
            '// concurrent maintainer edit\n',
          );
      },
    });
  } catch (error) {
    failure = error;
  }
  assert(failure?.message.includes('Recovery metadata retained'));
  const stage = /retained in (.+)\.$/.exec(failure.message)?.[1];
  assert(stage);
  t.after(() => rm(stage, { recursive: true, force: true }));
  assert.equal(
    await readFile(join(root, runtime), 'utf8'),
    '// concurrent maintainer edit\n',
  );
  assert.equal(
    await readFile(join(stage, 'original', runtime), 'utf8'),
    original,
  );
  await assert.rejects(
    lstat(join(root, 'CHANGELOG.md')),
    (error) => error.code === 'ENOENT',
  );
  assert.equal(
    JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version,
    BASE_VERSION,
  );
});

test('prepare CLI has help and rejects missing or oversized plans with failure status', async (t) => {
  const exec = promisify(execFile),
    cli = fileURLToPath(new URL('../release-prepare.mjs', import.meta.url));
  assert(
    (await exec(process.execPath, [cli, '--help'])).stdout.includes(
      'No commands install packages',
    ),
  );
  const root = await gitFixture(t),
    path = join(root, 'oversized-plan.json');
  await writeFile(path, ' '.repeat(16 * 1024 * 1024 + 1));
  for (const args of [[], ['--plan', path]])
    await assert.rejects(
      exec(process.execPath, [cli, ...args]),
      (error) => error.code === 1 && error.stderr.includes('at most 16 MiB'),
    );
});

test('concurrent preparations cannot interleave metadata replacements', async (t) => {
  const root = await gitFixture(t),
    plan = await planFor(root, { version: TARGET });
  let entered, release;
  const started = new Promise((resolve) => {
      entered = resolve;
    }),
    gate = new Promise((resolve) => {
      release = resolve;
    });
  let first = true;
  const active = prepareRelease(root, plan, {
    apply: true,
    install: async (root, path, content, mode) => {
      if (first) {
        first = false;
        entered();
        await gate;
      }
      await writeFile(join(root, path), content, { mode });
    },
  });
  await started;
  try {
    await assert.rejects(
      prepareRelease(root, plan, { apply: true }),
      /Another release preparation/,
    );
  } finally {
    release();
  }
  assert((await active).applied);
  assert.equal(
    (await auditReleaseVersions(root, { release: true })).version,
    TARGET,
  );
});
test('a competing source commit aborts preparation without resetting that commit', async (t) => {
  const root = await gitFixture(t),
    plan = await planFor(root, { version: TARGET });
  let first = true;
  await assert.rejects(
    prepareRelease(root, plan, {
      apply: true,
      install: async (root, path, content, mode) => {
        if (first) {
          first = false;
          await fixtureGit(root, [
            'commit',
            '--allow-empty',
            '-m',
            'docs: concurrent maintainer commit',
          ]);
        }
        await writeFile(join(root, path), content, { mode });
      },
    }),
    /rolled back/,
  );
  assert.notEqual(
    (await git(root, ['rev-parse', 'HEAD'])).trim(),
    plan.sourceCommit,
  );
  await clean(root);
  assert.equal((await auditReleaseVersions(root)).version, BASE_VERSION);
});
