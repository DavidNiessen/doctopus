import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import express from 'express';
import Fastify from 'fastify';
import {
  createStaticServer,
  inspectIsolatedSource,
} from '@davidniessen/doctopus-cli';
import { PostgresRepository } from '@davidniessen/doctopus-storage';
import { verifyArtifact } from '@davidniessen/doctopus-compiler';
import { validateSiteData } from '@davidniessen/doctopus-plugin-sdk';
import {
  downloadSpec,
  loadSpec,
  loadReferenceSnapshot,
  parseConfig,
  requestAllowedOrigin,
} from '@davidniessen/doctopus-spec';
import {
  defineReaderExtension,
  createReaderExtensionSession,
} from '@davidniessen/doctopus-plugin-sdk/browser';
import { createExpressDocs } from '@davidniessen/doctopus-node/express';
import { doctopusPlugin } from '@davidniessen/doctopus-node/fastify';
import {
  parseJsonValue,
  serializeJsonValue,
  setJsonProperty,
  toolVersion,
  objectFieldSchema,
  schemaVariants,
  feedbackHref,
  isRelayEndpoint,
  createUiTranslation,
  createPageData,
  createPageDataFactory,
  localizePath,
  localeRoute,
  readBuildPolicy,
  readSourceSnapshotInfo,
} from '@davidniessen/doctopus-contracts';
import {
  redactJsonBody,
  encodeFormBody,
  createMultipartParts,
  toFetchRequest,
  generateSnippet,
  redactRequest,
  generateMockResponse,
  prepareRequest,
  canSerializeEmptyParameter,
} from '@davidniessen/doctopus-explorer';

const exec = promisify(execFile);
const disconnectedStore = new PostgresRepository(
  'postgresql://fixture@127.0.0.1/unused',
  {
    statementTimeoutMs: 1000,
    queryTimeoutMs: 2000,
    buildQueue: { maxPending: 1 },
  },
);
assert.equal(typeof disconnectedStore.buildJobs.enqueue, 'function');
assert.equal(typeof disconnectedStore.buildJobs.claim, 'function');
const installedBuildPolicy = readBuildPolicy({
  image: 'sha256:' + 'a'.repeat(64),
});
assert.equal(installedBuildPolicy.schemaVersion, 1);
assert.equal(installedBuildPolicy.trustPlugins, false);
assert.equal(installedBuildPolicy.limits.timeoutMs, 180000);
assert.throws(() => readBuildPolicy({ image: 'builder:latest' }));
assert.deepEqual(
  readSourceSnapshotInfo({
    digestVersion: 2,
    digest: 'b'.repeat(64),
    bytes: 100,
    files: 1,
  }),
  { digestVersion: 2, digest: 'b'.repeat(64), bytes: 100, files: 1 },
);
await disconnectedStore.close();
assert.throws(
  () =>
    new PostgresRepository('postgresql://fixture@127.0.0.1/unused', {
      statementTimeoutMs: 0,
    }),
  /PostgreSQL/,
);

const browserPages = [];
const installedParameter = {
  name: 'empty',
  in: 'query',
  required: true,
  description: '',
  schema: { type: 'string' },
};
assert.equal(canSerializeEmptyParameter(installedParameter), true);
assert.equal(
  prepareRequest(
    {
      id: 'installed-presence',
      slug: 'installed-presence',
      method: 'get',
      path: '/probe',
      summary: '',
      description: '',
      tags: [],
      deprecated: false,
      parameters: [installedParameter],
      responses: [],
      security: [],
      servers: [],
      source: '#/paths/probe/get',
    },
    {},
    {
      server: 'https://installed.example.test',
      parameters: { 'query:empty': '' },
      parameterPresence: { 'query:empty': true },
    },
  ).url,
  'https://installed.example.test/probe?empty=',
);
const browserExtension = defineReaderExtension({
  id: 'installed-browser',
  version: '1.0.0',
  pluginApi: '1',
  capabilities: ['page'],
  activate(context) {
    return context.onPageChange((page) => browserPages.push(page.path));
  },
});
const browserSession = createReaderExtensionSession(
  browserExtension,
  { path: '/', title: 'Installed', locale: 'en', kind: 'guide' },
  { basePath: '/reference', mount: () => {} },
);
assert.equal(await browserSession.ready, true);
browserSession.dispose();
assert.deepEqual(browserPages, ['/']);

