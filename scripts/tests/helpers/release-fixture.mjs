import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readWorkspacePackages } from '../../lib/workspaces.mjs';
import { git } from '../../lib/release-plan.mjs';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
export const BASE_VERSION = JSON.parse(
  await readFile(join(repository, 'package.json'), 'utf8'),
).version;
export const poms = [
  'integrations/java/pom.xml',
  'integrations/java/core/pom.xml',
  'integrations/java/spring-boot-starter/pom.xml',
];
export async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'doctopus-versions-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = [
    ...(await readWorkspacePackages(repository)).map(
      (pkg) => (pkg.path ? pkg.path + '/' : '') + 'package.json',
    ),
    'package-lock.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'packages/contracts/src/version.ts',
    ...poms,
  ];
  for (const path of paths) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await cp(join(repository, path), join(root, path));
  }
  for (const path of poms) {
    const file = join(root, path);
    await writeFile(
      file,
      (await readFile(file, 'utf8')).replace(
        /(<artifactId>doctopus-parent<\/artifactId>\s*<version>)[^<]+(<\/version>)/g,
        (_match, prefix, suffix) =>
          prefix + BASE_VERSION + '-SNAPSHOT' + suffix,
      ),
    );
  }
  return root;
}

export const fixtureGit = (root, args) =>
  git(root, [
    '-c',
    'user.name=Release Test',
    '-c',
    'user.email=release@example.test',
    '-c',
    'commit.gpgsign=false',
    '-c',
    'tag.gpgsign=false',
    '-c',
    'core.hooksPath=/dev/null',
    ...args,
  ]);
export async function gitFixture(t) {
  const root = await fixture(t);
  await fixtureGit(root, ['init', '--initial-branch=main']);
  await fixtureGit(root, ['add', '.']);
  await fixtureGit(root, [
    'commit',
    '-m',
    'chore: initialize distribution metadata',
  ]);
  return root;
}
