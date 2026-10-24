import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify } from 'yaml';
import {
  compileProject,
  auditDocumentation,
} from '@davidniessen/doctopus-compiler';
import { parseConfig } from '@davidniessen/doctopus-spec';
import { createPageData } from '@davidniessen/doctopus-contracts';

async function project(
  run: (root: string) => Promise<void>,
  intro = '# Intro\n\n## Setup\n\n[Next](next.md#heading-next)\n\n![Pixel](/media/pixel.png)\n',
) {
  const root = await mkdtemp(join(tmpdir(), 'doctopus-doctor-'));
  try {
    await mkdir(join(root, 'guides'));
    await mkdir(join(root, 'public'));
    await writeFile(join(root, 'guides/intro.md'), intro);
    await writeFile(
      join(root, 'guides/next.md'),
      '# Next\n\n[Back](intro.md#heading-intro)',
    );
    await writeFile(
      join(root, 'public/pixel.png'),
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
        'base64',
      ),
    );
    await writeFile(
      join(root, 'docs.config.yaml'),
      stringify({
        name: 'Doctor',
        basePath: '/docs',
        specs: [{ id: 'health', path: 'openapi.json' }],
      }),
    );
    await writeFile(
      join(root, 'openapi.json'),
      JSON.stringify({
        openapi: '3.1.0',
        info: { title: 'Health', version: 'v1' },
        paths: {
          '/health': {
            get: {
              operationId: 'health',
              description: 'Check health.',
              tags: ['Health'],
              responses: {
                200: {
                  description: 'Healthy',
                  content: {
                    'application/json': {
                      schema: { type: 'string' },
                      example: 'ok',
                    },
                  },
                },
                default: { description: 'Unavailable' },
              },
            },
          },
        },
      }),
    );
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
describe('offline publication links and quality policy', () => {
  it('rewrites relative Markdown links and root asset URLs for a subpath, preserving fragments', async () => {
    await project(async (root) => {
      const site = await compileProject(root);
      expect(site.guides[0]!.html).toContain(
        'href="/docs/guides/next/#heading-next"',
      );
      expect(site.guides[0]!.html).toContain('data-doc-route');
      expect(site.guides[0]!.html).toContain('src="/docs/media/pixel.png"');
      expect(await auditDocumentation(site)).toEqual([]);
      const page = createPageData(site, '/api/health/v1/health/');
      expect(
        page.guides.every(
          (guide) => guide.links?.length === 0 && guide.anchors?.length === 0,
        ),
      ).toBe(true);
    });
  });
  it('checks nested filenames, query strings, index routes, root aliases and redirect fragments', async () => {
    await project(async (root) => {
      await mkdir(join(root, 'guides/nested'));
      await writeFile(
        join(root, 'guides/nested/Details_Page.md'),
        '# Details\n\n[Intro](../intro.md?view=all#heading-setup)',
      );
      await writeFile(
        join(root, 'guides/intro.md'),
        '# Intro\n\n## Setup\n\n[Details](nested/Details_Page.md#heading-details)\n\n[Root](/#heading-setup)\n\n[Alias](/old#heading-setup)\n\n[Next](/guides/next/index.html#heading-next)',
      );
      const site = await compileProject(root);
      // Pin root alias explicitly rather than depending on alphabetical title order.
      site.guides.sort((a, b) =>
        a.slug === 'intro' ? -1 : b.slug === 'intro' ? 1 : 0,
      );
      site.config.redirects = { '/old': '/guides/intro/' };
      expect(
        site.guides.find((g) => g.slug === 'nested/details-page')!.html,
      ).toContain('/docs/guides/intro/?view=all#heading-setup');
      expect(await auditDocumentation(site)).toEqual([]);
    });
  });
  it('reports broken routes/images/anchors with precise source indices, without URL query values', async () => {
    await project(async (root) => {
      const site = await compileProject(root);
      const result = await auditDocumentation(site);
      expect(result.filter((d) => d.code === 'broken-link')).toHaveLength(3);
      expect(result.filter((d) => d.code === 'broken-anchor')).toHaveLength(1);
      expect(
        result.every((d) => d.source?.startsWith('guides/intro.md#links/')),
      ).toBe(true);
      expect(JSON.stringify(result)).not.toContain('sensitive-query-marker');
    }, '# Intro\n\n[Missing](absent.md?token=sensitive-query-marker)\n\n[Fragment](next.md#missing)\n\n![Missing image](/media/absent.png)\n\n![HTML image](next.md)');
  });
  it('keeps external and browser text fragments offline and flags malformed local percent encoding', async () => {
    await project(async (root) => {
      const site = await compileProject(root);
      expect(await auditDocumentation(site)).toEqual([]);
      site.guides[0]!.links!.push({ kind: 'link', url: '/docs/%ZZ' });
      expect(await auditDocumentation(site)).toContainEqual(
        expect.objectContaining({ code: 'invalid-link', severity: 'error' }),
      );
    }, '# Intro\n\n[External](https://never-fetch.example.invalid/anything)\n\n[Mail](mailto:help@example.test)\n\n[Text](#:~:text=Intro)\n\n[Top](#top)');
  });
  it('applies exact-source suppressions with reasons, severity overrides and stale-policy diagnostics', async () => {
    await project(async (root) => {
      const site = await compileProject(root);
      const finding = (await auditDocumentation(site))[0]!;
      site.config.doctor = {
        rules: {},
        suppressions: [
          {
            code: finding.code,
            source: finding.source!,
            reason: 'The page is supplied by our authenticated portal gateway.',
          },
        ],
      };
      expect(await auditDocumentation(site)).toEqual([]);
      site.config.doctor.suppressions[0]!.source = 'guides/absent.md';
      const stale = await auditDocumentation(site);
      expect(stale).toContainEqual(
        expect.objectContaining({ code: 'doctor-unused-suppression' }),
      );
      site.config.doctor = {
        rules: { 'broken-link': 'warning', 'made-up-rule': 'off' },
        suppressions: [],
      };
      expect(await auditDocumentation(site)).toContainEqual(
        expect.objectContaining({ code: 'broken-link', severity: 'warning' }),
      );
      expect(await auditDocumentation(site)).toContainEqual(
        expect.objectContaining({ code: 'doctor-unknown-rule' }),
      );
      expect(() =>
        parseConfig({
          ...site.config,
          doctor: {
            rules: {},
            suppressions: [{ code: finding.code, source: '*', reason: '' }],
          },
        }),
      ).toThrow();
    }, '# Intro\n\n[Portal](/portal/)');
  });
  it('checks redirects and reports documentation coverage independently from structural correctness', async () => {
    await project(async (root) => {
      const site = await compileProject(root),
        op = site.apis[0]!.operations[0]!;
      site.config.redirects = {
        '/guides/intro/': '/guides/next/',
        '/dead': '/missing/',
      };
      op.tags = [];
      op.responses = op.responses.filter(
        (response) => response.status === '200',
      );
      delete op.responses[0]!.content['application/json']!.example;
      op.security = [{}, { key: [] }];
      site.apis[0]!.securitySchemes.key = {
        type: 'apiKey',
        in: 'header',
        name: 'X-Key',
      };
      expect((await auditDocumentation(site)).map((d) => d.code)).toEqual(
        expect.arrayContaining([
          'redirect-collision',
          'redirect-target',
          'operation-tags',
          'operation-error-response',
          'operation-example',
          'operation-anonymous',
        ]),
      );
    });
  });
});
