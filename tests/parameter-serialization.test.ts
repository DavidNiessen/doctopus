import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Operation, Parameter } from '@davidniessen/doctopus-contracts';
import {
  prepareRequest,
  redactRequest,
  canSerializeEmptyParameter,
} from '@davidniessen/doctopus-explorer';

const operation: Operation = {
  id: 'serialize',
  slug: 'serialize',
  method: 'get',
  path: '/colors',
  summary: '',
  description: '',
  tags: [],
  deprecated: false,
  parameters: [],
  responses: [],
  security: [],
  servers: [],
  source: '#/paths/colors/get',
};
const array = '["blue","black","brown"]';
const object = '{"R":100,"G":200,"B":150}';
function request(parameter: Partial<Parameter>, raw: string, extra = {}) {
  const p: Parameter = {
    name: 'color',
    in: 'query',
    required: true,
    description: '',
    schema: {
      type: raw.startsWith('[')
        ? 'array'
        : raw.startsWith('{')
          ? 'object'
          : 'string',
    },
    ...parameter,
  };
  return prepareRequest(
    {
      ...operation,
      path: p.in === 'path' ? '/colors/{color}' : '/colors',
      parameters: [p],
    },
    {},
    {
      server: 'https://api.example.test/v1',
      parameters: { [`${p.in}:${p.name}`]: raw },
      ...extra,
    },
  );
}
describe('OpenAPI parameter wire serialization', () => {
  it('handles long brace sequences without repeated placeholder searches', () => {
    const path = '/' + '{'.repeat(200_000);
    const prepared = prepareRequest(
      { ...operation, path },
      {},
      {
        server: 'https://api.example.test',
        parameters: {},
      },
    );
    expect(new URL(prepared.url).pathname.length).toBe(1 + 3 * 200_000);
    expect(prepared.url.endsWith('%7B'.repeat(100))).toBe(true);
    expect(() =>
      prepareRequest(
        { ...operation, path: path + '}' },
        {},
        {
          server: 'https://api.example.test',
          parameters: {},
        },
      ),
    ).toThrow('Unresolved path parameter');
    expect(() =>
      prepareRequest(
        { ...operation, path: '/}{}{later}' },
        {},
        {
          server: 'https://api.example.test',
          parameters: {},
        },
      ),
    ).toThrow('Unresolved path parameter');
  });
  it('preserves escaped strings and exact numeric tokens with linear JSON token consumption', () => {
    const text = '\\"'.repeat(25_000),
      raw = `[${JSON.stringify(text)},9007199254740993,1e400,-0,true,null]`;
    const styled = request({ schema: { type: 'array' }, explode: false }, raw);
    expect(new URL(styled.url).searchParams.get('color')).toBe(
      `${text},9007199254740993,1e400,-0,true,null`,
    );
    const content = request(
      { schema: {}, content: { 'application/json': { schema: {} } } },
      ` { "value": ${JSON.stringify(text)}, "n": 9007199254740993, "huge": 1e400 } `,
    );
    expect(new URL(content.url).searchParams.get('color')).toBe(
      `{"value":${JSON.stringify(text)},"n":9007199254740993,"huge":1e400}`,
    );
  });
  it.each(['query', 'header', 'path'] as const)(
    'supports explicit empty %s scalars while preserving omission defaults',
    (location) => {
      const key = `${location}:color`;
      const prepared = request({ in: location }, '', {
        parameterPresence: { [key]: true },
      });
      if (location === 'query')
        expect(prepared.url).toBe('https://api.example.test/v1/colors?color=');
      if (location === 'header') expect(prepared.headers.color).toBe('');
      if (location === 'path')
        expect(prepared.url).toBe('https://api.example.test/v1/colors/');
      expect(() => request({ in: location }, '')).toThrow('color is required');
      expect(() =>
        request({ in: location }, 'draft', {
          parameterPresence: { [key]: false },
        }),
      ).toThrow('color is required');
      if (location !== 'path') {
        const omitted = request(
          { in: location, required: false },
          'invalid draft',
          { parameterPresence: { [key]: false } },
        );
        expect(omitted.url).toBe('https://api.example.test/v1/colors');
      } else
        expect(() =>
          request({ in: location, required: false }, 'draft', {
            parameterPresence: { [key]: false },
          }),
        ).toThrow('Unresolved path');
    },
  );
  it('omits optional invalid structured/content drafts before parsing and retains precise included values', () => {
    expect(
      request({ required: false, schema: { type: 'array' } }, '[invalid', {
        parameterPresence: { 'query:color': false },
      }).url,
    ).toBe('https://api.example.test/v1/colors');
    expect(
      request(
        { required: false, content: { 'application/json': { schema: {} } } },
        'private invalid draft',
        { parameterPresence: { 'query:color': false } },
      ).url,
    ).toBe('https://api.example.test/v1/colors');
    expect(() =>
      request({ schema: { type: 'array' } }, '', {
        parameterPresence: { 'query:color': true },
      }),
    ).toThrow('valid JSON');
    expect(() =>
      request({ content: { 'application/json': { schema: {} } } }, '', {
        parameterPresence: { 'query:color': true },
      }),
    ).toThrow('valid JSON');
    expect(
      request({}, '9007199254740993', {
        parameterPresence: { 'query:color': true },
      }).url,
    ).toContain('color=9007199254740993');
  });
  it('keeps URL dot, cookie, forbidden-header and reserved-header boundaries with explicit presence', () => {
    expect(() =>
      request({ in: 'path', style: 'label' }, '', {
        parameterPresence: { 'path:color': true },
      }),
    ).toThrow('dot segments');
    expect(
      request({ in: 'path', style: 'matrix' }, '', {
        parameterPresence: { 'path:color': true },
      }).url.endsWith('/colors/;color='),
    ).toBe(true);
    expect(() =>
      request({ in: 'cookie' }, '', {
        parameterPresence: { 'cookie:color': true },
      }),
    ).toThrow('cannot be set manually');
    expect(() =>
      request({ in: 'header', name: 'Host' }, '', {
        parameterPresence: { 'header:Host': true },
      }),
    ).toThrow('Header cannot be set');
    expect(
      request({ in: 'header', name: 'Authorization' }, '', {
        parameterPresence: { 'header:Authorization': true },
      }).headers,
    ).not.toHaveProperty('Authorization');
  });
  it.each([null, [], true, 'true', 1])(
    'rejects invalid presence records %j without interpreting them as booleans',
    (parameterPresence) => {
      expect(() => request({}, '', { parameterPresence })).toThrow(
        'presence must be a record',
      );
    },
  );
  it.each([undefined, null, 1, 'true', {}])(
    'rejects nonboolean own presence flags %j',
    (flag) => {
      expect(() =>
        request({}, '', { parameterPresence: { 'query:color': flag } }),
      ).toThrow('must be a boolean');
    },
  );
  it('ignores inherited inclusion flags and isolates same-name locations', () => {
    expect(() =>
      request({}, '', {
        parameterPresence: Object.create({ 'query:color': true }),
      }),
    ).toThrow('color is required');
    const parameters: Parameter[] = ['query', 'header'].map((location) => ({
      name: 'trace',
      in: location as 'query' | 'header',
      required: false,
      description: '',
      schema: { type: 'string' },
    }));
    const prepared = prepareRequest(
      { ...operation, parameters },
      {},
      {
        server: 'https://api.example.test',
        parameters: {
          'query:trace': 'query draft',
          'header:trace': 'header value',
        },
        parameterPresence: { 'query:trace': false, 'header:trace': true },
      },
    );
    expect(prepared.url).toBe('https://api.example.test/colors');
    expect(prepared.headers.trace).toBe('header value');
  });
  it('reports whether empty text can serialize through the real parameter rules', () => {
    const parameter: Parameter = {
      name: 'color',
      in: 'query',
      required: true,
      description: '',
      schema: { type: 'string' },
    };
    expect(canSerializeEmptyParameter(parameter)).toBe(true);
    expect(
      canSerializeEmptyParameter({
        ...parameter,
        schema: { $ref: '#/components/schemas/Missing' },
      }),
    ).toBe(false);
    expect(
      canSerializeEmptyParameter({ ...parameter, schema: { type: 'object' } }),
    ).toBe(false);
    expect(
      canSerializeEmptyParameter({
        ...parameter,
        content: { 'text/plain': { schema: {} } },
      }),
    ).toBe(true);
    expect(
      canSerializeEmptyParameter({
        ...parameter,
        content: { 'application/json': { schema: {} } },
      }),
    ).toBe(false);
    expect(canSerializeEmptyParameter({ ...parameter, in: 'cookie' })).toBe(
      false,
    );
    expect(
      canSerializeEmptyParameter({
        ...parameter,
        in: 'header',
        name: 'Authorization',
      }),
    ).toBe(false);
    expect(
      canSerializeEmptyParameter({ ...parameter, in: 'header', name: 'Host' }),
    ).toBe(false);
  });
  it('transmits empty query/path/header values to a real loopback server and omits retained drafts', async () => {
    let received: {
      url?: string;
      headers?: import('node:http').IncomingHttpHeaders;
    } = {};
    const server = createServer((incoming, response) => {
      received = { url: incoming.url ?? '', headers: incoming.headers };
      response.end('ok');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const parameters: Parameter[] = [
        {
          name: 'id',
          in: 'path',
          required: true,
          description: '',
          schema: { type: 'string' },
        },
        {
          name: 'trace',
          in: 'query',
          required: true,
          description: '',
          schema: { type: 'string' },
        },
        {
          name: 'trace',
          in: 'header',
          required: false,
          description: '',
          schema: { type: 'string' },
        },
        {
          name: 'draft',
          in: 'query',
          required: false,
          description: '',
          schema: { type: 'object' },
        },
      ];
      const prepared = prepareRequest(
        { ...operation, path: '/echo/{id}', parameters },
        {},
        {
          server: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
          parameters: {
            'path:id': '',
            'query:trace': '',
            'header:trace': '',
            'query:draft': 'invalid private draft',
          },
          parameterPresence: {
            'path:id': true,
            'query:trace': true,
            'header:trace': true,
            'query:draft': false,
          },
        },
      );
      await (
        await fetch(prepared.url, { headers: Object.entries(prepared.headers) })
      ).text();
      expect(received.url).toBe('/echo/?trace=');
      expect(received.headers).toHaveProperty('trace', '');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
  it.each([
    ['simple', false, array, 'blue,black,brown'],
    ['simple', true, array, 'blue,black,brown'],
    ['simple', false, object, 'R,100,G,200,B,150'],
    ['simple', true, object, 'R=100,G=200,B=150'],
    ['label', false, array, '.blue,black,brown'],
    ['label', true, array, '.blue.black.brown'],
    ['label', false, object, '.R,100,G,200,B,150'],
    ['label', true, object, '.R=100.G=200.B=150'],
    ['matrix', false, array, ';color=blue,black,brown'],
    ['matrix', true, array, ';color=blue;color=black;color=brown'],
    ['matrix', false, object, ';color=R,100,G,200,B,150'],
    ['matrix', true, object, ';R=100;G=200;B=150'],
    ['simple', false, "a/b,!'()*", 'a%2Fb%2C%21%27%28%29%2A'],
  ] as const)(
    'serializes path %s / explode=%s / %s',
    (style, explode, raw, expected) => {
      expect(request({ in: 'path', style, explode }, raw).url).toBe(
        `https://api.example.test/v1/colors/${expected}`,
      );
    },
  );
  it.each([
    ['form', true, array, 'color=blue&color=black&color=brown'],
    ['form', false, array, 'color=blue,black,brown'],
    ['form', true, object, 'R=100&G=200&B=150'],
    ['form', false, object, 'color=R,100,G,200,B,150'],
    ['spaceDelimited', false, array, 'color=blue%20black%20brown'],
    ['spaceDelimited', false, object, 'color=R%20100%20G%20200%20B%20150'],
    ['pipeDelimited', false, array, 'color=blue%7Cblack%7Cbrown'],
    ['pipeDelimited', false, object, 'color=R%7C100%7CG%7C200%7CB%7C150'],
    [
      'deepObject',
      true,
      object,
      'color%5BR%5D=100&color%5BG%5D=200&color%5BB%5D=150',
    ],
    [
      'form',
      false,
      '["a,b","c&d","é /+"]',
      'color=a%2Cb,c%26d,%C3%A9%20%2F%2B',
    ],
  ] as const)(
    'serializes query %s / explode=%s / %s',
    (style, explode, raw, expected) => {
      expect(request({ style, explode }, raw).url).toBe(
        `https://api.example.test/v1/colors?${expected}`,
      );
    },
  );
  it('uses style-specific explode defaults and resolves referenced parameter types', () => {
    expect(request({ style: 'pipeDelimited' }, array).url).toContain(
      'color=blue%7Cblack%7Cbrown',
    );
    expect(request({ style: 'deepObject' }, object).url).toContain(
      'color%5BR%5D=100',
    );
    expect(
      request({ schema: { $ref: '#/components/schemas/Colors' } }, array, {
        schemas: { Colors: { type: 'array' } },
      }).url,
    ).toContain('color=blue&color=black');
    expect(
      request(
        { schema: { $ref: '#/components/schemas/Colors', maxItems: 3 } },
        array,
        {
          schemas: { Colors: { type: 'array' } },
        },
      ).url,
    ).toContain('color=blue&color=black');
    expect(
      request(
        { schema: { $ref: '#/components/schemas/Colors', type: 'object' } },
        array,
        {
          schemas: { Colors: { type: 'array' } },
          openapiVersion: '3.0.4',
        },
      ).url,
    ).toContain('color=blue&color=black');
  });
  it.each([
    [array, false, 'blue,black,brown'],
    [object, false, 'R,100,G,200,B,150'],
    [object, true, 'R=100,G=200,B=150'],
  ] as const)(
    'serializes simple header %s with explode=%s',
    (raw, explode, expected) => {
      expect(
        request({ in: 'header', name: 'X-Color', explode }, raw).headers[
          'X-Color'
        ],
      ).toBe(expected);
    },
  );
  it.each(['path', 'query', 'header'] as const)(
    'serializes JSON content in a %s parameter once',
    (location) => {
      const raw = ' { "query": {"name": "a/b&c"}, "ids": [1,2] } ';
      const result = request(
        {
          in: location,
          content: { 'application/problem+json': { schema: {} } },
        },
        raw,
      );
      const compact = JSON.stringify(JSON.parse(raw));
      if (location === 'header') expect(result.headers.color).toBe(compact);
      else if (location === 'query')
        expect(new URL(result.url).searchParams.get('color')).toBe(compact);
      else
        expect(
          decodeURIComponent(new URL(result.url).pathname.split('/').at(-1)!),
        ).toBe(compact);
    },
  );
  it('preserves serialized non-JSON content and safely supports reserved query values', () => {
    expect(
      new URL(
        request({ content: { 'text/plain': { schema: {} } } }, ' a/b & c ').url,
      ).searchParams.get('color'),
    ).toBe(' a/b & c ');
    expect(
      request({ allowReserved: true }, 'https://example.test/a?x%3D1@%5B%5D')
        .url,
    ).toContain('color=https://example.test/a?x%3D1@%5B%5D');
    expect(() => request({ allowReserved: true }, 'a&injected=true')).toThrow(
      /allowReserved/,
    );
    expect(() => request({ allowReserved: true }, 'a#fragment')).toThrow(
      /allowReserved/,
    );
    expect(
      new URL(request({}, 'a&injected=true#fragment').url).searchParams.get(
        'color',
      ),
    ).toBe('a&injected=true#fragment');
  });
  it('compacts JSON content without rounding numbers or changing string escapes', () => {
    const raw = String.raw` { "id": 9007199254740993, "huge": 1e400, "escaped": "a \"b\" \u0063" } `;
    const result = request(
      { content: { 'application/json': { schema: {} } } },
      raw,
    );
    expect(new URL(result.url).searchParams.get('color')).toBe(
      String.raw`{"id":9007199254740993,"huge":1e400,"escaped":"a \"b\" \u0063"}`,
    );
  });
  it('preserves numeric lexemes and null in styled collections', () => {
    expect(
      request({ explode: false }, '[9007199254740993,1e400,-0,1.00,null]').url,
    ).toContain('color=9007199254740993,1e400,-0,1.00,null');
    expect(
      request({ in: 'header', name: 'X-Color' }, '[9007199254740993,null]')
        .headers['X-Color'],
    ).toBe('9007199254740993,null');
  });
  it.each([
    [{}, '[{"nested":true}]', /nested parameter/],
    [{}, '{"nested":[1,2]}', /nested parameter/],
    [{ schema: { type: 'array' } }, '{}', /JSON array/],
    [{ schema: { $ref: '#/missing' } }, 'x', /reference could not resolve/],
    [{ style: 'deepObject', explode: false }, object, /deepObject/],
    [{ style: 'pipeDelimited', explode: true }, array, /explode disabled/],
    [{ style: 'spaceDelimited' }, 'blue', /requires an array or object/],
    [{ style: 'deepObject' }, '{}', /empty deepObject/],
    [{ style: 'form' }, '[]', /empty exploded/],
    [{ in: 'header', style: 'form' }, object, /Unsupported header style/],
    [
      { content: { 'application/json': { schema: {} } } },
      'not JSON',
      /valid JSON/,
    ],
  ] as const)(
    'rejects undefined or invalid parameter serialization %#',
    (parameter, raw, message) => {
      expect(() => request(parameter, raw)).toThrow(message);
    },
  );
  it.each(['.', '..', '%2e', '.%2e'])(
    'prevents URL normalization from changing the route for %s',
    (value) => {
      if (value.includes('%'))
        expect(request({ in: 'path' }, value).url).toContain('%252e');
      else expect(() => request({ in: 'path' }, value)).toThrow(/dot segments/);
    },
  );
  it('ignores OpenAPI reserved header parameters and rejects browser-controlled headers', () => {
    for (const name of ['Accept', 'CONTENT-TYPE', 'authorization'])
      expect(request({ in: 'header', name }, '').headers).toEqual({
        Accept: '*/*',
      });
    for (const name of [
      'Host',
      'Cookie',
      'sec-fetch-site',
      'Referer',
      'Content-Length',
      'bad name',
    ])
      expect(() => request({ in: 'header', name }, 'fixture')).toThrow(
        /Header cannot/,
      );
    expect(
      request({ in: 'header', name: 'Hostess' }, 'fixture').headers.Hostess,
    ).toBe('fixture');
    expect(
      request({ in: 'header', name: '__proto__' }, 'fixture').headers.__proto__,
    ).toBe('fixture');
    expect(() =>
      request({ in: 'header', name: 'X-Color' }, 'line\r\nbreak'),
    ).toThrow(/characters/);
    expect(() => request({ in: 'header', name: 'X-Color' }, '😀')).toThrow(
      /characters/,
    );
  });
  it('preserves query delimiters when appending a query API key', () => {
    const p: Parameter = {
      name: 'color',
      in: 'query',
      required: true,
      description: '',
      schema: { type: 'array' },
      explode: false,
    };
    const result = prepareRequest(
      { ...operation, parameters: [p], security: [{ key: [] }] },
      {
        key: { type: 'apiKey', in: 'query', name: 'api-key' },
      },
      {
        server: 'https://example.test',
        parameters: { 'query:color': '["a,b","c"]' },
        credentials: { key: 'fixture&token' },
      },
    );
    expect(result.url).toBe(
      'https://example.test/colors?color=a%2Cb,c&api-key=fixture%26token',
    );
    const secret = 'fixture~*token';
    const secured = prepareRequest(
      { ...operation, security: [{ key: [] }] },
      {
        key: { type: 'apiKey', in: 'query', name: 'api-key' },
      },
      {
        server: 'https://example.test',
        parameters: {},
        credentials: { key: secret },
      },
    );
    expect(secured.url).toContain('api-key=fixture~%2Atoken');
    expect(redactRequest(secured, { key: secret }).url).toContain(
      'api-key=YOUR_CREDENTIAL',
    );
  });
  it('sends exact path/query/header bytes to a real HTTP server', async () => {
    let received: { url?: string; header?: string } = {};
    const server = createServer((req, res) => {
      received = { url: req.url!, header: req.headers['x-color'] as string };
      res.writeHead(204).end();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const parameters: Parameter[] = [
        {
          name: 'color',
          in: 'path',
          required: true,
          description: '',
          schema: { type: 'array' },
          style: 'matrix',
          explode: true,
        },
        {
          name: 'tags',
          in: 'query',
          required: true,
          description: '',
          schema: { type: 'array' },
          explode: false,
        },
        {
          name: 'X-Color',
          in: 'header',
          required: true,
          description: '',
          schema: { type: 'object' },
          explode: true,
        },
      ];
      const prepared = prepareRequest(
        { ...operation, path: '/colors/{color}', parameters },
        {},
        {
          server: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
          parameters: {
            'path:color': '["a/b","c"]',
            'query:tags': '["x,y","z&n"]',
            'header:X-Color': object,
          },
        },
      );
      expect(
        (await fetch(prepared.url, { headers: prepared.headers })).status,
      ).toBe(204);
      expect(received).toEqual({
        url: '/v1/colors/;color=a%2Fb;color=c?tags=x%2Cy,z%26n',
        header: 'R=100,G=200,B=150',
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
