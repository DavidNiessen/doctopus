import { beforeAll, afterAll, expect, it } from 'vitest';
import {
  cp,
  mkdtemp,
  readFile,
  writeFile,
  rm,
  symlink,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { parse, stringify } from 'yaml';
import { buildSite, createStaticServer } from '@davidniessen/doctopus-cli';
import {
  compileProject,
  loadReaderExtensions,
  verifyArtifact,
} from '@davidniessen/doctopus-compiler';
import { parseConfig } from '@davidniessen/doctopus-spec';
import { createPageData } from '@davidniessen/doctopus-contracts';
let root = '';
async function config() {
  return parseConfig(
    parse(await readFile(join(root, 'docs.config.yaml'), 'utf8')),
  );
}
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'doctopus-reader-extension-'));
  await cp(resolve('examples/reader-extensions'), root, {
    recursive: true,
    filter: (path) =>
      !path.includes('.doctopus') && !path.includes('.api-docs'),
  });
});
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});
it('requires explicit operator trust and allows tooling to skip plugins', async () => {
  await expect(compileProject(root)).rejects.toThrow(/trust-plugins/);
  expect(
    (await compileProject(root, undefined, { skipPlugins: true }))
      .readerExtensions,
  ).toBeUndefined();
  expect(
    (
      await loadReaderExtensions(root, {
        ...(await config()),
        readerExtensions: [],
      })
    ).files.size,
  ).toBe(0);
});
it.each([
  { id: '../bad', entry: 'related-guides.mjs' },
  { id: 'valid', entry: 'https://evil.test/module.mjs' },
  { id: 'valid', entry: '../outside.mjs' },
  { id: 'valid', entry: 'module.ts' },
  { id: 'valid', entry: 'folder//module.mjs' },
  { id: 'valid', entry: 'folder/.hidden.mjs' },
])('rejects invalid declarations %#', async (item) => {
  expect(() =>
    parseConfig({ ...projectInput(), readerExtensions: [item] }),
  ).toThrow();
});
function projectInput() {
  return { name: 'Extensions', specs: [{ id: 'api', path: 'api.yaml' }] };
}
it('copies a deterministic complete ESM packet without evaluating modules', async () => {
  const first = await loadReaderExtensions(root, await config(), true),
    second = await loadReaderExtensions(root, await config(), true);
  expect(second.extensions).toEqual(first.extensions);
  const extension = first.extensions[0]!;
  expect([...first.files.keys()]).toContain(
    extension.entry.replace('related-guides.mjs', 'footer-tools.mjs'),
  );
  const file = join(root, 'unavailable.mjs'),
    original = await readFile(file, 'utf8');
  try {
    await writeFile(
      file,
      "throw new Error('Build must not execute browser code');",
    );
    const changed = await loadReaderExtensions(root, await config(), true);
    expect(changed.extensions[1]?.digest).not.toBe(first.extensions[1]?.digest);
  } finally {
    await writeFile(file, original);
  }
});
it('publishes listed modules and dependencies through the configured static-host subpath', async () => {
  const built = await buildSite(root, { trustPlugins: true });
  expect((await verifyArtifact(built.directory)).artifactDigest).toBe(
    built.manifest.artifactDigest,
  );
  const extension = built.site.readerExtensions![0]!;
  expect(built.manifest.files).toHaveProperty(extension.entry);
  expect(
    createPageData(built.site, '/guides/introduction/').readerExtensions,
  ).toEqual(built.site.readerExtensions);
  const server = await createStaticServer(built.directory);
  try {
    expect(
      (await server.inject('/extensions/' + extension.entry)).statusCode,
    ).toBe(200);
    expect(
      (await server.inject('/extensions/reader-extensions/unknown/module.mjs'))
        .statusCode,
    ).toBe(404);
  } finally {
    await server.close();
  }
});
it('rejects duplicate ids/files, missing dependencies and sources beyond file limits', async () => {
  const base = await config(),
    first = base.readerExtensions![0]!;
  expect(() =>
    parseConfig({ ...base, readerExtensions: [first, first] }),
  ).toThrow(/Duplicate/);
  await expect(
    loadReaderExtensions(
      root,
      { ...base, readerExtensions: [{ ...first, files: [first.entry] }] },
      true,
    ),
  ).rejects.toThrow(/distinct/);
  await expect(
    loadReaderExtensions(
      root,
      { ...base, readerExtensions: [{ ...first, files: ['missing.mjs'] }] },
      true,
    ),
  ).rejects.toThrow();
  const file = join(root, 'large.mjs');
  await writeFile(file, 'x'.repeat(256 * 1024 + 1));
  await expect(
    loadReaderExtensions(
      root,
      { ...base, readerExtensions: [{ id: 'large', entry: 'large.mjs' }] },
      true,
    ),
  ).rejects.toThrow();
  await rm(file);
});
it('rejects source escapes and invalid UTF-8 before publishing', async () => {
  const base = await config(),
    file = join(root, 'bad.mjs');
  await writeFile(file, new Uint8Array([255]));
  await expect(
    loadReaderExtensions(
      root,
      { ...base, readerExtensions: [{ id: 'bad', entry: 'bad.mjs' }] },
      true,
    ),
  ).rejects.toThrow();
  await rm(file);
  const outside = await mkdtemp(join(tmpdir(), 'doctopus-extension-outside-'));
  try {
    await writeFile(join(outside, 'entry.mjs'), 'export default {};');
    await symlink(join(outside, 'entry.mjs'), file);
    await expect(
      loadReaderExtensions(
        root,
        { ...base, readerExtensions: [{ id: 'bad', entry: 'bad.mjs' }] },
        true,
      ),
    ).rejects.toThrow();
  } finally {
    await rm(file, { force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
it('enforces aggregate file and byte budgets', async () => {
  const base = await config();
  const items = Array.from({ length: 8 }, (_, i) => ({
    id: 'group-' + i,
    entry: 'entry.mjs',
    files: Array.from({ length: 8 }, (_, n) => `dep-${n}.mjs`),
  }));
  await expect(
    loadReaderExtensions(root, { ...base, readerExtensions: items }, true),
  ).rejects.toThrow(/64/);
  const paths = Array.from({ length: 9 }, (_, i) => `budget-${i}.mjs`);
  try {
    await Promise.all(
      paths.map((path) => writeFile(join(root, path), 'x'.repeat(256 * 1024))),
    );
    await expect(
      loadReaderExtensions(
        root,
        {
          ...base,
          readerExtensions: [
            { id: 'budget', entry: paths[0]!, files: paths.slice(1) },
          ],
        },
        true,
      ),
    ).rejects.toThrow(/2 MiB/);
  } finally {
    await Promise.all(
      paths.map((path) => rm(join(root, path), { force: true })),
    );
  }
});
it('preserves the last publication when a reviewed source becomes invalid', async () => {
  const before = await buildSite(root, { trustPlugins: true });
  const file = join(root, 'docs.config.yaml'),
    original = await readFile(file, 'utf8'),
    input = parse(original);
  try {
    input.readerExtensions[0].entry = 'missing.mjs';
    await writeFile(file, stringify(input));
    await expect(buildSite(root, { trustPlugins: true })).rejects.toThrow();
    expect((await verifyArtifact(before.directory)).artifactDigest).toBe(
      before.manifest.artifactDigest,
    );
  } finally {
    await writeFile(file, original);
  }
});
