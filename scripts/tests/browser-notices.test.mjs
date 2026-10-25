import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const rootRequire = createRequire(join(repository, 'package.json'));
const specRequire = createRequire(
  join(repository, 'packages/spec/package.json'),
);

test('browser notices resolve direct and transitive libraries from an isolated dependency layout', async (t) => {
  // Outside the checkout so the fixture cannot inherit its hoisted node_modules.
  const root = await mkdtemp(
    join(dirname(repository.replace(/\/$/, '')), '.doctopus-notices-'),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const path of [
    'scripts/lib',
    'apps/shared/fonts',
    'packages/app/node_modules',
    'store/ajv/node_modules',
    'client/assets',
  ])
    await mkdir(join(root, path), { recursive: true });
  for (const path of [
    'scripts/write-browser-notices.mjs',
    'apps/shared/fonts/INTER-LICENSE.txt',
    'apps/shared/fonts/JETBRAINS-MONO-LICENSE.txt',
    'scripts/lib/workspaces.mjs',
    'scripts/lib/read-regular-file.mjs',
  ])
    await cp(join(repository, path), join(root, path));
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'notices-fixture',
      private: true,
      type: 'module',
      workspaces: ['packages/*'],
    }),
  );
  const names = ['ajv', 'fast-deep-equal', 'react', 'react-dom'];
  const ajv = dirname(specRequire.resolve('ajv/package.json'));
  const equal = dirname(
    createRequire(join(ajv, 'package.json')).resolve(
      'fast-deep-equal/package.json',
    ),
  );
  await cp(ajv, join(root, 'store/ajv/node_modules/ajv'), { recursive: true });
  await cp(equal, join(root, 'store/ajv/node_modules/fast-deep-equal'), {
    recursive: true,
  });
  await symlink(
    join(root, 'store/ajv/node_modules/ajv'),
    join(root, 'packages/app/node_modules/ajv'),
    'dir',
  );
  for (const name of ['react', 'react-dom', 'vite'])
    await symlink(
      dirname(rootRequire.resolve(name + '/package.json')),
      join(root, 'packages/app/node_modules', name),
      'dir',
    );
  await writeFile(
    join(root, 'packages/app/package.json'),
    JSON.stringify({
      name: 'notices-app',
      dependencies: Object.fromEntries(
        ['ajv', 'react', 'react-dom', 'vite'].map((name) => [name, '*']),
      ),
    }),
  );
  await writeFile(
    join(root, 'client/assets/bundle.js.map'),
    JSON.stringify({
      sources: names.map((name) => 'node_modules/' + name + '/index.js'),
    }),
  );
  const fixtureRequire = createRequire(
    join(root, 'scripts/write-browser-notices.mjs'),
  );
  assert.throws(() => fixtureRequire.resolve('ajv'), {
    code: 'MODULE_NOT_FOUND',
  });
  assert.throws(
    () =>
      createRequire(join(root, 'packages/app/package.json')).resolve(
        'fast-deep-equal',
      ),
    { code: 'MODULE_NOT_FOUND' },
  );
  await promisify(execFile)(
    process.execPath,
    ['scripts/write-browser-notices.mjs', 'client'],
    { cwd: root, env: { ...process.env, NODE_PATH: '' }, timeout: 30000 },
  );
  const inventory = JSON.parse(
    await readFile(join(root, 'client/assets/BROWSER_SBOM.cdx.json'), 'utf8'),
  );
  const notices = await readFile(
    join(root, 'client/assets/THIRD_PARTY_NOTICES.txt'),
    'utf8',
  );
  for (const name of [...names, 'vite']) {
    const component = inventory.components.find(
      (component) => component.name === name,
    );
    assert(
      component?.version && component.licenses.length > 0,
      name + ' is missing component/license metadata',
    );
    assert(
      notices.includes(name + '@' + component.version),
      name + ' is missing its license notice',
    );
  }
  assert(notices.includes('Permission is hereby granted'));
});
