import { describe, expect, it } from 'vitest';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createPageData,
  lifecycleRoutes,
  operationHref,
  pageMetadata,
} from '@davidniessen/doctopus-contracts';
import {
  compileProject,
  verifyArtifact,
  auditDocumentation,
} from '@davidniessen/doctopus-compiler';
import { buildSite, createStaticServer } from '@davidniessen/doctopus-cli';
import { renderDocument } from '@davidniessen/doctopus-reader/render';

describe('static lifecycle reader data', () => {
  it('resolves replacements before navigation is bounded and preserves route data when rendering twice', async () => {
    const site = await compileProject(resolve('examples/lifecycle'));
    const api = site.apis[0]!;
    const operation = api.operations.find((item) => item.id === 'listWidgets')!;
    const path = operationHref(api, operation);
    const page = createPageData(site, path);
    expect(page.lifecycle?.current?.replacementHref).toBe(
      '/api/catalog/v2/listwidgets/',
    );
    expect(page.lifecycle?.current).not.toHaveProperty('status');
    expect(page.lifecycle?.current).not.toHaveProperty('daysUntilSunset');
    expect(createPageData(page, path)).toBe(page);
    const html = renderDocument(page, path);
    expect(html).toContain('/reference/api/catalog/v2/listwidgets/');
    expect(html).toContain(
      '/reference/guides/migration/#heading-update-your-client',
    );
    expect(html).toContain('Operation lifecycle');
    expect(html).toContain('2027-06-01');
  });
  it('paginates the complete inventory while keeping ordinary page payloads bounded', async () => {
    const site = await compileProject(resolve('examples/lifecycle'));
    const template = site.apis[0]!.operations[0]!;
    site.apis[0]!.operations = Array.from({ length: 10_000 }, (_, index) => ({
      ...template,
      id: `operation-${String(index).padStart(5, '0')}`,
      slug: `operation-${String(index).padStart(5, '0')}`,
      lifecycle: { sunsetOn: '2028-01-01' },
    }));
    const routes = lifecycleRoutes(site);
    expect(routes).toContain('/deprecations/page/201/');
    expect(routes).toContain('/deprecations/api/catalog/version/v1/page/200/');
    expect(routes).not.toContain(
      '/deprecations/api/catalog/version/v1/page/201/',
    );
    const page = createPageData(
      site,
      '/deprecations/api/catalog/version/v1/page/200/',
    );
    expect(page.lifecycle?.page).toMatchObject({
      total: 10_001,
      matched: 10_000,
      number: 200,
      pages: 200,
    });
    expect(page.lifecycle?.page?.entries).toHaveLength(50);
    expect(page.lifecycle?.page?.entries.at(-1)?.operationId).toBe(
      'operation-09999',
    );
    expect(page.lifecycle?.page?.next).toBeUndefined();
    expect(JSON.stringify(page).length).toBeLessThan(70_000);
    const guide = createPageData(site, '/guides/migration/');
    expect(guide.lifecycle).toEqual({ total: 10_001 });
    expect(JSON.stringify(guide).length).toBeLessThan(30_000);
  });
  it('renders a usable empty center and rejects nonexistent catalog pages', async () => {
    const site = await compileProject(resolve('examples/demo'));
    const empty = createPageData(site, '/deprecations/');
    expect(pageMetadata(site, '/deprecations/').title).toBe('Deprecations');
    expect(empty.lifecycle?.page).toMatchObject({
      total: 0,
      number: 1,
      pages: 1,
    });
    expect(renderDocument(empty, '/deprecations/')).toContain(
      'No deprecated operations',
    );
    const missing = createPageData(site, '/deprecations/page/2/');
    expect(missing.lifecycle?.page).toBeUndefined();
    expect(pageMetadata(missing, '/deprecations/page/2/').robots).toBe(
      'noindex,nofollow',
    );
  });
  it('exports verified routes, SEO and base-path-safe data, and preserves the previous artifact on redirect collision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doctopus-lifecycle-pages-'));
    try {
      await cp(resolve('examples/lifecycle'), root, {
        recursive: true,
        filter: (file) =>
          !file.includes('.doctopus') && !file.includes('.api-docs'),
      });
      const config = join(root, 'docs.config.yaml');
      await writeFile(
        config,
        (await readFile(config, 'utf8')) +
          '\nsiteUrl: https://docs.example.test\n',
      );
      const built = await buildSite(root);
      expect(built.manifest.routes).toContain('/deprecations/');
      expect(built.manifest.routes).toContain(
        '/deprecations/api/catalog/version/v2/',
      );
      expect(built.manifest.files).toHaveProperty(
        'deprecations/page-data.json',
      );
      const html = await readFile(
        join(built.directory, 'deprecations/index.html'),
        'utf8',
      );
      expect(html).toContain('<title>Deprecations ·');
      expect(html).toContain(
        'https://docs.example.test/reference/deprecations/',
      );
      expect(
        await readFile(join(built.directory, 'sitemap.xml'), 'utf8'),
      ).toContain('/reference/deprecations/');
      expect(
        (await auditDocumentation(built.site)).filter(
          (item) => item.code === 'broken-link',
        ),
      ).toEqual([]);
      const server = await createStaticServer(built.directory);
      try {
        const response = await server.inject(
          '/reference/deprecations/api/catalog/version/v2/page-data.json',
        );
        expect(response.statusCode).toBe(200);
        expect(response.json().lifecycle.page).toMatchObject({ matched: 1 });
        expect(
          (await server.inject('/reference/deprecations/page/99/')).statusCode,
        ).toBe(404);
      } finally {
        await server.close();
      }
      await writeFile(
        config,
        (await readFile(config, 'utf8')) + '\nredirects:\n  /deprecations: /\n',
      );
      await expect(buildSite(root)).rejects.toThrow(/Redirect overwrites/);
      expect((await verifyArtifact(built.directory)).artifactDigest).toBe(
        built.manifest.artifactDigest,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
