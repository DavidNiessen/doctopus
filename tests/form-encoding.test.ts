import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Media, Operation } from '@davidniessen/doctopus-contracts';
import {
  encodeFormBody,
  isFormMediaType,
  prepareRequest,
} from '@davidniessen/doctopus-explorer';

const media: Media = {
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      enabled: { type: 'boolean' },
      count: { type: 'integer' },
      address: { type: 'object' },
      colors: { type: 'array', items: { type: 'string' } },
    },
  },
};
const type = 'application/x-www-form-urlencoded';
const operation: Operation = {
  id: 'form',
  slug: 'form',
  method: 'post',
  path: '/form',
  summary: '',
  description: '',
  tags: [],
  deprecated: false,
  parameters: [],
  security: [],
  servers: [],
  source: '#/paths/form/post',
  requestBody: { required: true, description: '', content: { [type]: media } },
  responses: [],
};
describe('form-urlencoded body encoding', () => {
  it('recognizes media types case-insensitively and ignores parameters', () => {
    expect(
      isFormMediaType(' Application/X-WWW-Form-Urlencoded; charset=UTF-8'),
    ).toBe(true);
    expect(isFormMediaType('multipart/form-data')).toBe(false);
    expect(isFormMediaType('application/json')).toBe(false);
  });
  it('matches the OpenAPI 3.1.2 content-based JSON address example', () => {
    const values =
      '{"id":"f81d4fae-7dec-11d0-a765-00a0c91e6bf6","address":{"streetAddress":"123 Example Dr.","city":"Somewhere","state":"CA","zip":"99999+1234"}}';
    expect(encodeFormBody(values, media)).toBe(
      'id=f81d4fae-7dec-11d0-a765-00a0c91e6bf6&address=%7B%22streetAddress%22%3A%22123+Example+Dr.%22%2C%22city%22%3A%22Somewhere%22%2C%22state%22%3A%22CA%22%2C%22zip%22%3A%2299999%2B1234%22%7D',
    );
  });
  it('preserves exact numbers, null/empty fields and non-ASCII input', () => {
    expect(
      encodeFormBody(
        '{"name":"café + ~*","enabled":false,"count":9007199254740993,"nothing":null,"empty":"","negative":-0}',
        media,
      ),
    ).toBe(
      'name=caf%C3%A9+%2B+%7E*&enabled=false&count=9007199254740993&nothing=&empty=&negative=-0',
    );
  });
  it('repeats array content values and stringifies each object without rounding', () => {
    const result = encodeFormBody(
      '{"colors":["blue","a+b"],"addresses":[{"id":9007199254740993},{"n":1e400}],"empty":[]}',
      media,
    );
    const parts = new URLSearchParams(result);
    expect(parts.getAll('colors')).toEqual(['blue', 'a+b']);
    expect(parts.getAll('addresses')).toEqual([
      '{"id":9007199254740993}',
      '{"n":1e400}',
    ]);
    expect(parts.has('empty')).toBe(false);
  });
  it('supports explicit JSON content for strings, scalars, arrays and nested arrays', () => {
    const input =
      '{"name":"quoted","enabled":false,"colors":["a","b"],"nested":[[1,2],[3]]}';
    const encoded = encodeFormBody(input, {
      ...media,
      encoding: {
        name: { contentType: 'application/json' },
        enabled: { contentType: 'application/problem+json' },
        colors: { contentType: 'application/json' },
        nested: { contentType: 'application/json' },
      },
    });
    const values = new URLSearchParams(encoded);
    expect(values.get('name')).toBe('"quoted"');
    expect(values.get('enabled')).toBe('false');
    expect(values.getAll('colors')).toEqual(['"a"', '"b"']);
    expect(values.getAll('nested')).toEqual(['[1,2]', '[3]']);
  });
  it('uses explicit style settings instead of content type defaults', () => {
    expect(
      encodeFormBody('{"colors":["a,b","c"],"address":{"R":100,"G":200}}', {
        ...media,
        encoding: {
          colors: { explode: false, contentType: 'application/json' },
          address: { style: 'form', explode: true },
        },
      }),
    ).toBe('colors=a%2Cb,c&R=100&G=200');
  });
  it.each([
    ['form', false, 'colors=blue,black'],
    ['form', true, 'colors=blue&colors=black'],
    ['spaceDelimited', false, 'colors=blue%20black'],
    ['pipeDelimited', false, 'colors=blue%7Cblack'],
  ] as const)('applies %s / explode=%s', (style, explode, expected) => {
    expect(
      encodeFormBody('{"colors":["blue","black"]}', {
        ...media,
        encoding: { colors: { style, explode } },
      }),
    ).toBe(expected);
  });
  it('supports deepObject, explicit empty strings and pre-escaped reserved data', () => {
    expect(
      encodeFormBody('{"address":{"zip":"a+b"}}', {
        ...media,
        encoding: { address: { style: 'deepObject', explode: true } },
      }),
    ).toBe('address%5Bzip%5D=a%2Bb');
    expect(
      encodeFormBody('{"name":""}', {
        ...media,
        encoding: { name: { style: 'form' } },
      }),
    ).toBe('name=');
    expect(
      encodeFormBody('{"name":"a%26b:/%2B"}', {
        ...media,
        encoding: { name: { allowReserved: true } },
      }),
    ).toBe('name=a%26b:/%2B');
  });
  it('resolves property/item references and accepts already encoded text for non-JSON media', () => {
    const input =
      '{"address":{"id":9007199254740993},"colors":[{"name":"a"}],"xml":" <x /> ","binary":"c29tZStieXRlcw=="}';
    const result = encodeFormBody(
      input,
      {
        schema: { $ref: '#/components/schemas/Root' },
        encoding: { xml: { contentType: 'application/xml' } },
      },
      {
        schemas: {
          Root: {
            type: 'object',
            properties: {
              address: { $ref: '#/components/schemas/Address' },
              colors: {
                type: 'array',
                items: { $ref: '#/components/schemas/Address' },
              },
              binary: { type: 'string', contentEncoding: 'base64' },
            },
          },
          Address: { type: 'object' },
        },
      },
    );
    const parsed = new URLSearchParams(result);
    expect(parsed.get('address')).toBe('{"id":9007199254740993}');
    expect(parsed.get('colors')).toBe('{"name":"a"}');
    expect(parsed.get('xml')).toBe(' <x /> ');
    expect(parsed.get('binary')).toBe('c29tZStieXRlcw==');
  });
  it.each([
    ['[]', media, /JSON object/],
    ['{"name":"a","name":"b"}', media, /Duplicate/],
    ['{"name":"a"}', { schema: { type: 'string' } }, /object schema/],
    ['{"name":"a"}', { schema: { $ref: '#/missing' } }, /reference could not/],
    [
      '{"name":"a"}',
      { schema: { allOf: [{ additionalProperties: false }] } },
      /Composed/,
    ],
    [
      '{"address":{"x":1}}',
      { ...media, encoding: { address: { contentType: 'application/xml' } } },
      /flat/,
    ],
    [
      '{"colors":[{"x":1}]}',
      { ...media, encoding: { colors: { style: 'form' } } },
      /flat/,
    ],
    [
      '{"name":"a&b"}',
      { ...media, encoding: { name: { allowReserved: true } } },
      /pre-encoding/,
    ],
    [
      '{"name":"a"}',
      { ...media, encoding: { name: { contentType: 'text/*' } } },
      /one concrete/,
    ],
    [
      '{"name":"a"}',
      { ...media, encoding: { name: { explode: 'yes' } } },
      /Invalid form encoding/,
    ],
  ] as const)(
    'rejects ambiguous or unsupported encoding %#',
    (raw, media, error) => {
      expect(() => encodeFormBody(raw, media)).toThrow(error);
    },
  );
  it('keeps pre-serialized request bodies literal and encodes logical JSON only when selected', () => {
    const base = {
      server: 'https://example.test',
      parameters: {},
      contentType: type,
    };
    expect(
      prepareRequest(operation, {}, { ...base, body: 'name=literal+form' })
        .body,
    ).toBe('name=literal+form');
    expect(
      prepareRequest(
        operation,
        {},
        { ...base, bodyFormat: 'json', body: '{"name":"logical form"}' },
      ).body,
    ).toBe('name=logical+form');
    expect(
      prepareRequest(
        operation,
        {},
        {
          ...base,
          contentType: 'Application/X-WWW-Form-Urlencoded; charset=UTF-8',
          bodyFormat: 'json',
          body: '{"name":"logical form"}',
        },
      ).body,
    ).toBe('name=logical+form');
    expect(() =>
      prepareRequest(
        operation,
        {},
        { ...base, bodyFormat: 'json', body: '{}' },
      ),
    ).toThrow(/required/);
    expect(() =>
      prepareRequest(
        operation,
        {},
        { ...base, contentType: 'text/plain', bodyFormat: 'json', body: '{}' },
      ),
    ).toThrow(/only for JSON or form/);
  });
  it('sends exact encoded body bytes with the expected content type', async () => {
    let received = '',
      header = '';
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      received = Buffer.concat(chunks).toString();
      header = req.headers['content-type']!;
      res.writeHead(204).end();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const request = prepareRequest(
        operation,
        {},
        {
          server: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
          parameters: {},
          contentType: type,
          bodyFormat: 'json',
          body: '{"name":"é + space","count":9007199254740993}',
        },
      );
      expect(
        (
          await fetch(request.url, {
            method: request.method,
            headers: request.headers,
            body: request.body!,
          })
        ).status,
      ).toBe(204);
      expect(header).toBe(type);
      expect(received).toBe('name=%C3%A9+%2B+space&count=9007199254740993');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
