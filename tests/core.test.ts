import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadSpec,
  parseConfig,
  parseSource,
  confinedPath,
  exampleFor,
} from '@davidniessen/doctopus-spec';
import {
  prepareRequest,
  generateSnippet,
  redactRequest,
} from '@davidniessen/doctopus-explorer';
import { definePlugin, applyPlugins } from '@davidniessen/doctopus-plugin-sdk';
import type { Operation, SiteData } from '@davidniessen/doctopus-contracts';

const fixture = {
  openapi: '3.1.0',
  info: { title: 'Test API', version: 'v1' },
  servers: [{ url: 'https://api.example.com/v1' }],
  paths: {
    '/pets/{id}': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      get: {
        operationId: 'getPet',
        summary: 'Get a pet',
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Pet' },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Pet: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          parent: { $ref: '#/components/schemas/Pet' },
        },
      },
    },
  },
};
async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'doctopus-spec-'));
  await writeFile(join(root, 'openapi.json'), JSON.stringify(fixture));
  return root;
}
describe('spec compiler', () => {
  it('normalizes operations, inherited parameters, schemas and diagnostics', async () => {
    const api = await loadSpec(await project(), {
      id: 'pets',
      path: 'openapi.json',
    });
    expect(api.operations[0]).toMatchObject({
      method: 'get',
      path: '/pets/{id}',
      slug: 'getpet',
      parameters: [{ name: 'id', required: true }],
      servers: ['https://api.example.com/v1'],
    });
    expect(api.diagnostics).toHaveLength(1);
    expect(exampleFor(api.schemas.Pet!, api.schemas)).toMatchObject({
      name: 'string',
    });
  });
  it('bounds recursive schema examples', () => {
    const recursive: Record<string, unknown> = { type: 'object' };
    recursive.properties = { self: recursive };
    expect(exampleFor(recursive)).toEqual({ self: null });
  });
  it('rejects duplicate YAML keys and traversal', async () => {
    expect(() => parseSource('a: 1\na: 2', 'bad.yaml')).toThrow(/unique/i);
    const root = await project();
    await expect(confinedPath(root, '../')).rejects.toThrow(/escapes/);
    await symlink('/etc', join(root, 'outside'));
    await expect(confinedPath(root, 'outside/hosts')).rejects.toThrow(
      /escapes/,
    );
  });
  it('bundles local references and rejects external references', async () => {
    const root = await project();
    await mkdir(join(root, 'models'));
    await writeFile(
      join(root, 'models/pet.yaml'),
      'type: object\nproperties:\n  name:\n    type: string\n',
    );
    const spec = structuredClone(fixture);
    spec.components.schemas.Pet = { $ref: './models/pet.yaml' } as never;
    await writeFile(join(root, 'openapi.json'), JSON.stringify(spec));
    expect(
      (await loadSpec(root, { id: 'pets', path: 'openapi.json' })).schemas.Pet,
    ).toMatchObject({ type: 'object' });
    spec.components.schemas.Pet = {
      $ref: 'https://example.com/pet.json',
    } as never;
    await writeFile(join(root, 'openapi.json'), JSON.stringify(spec));
    await expect(
      loadSpec(root, { id: 'pets', path: 'openapi.json' }),
    ).rejects.toThrow();
  });
  it('validates theme, paths and configuration', () => {
    expect(
      parseConfig({
        name: 'Docs',
        specs: [{ id: 'api', path: 'openapi.yaml' }],
      }).theme.accent,
    ).toBe('#7c3aed');
    expect(() =>
      parseConfig({ name: 'Docs', specs: [{ id: '../api', path: 'x' }] }),
    ).toThrow();
    expect(() =>
      parseConfig({
        name: 'Docs',
        specs: [{ id: 'api', path: 'x' }],
        theme: { accent: 'javascript:alert(1)' },
      }),
    ).toThrow();
  });
});
describe('request serialization and snippets', () => {
  const operation: Operation = {
    id: 'test',
    slug: 'test',
    path: '/pets/{id}',
    method: 'get',
    summary: 'Test',
    description: '',
    tags: [],
    deprecated: false,
    security: [],
    servers: [],
    responses: [],
    source: '',
    parameters: [
      {
        name: 'id',
        in: 'path',
        required: true,
        description: '',
        schema: { type: 'string' },
      },
      {
        name: 'tags',
        in: 'query',
        required: false,
        description: '',
        schema: { type: 'array' },
      },
    ],
  };
  it('encodes path values, preserves base paths and explodes query arrays', () => {
    const request = prepareRequest(
      operation,
      {},
      {
        server: 'https://api.example.com/v1',
        parameters: { 'path:id': 'a/b', 'query:tags': '["cat","dog"]' },
      },
    );
    expect(request.url).toBe(
      'https://api.example.com/v1/pets/a%2Fb?tags=cat&tags=dog',
    );
  });
  it('requires fields and rejects unsafe servers', () => {
    expect(() =>
      prepareRequest(
        operation,
        {},
        { server: 'javascript:alert(1)', parameters: {} },
      ),
    ).toThrow();
    expect(() =>
      prepareRequest(
        operation,
        {},
        { server: 'https://example.com', parameters: {} },
      ),
    ).toThrow(/required/);
  });
  it('supports security alternatives and redacts credentials', () => {
    const secured = {
      ...operation,
      security: [{ bearer: [] }, { apiKey: [] }],
    };
    const request = prepareRequest(
      secured,
      {
        bearer: { type: 'http', scheme: 'bearer' },
        apiKey: { type: 'apiKey', in: 'query', name: 'key' },
      },
      {
        server: 'https://example.com',
        parameters: { 'path:id': '1' },
        credentials: { apiKey: 'secret!token' },
      },
    );
    expect(request.url).toContain('key=secret%21token');
    expect(
      JSON.stringify(redactRequest(request, { apiKey: 'secret!token' })),
    ).not.toContain('secret');
    for (const language of [
      'cURL',
      'JavaScript',
      'TypeScript',
      'Python',
      'Java',
    ] as const)
      expect(
        generateSnippet(
          redactRequest(request, { apiKey: 'secret!token' }),
          language,
        ),
      ).toContain('YOUR_CREDENTIAL');
  });
});
describe('plugins', () => {
  it('checks API versions and cancels an unresponsive hook', async () => {
    expect(() =>
      definePlugin({ name: 'bad', version: '1.0.0', pluginApi: '2' as '1' }),
    ).toThrow();
    const site = {
      schemaVersion: 1,
      apis: [],
      guides: [],
      diagnostics: [],
    } as unknown as SiteData;
    await expect(
      applyPlugins(
        site,
        [
          {
            name: 'slow',
            version: '1.0.0',
            pluginApi: '1',
            transform: () => new Promise(() => {}),
          },
        ],
        10,
      ),
    ).rejects.toThrow(/timed out/);
  });
});
