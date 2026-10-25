import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const output = resolve(process.argv[2] ?? 'dist/client');
const packages = new Map([['vite', undefined]]); // Includes the generated module-preload helper.
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) await walk(join(directory, entry.name));
    else if (entry.name.endsWith('.js.map')) {
      const map = JSON.parse(
        await readFile(join(directory, entry.name), 'utf8'),
      );
      for (const source of map.sources ?? []) {
        assert(
          !/monaco-editor\/.*\/base\/browser\/dompurify\/dompurify\.js$/.test(
            source,
          ),
          'The browser bundle must use the separately pinned patched DOMPurify.',
        );
        const match = source.match(
          /(?:^|\/)node_modules\/(?!\.pnpm\/)((?:@[^/]+\/)?[^/]+)/,
        );
        const name = match?.[1];
        if (name) {
          if (!packages.has(name)) packages.set(name, undefined);
          // Resolve metadata from bundled sources, including pnpm's isolated store.
          const bundledDirectory = resolve(
            directory,
            source.slice(0, match.index + match[0].length),
          );
          const candidate = resolve(bundledDirectory, 'package.json');
          try {
            if (JSON.parse(await readFile(candidate, 'utf8')).name === name)
              packages.set(name, bundledDirectory);
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
          }
        }
      }
    }
  }
}
await walk(output);
assert(
  !packages.has('monaco-editor') || packages.has('dompurify'),
  'Monaco bundles must include the patched DOMPurify dependency.',
);
assert(
  packages.has('react') && packages.has('react-dom'),
  'Expected React browser bundle source maps',
);
const sections = [
  'Third-party notices for the bundled browser code.\nProject code is licensed under Apache-2.0. Dependencies retain their own licenses.\n',
];
for (const name of [...packages.keys()].sort()) {
  // Some ESM packages intentionally do not export package.json.
  let directory =
    packages.get(name) ?? dirname(fileURLToPath(import.meta.resolve(name)));
  let file;
  for (;;) {
    const candidate = join(directory, 'package.json');
    try {
      if (JSON.parse(await readFile(candidate, 'utf8')).name === name) {
        file = candidate;
        break;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = dirname(directory);
    assert(parent !== directory, `${name}: cannot resolve package metadata`);
    directory = parent;
  }
  const metadata = JSON.parse(await readFile(file, 'utf8'));
  const files = await readdir(dirname(file));
  const license = files.find((name) =>
    /^licen[cs]e(?:\.(?:md|txt))?$/i.test(name),
  );
  assert(
    license,
    `${name}: missing license text; review the bundled dependency`,
  );
  sections.push(
    `${name}@${metadata.version}\nLicense: ${metadata.license ?? 'See full text'}\n\n${await readFile(join(dirname(file), license), 'utf8')}`,
  );
  for (const notice of files
    .filter((name) =>
      /^third[-_ ]?party[-_ ]?notices?(?:\.(?:txt|md))?$/i.test(name),
    )
    .sort()) {
    sections.push(
      `${name}: upstream bundled dependency notices\n\n${await readFile(join(dirname(file), notice), 'utf8')}`,
    );
  }
}
for (const name of ['INTER-LICENSE.txt', 'JETBRAINS-MONO-LICENSE.txt']) {
  sections.push(
    `Locally bundled interface font: ${name}\n\n${await readFile(new URL('../apps/shared/fonts/' + name, import.meta.url), 'utf8')}`,
  );
}
await writeFile(
  join(output, 'assets/THIRD_PARTY_NOTICES.txt'),
  sections.join('\n\n' + '='.repeat(72) + '\n\n'),
);
console.log(
  `Browser notices include ${packages.size} bundled dependencies/helpers.`,
);
