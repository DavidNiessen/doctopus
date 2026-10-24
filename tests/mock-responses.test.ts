import { afterEach, expect, it, vi } from 'vitest';
import { generateMockResponse } from '@davidniessen/doctopus-explorer';
import type {
  Media,
  Operation,
  Schema,
} from '@davidniessen/doctopus-contracts';

const operation = (media: Media, status = '200'): Operation => ({
  id: 'mock',
  slug: 'mock',
  method: 'post',
  path: '/mock',
  summary: 'Mock',
  description: '',
  tags: [],
  deprecated: false,
  parameters: [],
  security: [],
  servers: [],
  source: '',
  responses: [
    {
      status,
      description: 'Preview',
      headers: {},
      content: { 'application/json': media },
    },
  ],
});
afterEach(() => vi.unstubAllGlobals());
it.each(['date-time', 'date', 'email', 'uri', 'ipv4'])(
  'produces usable %s examples with ordinary default bounds',
  (format) => {
    const value = JSON.parse(
      generateMockResponse(operation({ schema: { type: 'string', format } }))
        .body,
    );
    if (format === 'date-time' || format === 'date')
      expect(Number.isFinite(Date.parse(value))).toBe(true);
    else if (format === 'uri') expect(new URL(value).protocol).toBe('https:');
    else if (format === 'email') expect(value).toMatch(/^[^@]+@example\.com$/);
    else expect(value).toMatch(/^192\.0\.2\.\d+$/);
  },
);
it('generates repeatable, seed-dependent schema data without any transport', () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Unexpected request');
    }),
  );
  const op = operation({
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        count: { type: 'integer', minimum: 1, maximum: 9 },
        state: { enum: ['ready', 'waiting'] },
        secret: { $ref: '#/components/schemas/Secret' },
      },
    },
  });
  const options = {
    seed: 'first',
    schemas: { Secret: { type: 'string', writeOnly: true } },
  };
  const first = generateMockResponse(op, options);
  expect(generateMockResponse(op, options)).toEqual(first);
  expect(
    generateMockResponse(op, { ...options, seed: 'second' }).body,
  ).not.toBe(first.body);
  const body = JSON.parse(first.body);
  expect(body.id).toMatch(
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/,
  );
  expect(body.count).toBeGreaterThanOrEqual(1);
  expect(body.count).toBeLessThanOrEqual(9);
  expect(body).not.toHaveProperty('secret');
  expect(first).toMatchObject({
    kind: 'mock',
    source: 'schema',
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  expect(fetch).not.toHaveBeenCalled();
});
it('prefers inline and selected named examples and can explicitly regenerate from schema', () => {
  const op = operation({
    schema: { type: 'integer', minimum: 1, maximum: 1 },
    example: { published: 'inline' },
    examples: {
      alternate: { summary: 'Alternate', value: { published: 'named' } },
    },
  });
  expect(JSON.parse(generateMockResponse(op).body)).toEqual({
    published: 'inline',
  });
  expect(
    JSON.parse(generateMockResponse(op, { exampleId: 'named:alternate' }).body),
  ).toEqual({ published: 'named' });
  expect(generateMockResponse(op, { exampleId: 'generated' }).body).toBe('1');
  expect(() => generateMockResponse(op, { exampleId: 'missing' })).toThrow(
    /inline mock example/,
  );
});
it('never fetches external examples and falls back to the bounded generator', () => {
  vi.stubGlobal('fetch', vi.fn());
  const result = generateMockResponse(
    operation({
      schema: { type: 'boolean' },
      examples: { remote: { externalValue: 'https://example.com/secret' } },
    }),
  );
  expect(result.source).toBe('schema');
  expect(fetch).not.toHaveBeenCalled();
});
it.each(['204', '304', '101'])(
  'omits response bodies for HTTP %s',
  (status) => {
    expect(
      generateMockResponse(
        operation({ schema: {}, example: 'ignored' }, status),
      ),
    ).toMatchObject({ status: Number(status), body: '', source: 'empty' });
  },
);
it('omits HEAD and content-free bodies and resolves declared range/default statuses explicitly', () => {
  const op = operation({ schema: {}, example: 'ignored' });
  expect(generateMockResponse({ ...op, method: 'head' }).body).toBe('');
  op.responses[0]!.content = {};
  expect(generateMockResponse(op)).toMatchObject({
    body: '',
    source: 'empty',
    headers: {},
  });
  for (const [status, code] of [
    ['4XX', 400],
    ['default', 200],
  ] as const)
    expect(
      generateMockResponse(operation({ schema: { type: 'boolean' } }, status)),
    ).toMatchObject({ status: code, documentedStatus: status });
  expect(() => generateMockResponse(operation({ schema: {} }, '999'))).toThrow(
    /status/,
  );
  expect(() => generateMockResponse({ ...op, responses: [] })).toThrow(
    /documented/,
  );
});
it('retains serialized non-JSON examples and rejects unsupported synthetic structured media', () => {
  const op = operation({ schema: {} });
  op.responses[0]!.content = {
    'text/html': {
      schema: { type: 'string' },
      example: '<script>not_executed()</script>',
    },
    'application/xml': { schema: { type: 'object' } },
  };
  expect(generateMockResponse(op, { contentType: 'text/html' }).body).toBe(
    '<script>not_executed()</script>',
  );
  expect(() =>
    generateMockResponse(op, { contentType: 'application/xml' }),
  ).toThrow(/serialized example/);
  expect(() => generateMockResponse(op, { contentType: 'missing' })).toThrow(
    /media type/,
  );
  expect(() => generateMockResponse(op, { response: '404' })).toThrow(
    /documented/,
  );
});
it.each([
  { type: 'string', pattern: '^a+$' },
  { oneOf: [{ type: 'string' }, { type: 'integer' }] },
  { type: 'array', minItems: 9, items: { type: 'string' } },
  { type: 'array', minItems: 2, uniqueItems: true, items: { const: 'same' } },
  { type: 'integer', minimum: 5, maximum: 1 },
  { type: 'number', multipleOf: 0.1 },
  { type: 'string', format: 'binary' },
  { 'x-doctopus-boolean-schema': false },
] as Schema[])(
  'requires an explicit example for unsupported or unsatisfiable constraints %#',
  (schema) => {
    expect(() => generateMockResponse(operation({ schema }))).toThrow();
  },
);
it('supports bounded composition, required/additional fields, arrays and scalar annotations', () => {
  const schema: Schema = {
    allOf: [
      { type: 'object', properties: { id: { const: 'fixed' } } },
      {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            minItems: 2,
            maxItems: 2,
            items: { type: 'integer', minimum: 3, maximum: 3 },
          },
        },
      },
    ],
  };
  expect(JSON.parse(generateMockResponse(operation({ schema })).body)).toEqual({
    id: 'fixed',
    items: [3, 3],
  });
  expect(
    JSON.parse(
      generateMockResponse(
        operation({
          schema: {
            type: 'object',
            required: ['extra'],
            additionalProperties: { type: 'boolean' },
          },
        }),
      ).body,
    ),
  ).toHaveProperty('extra');
  expect(
    generateMockResponse(
      operation({
        schema: { type: 'integer', exclusiveMinimum: 0.5, maximum: 1 },
      }),
    ).body,
  ).toBe('1');
  expect(
    Number(
      generateMockResponse(
        operation({ schema: { type: 'integer', exclusiveMaximum: -1 } }),
      ).body,
    ),
  ).toBeLessThan(-1);
  expect(
    generateMockResponse(
      operation({ schema: { type: 'string', default: 'annotation' } }),
    ).body,
  ).toBe('"annotation"');
});
it('enforces source, recursion, node, seed and response byte budgets', () => {
  expect(() =>
    generateMockResponse(operation({ schema: {} }), { seed: 'x'.repeat(129) }),
  ).toThrow(/seed/);
  const cyclic: Schema = {
    type: 'object',
    properties: { next: { $ref: '#/components/schemas/Self' } },
  };
  expect(() =>
    generateMockResponse(operation({ schema: cyclic }), {
      schemas: { Self: cyclic },
    }),
  ).toThrow(/budget/);
  expect(() =>
    generateMockResponse(
      operation({ schema: {}, example: 'x'.repeat(2 * 1024 * 1024 + 1) }),
    ),
  ).toThrow(/2 MiB/);
  expect(() =>
    generateMockResponse(operation({ schema: {}, example: Infinity })),
  ).toThrow(/finite/);
  expect(() =>
    generateMockResponse(operation({ schema: {}, example: 9007199254740992 })),
  ).toThrow(/precision/);
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  expect(() =>
    generateMockResponse(operation({ schema: {}, example: cycle })),
  ).toThrow(/budget/);
});
