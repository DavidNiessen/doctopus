import { describe, expect, it } from 'vitest';
import type { Media } from '@davidniessen/doctopus-contracts';
import { compileProject } from '@davidniessen/doctopus-compiler';
import {
  createMultipartParts,
  multipartHeaderFields,
  redactRequest,
  toFetchRequest,
  prepareRequest,
} from '@davidniessen/doctopus-explorer';
import { resolve } from 'node:path';
import { multipartPartHeader } from '../packages/explorer/src/multipart.js';
import { normalizeSpec } from '../packages/spec/src/normalize.js';

const media: Media = {
  schema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      files: { type: 'array', items: { type: 'string', format: 'binary' } },
    },
  },
  encoding: {
    title: {
      headers: {
        'X-Tags': { schema: { type: 'array', items: { type: 'string' } } },
        'X-Meta': {
          content: { 'application/json': { schema: { type: 'object' } } },
        },
      },
    },
    files: {
      headers: {
        'X-Token': { required: true, schema: { type: 'string' } },
        'Content-Type': { required: true, schema: { type: 'string' } },
      },
    },
  },
};
const files = {
  files: [
    { filename: 'one.bin', data: new Blob([Uint8Array.from([0, 255])]) },
    { filename: 'two.bin', data: new Blob([]) },
  ],
};
describe('bounded multipart Header Objects', () => {
  it.each([
    ['3.0.3', 'Base description'],
    ['3.1.0', 'Reference description'],
  ])(
    'applies %s Header Reference Object siblings without schema overrides',
    (openapi, description) => {
      const reference = {
        $ref: '#/components/headers/Shared',
        description: 'Reference description',
        required: false,
        schema: { type: 'number' },
      };
      const result = normalizeSpec(
        {
          openapi,
          info: { title: 'Headers', version: 'v1' },
          components: {
            headers: {
              Shared: {
                description: 'Base description',
                required: true,
                schema: { type: 'string' },
              },
            },
          },
          paths: {
            '/': {
              post: {
                requestBody: {
                  content: {
                    'multipart/form-data': {
                      schema: { type: 'object' },
                      encoding: {
                        value: { headers: { 'X-Shared': reference } },
                      },
                    },
                  },
                },
                responses: {
                  200: {
                    description: 'OK',
                    headers: { 'X-Shared': reference },
                  },
                },
              },
            },
          },
        },
        { id: 'api', path: 'openapi.json' },
      );
      const operation = result.operations[0]!;
      expect(operation.responses[0]!.headers['X-Shared']).toMatchObject({
        description,
        required: true,
        schema: { type: 'string' },
      });
      const direct = multipartHeaderFields(
        {
          schema: {},
          encoding: { value: { headers: { 'X-Shared': reference } } },
        },
        {
          openapiVersion: openapi,
          schemas: {
            '#/components/headers/Shared': {
              description: 'Base description',
              required: true,
              schema: { type: 'string' },
            },
          },
        },
      );
      expect(direct[0]!.parameter).toMatchObject({
        description,
        required: true,
        schema: { type: 'string' },
      });
      const fields = multipartHeaderFields(
        operation.requestBody!.content['multipart/form-data']!,
      );
      expect(fields[0]!.parameter).toMatchObject({
        description,
        required: true,
        schema: { type: 'string' },
      });
    },
  );
  it('applies serialized header values to text and repeated file parts, preserving exact JSON tokens', async () => {
    const parts = createMultipartParts('{"title":"Visible"}', files, media, {
      partHeaders: {
        title: {
          'x-tags': '["a","b"]',
          'X-Meta': '{ "id": 9007199254740993 }',
        },
        files: {
          'x-token': 'private-token',
          'CONTENT-TYPE': 'ignored/injection\r\nX-Evil: ignored',
        },
      },
    });
    expect(parts[0]!.headers).toEqual({
      'X-Tags': 'a,b',
      'X-Meta': '{"id":9007199254740993}',
    });
    expect(
      parts
        .slice(1)
        .every((part) => part.headers?.['X-Token'] === 'private-token'),
    ).toBe(true);
    const request = {
      url: 'https://api.example.com',
      method: 'POST',
      headers: {},
      multipart: parts,
    };
    const init = toFetchRequest(request);
    const wire = await (init.body as Blob).text();
    expect(wire.match(/X-Token: private-token/g)).toHaveLength(2);
    expect(wire).not.toContain('X-Evil');
    const form = await new Response(init.body, {
      headers: init.headers,
    }).formData();
    expect(form.get('title')).toBe('Visible');
    expect(
      new Uint8Array(await (form.get('files') as File).arrayBuffer()),
    ).toEqual(Uint8Array.from([0, 255]));
    const safe = redactRequest(
      request,
      {},
      { schema: media.schema, schemas: {} },
    );
    expect(JSON.stringify(safe)).not.toContain('private-token');
    expect(safe.multipart![0]!.headers).toEqual({
      'X-Tags': 'YOUR_PART_HEADER',
      'X-Meta': 'YOUR_PART_HEADER',
    });
    expect(parts[1]!.headers!['X-Token']).toBe('private-token');
  });
  it('requires headers only for emitted parts and rejects undeclared, duplicate or invalid values', () => {
    expect(createMultipartParts('{"title":"x"}', {}, media)).toHaveLength(1);
    expect(() => createMultipartParts('{}', files, media)).toThrow(
      /Required multipart header/,
    );
    for (const headers of [
      { Unexpected: 'value' },
      { 'X-Token': 'a', 'x-token': 'b' },
      { 'X-Token': '\r\nX-Evil: v' },
      { 'X-Token': '🌍' },
      { 'X-Token': 'x'.repeat(8193) },
    ])
      expect(() =>
        createMultipartParts('{}', files, media, {
          partHeaders: { files: headers },
        }),
      ).toThrow();
  });
  it('supports simple object headers, own prototype names and declared Header Object references', () => {
    const selected: Media = {
      schema: media.schema,
      encoding: {
        title: {
          headers: Object.fromEntries([
            ['__proto__', { schema: { type: 'string' } }],
            ['X-Object', { $ref: '#/components/headers/Object' }],
          ]),
        },
      },
    };
    const options = {
      schemas: {
        '#/components/headers/Object': {
          style: 'simple',
          explode: true,
          schema: { type: 'object', additionalProperties: { type: 'string' } },
        },
      },
      partHeaders: {
        title: Object.fromEntries([
          ['__proto__', 'own-value'],
          ['X-Object', '{"name":"Ada","id":9007199254740993}'],
        ]),
      },
    };
    const parts = createMultipartParts('{"title":"v"}', {}, selected, options);
    expect(Object.hasOwn(parts[0]!.headers!, '__proto__')).toBe(true);
    expect(parts[0]!.headers!['X-Object']).toBe('name=Ada,id=9007199254740993');
  });
  it.each([
    'Content-Disposition',
    'Content-Length',
    'Transfer-Encoding',
    'Bad Name',
    'X\r\nEvil',
  ])('rejects encoder-owned or invalid header names (%s)', (name) => {
    expect(() =>
      multipartHeaderFields({
        schema: {},
        encoding: { title: { headers: { [name]: { schema: {} } } } },
      }),
    ).toThrow();
    expect(() =>
      multipartPartHeader({
        name: 'title',
        kind: 'text',
        value: 'x',
        contentType: 'text/plain',
        headers: { [name]: 'value' },
      }),
    ).toThrow();
  });
  it('bounds header counts and complete serialized bytes even for manually prepared parts', () => {
    const headers = Object.fromEntries(
      Array.from({ length: 17 }, (_, i) => [`X-${i}`, 'value']),
    );
    expect(() =>
      multipartPartHeader({
        name: 't',
        kind: 'text',
        value: 'x',
        contentType: 'text/plain',
        headers,
      }),
    ).toThrow(/16/);
    expect(() =>
      multipartPartHeader({
        name: 't',
        kind: 'text',
        value: 'x',
        contentType: 'text/plain',
        headers: { 'X-Large': 'x'.repeat(8192) },
      }),
    ).toThrow(/8192/);
    expect(() =>
      multipartPartHeader({
        name: 't',
        kind: 'text',
        value: 'x',
        contentType: 'text/plain',
        headers: { 'Content-Type': 'text/plain' },
      }),
    ).toThrow(/encoder-owned/);
  });
  it('rejects unresolved or unsupported header codecs without changing ordinary HTTP header policy', () => {
    for (const definition of [
      { $ref: '#/components/headers/Missing' },
      { style: 'form', schema: {} },
      { explode: 'true', schema: {} },
    ])
      expect(() =>
        multipartHeaderFields({
          schema: {},
          encoding: { title: { headers: { 'X-Part': definition } } },
        }),
      ).toThrow();
    expect(() =>
      prepareRequest(
        {
          id: 'x',
          slug: 'x',
          method: 'get',
          path: '/',
          summary: '',
          description: '',
          tags: [],
          deprecated: false,
          parameters: [],
          security: [],
          responses: [],
          servers: [],
          source: '',
        },
        {},
        {
          server: 'https://api.example.com',
          parameters: {},
          partHeaders: { title: { 'X-Part': 'value' } },
        },
      ),
    ).toThrow(/require multipart/);
  });
  it('normalizes real Header Object references before building the portable schema registry', async () => {
    const site = await compileProject(
      resolve('examples/components'),
      'docs.config.yaml',
      { trustContent: true },
    );
    const api = site.apis.find((api) => api.id === 'gallery')!;
    const operation = api.operations.find(
      (operation) => operation.id === 'uploadDocuments',
    )!;
    const selected = operation.requestBody!.content['multipart/form-data']!;
    const fields = multipartHeaderFields(selected, {
      schemas: api.schemas,
      openapiVersion: api.openapiVersion,
    });
    expect(fields.map((field) => field.parameter.name)).toEqual([
      'X-Upload-Token',
    ]);
    expect(fields[0]!.parameter).toMatchObject({
      required: true,
      schema: { writeOnly: true },
    });
    expect(Object.hasOwn(api.schemas, '#/components/headers/UploadToken')).toBe(
      false,
    );
  });
  it('bounds recursive Header Object content without disabling schema validation', () => {
    const part = {
      schema: { type: 'object' },
      encoding: {
        field: { headers: { 'X-Loop': { $ref: '#/components/headers/Loop' } } },
      },
    };
    expect(() =>
      normalizeSpec(
        {
          openapi: '3.1.0',
          info: { title: 'Loop', version: 'v1' },
          paths: {
            '/upload': {
              post: {
                responses: { 200: { description: 'OK' } },
                requestBody: { content: { 'multipart/form-data': part } },
              },
            },
          },
          components: {
            headers: { Loop: { content: { 'multipart/form-data': part } } },
          },
        },
        { id: 'api', path: 'openapi.json' },
      ),
    ).toThrow(/nesting/);
  });
});
