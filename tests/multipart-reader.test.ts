import { describe, expect, it } from 'vitest';
import { compileProject } from '@davidniessen/doctopus-compiler';
import { renderDocument } from '@davidniessen/doctopus-reader/render';
import { operationHref } from '@davidniessen/doctopus-contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Explorer } from '../apps/reader/dist/components/Explorer.js';
import { resolve } from 'node:path';
import {
  createMultipartParts,
  redactRequest,
} from '@davidniessen/doctopus-explorer';
import type {
  BodyRedaction,
  MultipartPart,
  PreparedRequest,
} from '@davidniessen/doctopus-explorer';
import type { Media } from '@davidniessen/doctopus-contracts';
import {
  multipartEditorModel,
  multipartExampleBody,
} from '../apps/reader/src/multipart-input.js';

const media: Media = {
  schema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      password: { type: 'string', format: 'password' },
      metadata: {
        type: 'object',
        properties: { id: { type: 'integer' }, note: { writeOnly: true } },
      },
      secrets: { type: 'array', items: { writeOnly: true } },
      documents: { type: 'array', items: { type: 'string', format: 'binary' } },
    },
  },
};
const context: BodyRedaction = { schema: media.schema, schemas: {} };
const request = (parts: MultipartPart[]): PreparedRequest => ({
  url: 'https://example.test/upload',
  method: 'POST',
  headers: {},
  multipart: parts,
});
const values = (value: PreparedRequest) =>
  value.multipart!.flatMap((part) =>
    part.kind === 'text' ? [[part.name, part.value]] : [],
  );
