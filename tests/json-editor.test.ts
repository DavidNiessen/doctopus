import { describe, expect, it } from 'vitest';
import {
  parseJsonValue,
  serializeJsonValue,
  setJsonProperty,
} from '@davidniessen/doctopus-contracts';
import { redactJsonBody, redactRequest } from '@davidniessen/doctopus-explorer';
import type { BodyRedaction } from '@davidniessen/doctopus-explorer';

describe('lossless JSON field editing', () => {
  it('preserves numeric tokens, falsy values and semantic string values', () => {
    const raw = String.raw` { "id":9007199254740993, "huge":1e400, "precise":1.234567890123456789, "zero":-0, "enabled":false, "empty":"", "nothing":null, "nested":["null",0,true], "escaped":"quote \" and \\ and \u0061" } `;
    const value = parseJsonValue(raw);
    const compact = serializeJsonValue(value);
    expect(compact).toContain('"id":9007199254740993');
    expect(compact).toContain('"huge":1e400');
    expect(compact).toContain('"precise":1.234567890123456789');
    expect(compact).toContain('"zero":-0');
    expect(JSON.parse(compact)).toEqual(JSON.parse(raw));
    expect(
      serializeJsonValue(parseJsonValue(serializeJsonValue(value, true))),
    ).toBe(compact);
  });
  it('updates properties without mutation, prototype effects or losing unknown values', () => {
    const value = parseJsonValue(
      '{"name":"before","id":9007199254740993,"__proto__":{"safe":true}}',
    );
    if (value.kind !== 'object') throw new Error('Expected object');
    const next = setJsonProperty(value, 'name', {
      kind: 'string',
      value: 'after',
    });
    expect(serializeJsonValue(value)).toContain('"name":"before"');
    expect(serializeJsonValue(next)).toBe(
      '{"name":"after","id":9007199254740993,"__proto__":{"safe":true}}',
    );
    expect(
      serializeJsonValue(setJsonProperty(next, '__proto__', undefined)),
    ).not.toContain('__proto__');
    expect(
      serializeJsonValue(
        setJsonProperty(next, 'constructor', { kind: 'boolean', value: false }),
      ),
    ).toContain('"constructor":false');
    expect({}).not.toHaveProperty('safe');
  });
  it.each([
    '',
    '[1,]',
    '{"a":1,"a":2}',
    '{"a":1,"\\u0061":2}',
    'NaN',
    '{unquoted:1}',
  ])('rejects unsafe field-editing input %s', (raw) =>
    expect(() => parseJsonValue(raw)).toThrow(),
  );
  it('bounds input bytes, nesting and values without truncating', () => {
    expect(() => parseJsonValue(JSON.stringify('é'.repeat(530_000)))).toThrow(
      /1 MiB/,
    );
    expect(() => parseJsonValue('['.repeat(34) + '0' + ']'.repeat(34))).toThrow(
      /32 levels/,
    );
    expect(() =>
      parseJsonValue(
        '[' + Array.from({ length: 10_001 }, () => '0').join(',') + ']',
      ),
    ).toThrow(/10,000/);
  });
  it('rejects an invalid numeric token supplied to the serializer', () => {
    expect(() =>
      serializeJsonValue({ kind: 'number', text: '0);evil()' }),
    ).toThrow(/Invalid JSON number/);
  });
});

describe('schema-aware JSON snippet redaction', () => {
  const context: BodyRedaction = {
    schema: {
      type: 'object',
      properties: {
        password: { type: 'string', format: 'password' },
        private: { $ref: '#/components/schemas/Private' },
        nested: {
          type: 'array',
          items: {
            type: 'object',
            properties: { secret: { type: 'string', writeOnly: true } },
          },
        },
        composed: { allOf: [{ type: 'string' }, { writeOnly: true }] },
      },
    },
    schemas: { Private: { type: 'string', writeOnly: true } },
    openapiVersion: '3.1.0',
  };
  it('redacts nested, composed and referenced sensitive values while preserving large IDs', () => {
    const raw =
      '{"id":9007199254740993,"password":"hidden-a","private":"hidden-b","nested":[{"secret":"hidden-c","visible":false}],"composed":"hidden-d"}';
    const redacted = redactJsonBody(raw, context);
    expect(redacted).not.toContain('hidden-');
    expect(redacted).toContain('9007199254740993');
    expect(JSON.parse(redacted)).toEqual({
      id: Number('9007199254740993'),
      password: 'YOUR_SENSITIVE_VALUE',
      private: 'YOUR_SENSITIVE_VALUE',
      nested: [{ secret: 'YOUR_SENSITIVE_VALUE', visible: false }],
      composed: 'YOUR_SENSITIVE_VALUE',
    });
    const request = {
      url: 'https://example.test',
      method: 'POST',
      headers: {},
      body: raw,
    };
    expect(redactRequest(request, {}, context).body).toBe(redacted);
    expect(request.body).toBe(raw);
  });
  it('redacts decoded credentials even when input strings use Unicode escapes', () => {
    expect(
      redactJsonBody(
        '{"token":"\\u0066ixture-secret"}',
        { schema: {}, schemas: {} },
        ['fixture-secret'],
      ),
    ).toContain('YOUR_CREDENTIAL');
    expect(
      redactRequest(
        {
          url: 'https://example.test',
          method: 'POST',
          headers: {},
          body: JSON.stringify({ token: 'fixture-"secret' }),
        },
        { bearer: 'fixture-"secret' },
      ).body,
    ).not.toContain('secret');
  });
  it('preserves exact unsensitive bodies and conservatively handles pattern/conditional annotations', () => {
    const raw = ' { "name": "visible", "id": 1e20 } ';
    expect(redactJsonBody(raw, context)).toBe(raw);
    expect(
      redactJsonBody('{"secret":"hidden"}', {
        schema: { then: { properties: { secret: { writeOnly: true } } } },
        schemas: {},
      }),
    ).not.toContain('hidden');
    expect(
      redactJsonBody('{"unknown":"hidden"}', {
        schema: { patternProperties: { '(a+)+$': { writeOnly: true } } },
        schemas: {},
      }),
    ).not.toContain('hidden');
  });
  it.each(['{"a":1,"a":2}', 'not JSON', '"' + 'a'.repeat(1_048_577) + '"'])(
    'omits snippets when a body cannot be redacted safely %#',
    (raw) => expect(redactJsonBody(raw, context)).toBe('YOUR_REQUEST_BODY'),
  );
  it('omits snippets for unresolved or excessive schema branches', () => {
    expect(
      redactJsonBody('{"value":"hidden"}', {
        schema: { $ref: '#/missing' },
        schemas: {},
      }),
    ).toBe('YOUR_REQUEST_BODY');
    expect(
      redactJsonBody('{"value":"hidden"}', {
        schema: { allOf: Array.from({ length: 10_001 }, () => ({})) },
        schemas: {},
      }),
    ).toBe('YOUR_REQUEST_BODY');
  });
});