const installedVariants = schemaVariants(
  {
    type: 'object',
    properties: { id: { type: 'integer' } },
    oneOf: [
      {
        title: 'Named',
        type: 'object',
        properties: { name: { type: 'string' } },
      },
      {
        title: 'Counted',
        type: 'object',
        properties: { count: { type: 'integer' } },
      },
    ],
  },
  {},
);
assert.equal(installedVariants.keyword, 'oneOf');
assert.equal(installedVariants.choices[1].label, '2. Counted');
assert.deepEqual(
  Object.keys(
    objectFieldSchema(installedVariants.choices[1].schema, {}, false)
      .properties,
  ),
  ['id', 'count'],
);

const feedbackConfig = parseConfig({
  name: 'Installed feedback',
  specs: [{ id: 'fixture', path: 'openapi.yaml' }],
  siteUrl: 'https://docs.example.test',
  basePath: '/installed',
  feedback: { url: 'https://issues.example.test/new', includePage: true },
});
assert.equal(
  new URL(
    feedbackHref(feedbackConfig, '/guide/?token=secret#private'),
  ).searchParams.get('body'),
  'Documentation page: https://docs.example.test/installed/guide/',
);
assert.equal(isRelayEndpoint('/api/projects/installed/relay'), true);
assert.equal(
  isRelayEndpoint('https://other.example/api/projects/installed/relay'),
  false,
);
assert.equal(
  parseConfig({
    name: 'Installed relay',
    specs: [{ id: 'fixture', path: 'openapi.yaml' }],
    explorer: { relay: '/api/projects/installed/relay' },
  }).explorer.relay,
  '/api/projects/installed/relay',
);
const translatedConfig = parseConfig({
  name: 'Installed messages',
  specs: [{ id: 'fixture', path: 'openapi.yaml' }],
  locales: ['de'],
  defaultLocale: 'de',
  i18n: {
    messages: {
      de: {
        'playground.dialog': '{title} testen',
        'settings.apply': '{name} anwenden',
        'appearance.radius': '{value}px Radius',
        'classic.page': 'Seite {page} von {pages}',
        'schema.variant': 'Variante {number}',
        'lifecycle.page': 'Seite {page} von {pages}',
      },
    },
  },
});
const translated = createUiTranslation('de', translatedConfig.i18n);
assert.equal(
  translated.text('playground.dialog', { title: 'Installed' }),
  'Installed testen',
);
assert.equal(translated.text('playground.send'), 'Send');
assert.equal(translated.translated, 6);
assert.equal(
  translated.text('settings.apply', { name: '<saved>' }),
  '<saved> anwenden',
);
assert.equal(
  translated.text('appearance.radius', { value: 12 }),
  '12px Radius',
);
assert.equal(
  translated.text('classic.page', { page: 2, pages: 7 }),
  'Seite 2 von 7',
);
assert.equal(translated.text('classic.retry'), 'Retry endpoint list');
assert.equal(translated.text('schema.variant', { number: 2 }), 'Variante 2');
assert.equal(
  translated.text('lifecycle.page', { page: 3, pages: 4 }),
  'Seite 3 von 4',
);
const languageRoutes = { locales: ['en', 'de'], defaultLocale: 'en' };
assert.equal(
  localizePath(languageRoutes, '/guides/start/', 'de'),
  '/de/guides/start/',
);
assert.equal(
  localeRoute(languageRoutes, '/de/guides/start/').contentPath,
  '/guides/start/',
);
const composed = objectFieldSchema(
  {
    allOf: [
      {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'integer' } },
      },
      { type: 'object', properties: { enabled: { type: 'boolean' } } },
    ],
  },
  {},
  false,
);
assert.deepEqual(composed.required, ['id']);
assert.equal(
  new URLSearchParams(
    encodeFormBody('{"id":9007199254740993,"enabled":false}', {
      schema: composed,
    }),
  ).get('id'),
  '9007199254740993',
);
const uploadRequest = {
  url: 'https://api.example.test/upload',
  method: 'POST',
  headers: {},
  multipart: createMultipartParts(
    '{"id":9007199254740993,"password":"installed-upload-secret","tags":["installed + styled",9007199254740993]}',
    {
      attachment: [
        {
          filename: 'installed.bin',
          data: new Blob([Uint8Array.from([0, 255, 128])]),
        },
      ],
    },
    {
      schema: {
        type: 'object',
        properties: {
          attachment: { type: 'string', format: 'binary' },
          password: { type: 'string', writeOnly: true },
          tags: { type: 'array', items: {} },
        },
      },
      encoding: {
        tags: { style: 'form', explode: false },
        attachment: { headers: { 'X-Part': { schema: { type: 'string' } } } },
      },
    },
    { partHeaders: { attachment: { 'X-Part': 'installed-part-secret' } } },
  ),
};
const multipart = toFetchRequest(uploadRequest);
const uploadPreview = redactRequest(
  uploadRequest,
  {},
  {
    schema: { type: 'object', properties: { password: { writeOnly: true } } },
    schemas: {},
  },
);
assert(!JSON.stringify(uploadPreview).includes('installed-upload-secret'));
assert(!JSON.stringify(uploadPreview).includes('installed-part-secret'));
assert(!JSON.stringify(uploadPreview).includes('installed%20%2B%20styled'));
assert(
  uploadPreview.multipart.some(
    (part) =>
      part.name === 'tags' &&
      part.value === 'YOUR_PART_VALUE' &&
      part.styled === true,
  ),
);
assert(
  uploadPreview.multipart.find((part) => part.kind === 'file').headers[
    'X-Part'
  ] === 'YOUR_PART_HEADER',
);
assert(
  uploadPreview.multipart.some(
    (part) =>
      part.kind === 'text' &&
      part.name === 'id' &&
      part.value === '9007199254740993',
  ),
);
for (const language of ['cURL', 'JavaScript', 'TypeScript', 'Python', 'Java']) {
  const code = generateSnippet(uploadRequest, language);
  assert(code.includes('YOUR_FILE_1'));
  assert(!code.includes('installed.bin'));
}
const uploaded = await new Response(multipart.body, {
  headers: multipart.headers,
}).formData();
assert.equal(uploaded.get('id'), '9007199254740993');
assert.equal(uploaded.get('tags'), 'installed%20%2B%20styled,9007199254740993');
assert.deepEqual(
  new Uint8Array(await uploaded.get('attachment').arrayBuffer()),
  Uint8Array.from([0, 255, 128]),
);
assert.equal(
  encodeFormBody('{"name":"installed + form","id":9007199254740993}', {
    schema: { type: 'object' },
  }),
  'name=installed+%2B+form&id=9007199254740993',
);
const parsedBody = parseJsonValue(
  '{"id":9007199254740993,"password":"fixture-only"}',
);
assert.equal(parsedBody.kind, 'object');
const editedBody = serializeJsonValue(
  setJsonProperty(parsedBody, 'name', { kind: 'string', value: 'installed' }),
);
assert(editedBody.includes('9007199254740993'));
assert(
  !redactJsonBody(editedBody, {
    schema: { properties: { password: { writeOnly: true } } },
    schemas: {},
  }).includes('fixture-only'),
);
const root = process.cwd();
const metadata = JSON.parse(await readFile('package.json', 'utf8'));
const typeImports = [];
for (const name of Object.keys(metadata.dependencies).filter((name) =>
  name.startsWith('@davidniessen/'),
)) {
  const entry =
    name === '@davidniessen/doctopus-reader'
      ? `${name}/render`
      : name === '@davidniessen/doctopus-node'
        ? `${name}/express`
        : name;
  assert(
    fileURLToPath(import.meta.resolve(entry)).startsWith(
      join(root, 'node_modules') + '/',
    ),
  );
  assert.equal(
    (await lstat(join(root, 'node_modules', name))).isSymbolicLink(),
    false,
    `${name}: workspace symlink bypasses package verification`,
  );
  typeImports.push(
    `import * as Component${typeImports.length} from ${JSON.stringify(entry)};\nvoid Component${typeImports.length};`,
  );
}
typeImports.push(`import {defineReaderExtension as defineTypedReaderExtension} from '@davidniessen/doctopus-plugin-sdk/browser';
const typedReaderExtension=defineTypedReaderExtension({id:'typed-reader',version:'1.0.0',pluginApi:'1',capabilities:['page','footer'],activate(context){context.setFooter(page=>{const element=document.createElement('p');element.textContent=page.title;return {element};});}});void typedReaderExtension;`);
typeImports.push(`import {createPageDataFactory as createTypedPageDataFactory} from '@davidniessen/doctopus-contracts';
import type {SiteData as ProjectionSiteData} from '@davidniessen/doctopus-contracts';
function projectPages(site:ProjectionSiteData):(path:string)=>ProjectionSiteData{return createTypedPageDataFactory(site);}
void projectPages;`);
typeImports.push(`import {PostgresRepository as TypedPostgresRepository} from '@davidniessen/doctopus-storage';
import type {PostgresRepositoryOptions} from '@davidniessen/doctopus-storage';
import type {BuildJobRepository, BuildLease, BuildQueueLimits} from '@davidniessen/doctopus-domain';
import type {BuildPolicy, SourceSnapshotInfo} from '@davidniessen/doctopus-contracts';
const queueLimits:Partial<BuildQueueLimits>={maxPending:1};
const databaseOptions: PostgresRepositoryOptions = {statementTimeoutMs:1000,queryTimeoutMs:2000,buildQueue:queueLimits};
const typedStore = new TypedPostgresRepository('postgresql://fixture@127.0.0.1/unused',databaseOptions);
const typedQueue:BuildJobRepository=typedStore.buildJobs;
function leasePolicy(lease:BuildLease):BuildPolicy{return lease.source.policy;}
function leaseSource(lease:BuildLease):SourceSnapshotInfo{return lease.source.snapshot;}
void [typedQueue,leasePolicy,leaseSource];`);
typeImports.push(`import {inspectIsolatedSource as typedInspectSource} from '@davidniessen/doctopus-cli';
import type {IsolatedSourceInfo, IsolatedSourceOptions, IsolatedBuildOptions} from '@davidniessen/doctopus-cli';
const sourceOptions:IsolatedSourceOptions={sourceMiB:1};
const sourcePromise:Promise<IsolatedSourceInfo>=typedInspectSource('docs',sourceOptions);
const pinnedBuild:IsolatedBuildOptions={image:'sha256:'+'a'.repeat(64),expectedSourceDigest:'b'.repeat(64)};
void [sourcePromise,pinnedBuild];`);
await writeFile(
  'types.mts',
  typeImports.join('\n') +
    `\nimport { definePlugin } from '@davidniessen/doctopus-plugin-sdk';\nimport type { ThemePatch, BuildPluginContext, SpecSource, SnippetInput, SnippetSample } from '@davidniessen/doctopus-plugin-sdk';\nimport type { SiteData } from '@davidniessen/doctopus-contracts';\nimport { createExpressDocs } from '@davidniessen/doctopus-node/express';\nimport { doctopusPlugin } from '@davidniessen/doctopus-node/fastify';\nimport { buildSite } from '@davidniessen/doctopus-cli';\nconst plugin = definePlugin({ name: 'installed-types', version: '1.0.0', pluginApi: '1', capabilities: ['source', 'theme', 'transform', 'snippets'], loadSpec: (source: Readonly<SpecSource>) => source.content, theme: (theme, context: BuildPluginContext): ThemePatch => ({ radius: context.signal.aborted ? theme.radius : 12 }), transform: (site: SiteData) => site, generateSnippets: ({operation}: SnippetInput): SnippetSample[] => [{id:'sdk', label:'SDK', language:'javascript', code:operation.id}] });\nconst pinnedSource: SpecSource = { id: 'pinned', path: 'source-0.yaml', content: '', references: 'snapshot.json' };\nvoid [plugin, pinnedSource, createExpressDocs, doctopusPlugin, buildSite];\n`,
);
await exec(process.execPath, [
  'node_modules/typescript/bin/tsc',
  '--noEmit',
  '--strict',
  '--module',
  'NodeNext',
  '--moduleResolution',
  'NodeNext',
  '--target',
  'ES2023',
  '--skipLibCheck',
  'false',
  '--types',
  'node',
  'types.mts',
]);
const cli = fileURLToPath(
  import.meta.resolve('@davidniessen/doctopus-cli'),
).replace(/index\.js$/, 'main.js');
const version = JSON.parse(
  await readFile(
    'node_modules/@davidniessen/doctopus-cli/package.json',
    'utf8',
  ),
).version;
assert.equal(toolVersion, version);
assert.equal(
  (
    await exec(join(root, 'node_modules/.bin/doctopus'), ['--version'])
  ).stdout.trim(),
  version,
);
await exec(process.execPath, [cli, 'init', 'docs']);
const sourceInfo = await inspectIsolatedSource('docs', { sourceMiB: 1 });
assert.equal(sourceInfo.digestVersion, 2);
assert.match(sourceInfo.digest, /^[a-f0-9]{64}$/);
assert.equal(
  JSON.parse(
    (await exec(process.execPath, [cli, 'source-info', 'docs', '--json']))
      .stdout,
  ).source.digest,
  sourceInfo.digest,
);
const importedSource = Buffer.from(
  '{"openapi":"3.1.0","info":{"title":"Packaged remote snapshot","version":"v1"},"paths":{},"components":{"schemas":{"Id":{"type":"integer","example":9007199254740993}}}}\n',
);
const importedDigest = createHash('sha256')
  .update(importedSource)
  .digest('hex');
