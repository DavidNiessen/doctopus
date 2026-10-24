import { expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSite } from '@davidniessen/doctopus-cli';
import { validateSiteData } from '@davidniessen/doctopus-plugin-sdk';
import {
  readOperationCatalog,
  readOperationRows,
  readExpandedOperation,
  referenceJson,
} from '../apps/reader/src/classic-reference-data.js';

const api = { id: 'large', version: 'v1' };
it('exports complete hashed endpoint pages beyond bounded sidebar navigation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'doctopus-classic-index-'));
  try {
    await mkdir(join(root, 'guides'));
    await writeFile(
      join(root, 'docs.config.yaml'),
      'name: Large reference\nspecs:\n  - id: large\n    path: openapi.json\n',
    );
    await writeFile(
      join(root, 'openapi.json'),
      JSON.stringify({
        openapi: '3.1.0',
        info: { title: 'Large API', version: 'v1' },
        paths: Object.fromEntries(
          Array.from({ length: 121 }, (_, index) => [
            `/item-${index}`,
            {
              get: {
                operationId: `item${index}`,
                summary: `Item ${index}`,
                tags: ['Items'],
                responses: { 200: { description: 'OK' } },
              },
            },
          ]),
        ),
      }),
    );
    const result = await buildSite(root);
    expect(result.site.apis[0]!.operationIndex).toBe(
      'api-index/0/catalog.json',
    );
    const output = join(root, '.doctopus/site');
    const exported = JSON.parse(
      await readFile(join(output, 'site.json'), 'utf8'),
    );
    expect(validateSiteData(exported).apis[0]!.operationIndex).toBe(
      'api-index/0/catalog.json',
    );
    for (const operationIndex of [
      'api-index/1/catalog.json',
      'api-index/00/catalog.json',
      'api-index/128/catalog.json',
      '../catalog.json',
      'https://catalog.example.test/catalog.json',
      0,
      null,
    ]) {
      const invalid = structuredClone(exported);
      invalid.apis[0].operationIndex = operationIndex;
      expect(() => validateSiteData(invalid)).toThrow('Invalid plugin output');
    }
    const catalog = readOperationCatalog(
      JSON.parse(
        await readFile(join(output, 'api-index/0/catalog.json'), 'utf8'),
      ),
      api,
    );
    expect(catalog).toMatchObject({ total: 121, pages: 2, pageSize: 100 });
    const first = readOperationRows(
      JSON.parse(await readFile(join(output, 'api-index/0/0.json'), 'utf8')),
      api,
      0,
      catalog,
    );
    const second = readOperationRows(
      JSON.parse(await readFile(join(output, 'api-index/0/1.json'), 'utf8')),
      api,
      1,
      catalog,
    );
    expect(first).toHaveLength(100);
    expect(second).toHaveLength(21);
    expect(new Set([...first, ...second].map((row) => row.slug)).size).toBe(
      121,
    );
    expect(result.manifest.files).toHaveProperty('api-index/0/catalog.json');
    expect(result.manifest.files).toHaveProperty('api-index/0/1.json');
    const page = JSON.parse(
      await readFile(
        join(output, 'api/large/v1/item120/page-data.json'),
        'utf8',
      ),
    );
    expect(page.apis[0].operations.length).toBeLessThan(121);
    expect(page.apis[0].operationIndex).toBe('api-index/0/catalog.json');
    expect(
      readExpandedOperation(page, api, 'item120', '').operation.parameters,
    ).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it.each([
  {
    schemaVersion: 1,
    apiId: 'other',
    version: 'v1',
    total: 1,
    pages: 1,
    pageSize: 100,
  },
  {
    schemaVersion: 1,
    apiId: 'large',
    version: 'v1',
    total: 101,
    pages: 1,
    pageSize: 100,
  },
  {
    schemaVersion: 1,
    apiId: 'large',
    version: 'v1',
    total: 1,
    pages: 1,
    pageSize: 1,
  },
  {
    schemaVersion: 1,
    apiId: 'large',
    version: 'v1',
    total: 1e9,
    pages: 1e7,
    pageSize: 100,
  },
])('rejects mismatched or invalid catalog bounds', (value) =>
  expect(() => readOperationCatalog(value, api)).toThrow(),
);
it('refuses duplicate or invalid row identities and cross-site endpoint payloads', () => {
  const catalog = readOperationCatalog(
    {
      schemaVersion: 1,
      apiId: 'large',
      version: 'v1',
      total: 2,
      pages: 1,
      pageSize: 100,
    },
    api,
  );
  const row = {
    slug: 'item1',
    method: 'get',
    path: '/item',
    summary: 'Item',
    tag: 'Items',
    deprecated: false,
  };
  const data = {
    schemaVersion: 1,
    apiId: 'large',
    version: 'v1',
    page: 0,
    operations: [row, row],
  };
  expect(() => readOperationRows(data, api, 0, catalog)).toThrow();
  expect(() =>
    readOperationRows(
      { ...data, operations: [row, { ...row, slug: '../escape' }] },
      api,
      0,
      catalog,
    ),
  ).toThrow();
  expect(() =>
    readOperationRows({ ...data, operations: [row] }, api, 0, catalog),
  ).toThrow();
  expect(() =>
    readExpandedOperation(
      { schemaVersion: 1, config: { basePath: '/other' }, apis: [] },
      api,
      'item1',
      '',
    ),
  ).toThrow();
  expect(() =>
    readExpandedOperation(
      {
        schemaVersion: 1,
        config: { basePath: '' },
        apis: [
          {
            ...api,
            schemas: {},
            securitySchemes: {},
            operations: [{ slug: 'item1', source: '' }],
          },
        ],
      },
      api,
      'item1',
      '',
    ),
  ).toThrow();
});
it('enforces streamed byte budgets and cancellation before parsing endpoint data', async () => {
  const source = URL.createObjectURL(
    new Blob(['{"large":"' + 'x'.repeat(1000) + '"}'], {
      type: 'application/json',
    }),
  );
  try {
    await expect(
      referenceJson(source, new AbortController().signal, 64),
    ).rejects.toThrow('byte budget');
    const controller = new AbortController();
    controller.abort();
    await expect(
      referenceJson(source, controller.signal, 2000),
    ).rejects.toThrow();
  } finally {
    URL.revokeObjectURL(source);
  }
});
