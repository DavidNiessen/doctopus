import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { format } from 'prettier';
import { parseDocument } from 'yaml';
import { createReleasePlan, git, canonicalVersion } from './release-plan.mjs';
import {
  auditReleaseVersions,
  dependencySections,
  readJavaVersionPaths,
} from './release-versions.mjs';
import { readRepositoryFile, readWorkspacePackages } from './workspaces.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const json = (value) =>
  format(JSON.stringify(value), {
    parser: 'json-stringify',
    singleQuote: true,
  });
async function absent(path) {
  try {
    await lstat(path);
    return false;
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    throw error;
  }
}
async function ownedFile(root, path, optional = false, tracked = true) {
  const pieces = path.split('/');
  for (let index = 1; index <= pieces.length; index++) {
    const part = join(root, ...pieces.slice(0, index));
    if (index === pieces.length && optional && (await absent(part)))
      return undefined;
    const entry = await lstat(part);
    assert(
      !entry.isSymbolicLink(),
      `Release metadata cannot traverse symlinks: ${path}`,
    );
    assert(
      index === pieces.length ? entry.isFile() : entry.isDirectory(),
      `Invalid release metadata path: ${path}`,
    );
  }
  if (tracked) await git(root, ['ls-files', '--error-unmatch', '--', path]);
  return readRepositoryFile(
    root,
    path,
    path === 'package-lock.json' ? 8 * 1024 * 1024 : 1024 * 1024,
  );
}
function changelog(previous, plan) {
  const old = previous ?? '# Changelog\n\n';
  assert(
    old.startsWith('# Changelog\n') || old.startsWith('# Changelog\r\n'),
    'Use a # Changelog document before preparing release notes.',
  );
  const headings = [...old.matchAll(/^## (.+)$/gm)];
  for (const match of headings) {
    const version = /^([^ ]+) - \d{4}-\d{2}-\d{2}\r?$/.exec(match[1])?.[1];
    assert(
      canonicalVersion(version),
      'Existing changelog entries must use ## <semver> - YYYY-MM-DD headings.',
    );
    assert(
      version !== plan.targetVersion,
      'The target version already has a changelog entry.',
    );
  }
  const at = headings[0]?.index ?? old.length;
  return format(
    old.slice(0, at).trimEnd() +
      '\n\n' +
      plan.notes.trimEnd() +
      '\n\n' +
      old.slice(at),
    { parser: 'markdown', proseWrap: 'preserve' },
  );
}
async function atomicWrite(root, path, content, mode) {
  const file = join(root, path),
    temporary = join(dirname(file), '.doctopus-release-' + randomUUID());
  try {
    await writeFile(temporary, content, { flag: 'wx', mode });
    await chmod(temporary, mode);
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}
async function sameSnapshot(root, change, expected) {
  if (expected === undefined) return absent(join(root, change.path));
  const actual = await ownedFile(
    root,
    change.path,
    false,
    change.before !== undefined,
  );
  return actual === expected;
}
/** Verify a source-bound plan and prepare a reviewable, network-free metadata change. */
async function prepareReleaseUnlocked(
  root,
  plan,
  { apply = false, install = atomicWrite } = {},
) {
  root = await realpath(root);
  assert(
    plan &&
      plan.schemaVersion === 1 &&
      typeof plan.initial === 'boolean' &&
      typeof plan.explicitVersion === 'boolean',
    'Unsupported release plan.',
  );
  assert(
    !plan.sourceWorkingTreeDirty,
    'Release preparation requires a plan from a clean checkout.',
  );
  assert(
    canonicalVersion(plan.targetVersion),
    'The reviewed plan must select a release version.',
  );
  const options = {
    initial: plan.initial,
    date: plan.date,
    ...(plan.baseTag || plan.baseCommit
      ? { since: plan.baseTag ?? plan.baseCommit }
      : {}),
    ...(plan.explicitVersion ? { version: plan.targetVersion } : {}),
  };
  const current = await createReleasePlan(root, options);
  assert(
    !current.sourceWorkingTreeDirty,
    'Release preparation requires a clean checkout.',
  );
  assert(
    isDeepStrictEqual(plan, current),
    'The release plan is stale or changed; regenerate it from this source.',
  );
  assert(
    (await realpath(
      (await git(root, ['rev-parse', '--show-toplevel'])).trim(),
    )) === root,
    'Prepare from the repository root.',
  );
  const packages = await readWorkspacePackages(root),
    names = new Set(packages.slice(1).map((pkg) => pkg.metadata.name)),
    version = plan.targetVersion;
  const snapshots = new Map(),
    proposed = new Map();
  async function remember(path, optional = false) {
    const value = await ownedFile(root, path, optional);
    snapshots.set(path, value);
    return value;
  }
  function changeDependencies(data) {
    for (const section of dependencySections)
      for (const name of Object.keys(data[section] ?? {}))
        if (names.has(name)) data[section][name] = version;
  }
  for (const pkg of packages) {
    const path = (pkg.path ? pkg.path + '/' : '') + 'package.json';
    await remember(path);
    pkg.metadata.version = version;
    changeDependencies(pkg.metadata);
    proposed.set(path, await json(pkg.metadata));
  }
  const lock = JSON.parse(await remember('package-lock.json'));
  lock.version = version;
  for (const pkg of packages) {
    lock.packages[pkg.path].version = version;
    changeDependencies(lock.packages[pkg.path]);
  }
  proposed.set('package-lock.json', JSON.stringify(lock, null, 2) + '\n');
  const pnpmSource = await remember('pnpm-lock.yaml');
  const pnpmLock = parseDocument(pnpmSource);
  const pnpmReplacements = [];
  for (const pkg of packages)
    for (const section of dependencySections)
      for (const name of Object.keys(pkg.metadata[section] ?? {}))
        if (names.has(name)) {
          const path = [
            'importers',
            pkg.path || '.',
            section === 'peerDependencies' ? 'dependencies' : section,
            name,
            'specifier',
          ];
          const scalar = pnpmLock.getIn(path, true);
          assert(
            scalar?.range && typeof scalar.value === 'string',
            'Missing pnpm dependency specifier.',
          );
          if (scalar.value !== version) {
            pnpmReplacements.push({
              start: scalar.range[0],
              end: scalar.range[1],
            });
          }
        }
  proposed.set(
    'pnpm-lock.yaml',
    pnpmReplacements
      .sort((a, b) => b.start - a.start)
      .reduce(
        (source, { start, end }) =>
          source.slice(0, start) + version + source.slice(end),
        pnpmSource,
      ),
  );
  proposed.set('pnpm-workspace.yaml', await remember('pnpm-workspace.yaml'));
  const runtime = await remember('packages/contracts/src/version.ts');
  proposed.set(
    'packages/contracts/src/version.ts',
    runtime.replace(
      /^(export const toolVersion = )(['"])[^'"\\\r\n]+\2;$/gm,
      (_all, prefix, quote) => prefix + quote + version + quote + ';',
    ),
  );
  for (const path of await readJavaVersionPaths(root)) {
    const pom = await remember(path);
    proposed.set(
      path,
      pom.replace(
        /(<artifactId>doctopus-parent<\/artifactId>\s*<version>)[^<]+(<\/version>)/g,
        (_all, prefix, suffix) => prefix + version + suffix,
      ),
    );
  }
  proposed.set(
    'CHANGELOG.md',
    await changelog(await remember('CHANGELOG.md', true), plan),
  );
  const changes = [...proposed]
    .filter(([path, after]) => snapshots.get(path) !== after)
    .map(([path, after]) => ({ path, before: snapshots.get(path), after }));
  const stage = await mkdtemp(join(tmpdir(), 'doctopus-release-preparation-'));
  let keepStage = false;
  try {
    for (const [path, content] of proposed) {
      await mkdir(dirname(join(stage, path)), { recursive: true });
      await writeFile(join(stage, path), content, { mode: 0o600 });
    }
    const audit = await auditReleaseVersions(stage, { release: true });
    if (apply) {
      assert(
        (await git(root, ['rev-parse', 'HEAD'])).trim() === plan.sourceCommit &&
          !(
            await git(root, ['status', '--porcelain', '--untracked-files=all'])
          ).trim(),
        'The source changed while staging the release; regenerate its plan.',
      );
      for (const [path, before] of snapshots)
        assert(
          await sameSnapshot(root, { path }, before),
          `Release metadata changed while staging: ${path}`,
        );
      const installed = [];
      try {
        for (const change of changes) {
          assert(
            await sameSnapshot(root, change, change.before),
            `Release metadata changed before installation: ${change.path}`,
          );
          const mode =
            change.before === undefined
              ? 0o644
              : (await lstat(join(root, change.path))).mode & 0o777;
          await install(root, change.path, change.after, mode);
          installed.push({ ...change, mode });
        }
        await auditReleaseVersions(root, { release: true });
        assert(
          (await git(root, ['rev-parse', 'HEAD'])).trim() === plan.sourceCommit,
          'The source commit changed during release preparation.',
        );
      } catch (cause) {
        const failed = [];
        for (const change of installed.reverse()) {
          try {
            assert(
              await sameSnapshot(root, change, change.after),
              'Concurrent modification detected.',
            );
            if (change.before === undefined) await rm(join(root, change.path));
            else
              await atomicWrite(root, change.path, change.before, change.mode);
          } catch {
            failed.push(change.path);
          }
        }
        if (failed.length) {
          keepStage = true;
          for (const change of changes)
            if (change.before !== undefined) {
              const path = join(stage, 'original', change.path);
              await mkdir(dirname(path), { recursive: true });
              await writeFile(path, change.before, { mode: 0o600 });
            }
          throw new Error(
            `Release preparation failed; inspect concurrent edits in ${failed.join(', ')}. Recovery metadata retained in ${stage}.`,
            { cause },
          );
        }
        throw new Error(
          'Release preparation failed; completed file replacements were rolled back.',
          { cause },
        );
      }
    }
    return {
      schemaVersion: 1,
      sourceCommit: plan.sourceCommit,
      version,
      applied: apply,
      audit,
      files: changes.map((change) => ({
        path: change.path,
        beforeSha256:
          change.before === undefined ? null : digest(change.before),
        afterSha256: digest(change.after),
      })),
    };
  } finally {
    if (!keepStage) await rm(stage, { recursive: true, force: true });
  }
}

/** Serialize applying preparations for a checkout; a crashed process leaves an inspectable lock. */
export async function prepareRelease(root, plan, options = {}) {
  root = await realpath(root);
  if (!options.apply) return prepareReleaseUnlocked(root, plan, options);
  const lock = join(tmpdir(), 'doctopus-release-' + digest(root) + '.lock');
  try {
    await mkdir(lock, { mode: 0o700 });
  } catch (cause) {
    if (cause.code !== 'EEXIST') throw cause;
    throw new Error(
      `Another release preparation is active or left an interrupted lock at ${lock}. Inspect its owner and checkout before removing the lock.`,
      { cause },
    );
  }
  try {
    await writeFile(
      join(lock, 'owner.json'),
      JSON.stringify({
        pid: process.pid,
        root,
        sourceCommit: plan?.sourceCommit,
      }),
      { mode: 0o600 },
    );
    return await prepareReleaseUnlocked(root, plan, options);
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}
