import { cp, mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(
  new URL('../apps/reader/dist/client/', import.meta.url),
);
await cp(
  new URL('../apps/reader/integration.html', import.meta.url),
  join(root, 'direct.html'),
);
const files = {};
for (const entry of await readdir(join(root, 'assets'), {
  withFileTypes: true,
})) {
  if (!entry.isFile() || entry.name.endsWith('.map')) continue;
  const path = 'assets/' + entry.name;
  files[path] = createHash('sha256')
    .update(await readFile(join(root, path)))
    .digest('hex');
}
await writeFile(join(root, 'direct-assets.json'), JSON.stringify(files));
// Both Java web stacks serve these classpath resources without extracting files
// or needing Node in the consuming application.
const java = fileURLToPath(
  new URL(
    '../integrations/java/.reader-resources/META-INF/doctopus/reader/',
    import.meta.url,
  ),
);
await rm(java, { recursive: true, force: true });
await mkdir(java, { recursive: true });
for (const path of [
  ...Object.keys(files),
  'direct.html',
  'direct-assets.json',
]) {
  await mkdir(join(java, path, '..'), { recursive: true });
  await cp(join(root, path), join(java, path));
}