describe('multipart reader model and schema-aware previews', () => {
  it('retains prefix-item positions when another part is opaque', () => {
    const parts: MultipartPart[] = [
      {
        name: 'rows',
        kind: 'text',
        collection: true,
        contentType: 'application/xml',
        value: '<private />',
      },
      {
        name: 'rows',
        kind: 'text',
        collection: true,
        contentType: 'application/json',
        value: '{"password":"private-value"}',
      },
    ];
    const preview = redactRequest(
      request(parts),
      {},
      {
        schemas: {},
        schema: {
          type: 'object',
          properties: {
            rows: {
              type: 'array',
              prefixItems: [
                {},
                {
                  type: 'object',
                  properties: { password: { writeOnly: true } },
                },
              ],
            },
          },
        },
      },
    );
    expect(values(preview)).toEqual([
      ['rows', 'YOUR_PART_VALUE'],
      ['rows', '{"password":"YOUR_SENSITIVE_VALUE"}'],
    ]);
  });
  it.each(['application/xml', 'text/plain'])(
    'omits opaque serialized structures for %s instead of exposing nested sensitive values',
    (contentType) => {
      const selected: Media = {
        schema: {
          type: 'object',
          properties: {
            address: {
              type: 'object',
              properties: { password: { writeOnly: true } },
            },
          },
        },
        encoding: { address: { contentType } },
      };
      const parts = createMultipartParts(
        JSON.stringify({ address: '<address password="private-value" />' }),
        {},
        selected,
      );
      const preview = redactRequest(
        request(parts),
        {},
        { schema: selected.schema, schemas: {} },
      );
      expect(values(preview)).toEqual([['address', 'YOUR_PART_VALUE']]);
      expect(JSON.stringify(preview)).not.toContain('private-value');
    },
  );
  it('renders file fields named constructor and __proto__ without interpreting object prototypes', async () => {
    const site = await compileProject(
      resolve('examples/components'),
      'docs.config.yaml',
      { trustContent: true },
    );
    const api = site.apis.find((api) => api.id === 'gallery')!;
    const operation = api.operations.find(
      (operation) => operation.id === 'uploadDocuments',
    )!;
    const media = operation.requestBody!.content['multipart/form-data']!;
    // Preserve composition while adding hostile-name properties at the root.
    const schema = media.schema;
    schema.properties = Object.fromEntries([
      ...Object.entries((schema.properties ?? {}) as Record<string, unknown>),
      ['constructor', { type: 'string', format: 'binary' }],
      ['__proto__', { type: 'string', format: 'binary' }],
    ]);
    const page = renderDocument(site, operationHref(api, operation));
    expect(page).toContain('Try now');
    expect(page).not.toContain('aria-label="Upload constructor"');
    const html = renderToStaticMarkup(
      createElement(Explorer, { api, operation }),
    );
    expect(html).toContain('aria-label="Upload constructor"');
    expect(html).toContain('aria-label="Upload __proto__"');
  });
  it('retains useful text and precise JSON while removing password/write-only data and credentials', () => {
    const parts = createMultipartParts(
      '{"title":"public token-secret","password":"private-password","metadata":{"id":9007199254740993,"note":"private-note"},"secrets":["first-secret"]}',
      {},
      media,
    );
    const actual = request(parts);
    const preview = redactRequest(actual, { bearer: 'token-secret' }, context);
    expect(values(preview)).toEqual([
      ['title', 'public YOUR_CREDENTIAL'],
      ['password', 'YOUR_SENSITIVE_VALUE'],
      ['metadata', '{"id":9007199254740993,"note":"YOUR_SENSITIVE_VALUE"}'],
      ['secrets', 'YOUR_SENSITIVE_VALUE'],
    ]);
    expect(JSON.stringify(actual)).toContain('private-password');
    expect(JSON.stringify(preview)).not.toContain('private-');
  });
  it('applies item annotations to a single repeated value and conservative pattern candidates without evaluating regexes', () => {
    const selected: Media = {
      schema: {
        type: 'object',
        patternProperties: { '(a+)+$': { items: { writeOnly: true } } },
      },
    };
    const parts = createMultipartParts(
      '{"unknown":["private-single-item"]}',
      {},
      selected,
    );
    const preview = redactRequest(
      request(parts),
      {},
      { schema: selected.schema, schemas: {} },
    );
    expect(values(preview)).toEqual([['unknown', 'YOUR_SENSITIVE_VALUE']]);
  });
  it('preserves repeated objects and follows property references and composition annotations', () => {
    const selected: Media = {
      schema: {
        type: 'object',
        properties: {
          rows: { type: 'array', items: { $ref: '#/components/schemas/Row' } },
        },
      },
    };
    const schemas = {
      Row: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          password: { allOf: [{ writeOnly: true }] },
        },
      },
    };
    const parts = createMultipartParts(
      '{"rows":[{"id":9007199254740993,"password":"secret-1"},{"id":2,"password":"secret-2"}]}',
      {},
      selected,
      { schemas },
    );
    const preview = redactRequest(
      request(parts),
      {},
      { schema: selected.schema, schemas },
    );
    expect(values(preview)).toEqual([
      ['rows', '{"id":9007199254740993,"password":"YOUR_SENSITIVE_VALUE"}'],
      ['rows', '{"id":2,"password":"YOUR_SENSITIVE_VALUE"}'],
    ]);
  });
  it('fails closed for unresolved or invalid contexts and keeps placeholders valid JSON', () => {
    const parts = createMultipartParts(
      '{"metadata":{"note":"private-note"}}',
      {},
      media,
    );
    for (const selected of [
      undefined,
      { schema: { $ref: '#/components/schemas/Missing' }, schemas: {} },
      { schema: { writeOnly: true }, schemas: {} },
    ]) {
      const preview = redactRequest(request(parts), {}, selected);
      expect(values(preview)).toEqual([['metadata', '"YOUR_PART_VALUE"']]);
    }
    const preview = redactRequest(
      request([
        {
          name: 'metadata',
          kind: 'text',
          contentType: 'application/json',
          value: 'invalid JSON private',
        },
      ]),
      {},
      context,
    );
    expect(values(preview)).toEqual([['metadata', '"YOUR_PART_VALUE"']]);
  });
  it('removes selected filenames and binary data even with a schema-aware context', () => {
    const parts = createMultipartParts(
      '{"title":"public"}',
      {
        documents: [
          {
            filename: 'private-client.bin',
            data: new Blob(['private file data']),
          },
        ],
      },
      media,
    );
    const preview = redactRequest(request(parts), {}, context);
    expect(JSON.stringify(preview)).not.toContain('private');
    const file = preview.multipart!.find((part) => part.kind === 'file');
    expect(file?.kind === 'file' && file.file.data.size).toBe(0);
    expect(values(preview)).toEqual([['title', 'public']]);
  });
  it('separates binary fields from text examples without changing numeric tokens or mutating schemas', () => {
    const model = multipartEditorModel(media, {}, false);
    expect(model.files).toEqual([
      { name: 'documents', multiple: true, required: false, description: '' },
    ]);
    expect(model.textSchema.properties).not.toHaveProperty('documents');
    expect(media.schema.properties).toHaveProperty('documents');
    const body = multipartExampleBody(
      '{"title":"example","metadata":{"id":9007199254740993},"documents":["not-selected"]}',
      media,
      {},
      false,
    );
    expect(body).toContain('9007199254740993');
    expect(body).not.toContain('documents');
    expect(multipartExampleBody('invalid', media, {}, false)).toBe('invalid');
  });
  it('resolves file/array references, omits response-only controls and does not require response-only properties', () => {
    const selected: Media = {
      schema: {
        type: 'object',
        required: ['responseOnly', 'attachment'],
        properties: {
          responseOnly: { readOnly: true },
          attachment: { $ref: '#/components/schemas/File' },
        },
      },
    };
    const schemas = { File: { type: 'string', format: 'binary' } };
    expect(multipartEditorModel(selected, schemas, false).files).toEqual([
      { name: 'attachment', multiple: false, required: true, description: '' },
    ]);
    expect(
      createMultipartParts(
        '{}',
        { attachment: [{ filename: 'empty.bin', data: new Blob([]) }] },
        selected,
        { schemas },
      ),
    ).toHaveLength(1);
    expect(() =>
      multipartEditorModel(
        {
          schema: {
            type: 'object',
            properties: { missing: { $ref: '#/missing' } },
          },
        },
        {},
        false,
      ),
    ).toThrow(/resolve/);
  });
  it('bounds reader controls and rejects unsupported root shapes without silently dropping data', () => {
    expect(() =>
      multipartEditorModel(
        { schema: { oneOf: [{ type: 'object' }] } },
        {},
        false,
      ),
    ).toThrow(/direct object/);
    expect(() =>
      multipartEditorModel(
        {
          schema: {
            type: 'object',
            properties: Object.fromEntries(
              Array.from({ length: 101 }, (_, index) => [
                'field' + index,
                { type: 'string' },
              ]),
            ),
          },
        },
        {},
        false,
      ),
    ).toThrow(/100 declared/);
  });
});
