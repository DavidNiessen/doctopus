import { describe, expect, it } from 'vitest';
import { objectFieldSchema } from '@davidniessen/doctopus-contracts';
import type { Media, Schema } from '@davidniessen/doctopus-contracts';
import {
  encodeFormBody,
  createMultipartParts,
  redactRequest,
  toFetchRequest,
} from '@davidniessen/doctopus-explorer';
import {
  multipartEditorModel,
  multipartExampleBody,
} from '../apps/reader/src/multipart-input.js';

const schemas: Record<string, Schema> = {
  Details: {
    type: 'object',
    required: ['title'],
    properties: {
      title: { type: 'string' },
      secret: { type: 'string', writeOnly: true },
      metadata: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          privateNote: { writeOnly: true },
        },
      },
    },
  },
  Upload: {
    type: 'object',
    required: ['documents', 'responseOnly'],
    properties: {
      documents: { type: 'array', items: { type: 'string', format: 'binary' } },
      responseOnly: { type: 'string', readOnly: true },
    },
  },
};
const media: Media = {
  schema: {
    allOf: [
      { $ref: '#/components/schemas/Details' },
      { $ref: '#/components/schemas/Upload' },
    ],
  },
};
const body =
  '{"title":"Visible 🌍","secret":"private-fixture","metadata":{"id":9007199254740993,"privateNote":"private-note"},"extra":"retained"}';
describe('shared allOf form projections', () => {
  it('serializes disjoint referenced form fields without losing numeric tokens or unknown values', () => {
    const selected: Media = {
      schema: {
        allOf: [
          { $ref: '#/components/schemas/Details' },
          {
            type: 'object',
            properties: { tags: { type: 'array', items: { type: 'string' } } },
          },
        ],
      },
      encoding: { tags: { style: 'form', explode: true } },
    };
    const encoded = encodeFormBody(
      body.slice(0, -1) + ',"tags":["a/b","c"]}',
      selected,
      { schemas },
    );
    const actual = new URLSearchParams(encoded);
    expect(actual.get('title')).toBe('Visible 🌍');
    expect(actual.get('metadata')).toBe(
      '{"id":9007199254740993,"privateNote":"private-note"}',
    );
    expect(actual.get('extra')).toBe('retained');
    expect(actual.getAll('tags')).toEqual(['a/b', 'c']);
    expect(actual.get('secret')).toBe('private-fixture');
  });
  it('uses the same composed binary fields and requirements in the reader and actual multipart bytes', async () => {
    const model = multipartEditorModel(media, schemas, false);
    expect(model.files).toEqual([
      { name: 'documents', multiple: true, required: true, description: '' },
    ]);
    expect(model.textSchema.required).toEqual(['title', 'responseOnly']);
    const parts = createMultipartParts(
      body,
      {
        documents: [
          {
            data: new Blob([Uint8Array.from([0, 255, 128])]),
            filename: 'private-file.bin',
          },
        ],
      },
      media,
      { schemas },
    );
    const request = {
      url: 'https://api.example.com/upload',
      method: 'POST',
      headers: {},
      multipart: parts,
    };
    const init = toFetchRequest(request);
    const parsed = await new Response(init.body, {
      headers: init.headers,
    }).formData();
    expect(parsed.get('title')).toBe('Visible 🌍');
    expect(parsed.get('metadata')).toBe(
      '{"id":9007199254740993,"privateNote":"private-note"}',
    );
    expect(
      new Uint8Array(await (parsed.get('documents') as File).arrayBuffer()),
    ).toEqual(Uint8Array.from([0, 255, 128]));
    expect(() => createMultipartParts(body, {}, media, { schemas })).toThrow(
      /Required multipart field/,
    );
    const preview = redactRequest(
      request,
      {},
      { schema: media.schema, schemas },
    );
    const shown = JSON.stringify(preview);
    expect(shown).toContain('Visible 🌍');
    expect(shown).toContain('9007199254740993');
    expect(shown).not.toContain('private-fixture');
    expect(shown).not.toContain('private-note');
    expect(shown).not.toContain('private-file.bin');
    expect(parts.find((part) => part.name === 'secret')).toMatchObject({
      value: 'private-fixture',
    });
    expect(
      multipartExampleBody(
        '{"title":"t","documents":["example.bin"]}',
        media,
        schemas,
        false,
      ),
    ).not.toContain('documents');
  });
  it('retains OpenAPI 3.0 reference-sibling behavior and 3.1 composition additions', () => {
    const schema = {
      $ref: '#/components/schemas/Details',
      allOf: [{ type: 'object', properties: { appended: { type: 'string' } } }],
    };
    expect(
      Object.keys(
        objectFieldSchema(schema, schemas, true).properties as Schema,
      ),
    ).not.toContain('appended');
    expect(
      Object.keys(
        objectFieldSchema(schema, schemas, false).properties as Schema,
      ),
    ).toContain('appended');
  });
  it.each([
    {
      allOf: [
        { type: 'object', properties: { name: {} } },
        { type: 'object', properties: { name: {} } },
      ],
    },
    { allOf: [{ type: 'object', additionalProperties: false }] },
    { allOf: [{ type: 'object', patternProperties: { '^x': {} } }] },
    { allOf: [{ type: 'object' }, { type: 'string' }] },
    { allOf: [{ type: 'object', oneOf: [{ properties: { name: {} } }] }] },
    { allOf: [{ $ref: '#/components/schemas/Missing' }] },
    { allOf: Array.from({ length: 32 }, () => ({ type: 'object' })) },
  ])(
    'rejects ambiguous, constrained or excessive roots consistently (%j)',
    (schema) => {
      const selected: Media = { schema };
      expect(() => encodeFormBody('{}', selected, { schemas })).toThrow(
        /pre-serialized/,
      );
      expect(() =>
        createMultipartParts('{}', {}, selected, { schemas }),
      ).toThrow(/custom client/);
      expect(() => multipartEditorModel(selected, schemas, false)).toThrow(
        /custom client/,
      );
    },
  );
  it('bounds recursive allOf references and preserves inherited sensitivity/nullability', () => {
    const recursive = {
      Recursive: { allOf: [{ $ref: '#/components/schemas/Recursive' }] },
    };
    expect(() =>
      objectFieldSchema(recursive.Recursive, recursive, false),
    ).toThrow();
    const projected = objectFieldSchema(
      {
        allOf: [
          { type: ['object', 'null'], writeOnly: true },
          { type: 'object', properties: { label: { type: 'string' } } },
        ],
      },
      {},
      false,
    );
    expect(projected.type).toBe('object');
    expect(projected.writeOnly).toBe(true);
  });
});
