import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import {
  loadSpec,
  readTextFile,
  parseConfig,
} from '@davidniessen/doctopus-spec';
import {
  createPageData,
  exampleFor,
  operationHref,
  resolveSchema,
} from '@davidniessen/doctopus-contracts';
import { prepareRequest } from '@davidniessen/doctopus-explorer';
import { renderDocument } from '@davidniessen/doctopus-reader/render';

const response = { description: 'Accepted' };
function fixture(version = '3.1.0'): Record<string, unknown> {
  return {
    openapi: version,
    info: { title: 'Compatibility', version: 'v1' },
    paths: {
      '/events/{id}': {
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        get: {
          operationId: 'getEvent',
          description: 'Read an event.',
          responses: { 200: response },
        },
      },
    },
  };
}
async function load(spec: Record<string, unknown>, yaml = false) {
  const root = await mkdtemp(join(tmpdir(), 'doctopus-compatibility-'));
  try {
    const path = yaml ? 'openapi.yaml' : 'openapi.json';
    await writeFile(
      join(root, path),
      yaml ? stringify(spec) : JSON.stringify(spec),
    );
    return await loadSpec(root, { id: 'events', path });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
function get(spec: Record<string, unknown>): Record<string, unknown> {
  return (spec.paths as Record<string, Record<string, unknown>>)[
    '/events/{id}'
  ]!.get as Record<string, unknown>;
}
describe('OpenAPI compatibility and semantic validation', () => {
  it.each(['3.0.4', '3.1.0', '3.1.2'])(
    'accepts supported %s documents with YAML/JSON parity',
    async (version) => {
      const json = await load(fixture(version));
      const yaml = await load(fixture(version), true);
      expect(yaml.operations.map((op) => ({ ...op, source: '' }))).toEqual(
        json.operations.map((op) => ({ ...op, source: '' })),
      );
    },
  );
  it.each([
    [
      'invalid response',
      (spec: Record<string, unknown>) => {
        get(spec).responses = { invalid: {} };
      },
    ],
    [
      'invalid JSON Schema',
      (spec: Record<string, unknown>) => {
        spec.components = { schemas: { Invalid: { type: 42, minLength: -1 } } };
      },
    ],
    [
      'unknown security scheme',
      (spec: Record<string, unknown>) => {
        get(spec).security = [{ missing: [] }];
      },
    ],
    [
      'missing path parameter',
      (spec: Record<string, unknown>) => {
        (spec.paths as Record<string, Record<string, unknown>>)[
          '/events/{id}'
        ]!.parameters = [];
      },
    ],
    [
      'optional path parameter',
      (spec: Record<string, unknown>) => {
        (spec.paths as Record<string, Record<string, unknown>>)[
          '/events/{id}'
        ]!.parameters = [
          {
            name: 'id',
            in: 'path',
            required: false,
            schema: { type: 'string' },
          },
        ];
      },
    ],
    [
      'duplicate operation id',
      (spec: Record<string, unknown>) => {
        (spec.paths as Record<string, unknown>)['/other'] = { get: get(spec) };
      },
    ],
    [
      'ambiguous path templates',
      (spec: Record<string, unknown>) => {
        (spec.paths as Record<string, unknown>)['/events/{other}'] = {
          get: { responses: { 200: response } },
        };
      },
    ],
    [
      'duplicate parameters',
      (spec: Record<string, unknown>) => {
        get(spec).parameters = Array(2).fill({
          name: 'filter',
          in: 'query',
          schema: { type: 'string' },
        });
      },
    ],
  ])(
    'rejects %s instead of rendering a plausible but incorrect page',
    async (_name, mutate) => {
      const spec = fixture();
      mutate(spec);
      await expect(load(spec)).rejects.toThrow();
    },
  );
  it('accepts omitted responses in 3.1 with an actionable warning and rejects them in 3.0', async () => {
    const modern = fixture();
    delete get(modern).responses;
    expect((await load(modern)).diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'operation-responses',
        severity: 'warning',
      }),
    );
    const legacy = fixture('3.0.4');
    delete get(legacy).responses;
    await expect(load(legacy)).rejects.toThrow(/responses/);
  });
  it('resolves alias chains, nested pointers, schema siblings and cycles without expanding output', async () => {
    const spec = fixture();
    spec.components = {
      schemas: {
        Envelope: {
          type: 'object',
          properties: {
            event: {
              type: 'object',
              properties: {
                kind: { const: 'created' },
                recursive: { $ref: '#/components/schemas/Alias' },
              },
            },
          },
        },
        Alias: { $ref: '#/components/schemas/Envelope/properties/event' },
        Impossible: false,
      },
    };
    get(spec).responses = {
      200: {
        description: 'Event',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Alias',
              description: 'An event payload',
            },
          },
        },
      },
    };
    const api = await load(spec);
    const media = api.operations[0]!.responses[0]!.content['application/json']!;
    expect(resolveSchema(media.schema, api.schemas)).toMatchObject({
      type: 'object',
      description: 'An event payload',
    });
    expect(exampleFor(media.schema, api.schemas)).toMatchObject({
      kind: 'created',
    });
    expect(exampleFor(api.schemas.Impossible!, api.schemas)).toBeNull();
    const site = {
      schemaVersion: 1 as const,
      config: parseConfig({
        name: 'Docs',
        specs: [{ id: 'events', path: 'openapi.json' }],
      }),
      apis: [api],
      guides: [],
      diagnostics: [],
    };
    const page = createPageData(site, operationHref(api, api.operations[0]!));
    expect(page.apis[0]!.schemas).toHaveProperty(
      '#/components/schemas/Envelope/properties/event',
    );
    expect(JSON.stringify(page).length).toBeLessThan(20000);
  });
  it('keeps validation siblings as an intersection rather than overwriting referenced constraints', () => {
    const target = {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string' } },
    };
    const sibling = {
      required: ['name'],
      properties: { name: { type: 'string' } },
    };
    const resolved = resolveSchema(
      { $ref: '#/components/schemas/Model', ...sibling },
      { Model: target },
    );
    expect(resolved.allOf).toEqual([target, sibling]);
  });
  it('renders webhook and callback payloads while rejecting outbound execution', async () => {
    const spec = fixture();
    const incoming = {
      operationId: 'eventDelivered',
      summary: 'Event delivered',
      description: 'Receive an event.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: { event: { const: 'created' } },
            },
          },
        },
      },
      responses: { 202: response },
    };
    spec.webhooks = { eventCreated: { post: incoming } };
    get(spec).callbacks = {
      onEvent: {
        '{$request.query.callbackUrl}': {
          post: { ...incoming, operationId: 'callbackDelivered' },
        },
      },
    };
    const api = await load(spec);
    expect(api.operations.map((op) => op.kind)).toEqual([
      'endpoint',
      'callback',
      'webhook',
    ]);
    for (const op of api.operations.filter((op) => op.kind !== 'endpoint')) {
      expect(() =>
        prepareRequest(
          op,
          {},
          { server: 'https://api.example.com', parameters: {} },
        ),
      ).toThrow(/inbound events/);
      const html = renderDocument(
        {
          schemaVersion: 1,
          config: parseConfig({
            name: 'Docs',
            specs: [{ id: 'events', path: 'openapi.json' }],
          }),
          apis: [api],
          guides: [],
          diagnostics: [],
        },
        operationHref(api, op),
      );
      expect(html).toContain('Incoming payload');
      expect(html).toContain('your application receives this request');
      expect(html).not.toContain('Send request');
    }
    expect(api.operations[1]!.callback).toMatchObject({
      operationId: 'getEvent',
      name: 'onEvent',
      expression: '{$request.query.callbackUrl}',
    });
  });
  it('bounds file reads and rejects malformed UTF-8 before parsing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doctopus-bounded-read-'));
    try {
      const file = join(root, 'input');
      await writeFile(file, '123456789');
      await expect(readTextFile(file, 8)).rejects.toThrow(/exceeds/);
      await writeFile(file, Buffer.from([0xff, 0xfe]));
      await expect(readTextFile(file)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
