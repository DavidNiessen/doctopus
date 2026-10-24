import { afterAll, beforeAll, expect, it } from 'vitest';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { parse, stringify } from 'yaml';
import {
  localeRoute,
  localePaths,
  localizePath,
  localeName,
  createPageData,
  operationHref,
  pageMetadata,
} from '@davidniessen/doctopus-contracts';
import type { SiteData } from '@davidniessen/doctopus-contracts';
import {
  buildSite,
  createDevelopmentBuilder,
  createStaticServer,
} from '@davidniessen/doctopus-cli';
import {
  verifyArtifact,
  auditDocumentation,
  compileProject,
} from '@davidniessen/doctopus-compiler';
const config = { locales: ['en', 'de', 'pt-BR'], defaultLocale: 'en' };
let root = '',
  built: Awaited<ReturnType<typeof buildSite>>;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'doctopus-locales-'));
  await cp(resolve('examples/localized'), root, {
    recursive: true,
    filter: (path) =>
      !path.includes('.doctopus') && !path.includes('.api-docs'),
  });
  const configPath = join(root, 'docs.config.yaml');
  const authored = parse(await readFile(configPath, 'utf8'));
  delete authored.i18n.guides;
  await writeFile(configPath, stringify(authored));
  built = await buildSite(root);
});
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});
it('keeps default URLs and resolves exact alternate locale prefixes', () => {
  expect(localeRoute(config, '/api/example/v1/list/')).toEqual({
    locale: 'en',
    prefix: '',
    contentPath: '/api/example/v1/list/',
  });
  expect(localeRoute(config, '/de/api/example/v1/list/')).toEqual({
    locale: 'de',
    prefix: '/de',
    contentPath: '/api/example/v1/list/',
  });
  expect(localeRoute(config, '/pt-BR/')).toEqual({
    locale: 'pt-BR',
    prefix: '/pt-BR',
    contentPath: '/',
  });
  expect(localeRoute(config, '/de')).toMatchObject({ contentPath: '/' });
  for (const path of ['/fr/guides/a/', '/developer/', '/DE/'])
    expect(localeRoute(config, path).locale).toBe('en');
  expect(localePaths(config, '/guides/a/')).toEqual([
    '/guides/a/',
    '/de/guides/a/',
    '/pt-BR/guides/a/',
  ]);
});
it('changes only the locale prefix and rejects malformed paths or unconfigured languages', () => {
  expect(localizePath(config, '/de/guides/a/', 'en')).toBe('/guides/a/');
  expect(localizePath(config, '/de/guides/a/', 'pt-BR')).toBe(
    '/pt-BR/guides/a/',
  );
  for (const path of [
    'https://evil.test/',
    '//evil.test/',
    '/guides/a/?token=private',
    '/guides/a/#private',
    '/de\\private',
  ])
    expect(() => localizePath(config, path, 'de')).toThrow();
  expect(() => localizePath(config, '/', 'fr')).toThrow(/not configured/);
  expect(localeName('de')).toBe('Deutsch');
  expect(localeName('pt-BR')).toBe('Português (BR)');
  expect(localeName('xx')).toBe('xx');
});
it('generates verified fallback routes, scoped payloads and source-language canonical metadata', async () => {
  expect(built.manifest.routes).toContain('/en/');
  expect(built.manifest.routes).toContain('/en/guides/introduction/');
  expect(built.manifest.routes).not.toContain('/en/oauth/callback/');
  expect((await verifyArtifact(built.directory)).artifactDigest).toBe(
    built.manifest.artifactDigest,
  );
  const path = '/en/guides/introduction/';
  const page = JSON.parse(
    await readFile(join(built.directory, path, 'page-data.json'), 'utf8'),
  ) as SiteData;
  expect(page.pagePath).toBe(path);
  expect(page.guides[0]?.html).toContain('Lerne die API');
  const html = await readFile(
    join(built.directory, path, 'index.html'),
    'utf8',
  );
  expect(html).toContain('<html lang="en"');
  expect(html).toContain(
    'Documentation content is shown in Deutsch. UI language: English.',
  );
  expect(html).toContain('lang="de" class="article');
  expect(html).toContain('href="/localized/en/api/api/v1/listprojects/"');
  expect(pageMetadata(built.site, path)).toMatchObject({
    canonical: 'https://docs.example.test/localized/guides/introduction/',
    robots: 'noindex,follow',
  });
  expect(pageMetadata(built.site, '/guides/introduction/').robots).toBe(
    'index,follow',
  );
  const sitemap = await readFile(join(built.directory, 'sitemap.xml'), 'utf8');
  expect(sitemap).not.toContain('/localized/en/');
  expect(sitemap).toContain('/localized/guides/introduction/');
});
it('selects complete operation schemas for prefixed API pages', () => {
  const api = built.site.apis[0]!,
    operation = api.operations[0]!;
  const path = '/en' + operationHref(api, operation);
  const page = createPageData(built.site, path);
  expect(page.pagePath).toBe(path);
  expect(page.apis[0]?.operations[0]?.responses).toEqual(operation.responses);
  expect(pageMetadata(page, path).title).toBe('Projekte auflisten');
});
it('resolves the shared lifecycle inventory through a locale prefix', () => {
  const api = built.site.apis[0]!;
  const site = {
    ...built.site,
    apis: [
      {
        ...api,
        operations: api.operations.map((operation) => ({
          ...operation,
          deprecated: true,
        })),
      },
    ],
  };
  const page = createPageData(site, '/en/deprecations/');
  expect(page.pagePath).toBe('/en/deprecations/');
  expect(page.lifecycle?.page?.entries[0]?.operationId).toBe(
    api.operations[0]?.id,
  );
  expect(pageMetadata(page, '/en/deprecations/')).toMatchObject({
    title: 'Deprecations',
    robots: 'noindex,follow',
  });
});
it('serves prefixed routes through the same manifest allowlist without inventing prefixed assets or callbacks', async () => {
  const server = await createStaticServer(built.directory);
  try {
    expect((await server.inject('/localized/en/')).statusCode).toBe(200);
    expect(
      (await server.inject('/localized/en/guides/introduction/page-data.json'))
        .statusCode,
    ).toBe(200);
    expect((await server.inject('/localized/fr/')).statusCode).toBe(404);
    expect(
      (await server.inject('/localized/en/oauth/callback/')).statusCode,
    ).toBe(404);
    expect((await server.inject('/localized/en/site.json')).statusCode).toBe(
      404,
    );
  } finally {
    await server.close();
  }
});
it('updates every locale during incremental builds and matches a clean build byte for byte', async () => {
  const builder = createDevelopmentBuilder(root);
  await builder.build();
  const file = join(root, 'guides/introduction.md');
  await writeFile(
    file,
    (await readFile(file, 'utf8')) +
      '\n\nNeue Information für alle Sprachen.\n',
  );
  const changed = await builder.build(['guides/introduction.md']);
  expect(changed.mode).toBe('incremental');
  for (const path of [
    '/',
    '/en/',
    '/guides/introduction/',
    '/en/guides/introduction/',
  ])
    expect(
      await readFile(join(changed.directory, path, 'index.html'), 'utf8'),
    ).toContain('Neue Information');
  await verifyArtifact(changed.directory);
  const clean = await buildSite(root);
  expect(clean.manifest.files).toEqual(changed.manifest.files);
  expect(clean.manifest.artifactDigest).toBe(changed.manifest.artifactDigest);
});
it('doctor recognizes localized links and anchors while rejecting unknown locale destinations', async () => {
  const file = join(root, 'guides/introduction.md');
  await writeFile(
    file,
    (await readFile(file, 'utf8')) +
      '\n\n[English UI](/localized/en/guides/introduction/#heading-projekte-erkunden)\n',
  );
  const site = await compileProject(root);
  expect(
    (await auditDocumentation(site)).filter((item) =>
      ['broken-link', 'broken-anchor'].includes(item.code),
    ),
  ).toEqual([]);
});
