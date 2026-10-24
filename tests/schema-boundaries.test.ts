import { expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { loadSpec } from '@davidniessen/doctopus-spec';
import type { Schema } from '@davidniessen/doctopus-contracts';
import { validateSchemaBoundaries } from '../packages/spec/src/schema-boundaries.js';

async function load(
  schema: Schema,
  mutate?: (document: Record<string, unknown>) => void,
  yaml = false,
) {
  const root = await mkdtemp(join(tmpdir(), 'doctopus-schema-boundaries-'));
  try {
    const document: Record<string, unknown> = {
      openapi: '3.1.0',
      info: { title: 'Schema scopes', version: 'v1' },
      paths: {
        '/values': {
          post: {
            operationId: 'writeValues',
            description: 'Inspect values.',
            responses: {
              '200': {
                description: 'OK',
                content: { 'application/json': { schema } },
              },
            },
          },
        },
      },
    };
    mutate?.(document);
    const path = yaml ? 'openapi.yaml' : 'openapi.json';
    await writeFile(
      join(root, path),
      yaml ? stringify(document) : JSON.stringify(document),
    );
    return await loadSpec(root, { id: 'api', path });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
function operation(document: Record<string, unknown>) {
  return (
    document.paths as Record<string, Record<string, Record<string, unknown>>>
  )['/values']!.post!;
}
const unknownDialect = {
  $schema: 'https://private.invalid/custom-vocabulary',
  type: 'string',
};

it.each([
  ['$id', 'https://private.invalid/rebased-schema'],
  ['$anchor', 'node'],
  ['$dynamicRef', '#node'],
  ['$dynamicAnchor', 'node'],
  ['$recursiveRef', '#'],
  ['$recursiveAnchor', true],
])(
  'rejects unsupported schema scope keyword %s in YAML and JSON without reflecting its value',
  async (keyword, value) => {
    for (const yaml of [false, true]) {
      const result = load(
        { type: 'object', [keyword as string]: value },
        undefined,
        yaml,
      );
      await expect(result).rejects.toThrow(
        `unsupported JSON Schema keyword ${keyword}`,
      );
      await expect(result).rejects.not.toThrow('https://private.invalid');
    }
  },
);

it.each([
  'properties',
  'patternProperties',
  '$defs',
  'definitions',
  'dependentSchemas',
])('rejects nested custom dialects in the %s schema map', async (keyword) => {
  await expect(
    load({ type: 'object', [keyword]: { 'child/name': unknownDialect } }),
  ).rejects.toThrow(/unsupported JSON Schema dialect/);
});
it.each(['allOf', 'oneOf', 'anyOf', 'prefixItems'])(
  'rejects nested custom dialects in %s branches',
  async (keyword) => {
    await expect(load({ [keyword]: [unknownDialect] })).rejects.toThrow(
      /unsupported JSON Schema dialect/,
    );
  },
);
it.each([
  'items',
  'contains',
  'additionalProperties',
  'unevaluatedProperties',
  'unevaluatedItems',
  'propertyNames',
  'not',
  'if',
  'then',
  'else',
  'contentSchema',
])(
  'rejects nested custom dialects at the %s schema position',
  async (keyword) => {
    await expect(load({ [keyword]: unknownDialect })).rejects.toThrow(
      /unsupported JSON Schema dialect/,
    );
  },
);

it('checks parameter content and response Header Object content schemas', async () => {
  await expect(
    load({}, (document) => {
      operation(document).parameters = [
        {
          name: 'filter',
          in: 'query',
          content: {
            'application/json': {
              schema: { properties: { nested: unknownDialect } },
            },
          },
        },
      ];
    }),
  ).rejects.toThrow(/unsupported JSON Schema dialect/);
  await expect(
    load({}, (document) => {
      const responses = operation(document).responses as Record<
        string,
        Record<string, unknown>
      >;
      responses['200']!.headers = {
        'X-Meta': {
          content: {
            'application/json': {
              schema: { properties: { nested: unknownDialect } },
            },
          },
        },
      };
    }),
  ).rejects.toThrow(/unsupported JSON Schema dialect/);
});
it('checks multipart encoding headers and unused reusable component schemas', async () => {
  await expect(
    load({}, (document) => {
      operation(document).requestBody = {
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              properties: { payload: { type: 'string' } },
            },
            encoding: {
              payload: {
                headers: { 'X-Meta': { schema: { $dynamicRef: '#node' } } },
              },
            },
          },
        },
      };
    }),
  ).rejects.toThrow(/unsupported JSON Schema keyword \$dynamicRef/);
  await expect(
    load({}, (document) => {
      document.components = {
        schemas: {
          Unused: { $id: 'https://private.invalid/scope', type: 'object' },
        },
      };
    }),
  ).rejects.toThrow(/unsupported JSON Schema keyword \$id/);
});
it('preserves supported nested dialect declarations and reference-like literal data', async () => {
  const example = {
    $id: 'literal identity',
    $schema: 'literal dialect',
    $dynamicRef: '#literal',
  };
  const schema = {
    type: 'object',
    properties: {
      $id: { type: 'string' },
      $schema: { type: 'string' },
      nested: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'boolean',
      },
    },
    example,
    default: example,
    enum: [example],
    'x-payload': example,
  };
  const api = await load(schema);
  const result =
    api.operations[0]!.responses[0]!.content['application/json']!.schema;
  expect(result.example).toEqual(example);
  expect(result.properties).toEqual(schema.properties);
  expect(result.default).toEqual(example);
});
it('terminates on shared or cyclic schema objects without changing caller-owned data', () => {
  const schema: Schema = { type: 'object', properties: {} };
  (schema.properties as Record<string, unknown>).next = schema;
  validateSchemaBoundaries(
    [
      ['root', schema],
      ['alias', schema],
    ],
    new Set(['https://json-schema.org/draft/2020-12/schema']),
    'fixture.json',
  );
  expect((schema.properties as Record<string, unknown>).next).toBe(schema);
});
