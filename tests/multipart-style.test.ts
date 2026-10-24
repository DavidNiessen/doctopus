import { expect, it } from 'vitest';
import type { Media, Schema } from '@davidniessen/doctopus-contracts';
import {
  createMultipartParts,
  toFetchRequest,
  redactRequest,
  generateSnippet,
} from '@davidniessen/doctopus-explorer';

const field = (encoding: Schema): Media => ({
  schema: { type: 'object', required: ['value'], properties: { value: {} } },
  encoding: { value: encoding },
});
it.each([
  [
    '{"value":["a+b","c&d"]}',
    { style: 'form' },
    [
      ['value', 'a%2Bb'],
      ['value', 'c%26d'],
    ],
  ],
  [
    '{"value":["a,b",9007199254740993]}',
    { explode: false },
    [['value', 'a%2Cb,9007199254740993']],
  ],
  [
    '{"value":{"name":"café","id":1e400}}',
    { style: 'form' },
    [
      ['name', 'caf%C3%A9'],
      ['id', '1e400'],
    ],
  ],
  [
    '{"value":{"name":"a,b","enabled":false}}',
    { explode: false },
    [['value', 'name,a%2Cb,enabled,false']],
  ],
  [
    '{"value":["a b","c"]}',
    { style: 'spaceDelimited' },
    [['value', 'a%20b%20c']],
  ],
  [
    '{"value":["a|b","c"]}',
    { style: 'pipeDelimited' },
    [['value', 'a%7Cb%7Cc']],
  ],
  [
    '{"value":{"key":"a+b"}}',
    { style: 'deepObject', explode: true },
    [['value[key]', 'a%2Bb']],
  ],
  [
    '{"value":"https://example.com/path?name"}',
    { allowReserved: true },
    [['value', 'https://example.com/path?name']],
  ],
] as const)(
  'serializes explicit multipart style %# without numeric rounding',
  async (input, encoding, expected) => {
    const multipart = createMultipartParts(input, {}, field(encoding));
    expect(
      multipart.map((part) => [
        part.name,
        part.kind === 'text' ? part.value : 'file',
      ]),
    ).toEqual(expected);
    const init = toFetchRequest({
      method: 'POST',
      url: 'https://api.example.com',
      headers: {},
      multipart,
    });
    const parsed = await new Response(init.body, {
      headers: init.headers,
    }).formData();
    expect([...parsed.entries()]).toEqual(expected);
  },
);
it('ignores contentType when a 3.1 style field is explicit, including false values', () => {
  for (const encoding of [
    { style: 'form' },
    { explode: false },
    { allowReserved: false },
  ]) {
    const parts = createMultipartParts(
      '{"value":"plain"}',
      {},
      field({ ...encoding, contentType: 'application/json' }),
    );
    expect(parts[0]).toMatchObject({
      contentType: 'text/plain; charset=utf-8',
      value: 'plain',
      styled: true,
    });
  }
});
it('ignores multipart style fields in OpenAPI 3.0 and retains content-based files and JSON', () => {
  const media: Media = {
    schema: {
      type: 'object',
      properties: {
        value: { type: 'object' },
        file: { type: 'string', format: 'binary' },
      },
    },
    encoding: {
      value: { style: 'form', explode: true },
      file: { style: 'form', contentType: 'image/png' },
    },
  };
  const parts = createMultipartParts(
    '{"value":{"name":"café"}}',
    {
      file: [
        { filename: 'picture.png', data: new Blob([Uint8Array.of(0, 255)]) },
      ],
    },
    media,
    { openapiVersion: '3.0.3' },
  );
  expect(parts[0]).toMatchObject({
    contentType: 'application/json',
    value: '{"name":"café"}',
  });
  expect(parts[0]).not.toHaveProperty('styled');
  expect(parts[1]).toMatchObject({ kind: 'file', contentType: 'image/png' });
  expect(() =>
    createMultipartParts(
      '{}',
      { file: [{ filename: 'file', data: new Blob([]) }] },
      media,
      { openapiVersion: '3.1.0' },
    ),
  ).toThrow(/binary uploads/);
});
it('applies custom headers and required checks to the logical property after object expansion', () => {
  const media = field({
    style: 'form',
    headers: { 'X-Token': { required: true, schema: { type: 'string' } } },
  });
  expect(() =>
    createMultipartParts('{"value":{"one":"a","two":"b"}}', {}, media),
  ).toThrow(/X-Token/);
  const parts = createMultipartParts(
    '{"value":{"one":"a","two":"b"}}',
    {},
    media,
    { partHeaders: { value: { 'X-Token': 'secret' } } },
  );
  expect(parts.map((part) => part.headers)).toEqual([
    { 'X-Token': 'secret' },
    { 'X-Token': 'secret' },
  ]);
});
it('fails closed for nested data, undefined styles, empty collections, invalid flags and colliding wire names', () => {
  for (const [input, encoding] of [
    ['{"value":{"nested":{}}}', { style: 'form' }],
    ['{"value":[]}', { explode: true }],
    ['{"value":{}}', { style: 'deepObject', explode: true }],
    ['{"value":[]}', { style: 'pipeDelimited', explode: true }],
    ['{"value":"x"}', { explode: 'true' }],
    ['{"value":"a&b"}', { allowReserved: true }],
  ] as const)
    expect(() => createMultipartParts(input, {}, field(encoding))).toThrow();
  const media = field({ style: 'form' });
  expect(() =>
    createMultipartParts('{"value":{"other":"one"},"other":"two"}', {}, media),
  ).toThrow(/collide/);
  expect(() =>
    createMultipartParts('{"other":"two","value":{"other":"one"}}', {}, media),
  ).toThrow(/collide/);
});
it('always replaces styled values in all copied clients, including encoded secrets and nested annotations', () => {
  const media = field({ style: 'form' });
  media.schema.properties = {
    value: {
      type: 'object',
      properties: { privateNote: { type: 'string', writeOnly: true } },
    },
  };
  const multipart = createMultipartParts(
    '{"value":{"privateNote":"secret + note","public":"plain"}}',
    {},
    media,
  );
  const request = {
    method: 'POST',
    url: 'https://api.example.com',
    headers: {},
    multipart,
  };
  const copied = redactRequest(
    request,
    {},
    {
      schema: media.schema,
      schemas: {},
    },
  );
  expect(copied.multipart).toEqual(
    multipart.map((part) => ({ ...part, value: 'YOUR_PART_VALUE' })),
  );
  for (const language of [
    'cURL',
    'JavaScript',
    'TypeScript',
    'Python',
    'Java',
  ] as const) {
    const code = generateSnippet(copied, language);
    expect(code).toContain('YOUR_PART_VALUE');
    expect(code).not.toContain('secret%20%2B%20note');
  }
  expect(multipart[0]).toMatchObject({ value: 'secret%20%2B%20note' });
});
