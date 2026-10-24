import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Media, Operation } from '@davidniessen/doctopus-contracts';
import {
  createMultipartParts,
  generateSnippet,
  isMultipartMediaType,
  MULTIPART_LIMITS,
  prepareRequest,
  redactRequest,
  toFetchRequest,
} from '@davidniessen/doctopus-explorer';
import type {
  MultipartFiles,
  PreparedRequest,
} from '@davidniessen/doctopus-explorer';

const type = 'multipart/form-data';
const media: Media = {
  schema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      count: { type: 'integer' },
      metadata: { type: 'object' },
      tags: { type: 'array', items: { type: 'string' } },
      attachment: { type: 'string', format: 'binary' },
      documents: { type: 'array', items: { type: 'string', format: 'binary' } },
      password: { type: 'string', format: 'password' },
    },
  },
};
const operation: Operation = {
  id: 'upload',
  slug: 'upload',
  method: 'post',
  path: '/upload',
  summary: '',
  description: '',
  tags: [],
  deprecated: false,
  parameters: [],
  security: [],
  servers: [],
  source: '#/paths/upload/post',
  responses: [],
  requestBody: { required: true, description: '', content: { [type]: media } },
};
const binary = Uint8Array.from([0, 255, 128, 13, 10, 34, 1, 254]);
const file = { filename: 'résumé.bin', data: new Blob([binary]) };
const parts = (
  body = '{}',
  files: MultipartFiles = {},
  selected: Media = media,
) => createMultipartParts(body, files, selected);
const prepare = (body = '{}', files: MultipartFiles = {}): PreparedRequest =>
  prepareRequest(
    operation,
    {},
    {
      server: 'http://127.0.0.1',
      parameters: {},
      body,
      files,
      bodyFormat: 'json',
      contentType: type,
    },
  );

