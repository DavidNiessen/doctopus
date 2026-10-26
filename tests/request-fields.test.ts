import { describe, it, expect } from 'vitest';
import { parseBrowserSpec } from '@davidniessen/doctopus-spec/browser';
import { requestFields } from '../apps/reader/src/request-fields.js';
const api = parseBrowserSpec(
  JSON.stringify({
    openapi: '3.1.0',
    info: {
      title: 'Request fields',
      version: 'v1',
    },
    paths: {
      '/items/{id}': {
        post: {
          parameters: [
            {
              in: 'path',
              name: 'id',
              required: true,
              schema: {
                type: 'string',
              },
            },
            {
              in: 'query',
              name: 'limit',
              schema: {
                type: 'integer',
              },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name'],
                  properties: {
                    name: {
                      type: 'string',
                    },
                    count: {
                      type: 'number',
                    },
                    enabled: {
                      type: 'boolean',
                    },
                    note: {
                      type: 'string',
                    },
                    profile: {
                      type: 'object',
                      required: ['label'],
                      properties: {
                        label: {
                          type: 'string',
                        },
                      },
                    },
                    dictionary: {
                      type: 'object',
                      additionalProperties: {
                        type: 'string',
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'ok',
            },
          },
        },
      },
    },
  }),
  'https://example.com/openapi.json',
);
const operation = api.operations[0]!;
const check = (
  body: string,
  parameters: Record<string, string> = { 'path:id': 'item-1' },
) =>
  requestFields(
    operation,
    parameters,
    body,
    'application/json',
    'json',
    api.schemas,
  );
describe('spec-driven request fields', () => {
  it('blocks missing required path and nested body fields and identifies each name', () => {
    expect(check('{"profile":{}}', {}).errors).toEqual([
      'id is required.',
      'Body.name is required.',
      'Body.profile.label is required.',
    ]);
    expect(check('{"name":"  "}').errors).toContain('Body.name is required.');
  });
  it('omits blank optional fields while preserving false, zero and exact numeric tokens', () => {
    const result = check(
      '{"name":"demo","enabled":false,"count":900719925474099312345,"note":"  "}',
    );
    expect(result.errors).toEqual([]);
    expect(result.body).toContain('900719925474099312345');
    expect(JSON.parse(result.body)).toMatchObject({
      name: 'demo',
      enabled: false,
    });
    expect(result.body).not.toContain('note');
    expect(JSON.parse(check('{"name":"demo","count":0}').body).count).toBe(0);
  });
  it('rejects undeclared named fields at every level and accepts dictionaries declared by the spec', () => {
    expect(
      check(
        '{"name":"demo","extra":"value","profile":{"label":"ok","extra":1}}',
      ).errors,
    ).toEqual([
      'Body.extra is not defined in the specification.',
      'Body.profile.extra is not defined in the specification.',
    ]);
    expect(
      check('{"name":"demo","dictionary":{"first":"value"}}').errors,
    ).toEqual([]);
  });
  it('checks required fields on the matching union branch while allowing other declared branch fields', () => {
    const union = {
      ...operation,
      requestBody: {
        required: true,
        description: '',
        content: {
          'application/json': {
            schema: {
              oneOf: [
                {
                  type: 'object',
                  properties: {
                    kind: { const: 'person' },
                    name: { type: 'string' },
                  },
                  required: ['kind', 'name'],
                },
                {
                  type: 'object',
                  properties: {
                    kind: { const: 'company' },
                    company: { type: 'string' },
                  },
                  required: ['kind', 'company'],
                },
              ],
            },
          },
        },
      },
    };
    const validate = (body: string) =>
      requestFields(
        union,
        { 'path:id': '1' },
        body,
        'application/json',
        'json',
        api.schemas,
      );
    expect(validate('{"kind":"company","name":"retained"}').errors).toContain(
      'Body.company is required.',
    );
    expect(
      validate('{"kind":"company","name":"retained","company":"Acme"}').errors,
    ).toEqual([]);
    expect(
      validate('{"kind":"company","company":"Acme","rogue":1}').errors,
    ).toContain('Body.rogue is not defined in the specification.');
  });
  it('omits an empty optional request body and never invents a body for an operation without one', () => {
    expect(
      requestFields(
        {
          ...operation,
          requestBody: { ...operation.requestBody!, required: false },
        },
        { 'path:id': '1' },
        '{}',
        'application/json',
        'json',
        api.schemas,
      ),
    ).toEqual({ body: '', errors: [] });
    const noBody = { ...operation };
    delete noBody.requestBody;
    expect(
      requestFields(
        noBody,
        { 'path:id': '1' },
        '{"extra":true}',
        'application/json',
        'json',
        api.schemas,
      ),
    ).toEqual({ body: '', errors: [] });
  });
  it('retains nonempty encoded form bytes and repeated values while omitting only blank occurrences', () => {
    const form = {
      ...operation,
      requestBody: {
        required: true,
        description: '',
        content: {
          'application/x-www-form-urlencoded': {
            schema: {
              type: 'object',
              required: ['name'],
              properties: {
                name: { type: 'string' },
                note: { type: 'string' },
              },
            },
          },
        },
      },
    };
    const result = requestFields(
      form,
      { 'path:id': '1' },
      'name=A%20B&note=one&note=&note=two',
      'application/x-www-form-urlencoded',
      'serialized',
      {},
    );
    expect(result).toEqual({
      body: 'name=A%20B&note=one&note=two',
      errors: [],
    });
  });
});