const pinnedRoot = Buffer.from(
  'openapi: 3.1.0\ninfo: {title: Installed pinned API, version: v1}\npaths: {}\ncomponents:\n  schemas:\n    Item: {$ref: "./models.yaml#/Item"}\n',
);
const pinnedModel = Buffer.from(
  'Item: {type: object, properties: {id: {type: string}}}\n',
);
let pinnedSpec;
const sourceServer = createServer(async (request, response) => {
  if (request.method === 'POST') {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    response
      .writeHead(201, { 'Content-Type': 'application/octet-stream' })
      .end(Buffer.concat(chunks));
  } else if (request.url === '/pinned/openapi.yaml') response.end(pinnedRoot);
  else if (request.url === '/pinned/models.yaml') response.end(pinnedModel);
  else response.end(importedSource);
});
await new Promise((resolve, reject) => {
  sourceServer.once('error', reject);
  sourceServer.listen(0, '127.0.0.1', resolve);
});
try {
  const address = sourceServer.address();
  assert(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const exchange = await requestAllowedOrigin(origin + '/echo', {
    allowedOrigins: [origin],
    allowHttp: true,
    allowPrivateNetwork: true,
    method: 'POST',
    body: Uint8Array.of(0, 255, 128),
  });
  assert.equal(exchange.status, 201);
  assert.deepEqual(exchange.body, Buffer.from([0, 255, 128]));
  const snapshot = await downloadSpec(origin + '/openapi', {
    allowedOrigins: [origin],
    allowHttp: true,
    allowPrivateNetwork: true,
    expectedSha256: importedDigest,
  });
  assert.deepEqual(snapshot.source, importedSource);
  const imported = await exec(process.execPath, [
    cli,
    'import-spec',
    origin + '/openapi',
    'docs',
    '--allow-origin',
    origin,
    '--allow-http',
    '--allow-private-network',
    '--sha256',
    importedDigest,
    '--output',
    'downloaded.json',
  ]);
  assert(imported.stdout.includes(importedDigest));
  assert.deepEqual(await readFile('docs/downloaded.json'), importedSource);
  await mkdir('frozen');
  await writeFile(
    'frozen/policy.json',
    JSON.stringify({
      schemaVersion: 1,
      root: origin + '/pinned/openapi.yaml',
      sources: [
        {
          url: origin + '/pinned/openapi.yaml',
          sha256: createHash('sha256').update(pinnedRoot).digest('hex'),
        },
        {
          url: origin + '/pinned/models.yaml',
          sha256: createHash('sha256').update(pinnedModel).digest('hex'),
        },
      ],
    }),
  );
  const vendored = await exec(process.execPath, [
    cli,
    'vendor-spec',
    'policy.json',
    'frozen',
    '--allow-origin',
    origin,
    '--allow-http',
    '--allow-private-network',
  ]);
  const digest = vendored.stdout.match(/spec-snapshots\/([a-f0-9]{64})\//)?.[1];
  assert(digest, 'Installed CLI did not produce a reference snapshot');
  assert(!vendored.stdout.includes(origin));
  pinnedSpec = {
    id: 'pinned',
    path: `spec-snapshots/${digest}/source-0.yaml`,
    references: `spec-snapshots/${digest}/snapshot.json`,
  };
  const cached = await loadReferenceSnapshot(
    join(root, 'frozen'),
    pinnedSpec.references,
  );
  assert.equal(cached.manifest.documents.length, 2);
  assert.deepEqual(await readFile(join('frozen', pinnedSpec.path)), pinnedRoot);
} finally {
  sourceServer.closeAllConnections();
  await new Promise((resolve) => sourceServer.close(resolve));
}
// The source server is closed: the physically installed loader and CLI must use only pinned bytes.
assert(pinnedSpec);
assert.equal(
  (await loadSpec(join(root, 'frozen'), pinnedSpec)).title,
  'Installed pinned API',
);
await writeFile(
  'frozen/docs.config.yaml',
  JSON.stringify({ name: 'Frozen consumer', specs: [pinnedSpec] }),
);
await exec(process.execPath, [cli, 'build', 'frozen']);
const frozenManifest = await verifyArtifact(
  join(root, 'frozen/.doctopus/site'),
);
assert(
  !Object.keys(frozenManifest.files).some((file) =>
    file.startsWith('spec-snapshots/'),
  ),
);
await exec(process.execPath, [cli, 'doctor', 'docs', '--strict']);
const config = join(root, 'docs/docs.config.yaml');
await writeFile(
  config,
  (await readFile(config, 'utf8')) +
    '\nbasePath: /reference\nplugins:\n  - plugin.mjs\nlocales: [en, de]\ni18n:\n  guides:\n    de: translations/de\nreaderExtensions:\n  - id: installed-footer\n    entry: installed-footer.mjs\n',
);
await writeFile(
  'docs/plugin.mjs',
  `import { definePlugin } from '@davidniessen/doctopus-plugin-sdk';\nexport default definePlugin({ name: 'installed-consumer', version: '1.0.0', pluginApi: '1', capabilities: ['source', 'theme', 'transform', 'snippets'], loadSpec: (source) => source.content.replace('title: My API', 'title: Installed source API'), theme: () => ({ radius: 12, colors: { light: { surface: '#f4f8f6' } } }), transform: (site) => { if (site.config.theme.radius !== 12 || site.apis[0].title !== 'Installed source API') throw new Error('Source/theme hooks did not precede transform'); return { ...site, config: { ...site.config, name: 'Packaged consumer' }, apis: site.apis.map((api, i) => i ? api : { ...api, operations: api.operations.map((op, j) => j ? op : { ...op, lifecycle: { sunsetOn: '2028-01-01', message: 'Packaged lifecycle metadata' } }) }) }; }, generateSnippets({operation}) { return [{id:'sdk', label:'Installed SDK', language:'javascript', code:'console.log('+JSON.stringify(operation.id)+');'}]; } });\n`,
);
await writeFile(
  'docs/installed-footer.mjs',
  `export default {id:'installed-footer',version:'1.0.0',pluginApi:'1',capabilities:['footer'],activate(context){context.setFooter(page=>{const element=globalThis.document.createElement('p');element.textContent=page.title;return {element};});}};`,
);
await mkdir('docs/translations/de', { recursive: true });
await writeFile(
  'docs/translations/de/installed.md',
  '---\ntitle: Installierte Pakete\n---\n\n## Lokale Übersetzung\n\nDie installierten Komponenten unterstützen übersetzte Anleitungen.\n',
);
await writeFile(
  'docs/guides/installed.mdx',
  '---\ntitle: Installed consumer\n---\n\n<Callout>Packaged MDX works.</Callout>\n',
);
await exec(process.execPath, [
  cli,
  'plugin-check',
  'plugin.mjs',
  'docs',
  '--trust-plugins',
  '--trust-content',
]);
await exec(process.execPath, [
  cli,
  'build',
  'docs',
  '--trust-plugins',
  '--trust-content',
]);
await exec(process.execPath, [
  cli,
  'doctor',
  'docs',
  '--strict',
  '--trust-plugins',
  '--trust-content',
]);
const directory = join(root, 'docs/.doctopus/site');
const manifest = await verifyArtifact(directory);
assert.equal(manifest.compilerVersion, version);
const installedSite = JSON.parse(
  await readFile(join(directory, 'site.json'), 'utf8'),
);
assert.deepEqual(validateSiteData(installedSite), installedSite);
assert.deepEqual(
  createPageDataFactory(installedSite)('/'),
  createPageData(installedSite, '/'),
);
for (const api of installedSite.apis) {
  assert.match(api.operationIndex, /^api-index\/\d+\/catalog\.json$/);
  assert(Object.hasOwn(manifest.files, api.operationIndex));
  const catalog = JSON.parse(
    await readFile(join(directory, api.operationIndex), 'utf8'),
  );
  assert.equal(catalog.apiId, api.id);
  assert.equal(catalog.version, api.version);
  assert.equal(catalog.total, api.operations.length);
  let entries = 0;
  for (let page = 0; page < catalog.pages; page++) {
    const file = api.operationIndex.replace('catalog.json', `${page}.json`);
    assert(Object.hasOwn(manifest.files, file));
    entries += JSON.parse(await readFile(join(directory, file), 'utf8'))
      .operations.length;
  }
  assert.equal(entries, api.operations.length);
}
const translatedPage = JSON.parse(
  await readFile(join(directory, 'de/guides/installed/page-data.json'), 'utf8'),
);
assert.equal(translatedPage.contentLocale, 'de');
assert.equal(translatedPage.guideTranslations, undefined);
assert(
  (
    await readFile(join(directory, 'de/guides/installed/index.html'), 'utf8')
  ).includes('<title>Installierte Pakete · Packaged consumer</title>'),
);
assert(
  (await readFile(join(directory, 'search/de/catalog.json'), 'utf8')).includes(
    'search/de/0.json',
  ),
);
assert.equal(installedSite.readerExtensions[0].id, 'installed-footer');
assert(Object.hasOwn(manifest.files, installedSite.readerExtensions[0].entry));
assert.equal(installedSite.config.theme.radius, 12);
assert.equal(installedSite.config.theme.colors.light.surface, '#f4f8f6');
assert.equal(installedSite.apis[0].title, 'Installed source API');
const mockOperation = {
  ...installedSite.apis[0].operations[0],
  responses: [
    {
      status: '200',
      description: 'Installed mock',
      headers: {},
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: { id: { type: 'string', format: 'uuid' } },
          },
        },
      },
    },
  ],
};
const mock = generateMockResponse(mockOperation, { seed: 'installed' });
assert.equal(mock.kind, 'mock');
assert.match(JSON.parse(mock.body).id, /^[a-f0-9-]{36}$/);
assert.deepEqual(
  generateMockResponse(mockOperation, { seed: 'installed' }),
  mock,
);
assert.notEqual(
  generateMockResponse(mockOperation, { seed: 'different' }).body,
  mock.body,
);
assert.equal(
  installedSite.apis[0].operations[0].codeSamples[0].plugin,
  'installed-consumer',
);
assert(
  installedSite.apis[0].operations[0].codeSamples[0].code.includes('getHealth'),
);
assert(
  (await readFile(join(directory, 'index.html'), 'utf8')).includes(
    `content="doctopus ${version}"`,
  ),
);
const lifecycle = JSON.parse(
  (
    await exec(process.execPath, [
      cli,
      'lifecycle',
      'docs',
      '--as-of',
      '2027-05-15',
      '--json',
      '--trust-plugins',
      '--trust-content',
    ])
  ).stdout,
);
assert.equal(lifecycle.total, 1);
assert.equal(lifecycle.entries[0].lifecycle.sunsetOn, '2028-01-01');
assert.equal(lifecycle.entries[0].status, 'planned');
assert(Object.keys(manifest.files).some((file) => file === 'assets/reader.js'));
assert(
  (
    await readFile(join(directory, 'guides/installed/index.html'), 'utf8')
  ).includes('Packaged MDX works.'),
);
await writeFile(join(directory, 'private.txt'), 'unlisted-consumer-fixture');
await writeFile(
  join(directory, 'assets/private.txt'),
  'unlisted-consumer-fixture',
);
const unlistedPaths = [
  '/reference/private.txt',
  '/reference/assets/private.txt',
  '/reference/manifest.json',
];
const staticServer = await createStaticServer(directory);
try {
  const response = await staticServer.inject('/reference/');
  assert.equal(response.statusCode, 200);
  assert(response.body.includes('Packaged consumer'));
  assert.equal(
    (
      await staticServer.inject(
        '/reference/' + installedSite.readerExtensions[0].entry,
      )
    ).statusCode,
    200,
  );
  const localized = await staticServer.inject(
    '/reference/de/guides/installed/',
  );
  assert.equal(localized.statusCode, 200);
  assert(localized.body.includes('Lokale Übersetzung'));
  assert.equal(
    (await staticServer.inject('/reference/search/de/catalog.json')).statusCode,
    200,
  );
  for (const url of unlistedPaths) {
    for (const method of ['GET', 'HEAD']) {
      const rejected = await staticServer.inject({ url, method });
      assert.equal(rejected.statusCode, 404);
      assert(!rejected.body.includes('unlisted-consumer-fixture'));
    }
  }
  await staticServer.reloadPublication();
  assert.equal((await staticServer.inject('/health/ready')).statusCode, 200);

  assert.equal(
    (await staticServer.inject('/reference/assets/reader.js')).statusCode,
    200,
  );
  const notices = await staticServer.inject(
    '/reference/assets/THIRD_PARTY_NOTICES.txt',
  );
  assert.equal(notices.statusCode, 200);
  assert(
    notices.body.includes('MIT License') && notices.body.includes('react-dom@'),
  );
} finally {
  await staticServer.close();
}
const headers = { authorization: 'Bearer fixture' };
const paths = [
  '/reference/',
  '/reference/guides/installed/',
  '/reference/assets/reader.js',
  '/reference/search.json',
  '/reference/site.json',
  '/reference/oauth/callback/',
  '/reference/assets/oauth-callback.js',
  '/reference/deprecations/',
  '/reference/deprecations/page-data.json',
];
const app = express();
const docs = await createExpressDocs({
  directory,
  authenticate: (request, response, next) =>
    request.headers.authorization === headers.authorization
      ? next()
      : response.sendStatus(401),
});
app.use(docs.mountPath, docs.router);
const listener = app.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => {
  listener.once('error', reject);
  listener.once('listening', resolve);
});
try {
  const address = listener.address();
  assert(address && typeof address !== 'string');
  for (const path of paths) {
    assert.equal(
      (await fetch(`http://127.0.0.1:${address.port}${path}`)).status,
      401,
    );
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      headers,
    });
    assert.equal(response.status, 200);
    await response.arrayBuffer();
  }
  for (const path of unlistedPaths) {
    assert.equal(
      (await fetch(`http://127.0.0.1:${address.port}${path}`)).status,
      401,
    );
    for (const method of ['GET', 'HEAD']) {
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
        headers,
        method,
      });
      assert.equal(response.status, 404);
      assert(!(await response.text()).includes('unlisted-consumer-fixture'));
    }
  }
} finally {
  listener.closeAllConnections();
  await new Promise((resolve) => listener.close(resolve));
}
const fastify = Fastify();
try {
  await fastify.register(doctopusPlugin, {
    directory,
    authenticate: async (request, reply) => {
      if (request.headers.authorization !== headers.authorization)
        return reply.code(401).send();
    },
  });
  for (const url of paths) {
    assert.equal((await fastify.inject(url)).statusCode, 401);
    assert.equal((await fastify.inject({ url, headers })).statusCode, 200);
  }
  for (const url of unlistedPaths) {
    assert.equal((await fastify.inject(url)).statusCode, 401);
    for (const method of ['GET', 'HEAD']) {
      const response = await fastify.inject({ url, headers, method });
      assert.equal(response.statusCode, 404);
      assert(!response.body.includes('unlisted-consumer-fixture'));
    }
  }
} finally {
  await fastify.close();
}
console.log(
  'Installed types, CLI, MDX/plugin workers, doctor, artifact checks and authenticated Express/Fastify subpaths passed.',
);
