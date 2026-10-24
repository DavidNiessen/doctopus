import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { buildSite } from '@davidniessen/doctopus-cli';
const root = new URL('../.doctopus/java-fixture/', import.meta.url);
await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });
await cp(new URL('../examples/demo/', import.meta.url), root, {
  recursive: true,
  filter: (file) => !file.includes('.doctopus') && !file.includes('.api-docs'),
});
const config = new URL('docs.config.yaml', root);
await writeFile(
  config,
  (await readFile(config, 'utf8')) + '\nbasePath: /docs\n',
);
await buildSite(root.pathname);
console.log('Prepared a real reader publication for Java adapter tests.');
