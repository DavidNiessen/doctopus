import assert from 'node:assert/strict';
import { valid } from 'semver';
import { readRepositoryFile, readWorkspacePackages } from './workspaces.mjs';
import { auditPnpmLock } from './pnpm-lock.mjs';

export const dependencySections = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];
export async function auditReleaseVersions(root, { release = false } = {}) {
  const packages = await readWorkspacePackages(root);
  const version = packages[0].metadata.version;
  assert(
    typeof version === 'string' &&
      !version.includes('+') &&
      valid(version) === version,
    'The root version must be canonical SemVer without build metadata.',
  );
  const names = new Map(
    packages.slice(1).map((pkg) => [pkg.metadata.name, pkg]),
  );
  const lock = JSON.parse(
    await readRepositoryFile(root, 'package-lock.json', 8 * 1024 * 1024),
  );
  assert(
    lock.lockfileVersion === 3 &&
      lock.version === version &&
      lock.name === packages[0].metadata.name &&
      lock.packages,
    'Root lockfile version/name drift.',
  );
  assert.deepEqual(
    lock.packages['']?.workspaces,
    packages[0].metadata.workspaces,
    'Workspace lockfile declarations drift.',
  );
  assert.deepEqual(
    Object.keys(lock.packages)
      .filter((path) => path && !path.split('/').includes('node_modules'))
      .sort(),
    packages
      .slice(1)
      .map((pkg) => pkg.path)
      .sort(),
    'Workspace lockfile inventory drift.',
  );
  for (const pkg of packages) {
    assert(
      pkg.metadata.version === version,
      `Workspace version drift: ${pkg.path || 'package.json'}`,
    );
    const locked = lock.packages[pkg.path];
    assert(
      locked?.version === version && locked.name === pkg.metadata.name,
      `Workspace lockfile drift: ${pkg.path || 'package.json'}`,
    );
    if (pkg.path) {
      const link = lock.packages['node_modules/' + pkg.metadata.name];
      assert(
        link?.link === true && link.resolved === pkg.path,
        `Workspace link drift: ${pkg.path}`,
      );
    }
    for (const section of dependencySections) {
      const actual = Object.entries(pkg.metadata[section] ?? {})
        .filter(([name]) => names.has(name))
        .sort();
      const recorded = Object.entries(locked[section] ?? {})
        .filter(([name]) => names.has(name))
        .sort();
      assert.deepEqual(
        recorded,
        actual,
        `Internal lockfile dependency drift: ${pkg.path || 'package.json'} / ${section}`,
      );
      for (const [name, range] of actual) {
        assert(
          range === version,
          `Internal dependencies must use the exact unified version: ${pkg.path || 'package.json'} / ${section}`,
        );
        if (pkg.metadata.private !== true && section !== 'devDependencies')
          assert(
            names.get(name).metadata.private !== true,
            `Public runtime/peer dependency targets a private workspace: ${pkg.path}`,
          );
      }
    }
  }
  await auditPnpmLock(root, packages);
  const runtime = await readRepositoryFile(
    root,
    'packages/contracts/src/version.ts',
  );
  const declarations = [
    ...runtime.matchAll(
      /^export const toolVersion = (['"])([^'"\\\r\n]+)\1;$/gm,
    ),
  ];
  assert(
    declarations.length === 1 && declarations[0][2] === version,
    'Runtime distribution version drift.',
  );
  const javaPaths = await readJavaVersionPaths(root);
  const javaVersions = [];
  for (const path of javaPaths) {
    const pom = await readRepositoryFile(root, path);
    const parents = [
      ...pom.matchAll(
        /<artifactId>doctopus-parent<\/artifactId>\s*<version>([^<]+)<\/version>/g,
      ),
    ];
    assert(parents.length === 1, `Expected one Java parent version: ${path}`);
    javaVersions.push(parents[0][1]);
    for (const match of pom.matchAll(
      /<artifactId>doctopus-core<\/artifactId>\s*<version>([^<]+)<\/version>/g,
    ))
      assert(
        match[1] === '${project.version}',
        `Java internal dependencies must use project.version: ${path}`,
      );
  }
  assert(new Set(javaVersions).size === 1, 'Java parent versions disagree.');
  const javaVersion = javaVersions[0];
  assert(
    javaVersion === version ||
      (!release && javaVersion === version + '-SNAPSHOT'),
    release
      ? 'Release versions require the exact npm version in Java without SNAPSHOT.'
      : 'Java/npm version drift.',
  );
  return {
    version,
    mode: release ? 'release' : 'development',
    nodePackages: packages.length,
    publicPackages: packages.filter(
      (pkg) => pkg.path && pkg.metadata.private !== true,
    ).length,
    javaVersion,
    javaPoms: javaPaths.length,
  };
}

export async function readJavaVersionPaths(root) {
  const parent = await readRepositoryFile(root, 'integrations/java/pom.xml');
  const modules = [...parent.matchAll(/<module>([^<]+)<\/module>/g)].map(
    (match) => match[1],
  );
  assert(
    modules.length > 0 &&
      modules.length <= 100 &&
      new Set(modules).size === modules.length &&
      modules.every((module) =>
        /^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(module),
      ),
    'Invalid Java reactor module paths.',
  );
  return [
    'integrations/java/pom.xml',
    ...modules.map((module) => `integrations/java/${module}/pom.xml`),
  ];
}
