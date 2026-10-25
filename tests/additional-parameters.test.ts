import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Operation } from '@davidniessen/doctopus-contracts';
import {
  prepareRequest,
  toFetchRequest,
  generateSnippet,
  redactAdditionalParameters,
} from '@davidniessen/doctopus-explorer';
import type { AdditionalParameter } from '@davidniessen/doctopus-explorer';

const operation: Operation = {
  id: 'extra',
  slug: 'extra',
  method: 'get',
  path: '/params',
  summary: '',
  description: '',
  tags: [],
  deprecated: false,
  parameters: [],
  responses: [],
  security: [],
  servers: [],
  source: '#/paths/params/get',
};
const prepare = (rows: AdditionalParameter[]) =>
  prepareRequest(
    operation,
    {},
    {
      server: 'https://api.example.test/v1',
      parameters: {},
      additionalParameters: rows,
    },
  );

describe('additional request parameters', () => {
  it('rejects ambiguous inclusion flags instead of sending a disabled-looking draft', () => {
    expect(() =>
      prepare([
        {
          in: 'query',
          name: 'token',
          value: 'private',
          enabled: 'false',
        } as unknown as AdditionalParameter,
      ]),
    ).toThrow(/inclusion must be a boolean/);
  });
  it('preserves repeated query keys, literal encoding, empty values and disabled drafts on the actual wire', async () => {
    const server = createServer((request, response) => {
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({ url: request.url, trace: request.headers.trace }),
      );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const result = prepareRequest(
        operation,
        {},
        {
          server: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
          parameters: {},
          additionalParameters: [
            { in: 'query', name: 'tag', value: 'a&b + café' },
            { in: 'query', name: 'tag', value: '' },
            {
              in: 'query',
              name: 'omitted',
              value: 'private draft',
              enabled: false,
            },
            { in: 'query', name: '', value: '' },
            { in: 'header', name: 'trace', value: '' },
          ],
        },
      );
      const received = await (
        await fetch(result.url, toFetchRequest(result))
      ).json();
      expect(received).toEqual({
        url: '/params?tag=a%26b%20%2B%20caf%C3%A9&tag=',
        trace: '',
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it('supplements typed OpenAPI arrays without changing their serialization', () => {
    const request = prepareRequest(
      {
        ...operation,
        parameters: [
          {
            in: 'query',
            name: 'color',
            required: true,
            schema: { type: 'array' },
            description: '',
            style: 'form',
            explode: true,
          },
        ],
      },
      {},
      {
        server: 'https://api.example.test',
        parameters: { 'query:color': '["blue","red"]' },
        additionalParameters: [{ in: 'query', name: 'color', value: 'green' }],
      },
    );
    expect(new URL(request.url).searchParams.getAll('color')).toEqual([
      'blue',
      'red',
      'green',
    ]);
  });
  it.each([
    'Host',
    'Cookie',
    'Content-Length',
    'Origin',
    'Sec-Fetch-Site',
    'bad header',
  ])('retains browser restrictions for %s', (name) => {
    expect(() => prepare([{ in: 'header', name, value: 'value' }])).toThrow(
      /Header cannot/,
    );
  });
  it('rejects invalid header values and case-insensitive duplicates, while ignoring disabled invalid drafts', () => {
    expect(() =>
      prepare([{ in: 'header', name: 'trace', value: 'one\r\ntwo' }]),
    ).toThrow(/characters/);
    expect(() =>
      prepare([
        { in: 'header', name: 'Trace', value: 'one' },
        { in: 'header', name: 'trace', value: 'two' },
      ]),
    ).toThrow(/Duplicate/);
    expect(() =>
      prepare([
        {
          in: 'header',
          name: 'bad header',
          value: 'one\r\ntwo',
          enabled: false,
        },
      ]),
    ).not.toThrow();
  });
  it('keeps auth and generated content-type ownership explicit', () => {
    expect(() =>
      prepareRequest(
        { ...operation, security: [{ bearer: [] }] },
        { bearer: { type: 'http', scheme: 'bearer' } },
        {
          server: 'https://api.example.test',
          parameters: {},
          credentials: { bearer: 'real-credential' },
          additionalParameters: [
            { in: 'header', name: 'Authorization', value: 'Bearer custom' },
          ],
        },
      ),
    ).toThrow(/authentication controls/);
    expect(() =>
      prepareRequest(
        { ...operation, method: 'post' },
        {},
        {
          server: 'https://api.example.test',
          parameters: {},
          body: '{}',
          contentType: 'application/json',
          additionalParameters: [
            { in: 'header', name: 'Content-Type', value: 'text/plain' },
          ],
        },
      ),
    ).toThrow(/Content type control/);
  });
  it('redacts custom credential fields in all generated snippet languages without changing live inputs', () => {
    const rows: AdditionalParameter[] = [
      { in: 'query', name: 'api_key', value: 'private-query-secret' },
      {
        in: 'header',
        name: 'Authorization',
        value: 'Bearer private-header-secret',
      },
      { in: 'query', name: 'filter', value: 'active' },
    ];
    const preview = prepare(redactAdditionalParameters(rows));
    for (const language of [
      'cURL',
      'JavaScript',
      'TypeScript',
      'Python',
      'Java',
    ] as const) {
      const snippet = generateSnippet(preview, language);
      expect(snippet).not.toContain('private-query-secret');
      expect(snippet).not.toContain('private-header-secret');
      expect(snippet).toContain('YOUR_CREDENTIAL');
      expect(snippet).toContain('filter=active');
    }
    const live = prepare(rows);
    expect(new URL(live.url).searchParams.get('api_key')).toBe(
      'private-query-secret',
    );
    expect(live.headers.Authorization).toBe('Bearer private-header-secret');
    expect(rows[0]!.value).toBe('private-query-secret');
  });
  it('handles prototype-shaped header names through the shared fetch transport', () => {
    const request = prepare([
      { in: 'header', name: '__proto__', value: 'literal' },
    ]);
    expect(toFetchRequest(request).headers.get('__proto__')).toBe('literal');
    expect(Object.getPrototypeOf(request.headers)).toBe(Object.prototype);
  });
});
