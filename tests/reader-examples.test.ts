import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import {
  exampleFor,
  resolveSchema,
  exampleChoices,
  formatExample,
  hasExternalExamples,
  isJsonMediaType,
} from '@davidniessen/doctopus-contracts';
import { loadSpec } from '@davidniessen/doctopus-spec';
import { prepareRequest } from '@davidniessen/doctopus-explorer';

describe('authored example presentation', () => {
  it('resolves legacy reference aliases without adopting ignored siblings', () => {
    const schemas = {
      Alias: { $ref: '#/components/schemas/Value', minLength: 10 },
      Value: { type: 'string', description: 'Base' },
    };
    expect(
      resolveSchema(
        { $ref: '#/components/schemas/Alias', nullable: true },
        schemas,
        { ignoreReferenceSiblings: true },
      ),
    ).toEqual(schemas.Value);
    expect(
      resolveSchema(
        { $ref: '#/components/schemas/Value', nullable: true },
        schemas,
      ),
    ).toMatchObject({ nullable: true });
  });
  it('retains reference annotations alongside intersected validation siblings', () => {
    const target = {
      type: 'string',
      description: 'Identifier',
      readOnly: true,
    };
    expect(
      resolveSchema(
        { $ref: '#/components/schemas/Id', maxLength: 20 },
        { Id: target },
      ),
    ).toEqual({
      description: 'Identifier',
      readOnly: true,
      allOf: [target, { maxLength: 20 }],
    });
  });
  it('generates null and avoids forbidden properties or array items', () => {
    expect(exampleFor({ type: 'null' })).toBeNull();
    expect(exampleFor({ type: ['null'] })).toBeNull();
    expect(
      exampleFor({
        type: 'object',
        properties: { forbidden: false, name: { const: 'present' } },
      }),
    ).toEqual({ name: 'present' });
    expect(exampleFor({ type: 'array', items: false })).toEqual([]);
  });
  it.each([null, false, 0, ''])('preserves the inline value %j', (value) => {
    expect(exampleChoices({ schema: {}, example: value })).toEqual([
      { id: 'inline', label: 'Example', value },
    ]);
  });
  it('uses named values and summaries without treating external URLs as payloads', () => {
    const media = {
      schema: { type: 'string' },
      examples: {
        empty: { summary: 'Empty value', value: null },
        remote: { externalValue: 'https://examples.invalid/value' },
        false: { value: false },
      },
    };
    expect(exampleChoices(media)).toEqual([
      { id: 'named:empty', label: 'Empty value', value: null },
      { id: 'named:false', label: 'false', value: false },
    ]);
    expect(hasExternalExamples(media)).toBe(true);
    expect(exampleChoices({ schema: { const: 0 } })[0]).toEqual({
      id: 'generated',
      label: 'Generated example',
      value: 0,
    });
  });
  it('formats JSON strings and preserves serialized non-JSON text exactly', () => {
    expect(formatExample('  text  ', 'text/plain')).toBe('  text  ');
    expect(formatExample('<a/>', 'application/xml')).toBe('<a/>');
    expect(
      formatExample('text', 'application/problem+json; charset=utf-8'),
    ).toBe('"text"');
    expect(formatExample(null, 'application/json')).toBe('null');
    expect(isJsonMediaType('APPLICATION/JSON; charset=UTF-8')).toBe(true);
    expect(isJsonMediaType('text/jsonp')).toBe(false);
  });
});

describe('example requests', () => {
  const getApi = () =>
    loadSpec(resolve('examples/components'), {
      id: 'gallery',
      path: 'openapi.yaml',
    });
  it('preserves whitespace bodies and uses the requested response format', async () => {
    const api = await getApi();
    const operation = api.operations.find(
      (item) => item.id === 'sampleValues',
    )!;
    const request = prepareRequest(operation, api.securitySchemes, {
      server: 'https://example.test',
      parameters: {},
      body: '  text  ',
      contentType: 'text/plain',
      accept: 'text/plain',
    });
    expect(request.body).toBe('  text  ');
    expect(request.headers).toMatchObject({
      'Content-Type': 'text/plain',
      Accept: 'text/plain',
    });
    expect(request.headers.Authorization).toBeUndefined();
    expect(() =>
      prepareRequest(
        operation,
        {},
        {
          server: 'https://example.test',
          parameters: {},
          body: '   ',
          contentType: 'application/json',
        },
      ),
    ).toThrow(/valid JSON/);
    expect(() =>
      prepareRequest(
        operation,
        {},
        {
          server: 'https://example.test',
          parameters: {},
          body: '',
          contentType: 'text/plain',
        },
      ),
    ).toThrow(/required/);
    expect(() =>
      prepareRequest(
        operation,
        {},
        {
          server: 'https://example.test',
          parameters: {},
          body: 'null',
          accept: 'text/plain\r\nx-evil: true',
        },
      ),
    ).toThrow(/newlines/);
  });
  it('prefers supplied complete credentials over an anonymous alternative', async () => {
    const api = await getApi();
    const operation = api.operations.find(
      (item) => item.id === 'sampleValues',
    )!;
    const request = prepareRequest(operation, api.securitySchemes, {
      server: 'https://example.test',
      parameters: {},
      body: 'null',
      credentials: { bearer: 'fixture-token' },
    });
    expect(request.headers.Authorization).toBe('Bearer fixture-token');
    expect(request.body).toBe('null');
  });
});
