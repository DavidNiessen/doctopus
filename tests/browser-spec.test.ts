import { describe, expect, it } from 'vitest';
import { parseBrowserSpec } from '@davidniessen/doctopus-spec/browser';
const specification = {
  openapi: '3.1.0',
  info: { title: 'Direct API', version: '1.0.0' },
  paths: {
    '/hello': {
      get: {
        operationId: 'hello',
        summary: 'Hello',
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Greeting' },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Greeting: { type: 'object', properties: { message: { type: 'string' } } },
    },
  },
};
describe('portable browser OpenAPI normalization', () => {
  it('uses shared OpenAPI normalization and resolves omitted/relative servers from the spec URL', () => {
    const api = parseBrowserSpec(
      JSON.stringify(specification),
      'https://example.com/specs/openapi.json',
    );
    expect(api.title).toBe('Direct API');
    expect(api.operations[0]?.id).toBe('hello');
    expect(api.servers).toEqual(['https://example.com/']);
    expect(api.operations[0]?.servers).toEqual(api.servers);
    expect(api.schemas.Greeting).toMatchObject({ type: 'object' });
    const relative = parseBrowserSpec(
      JSON.stringify({ ...specification, servers: [{ url: '../api' }] }),
      'https://example.com/specs/openapi.json',
    );
    expect(relative.servers).toEqual(['https://example.com/api']);
  });
  it('accepts YAML and rejects duplicate keys, unsupported versions, invalid schemas and external references', () => {
    expect(
      parseBrowserSpec(
        'openapi: 3.0.3\ninfo:\n  title: YAML API\n  version: v1\npaths: {}\n',
        'https://example.com/openapi.yaml',
      ).title,
    ).toBe('YAML API');
    for (const document of [
      { ...specification, openapi: '2.0' },
      { ...specification, info: {} },
      { ...specification, components: { schemas: { Greeting: { type: 42 } } } },
      {
        ...specification,
        components: {
          schemas: {
            Greeting: { $ref: 'https://other.example.com/types.json' },
          },
        },
      },
    ])
      expect(() =>
        parseBrowserSpec(
          JSON.stringify(document),
          'https://example.com/openapi.json',
        ),
      ).toThrow();
    expect(() =>
      parseBrowserSpec(
        'openapi: 3.0.3\nopenapi: 3.1.0',
        'https://example.com/openapi.yaml',
      ),
    ).toThrow();
  });
});
