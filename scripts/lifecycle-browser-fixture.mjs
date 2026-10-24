import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { buildSite, createStaticServer } from '@davidniessen/doctopus-cli';
import { parse } from 'yaml';

const root = new URL(
  '../.doctopus/lifecycle-browser-fixture/',
  import.meta.url,
);
await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });
await cp(new URL('../examples/lifecycle/', import.meta.url), root, {
  recursive: true,
  filter: (path) => !path.includes('.doctopus') && !path.includes('.api-docs'),
});
const file = new URL('v1.yaml', root);
const spec = parse(await readFile(file, 'utf8'));
for (let index = 0; index < 52; index++)
  spec.paths[`/legacy/${index}`] = {
    get: {
      operationId: `zzLegacy${index}`,
      summary: `Legacy resource ${index}`,
      tags: ['Legacy'],
      deprecated: true,
      'x-doctopus-lifecycle': {
        sunsetOn: '2027-06-01',
        migrationUrl: '/guides/migration/#heading-update-your-client',
      },
      responses: { 200: { description: 'OK' } },
    },
  };
await writeFile(file, JSON.stringify(spec));
for (const filename of ['go.mjs', 'go-code.mjs'])
  await cp(
    new URL(`../examples/snippet-plugin/${filename}`, import.meta.url),
    new URL(filename, root),
  );
await writeFile(
  new URL('plain-text.mjs', root),
  `export default { name: 'plain-text', version: '1.0.0', pluginApi: '1', capabilities: ['snippets'], generateSnippets({ operation }) { return operation.id === 'listWidgets' ? [{ id: 'escaped', label: 'Escaped text', language: 'text', code: '<script>window.sampleExecuted = true</script>\\n<img src=x onerror="window.sampleExecuted=true">' }] : []; } };`,
);
const config = new URL('docs.config.yaml', root);
const configuration = parse(await readFile(config, 'utf8'));
configuration.plugins = ['go.mjs', 'plain-text.mjs'];
configuration.locales = ['en', 'de'];
configuration.defaultLocale = 'en';
const localized = parse(
  await readFile(
    new URL('../examples/localized/docs.config.yaml', import.meta.url),
    'utf8',
  ),
);
configuration.i18n = { messages: { de: localized.i18n.messages.de } };
await writeFile(config, JSON.stringify(configuration));
const built = await buildSite(root.pathname, { trustPlugins: true });
const server = await createStaticServer(built.directory);
await server.listen({ host: '127.0.0.1', port: 4176 });
