import test from 'node:test';
import { inc } from 'semver';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditReleaseVersions } from '../lib/release-versions.mjs';
import { parse, stringify } from 'yaml';

import { fixture, BASE_VERSION, poms } from './helpers/release-fixture.mjs';

const OTHER_VERSION = inc(BASE_VERSION, 'major');
assert(OTHER_VERSION);
const json = async (root, path) =>
  JSON.parse(await readFile(join(root, path), 'utf8'));
async function editJson(root, path, change) {
  const data = await json(root, path);
  change(data);
  await writeFile(join(root, path), JSON.stringify(data, null, 2) + '\n');
}
test('all npm/runtime/lockfile and Maven versions align without changing files', async (t) => {
  const root = await fixture(t),
    lock = await readFile(join(root, 'package-lock.json'), 'utf8');
  const report = await auditReleaseVersions(root);
  assert.deepEqual(report, {
    version: BASE_VERSION,
    mode: 'development',
    nodePackages: 16,
    publicPackages: 12,
    javaVersion: BASE_VERSION + '-SNAPSHOT',
    javaPoms: 3,
  });
  assert.equal(await readFile(join(root, 'package-lock.json'), 'utf8'), lock);
  await assert.rejects(
    auditReleaseVersions(root, { release: true }),
    /without SNAPSHOT/,
  );
});
test('release mode requires identical Maven coordinates and allows the aligned release', async (t) => {
  const root = await fixture(t);
  for (const path of poms)
    await writeFile(
      join(root, path),
      (await readFile(join(root, path), 'utf8')).replaceAll(
        BASE_VERSION + '-SNAPSHOT',
        BASE_VERSION,
      ),
    );
  assert.equal(
    (await auditReleaseVersions(root, { release: true })).mode,
    'release',
  );
});
const mutations = [
  ...[
    [
      'pnpm inventory',
      'pnpm-lock.yaml',
      (data) => {
        delete data.importers['apps/reader'];
      },
      /pnpm lockfile workspace inventory/,
    ],
    [
      'pnpm external specifier',
      'pnpm-lock.yaml',
      (data) => {
        data.importers['.'].devDependencies.prettier.specifier = '0.0.0';
      },
      /pnpm dependency specifier/,
    ],
    [
      'pnpm internal specifier',
      'pnpm-lock.yaml',
      (data) => {
        data.importers['apps/reader'].dependencies[
          '@davidniessen/doctopus-contracts'
        ].specifier = OTHER_VERSION;
      },
      /pnpm dependency specifier/,
    ],
    [
      'pnpm local link',
      'pnpm-lock.yaml',
      (data) => {
        data.importers['apps/reader'].dependencies[
          '@davidniessen/doctopus-contracts'
        ].version = 'link:../../packages/spec';
      },
      /pnpm workspace link/,
    ],
    [
      'pnpm overrides',
      'pnpm-lock.yaml',
      (data) => {
        data.overrides.dompurify = '0.0.0';
      },
      /pnpm lockfile overrides/,
    ],
    [
      'workspace overrides',
      'pnpm-workspace.yaml',
      (data) => {
        data.overrides.dompurify = '0.0.0';
      },
      /Package-manager override/,
    ],
    [
      'pnpm workspace declarations',
      'pnpm-workspace.yaml',
      (data) => {
        data.packages = ['packages/*'];
      },
      /pnpm workspace declarations/,
    ],
  ].map(([name, path, change, expected]) => [
    name,
    async (root) => {
      const data = parse(await readFile(join(root, path), 'utf8'));
      change(data);
      await writeFile(join(root, path), stringify(data));
    },
    expected,
  ]),
  [
    'workspace declaration drift',
    (root) =>
      editJson(root, 'package.json', (data) => {
        data.workspaces = ['apps/*'];
      }),
    /Workspace lockfile declarations/,
  ],
  [
    'missing workspace manifest',
    (root) => unlink(join(root, 'packages/contracts/package.json')),
    /Workspace lockfile inventory/,
  ],
  [
    'workspace metadata',
    (root) =>
      editJson(root, 'packages/contracts/package.json', (data) => {
        data.version = OTHER_VERSION;
      }),
    /Workspace version drift/,
  ],
  [
    'root lock version',
    (root) =>
      editJson(root, 'package-lock.json', (data) => {
        data.version = OTHER_VERSION;
      }),
    /Root lockfile/,
  ],
  [
    'workspace lock version',
    (root) =>
      editJson(root, 'package-lock.json', (data) => {
        data.packages['apps/reader'].version = OTHER_VERSION;
      }),
    /Workspace lockfile/,
  ],
  [
    'workspace link',
    (root) =>
      editJson(root, 'package-lock.json', (data) => {
        data.packages[
          'node_modules/@davidniessen/doctopus-contracts'
        ].resolved = 'different';
      }),
    /Workspace link/,
  ],
  [
    'internal lock reference',
    (root) =>
      editJson(root, 'package-lock.json', (data) => {
        delete data.packages['packages/cli'].dependencies[
          '@davidniessen/doctopus-contracts'
        ];
      }),
    /Internal lockfile dependency/,
  ],
  [
    'internal caret range',
    async (root) => {
      await editJson(root, 'packages/cli/package.json', (data) => {
        data.dependencies['@davidniessen/doctopus-contracts'] =
          '^' + BASE_VERSION;
      });
      await editJson(root, 'package-lock.json', (data) => {
        data.packages['packages/cli'].dependencies[
          '@davidniessen/doctopus-contracts'
        ] = '^' + BASE_VERSION;
      });
    },
    /exact unified version/,
  ],
  [
    'runtime version',
    (root) =>
      writeFile(
        join(root, 'packages/contracts/src/version.ts'),
        `export const toolVersion = '${OTHER_VERSION}';\n`,
      ),
    /Runtime distribution/,
  ],
  [
    'Java parent mismatch',
    async (root) => {
      const path = join(root, poms[1]);
      await writeFile(
        path,
        (await readFile(path, 'utf8')).replace(
          BASE_VERSION + '-SNAPSHOT',
          OTHER_VERSION + '-SNAPSHOT',
        ),
      );
    },
    /Java parent versions/,
  ],
  [
    'Java internal dependency',
    async (root) => {
      const path = join(root, poms[2]);
      await writeFile(
        path,
        (await readFile(path, 'utf8')).replace(
          '${project.version}',
          BASE_VERSION,
        ),
      );
    },
    /Java internal dependencies/,
  ],
  [
    'private runtime dependency',
    async (root) => {
      await editJson(root, 'packages/cli/package.json', (data) => {
        data.dependencies['@davidniessen/doctopus-server'] = BASE_VERSION;
      });
      await editJson(root, 'package-lock.json', (data) => {
        data.packages['packages/cli'].dependencies[
          '@davidniessen/doctopus-server'
        ] = BASE_VERSION;
      });
    },
    /private workspace/,
  ],
  [
    'duplicate package',
    (root) =>
      editJson(root, 'packages/contracts/package.json', (data) => {
        data.name = 'doctopus';
      }),
    /Duplicate workspace/,
  ],
  [
    'unsafe workspace glob',
    (root) =>
      editJson(root, 'package.json', (data) => {
        data.workspaces = ['../outside'];
      }),
    /Unsupported workspace pattern/,
  ],
];
for (const [name, change, message] of mutations)
  test(`rejects ${name}`, async (t) => {
    const root = await fixture(t);
    await change(root);
    await assert.rejects(auditReleaseVersions(root), message);
  });
for (const version of ['v0.1.0', '01.0.0', '0.1.0+build', '0.1'])
  test(`rejects noncanonical distribution version ${version}`, async (t) => {
    const root = await fixture(t);
    await editJson(root, 'package.json', (data) => {
      data.version = version;
    });
    await assert.rejects(auditReleaseVersions(root), /canonical SemVer/);
  });
test('refuses metadata symlinks outside the checkout', async (t) => {
  const root = await fixture(t),
    outside = await mkdtemp(join(tmpdir(), 'doctopus-outside-version-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(
    join(outside, 'outside.json'),
    '{"private":"fixture-only-outside"}',
  );
  const path = join(root, 'packages/contracts/package.json');
  await unlink(path);
  await symlink(join(outside, 'outside.json'), path);
  await assert.rejects(auditReleaseVersions(root), /inside the checkout/);
});