describe('binary-safe multipart requests', () => {
  it('recognizes only form-data case insensitively', () => {
    expect(isMultipartMediaType(' Multipart/Form-Data; boundary=test')).toBe(
      true,
    );
    expect(isMultipartMediaType('multipart/mixed')).toBe(false);
    expect(isMultipartMediaType('application/json')).toBe(false);
  });
  it('retains exact numeric tokens, objects, repeated primitive values and file metadata without reading files', () => {
    const result = parts(
      '{"title":"café + space","count":9007199254740993,"metadata":{"id":1e400},"tags":["a","b"],"empty":null}',
      { attachment: [file] },
    );
    expect(result.map((part) => part.name)).toEqual([
      'title',
      'count',
      'metadata',
      'tags',
      'tags',
      'empty',
      'attachment',
    ]);
    expect(result[1]).toMatchObject({
      kind: 'text',
      value: '9007199254740993',
      contentType: 'text/plain; charset=utf-8',
    });
    expect(result[2]).toMatchObject({
      kind: 'text',
      value: '{"id":1e400}',
      contentType: 'application/json',
    });
    expect(result[5]).toMatchObject({ value: '' });
    expect(result[6]).toMatchObject({
      kind: 'file',
      file,
      contentType: 'application/octet-stream',
    });
    expect(result[6]?.kind === 'file' && result[6].file.data).toBe(file.data);
  });
  it('round-trips binary bytes and Unicode metadata through an independent multipart parser', async () => {
    const request = prepare(
      '{"title":' +
        JSON.stringify('café 😀\r\nsecond line') +
        ',"tags":["a","b"],"metadata":{"id":9007199254740993}}',
      {
        attachment: [file],
        documents: [file, { ...file, filename: 'second.bin' }],
      },
    );
    expect(request.body).toBeUndefined();
    expect(
      Object.keys(request.headers).some(
        (name) => name.toLowerCase() === 'content-type',
      ),
    ).toBe(false);
    const init = toFetchRequest(request);
    expect(init.body).toBeInstanceOf(Blob);
    const form = await new Response(init.body, {
      headers: init.headers,
    }).formData();
    expect(form.get('title')).toBe('café 😀\r\nsecond line');
    expect(form.getAll('tags')).toEqual(['a', 'b']);
    expect(form.get('metadata')).toBe('{"id":9007199254740993}');
    const actual = form.get('attachment') as File;
    expect(actual.name).toBe('résumé.bin');
    expect(actual.type).toBe('application/octet-stream');
    expect(new Uint8Array(await actual.arrayBuffer())).toEqual(binary);
    expect(form.getAll('documents')).toHaveLength(2);
  });
  it('sends genuine binary multipart bytes and per-part JSON content types over HTTP', async () => {
    let received:
      { type: string; body: Buffer; rawHeaders: string[] } | undefined;
    const server = createServer(async (request, response) => {
      const buffers: Buffer[] = [];
      for await (const chunk of request) buffers.push(chunk);
      received = {
        type: String(request.headers['content-type']),
        body: Buffer.concat(buffers),
        rawHeaders: [...request.rawHeaders],
      };
      response
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end('{"ok":true}');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const address = server.address() as AddressInfo;
      const request = prepare('{"metadata":{"n":9007199254740993}}', {
        attachment: [file],
      });
      Object.defineProperty(request.headers, '__proto__', {
        value: 'own-header-fixture',
        enumerable: true,
      });
      const response = await fetch(
        `http://127.0.0.1:${address.port}/upload`,
        toFetchRequest(request),
      );
      expect(await response.json()).toEqual({ ok: true });
      const headers = new Map(
        Array.from({ length: received!.rawHeaders.length / 2 }, (_, index) => [
          received!.rawHeaders[index * 2]!.toLowerCase(),
          received!.rawHeaders[index * 2 + 1],
        ]),
      );
      expect(headers.get('__proto__')).toBe('own-header-fixture');
      expect(received?.type).toMatch(
        /^multipart\/form-data; boundary=doctopus-[a-f0-9]{48}$/,
      );
      const text = received!.body.toString('latin1');
      expect(text).toContain(
        'name="metadata"\r\nContent-Type: application/json\r\n\r\n{"n":9007199254740993}',
      );
      expect(text).not.toContain('name="metadata"; filename=');
      expect(received!.body.includes(Buffer.from(binary))).toBe(true);
      const boundary = received!.type.split('boundary=')[1]!;
      expect(text.endsWith(`\r\n--${boundary}--\r\n`)).toBe(true);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it('uses a fresh unpredictable boundary on every send while previews remain deterministic', () => {
    const request = prepare('{"title":"a"}');
    expect(prepare('{"title":"a"}')).toEqual(request);
    expect(toFetchRequest(request).headers.get('Content-Type')).not.toBe(
      toFetchRequest(request).headers.get('Content-Type'),
    );
    expect(request.headers['Content-Type']).toBeUndefined();
    const custom = toFetchRequest({
      ...request,
      headers: {
        ...request.headers,
        'content-type': 'bad-boundary',
        'CONTENT-TYPE': 'another',
      },
    });
    expect(
      [...custom.headers.keys()].filter((key) => key === 'content-type'),
    ).toEqual(['content-type']);
  });
  it('selects explicit JSON/text/file codecs and resolves root/property/item references', () => {
    const result = createMultipartParts(
      '{"name":"quoted","things":[{"id":9007199254740993}],"xml":"<x />"}',
      { uploads: [file] },
      {
        schema: { $ref: '#/components/schemas/Root' },
        encoding: {
          name: { contentType: 'application/json' },
          uploads: { contentType: 'image/png' },
          xml: { contentType: 'application/xml' },
        },
      },
      {
        schemas: {
          Root: {
            type: 'object',
            properties: {
              uploads: {
                type: 'array',
                items: { $ref: '#/components/schemas/Upload' },
              },
              things: {
                type: 'array',
                items: { $ref: '#/components/schemas/Thing' },
              },
            },
          },
          Upload: { type: 'string', format: 'binary' },
          Thing: { type: 'object' },
        },
      },
    );
    expect(result[0]).toMatchObject({
      value: '"quoted"',
      contentType: 'application/json',
    });
    expect(result[1]).toMatchObject({
      value: '{"id":9007199254740993}',
      contentType: 'application/json',
    });
    expect(result[2]).toMatchObject({
      value: '<x />',
      contentType: 'application/xml',
    });
    expect(result[3]).toMatchObject({ kind: 'file', contentType: 'image/png' });
  });
  it('rejects ambiguous field names and uses browser-compatible filename escaping', async () => {
    expect(() =>
      prepare(
        JSON.stringify({
          ['a' + String.fromCharCode(34) + '; filename=injected']: 'value',
        }),
      ),
    ).toThrow(/field names/);
    const request = prepare('{"title; filename=injected":"value"}', {
      attachment: [{ ...file, filename: 'a"b.bin' }],
    });
    const init = toFetchRequest(request);
    const text = await (init.body as Blob).text();
    expect(text).toContain('name="title; filename=injected"');
    expect(text).toContain('filename="a%22b.bin"');
    const form = await new Response(init.body, {
      headers: init.headers,
    }).formData();
    expect(form.get('title; filename=injected')).toBe('value');
    expect((form.get('attachment') as File).name).toBe('a"b.bin');
  });
  it.each(['a\r\nInjected: x', 'a\u0000b', 'a\u007fb'])(
    'rejects header controls in names and filenames %#',
    (name) => {
      expect(() => parts(JSON.stringify({ [name]: 'v' }))).toThrow(
        /field names/,
      );
      expect(() =>
        parts('{}', { attachment: [{ ...file, filename: name }] }),
      ).toThrow(/filenames/);
    },
  );
  it.each(['../file', 'C:\\secret.bin', '', '.', '..'])(
    'rejects non-basename filenames %#',
    (filename) => {
      expect(() =>
        parts('{}', { attachment: [{ ...file, filename }] }),
      ).toThrow(/filenames/);
    },
  );
  it.each([
    'text/*',
    'application/json,text/plain',
    'text/plain\r\nX-Evil: v',
    'invalid',
    'text/plain; charset="unterminated',
  ])('rejects unsafe or ambiguous part content types %#', (contentType) => {
    expect(() =>
      parts(
        '{"title":"x"}',
        {},
        { ...media, encoding: { title: { contentType } } },
      ),
    ).toThrow(/content type/);
  });
  it('rejects unsupported styles and unresolvable/composed schemas explicitly', () => {
    for (const encoding of [
      { style: 'matrix' },
      { style: 'simple' },
      { style: 'label' },
    ])
      expect(() =>
        parts('{"title":"x"}', {}, { ...media, encoding: { title: encoding } }),
      ).toThrow(/Unsupported query style/);
    expect(() =>
      parts('{}', {}, { schema: { $ref: '#/components/schemas/Missing' } }),
    ).toThrow(/resolve/);
    for (const schema of [
      { anyOf: [{ type: 'object' }] },
      { type: 'array' },
      { 'x-doctopus-boolean-schema': false },
    ])
      expect(() => parts('{}', {}, { schema })).toThrow(/direct object/);
    expect(() =>
      parts(
        '{"xml":{"nested":true}}',
        {},
        { ...media, encoding: { xml: { contentType: 'application/xml' } } },
      ),
    ).toThrow(/serialized text/);
  });
  it('rejects duplicate JSON keys, binary-as-text, conflicting inputs and undeclared file types', () => {
    expect(() => parts('{"title":"a","title":"b"}')).toThrow();
    expect(() => parts('{"attachment":"not-file"}')).toThrow(/selected files/);
    expect(() => parts('{}', { title: [file] })).toThrow(/format: binary/);
    expect(() => parts('{}', { attachment: [file, file] })).toThrow(
      /single-file/,
    );
    expect(() =>
      parts('{"attachment":"value"}', { attachment: [file] }),
    ).toThrow();
    expect(() => parts('[]')).toThrow(/JSON object/);
  });
  it('checks required fields, part count and aggregate bytes before reading any file data', () => {
    expect(() =>
      parts(
        '{}',
        {},
        { schema: { ...media.schema, required: ['attachment'] } },
      ),
    ).toThrow(/Required multipart field/);
    expect(parts('{"tags":[]}', {}, media)).toEqual([]);
    expect(() =>
      parts('{}', { documents: Array.from({ length: 101 }, () => file) }),
    ).toThrow(/100 parts/);
    const large = new Blob([new Uint8Array(MULTIPART_LIMITS.bytes)]);
    expect(() =>
      parts('{}', { attachment: [{ filename: 'big.bin', data: large }] }),
    ).toThrow(/32 MiB/);
    expect(() => parts(JSON.stringify({ ['n'.repeat(1025)]: 'x' }))).toThrow(
      /1024 UTF-8/,
    );
  });
  it('enforces browser request and input-format boundaries', () => {
    const input = {
      server: 'http://127.0.0.1',
      parameters: {},
      contentType: type,
      body: '{}',
      bodyFormat: 'json' as const,
    };
    expect(() =>
      prepareRequest(operation, {}, { ...input, bodyFormat: 'serialized' }),
    ).toThrow(/logical JSON/);
    expect(() =>
      prepareRequest(
        operation,
        {},
        { ...input, contentType: type + '; boundary=provided' },
      ),
    ).toThrow(/boundaries/);
    expect(() => prepare()).toThrow(/body is required/i);
    expect(() =>
      prepareRequest(
        { ...operation, method: 'get' },
        {},
        { ...input, files: { attachment: [file] } },
      ),
    ).toThrow(/cannot have a body/);
    expect(() =>
      prepareRequest(
        operation,
        {},
        {
          ...input,
          contentType: 'application/json',
          body: '{}',
          files: { attachment: [file] },
        },
      ),
    ).toThrow(/Selected files require/);
    expect(() =>
      prepareRequest(
        { ...operation, requestBody: undefined } as unknown as Operation,
        {},
        input,
      ),
    ).toThrow(/not declared/);
    expect(() =>
      toFetchRequest({ ...prepare('{"title":"a"}'), body: 'conflict' }),
    ).toThrow(/both/);
  });
  it('redacts file bytes, filenames and all multipart text from copied previews without mutating the actual request', () => {
    const request = prepare('{"title":"private title","password":"secret"}', {
      attachment: [
        {
          filename: 'private-client.bin',
          data: new Blob(['private file bytes']),
        },
      ],
    });
    const redacted = redactRequest(request, {});
    expect(redacted.multipart?.[0]).toMatchObject({ value: 'YOUR_PART_VALUE' });
    const filePart = redacted.multipart?.find((part) => part.kind === 'file');
    expect(filePart?.kind === 'file' && filePart.file.data.size).toBe(0);
    expect(filePart?.kind === 'file' && filePart.file.filename).toBe(
      'upload.bin',
    );
    expect(JSON.stringify(redacted)).not.toContain('private');
    expect(request.multipart?.[0]).toMatchObject({ value: 'private title' });
    for (const language of [
      'cURL',
      'JavaScript',
      'TypeScript',
      'Python',
      'Java',
    ] as const) {
      const code = generateSnippet(redacted, language);
      expect(code).toContain('YOUR_FILE_1');
      expect(code).not.toContain('private');
      expect(code).not.toContain('secret');
      expect(code).toContain('YOUR_PART_VALUE');
      const unredacted = generateSnippet(request, language);
      expect(unredacted).not.toContain('private-client.bin');
      expect(unredacted).not.toContain('private file bytes');
    }
  });
});
