import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  cp,
  mkdtemp,
  readFile,
  rm,
  writeFile,
  symlink,
  rename,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { parse, stringify } from 'yaml';
import {
  buildSite,
  createDevelopmentBuilder,
  createStaticServer,
} from '@davidniessen/doctopus-cli';
import {
  compileProject,
  auditDocumentation,
  verifyArtifact,
} from '@davidniessen/doctopus-compiler';
import { loadGuides } from '@davidniessen/doctopus-content';
import { parseConfig } from '@davidniessen/doctopus-spec';
import {
  createPageData,
  pageMetadata,
  guidesForLocale,
  validateGuideTranslations,
} from '@davidniessen/doctopus-contracts';
import { createSearchIndex, search } from '@davidniessen/doctopus-search';
let root = '',
  built: Awaited<ReturnType<typeof buildSite>>;
async function project() {
  const root = await mkdtemp(join(tmpdir(), 'doctopus-guide-translations-'));
  await cp(resolve('examples/localized'), root, {
    recursive: true,
    filter: (path) =>
      !path.includes('.doctopus') && !path.includes('.api-docs'),
  });
  return root;
}
async function isolated(run: (root: string) => Promise<void>) {
  const root = await project();
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
beforeAll(async () => {
  root = await project();
  built = await buildSite(root);
});
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});
it('validates explicit, declared, disjoint locale roots and defaults an absent message catalog', () => {
  const input = {
    name: 'Guide languages',
    specs: [{ id: 'api', path: 'api.yaml' }],
    locales: ['en', 'de'],
  };
  expect(
    parseConfig({ ...input, i18n: { guides: { de: 'translations/de' } } }).i18n
      ?.messages,
  ).toEqual({});
  for (const guides of [
    { en: 'translations/en' },
    { fr: 'translations/fr' },
    { de: '../outside' },
    { de: '/absolute' },
    { de: 'guides/de' },
    { de: 'guides' },
    { de: 'guides/./de' },
  ])
    expect(() => parseConfig({ ...input, i18n: { guides } })).toThrow();
});
it('projects translated metadata/body with per-page fallback and removes other translation bodies from payloads', () => {
  const page = createPageData(built.site, '/en/guides/introduction/');
  expect(page.contentLocale).toBe('en');
  expect(page.searchLocale).toBe('en');
  expect(page.guideTranslations).toBeUndefined();
  expect(
    page.guides.find((guide) => guide.slug === 'introduction'),
  ).toMatchObject({ title: 'Getting started', group: 'Guides' });
  expect(
    page.guides.find((guide) => guide.slug === 'introduction')?.html,
  ).toContain('Launch your rocket');
  expect(
    page.guides.find((guide) => guide.slug === 'authentication')?.html,
  ).toBe('');
  const fallback = createPageData(built.site, '/en/guides/authentication/');
  expect(fallback.contentLocale).toBe('de');
  expect(
    fallback.guides.find((guide) => guide.slug === 'authentication')?.html,
  ).toContain('Zugang konfigurieren');
  expect(guidesForLocale(built.site, 'en').map((guide) => guide.title)).toEqual(
    ['Getting started', 'Authentifizierung'],
  );
});
it('publishes reciprocal language metadata only for authored guide variants and keeps fallback pages out of the sitemap', async () => {
  const path = '/en/guides/introduction/';
  expect(pageMetadata(built.site, path)).toMatchObject({
    title: 'Getting started',
    robots: 'index,follow',
    canonical: 'https://docs.example.test/localized/en/guides/introduction/',
  });
  const page = createPageData(built.site, path);
  expect(pageMetadata(page, path).alternates).toEqual([
    { locale: 'en', href: path },
    { locale: 'de', href: '/guides/introduction/' },
  ]);
  const html = await readFile(
    join(built.directory, path, 'index.html'),
    'utf8',
  );
  expect(html).toContain('<title>Getting started · Mehrsprachige API</title>');
  expect(html).toContain(
    'hreflang="en" href="https://docs.example.test/localized/en/guides/introduction/"',
  );
  expect(html).toContain(
    'hreflang="de" href="https://docs.example.test/localized/guides/introduction/"',
  );
  expect(html).not.toContain('Documentation content is shown in Deutsch');
  const fallback = pageMetadata(built.site, '/en/guides/authentication/');
  expect(fallback.robots).toBe('noindex,follow');
  expect(fallback.alternates).toEqual([]);
  const sitemap = await readFile(join(built.directory, 'sitemap.xml'), 'utf8');
  expect(sitemap).toContain('/localized/en/guides/introduction/');
  expect(sitemap).not.toContain('/localized/en/guides/authentication/');
});
it('writes a localized search corpus with translated text and source fallback while preserving legacy default assets', async () => {
  const index = createSearchIndex(built.site, 'en');
  expect(search(index, 'rocket')[0]).toMatchObject({
    title: 'Getting started',
    href: '/guides/introduction/',
  });
  expect(search(index, 'Zugang')[0]?.title).toBe('Authentifizierung');
  expect(search(createSearchIndex(built.site), 'rocket')).toEqual([]);
  const manifest = JSON.parse(
    await readFile(join(built.directory, 'search/en/catalog.json'), 'utf8'),
  );
  expect(manifest.shards).toEqual(['search/en/0.json']);
  const shard = JSON.parse(
    await readFile(join(built.directory, manifest.shards[0]), 'utf8'),
  );
  expect(
    shard.find((item: { id: string }) => item.id === 'introduction').title,
  ).toBe('Getting started');
  expect(
    await readFile(join(built.directory, 'search-manifest.json'), 'utf8'),
  ).toContain('search/0.json');
  expect(built.manifest.files).toHaveProperty('search/en/catalog.json');
  const server = await createStaticServer(built.directory);
  try {
    expect(
      (await server.inject('/localized/search/en/catalog.json')).statusCode,
    ).toBe(200);
    expect(
      (await server.inject('/localized/search/en/0.json')).statusCode,
    ).toBe(200);
  } finally {
    await server.close();
  }
  await verifyArtifact(built.directory);
});
it('rewrites relative translated guide links, validates translated anchors and detects untranslated-anchor mistakes', async () => {
  expect(built.site.guideTranslations?.en?.[0]?.links).toContainEqual({
    kind: 'link',
    url: '/localized/en/guides/authentication/',
  });
  expect(
    (await auditDocumentation(built.site)).filter((item) =>
      ['broken-link', 'broken-anchor'].includes(item.code),
    ),
  ).toEqual([]);
  const variant = built.site.guideTranslations!.en![0]!;
  const site = {
    ...built.site,
    guideTranslations: {
      en: [
        {
          ...variant,
          links: [
            { kind: 'link' as const, url: '#heading-launch-your-rocket' },
          ],
        },
      ],
    },
  };
  expect(
    (await auditDocumentation(site)).filter(
      (item) => item.code === 'broken-anchor',
    ),
  ).toEqual([]);
  const wrong = {
    ...site,
    guideTranslations: {
      en: [
        {
          ...variant,
          links: [{ kind: 'link' as const, url: '#heading-projekte-erkunden' }],
        },
      ],
    },
  };
  expect(
    (await auditDocumentation(wrong)).some(
      (item) => item.code === 'broken-anchor',
    ),
  ).toBe(true);
});
it('requires configured roots to exist and variant slugs to match default guides', async () => {
  await isolated(async (root) => {
    await rm(join(root, 'translations/en'), { recursive: true });
    await expect(compileProject(root)).rejects.toThrow();
  });
  await isolated(async (root) => {
    await rename(
      join(root, 'translations/en/introduction.md'),
      join(root, 'translations/en/unmatched.md'),
    );
    await expect(compileProject(root)).rejects.toThrow(/matching default/);
  });
});
it('retains symlink refusal and MDX opt-in for translated guides', async () => {
  await isolated(async (root) => {
    await symlink(
      join(root, 'guides/authentication.md'),
      join(root, 'translations/en/authentication.md'),
    );
    await expect(compileProject(root)).rejects.toThrow(/symlink/);
  });
  await isolated(async (root) => {
    await rename(
      join(root, 'translations/en/introduction.md'),
      join(root, 'translations/en/introduction.mdx'),
    );
    await expect(compileProject(root)).rejects.toThrow(/trust-content/);
    expect(
      (await compileProject(root, undefined, { trustContent: true }))
        .guideTranslations?.en?.[0]?.title,
    ).toBe('Getting started');
  });
});
it('shares finite source counters across default and translated directories', async () => {
  const budget = { entries: 0, bytes: 0, guides: 0 };
  await loadGuides(root, 'guides', { budget });
  const before = budget.bytes;
  await loadGuides(root, 'translations/en', { budget });
  expect(budget.guides).toBe(3);
  expect(budget.bytes).toBeGreaterThan(before);
  await expect(
    loadGuides(root, 'translations/en', {
      budget: { entries: 0, bytes: 64 * 1024 * 1024 - 1, guides: 0 },
    }),
  ).rejects.toThrow(/64 MiB/);
  await expect(
    loadGuides(root, 'translations/en', {
      budget: { entries: 0, bytes: 0, guides: 10000 },
    }),
  ).rejects.toThrow(/Guide count/);
  await expect(
    loadGuides(root, 'translations/en', {
      budget: { entries: 0, bytes: Number.NaN, guides: 0 },
    }),
  ).rejects.toThrow(/Invalid guide/);
});
it('rejects duplicate, undeclared, orphan and excessive graph-plugin variants', () => {
  const variant = built.site.guideTranslations!.en![0]!;
  for (const guideTranslations of [
    { en: [variant, variant] },
    { fr: [variant] },
    { en: [{ ...variant, slug: 'absent' }] },
    { en: [{ ...variant, sourceBytes: 64 * 1024 * 1024 }] },
  ])
    expect(() =>
      validateGuideTranslations({ ...built.site, guideTranslations }),
    ).toThrow();
});
it('sanitizes translated graph-plugin output through the same boundary as default guides', async () => {
  await isolated(async (root) => {
    const file = join(root, 'docs.config.yaml'),
      config = parse(await readFile(file, 'utf8'));
    config.plugins = ['translate.mjs'];
    await writeFile(file, stringify(config));
    await writeFile(
      join(root, 'translate.mjs'),
      `export default {name:'guide-translation',version:'1.0.0',pluginApi:'1',capabilities:['transform'],transform(site){site.guideTranslations.en[0].html='<h2>Plugin translation</h2><script>window.translationExecuted=true</script>';return site;}};`,
    );
    const site = await compileProject(root, undefined, { trustPlugins: true });
    expect(site.guideTranslations?.en?.[0]?.html).toContain(
      'Plugin translation',
    );
    expect(site.guideTranslations?.en?.[0]?.html).not.toContain('script');
    expect(site.guideTranslations?.en?.[0]?.text).not.toContain(
      'translationExecuted',
    );
  });
});
it('rebuilds translated projects completely after edits and preserves the prior artifact after a failed translation', async () => {
  await isolated(async (root) => {
    const builder = createDevelopmentBuilder(root);
    await builder.build();
    const file = join(root, 'translations/en/introduction.md');
    await writeFile(
      file,
      (await readFile(file, 'utf8')) + '\n\nAdditional authored translation.\n',
    );
    const changed = await builder.build(['translations/en/introduction.md']);
    expect(changed.mode).toBe('full');
    expect(
      await readFile(
        join(changed.directory, 'en/guides/introduction/index.html'),
        'utf8',
      ),
    ).toContain('Additional authored translation');
    const before = changed.manifest.artifactDigest;
    await writeFile(file, '---\ntitle: null\n---\nInvalid');
    await expect(
      builder.build(['translations/en/introduction.md']),
    ).rejects.toThrow(/frontmatter/);
    expect((await verifyArtifact(changed.directory)).artifactDigest).toBe(
      before,
    );
  });
});
