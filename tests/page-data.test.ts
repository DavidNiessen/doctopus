import { renderDocument } from '@davidniessen/doctopus-reader/render';
import { expect, it } from 'vitest';
import {
  createPageData,
  createPageDataFactory,
  normalizePagePath,
  operationHref,
  localizePath,
} from '@davidniessen/doctopus-contracts';
import type { SiteData } from '@davidniessen/doctopus-contracts';
import { compileProject } from '@davidniessen/doctopus-compiler';
import { resolve } from 'node:path';
it('bounds navigation and sends only the active operation and reachable schemas', async () => {
  const site = await compileProject(resolve('examples/demo'));
  const api = site.apis[0]!;
  const template = api.operations[0]!;
  api.operations = Array.from({ length: 10_000 }, (_, index) => ({
    ...template,
    id: `operation-${index}`,
    slug: `operation-${index}`,
    description: 'Private route-specific detail '.repeat(10),
    responses: [
      {
        status: '200',
        description: 'OK',
        headers: {},
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Project' },
          },
        },
      },
    ],
  }));
  api.schemas.Unrelated = {
    type: 'object',
    description: 'Do not send this schema to unrelated routes',
  };
  const page: SiteData = createPageData(site, '/api/orbit/v1/operation-9999/');
  expect(page.apis[0]!.operations.length).toBeLessThanOrEqual(21);
  expect(
    page.apis[0]!.operations.find(
      (operation) => operation.id === 'operation-9999',
    )?.description,
  ).toBe('Private route-specific detail '.repeat(10));
  expect(page.apis[0]!.schemas).toHaveProperty('Project');
  expect(page.apis[0]!.schemas).not.toHaveProperty('Unrelated');
  expect(JSON.stringify(page).length).toBeLessThan(50_000);
  expect(normalizePagePath('/docs/index.html')).toBe('/docs/');
});

it('HTML-safe bootstrap data round-trips markup without changing its content', async () => {
  const site = await compileProject(resolve('examples/demo'));
  site.config.description = '</script><script>alert(1)</script>';
  const document = renderDocument(site, '/');
  const json = /id="docs-data">([\s\S]*?)<\/script>/.exec(document)?.[1];
  expect(json).toBeDefined();
  expect(json).not.toContain('<');
  const parsed = JSON.parse(json!) as SiteData;
  expect(parsed.config.description).toBe(site.config.description);
  expect(parsed.guides[0]!.html).toBe(site.guides[0]!.html);
});

it('indexed rendering preserves localized route data and HTML beyond the navigation window and API limit', async () => {
  const site = await compileProject(resolve('examples/localized'));
  const api = site.apis[0]!;
  site.apis = Array.from({ length: 18 }, (_, index) => ({
    ...api,
    version: `v${index + 1}`,
    operations: Array.from({ length: 240 }, (_, position) => ({
      ...api.operations[0]!,
      id: `operation-${position}`,
      slug: `operation-${position}`,
    })),
  }));
  const last = site.apis.at(-1)!;
  const path = operationHref(last, last.operations.at(-1)!);
  const snapshot = JSON.stringify(site);
  const indexed = createPageDataFactory(site);
  for (const route of [
    '/',
    '/guides/introduction/',
    '/not-found/',
    '/deprecations/',
    path,
    path + 'index.html',
    localizePath(site.config, path, 'en'),
  ]) {
    const expected = createPageData(site, route);
    expect(indexed(route)).toEqual(expected);
    expect(renderDocument(indexed(route), route)).toBe(
      renderDocument(expected, route),
    );
  }
  expect(JSON.stringify(site)).toBe(snapshot);
  const page = indexed(path);
  expect(page.apis).toHaveLength(17);
  expect(page.apis.at(-1)!.operations.at(-1)!.id).toBe('operation-239');
  expect(indexed(page.pagePath!)).toEqual(page);
  const apiOnly = { ...site, guides: [] };
  expect(createPageDataFactory(apiOnly)('/')).toEqual(
    createPageData(apiOnly, '/'),
  );
});

it('route indexes belong to their graph and preserve first-match behavior without changing direct projections', async () => {
  const site = await compileProject(resolve('examples/demo'));
  const first = site.apis[0]!.operations[0]!;
  const path = operationHref(site.apis[0]!, first);
  const duplicate = { ...first, description: 'Duplicate must not win' };
  site.apis[0]!.operations.push(duplicate);
  const indexed = createPageDataFactory(site);
  expect(indexed(path)).toEqual(createPageData(site, path));
  expect(indexed(path).apis[0]!.operations[0]!.description).toBe(
    first.description,
  );
  const next = {
    ...site,
    apis: [{ ...site.apis[0]!, operations: [duplicate] }],
  };
  expect(createPageDataFactory(next)(path)).toEqual(createPageData(next, path));
  expect(
    createPageDataFactory(next)(path).apis[0]!.operations[0]!.description,
  ).toBe(duplicate.description);
  expect(indexed(path).apis[0]!.operations[0]!.description).toBe(
    first.description,
  );
  next.apis[0]!.operations = [first];
  expect(createPageData(next, path).apis[0]!.operations[0]!.description).toBe(
    first.description,
  );
});

it('indexed navigation preserves tag quotas, source order and repeated active identities without full graph scans per page', async () => {
  const site = await compileProject(resolve('examples/demo'));
  const api = site.apis[0]!;
  const template = api.operations[0]!;
  const operations = Array.from({ length: 10_000 }, (_, index) => ({
    ...template,
    id: `entry-${index}`,
    slug: `entry-${index}`,
    tags: index < 30 ? ['First'] : index < 70 ? [] : [`Group ${index % 4}`],
    description: `Only entry ${index} has this description`,
  }));
  operations.push(operations[20]!);
  api.operations = operations;
  const indexed = createPageDataFactory(site);
  for (const position of [0, 19, 20, 29, 30, 69, 70, 199, 200, 9999]) {
    const path = operationHref(api, operations[position]!);
    expect(indexed(path)).toEqual(createPageData(site, path));
  }
  const path = operationHref(api, operations[9999]!);
  const page = indexed(path);
  const preview = page.apis[0]!.operations[0]!;
  expect(preview.description).toBe('');
  preview.description = 'A caller changed its own page projection';
  expect(indexed(path).apis[0]!.operations[0]!.description).toBe('');

  let reads = 0;
  api.operations = new Proxy(operations, {
    get(target, property, receiver) {
      if (typeof property === 'string' && /^\d+$/.test(property)) reads++;
      return Reflect.get(target, property, receiver);
    },
  });
  const bounded = createPageDataFactory(site);
  bounded('/');
  reads = 0;
  for (let index = 0; index < 10; index++)
    bounded(operationHref(api, operations[9999 - index]!));
  expect(reads).toBeLessThan(2500);
});
