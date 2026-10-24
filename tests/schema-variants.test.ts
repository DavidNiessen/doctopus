import { describe, expect, it } from 'vitest';
import {
  schemaVariants,
  objectFieldSchema,
  serializeJsonValue,
  setJsonProperty,
} from '@davidniessen/doctopus-contracts';
import type { Schema } from '@davidniessen/doctopus-contracts';
import { redactJsonBody } from '@davidniessen/doctopus-explorer';
import { bodyFieldModel } from '../apps/reader/src/body-fields.js';

const person: Schema = {
  title: 'Individual',
  type: 'object',
  required: ['kind', 'name'],
  properties: {
    kind: { type: 'string', const: 'person' },
    name: { type: 'string' },
    token: { type: 'string', writeOnly: true },
  },
};
const organization: Schema = {
  title: 'Organization',
  type: 'object',
  properties: {
    kind: { const: 'organization' },
    company: { type: 'string' },
    token: { type: 'string' },
  },
};
const schemas = { Person: person, Organization: organization };
const root: Schema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'integer' },
    serverOnly: { type: 'string', readOnly: true },
  },
  discriminator: {
    propertyName: 'kind',
    mapping: {
      person: '#/components/schemas/Person',
      organization: '#/components/schemas/Organization',
    },
  },
  oneOf: [
    { $ref: '#/components/schemas/Person' },
    { $ref: '#/components/schemas/Organization' },
  ],
};

describe('explicit bounded schema editing choices', () => {
  it('projects common object fields with a chosen reference and retains source identity', () => {
    const original = structuredClone(root),
      originalSchemas = structuredClone(schemas);
    const variants = schemaVariants(root, schemas)!;
    expect(variants.keyword).toBe('oneOf');
    expect(variants.choices.map((choice) => choice.label)).toEqual([
      '1. Individual',
      '2. Organization',
    ]);
    const projected = objectFieldSchema(
      variants.choices[0]!.schema,
      schemas,
      false,
    );
    expect(projected.required).toEqual(['id', 'kind', 'name']);
    expect(Object.keys(projected.properties as Schema)).toEqual([
      'id',
      'serverOnly',
      'kind',
      'name',
      'token',
    ]);
    expect(root).toEqual(original);
    expect(schemas).toEqual(originalSchemas);
  });
  it('retains body numbers, unknown values and read-only values while editing selected fields', () => {
    const selected = schemaVariants(root, schemas)!.choices[1]!.schema;
    const model = bodyFieldModel(
      '{"id":9007199254740993,"kind":"person","company":"Before","serverOnly":"retained","extra":1.234567890123456789}',
      selected,
      schemas,
      false,
    );
    if (!model.available || !('fields' in model))
      throw new Error('Missing selected fields');
    expect(model.fields.map((field) => field.name)).not.toContain('serverOnly');
    expect(
      serializeJsonValue(
        setJsonProperty(model.value, 'company', {
          kind: 'string',
          value: 'After',
        }),
      ),
    ).toBe(
      '{"id":9007199254740993,"kind":"person","company":"After","serverOnly":"retained","extra":1.234567890123456789}',
    );
  });
  it('never weakens redaction when another displayed branch calls a field public', () => {
    const selected = schemaVariants(root, schemas)!.choices[1]!.schema;
    const model = bodyFieldModel(
      '{"id":1,"kind":"person","company":"Team","token":"PRIVATE_UNSELECTED_BRANCH"}',
      selected,
      schemas,
      false,
    );
    expect(model.available).toBe(true);
    const preview = redactJsonBody(
      '{"id":9007199254740993,"token":"PRIVATE_UNSELECTED_BRANCH"}',
      { schema: root, schemas },
    );
    expect(preview).toContain('9007199254740993');
    expect(preview).toContain('YOUR_SENSITIVE_VALUE');
    expect(preview).not.toContain('PRIVATE_UNSELECTED_BRANCH');
  });
  it('supports anyOf homogeneous arrays without matching or replacing their values', () => {
    const variants = schemaVariants(
      {
        anyOf: [
          { title: 'Names', type: 'array', items: { type: 'string' } },
          { type: 'array', items: { $ref: '#/components/schemas/Person' } },
        ],
      },
      schemas,
    )!;
    expect(variants.keyword).toBe('anyOf');
    expect(variants.choices[1]!.label).toBe('2. Option 2');
    const model = bodyFieldModel(
      '[{"name":"Ada","id":9007199254740993}]',
      variants.choices[1]!.schema,
      schemas,
      false,
    );
    if (!model.available || !('items' in model))
      throw new Error('Missing array fields');
    expect(model.items[0]!.nested?.available).toBe(true);
    expect(serializeJsonValue(model.value)).toContain('9007199254740993');
  });
  it.each(['writeOnly', 'readOnly'])(
    'retains inherited %s annotations even when a branch says false',
    (key) => {
      const selected = schemaVariants(
        { [key]: true, oneOf: [{ ...person, [key]: false }] },
        {},
      )!.choices[0]!.schema;
      expect(selected[key]).toBe(true);
    },
  );
  it('ignores 3.0 reference siblings and preserves 3.1 intersections', () => {
    const input = {
      $ref: '#/components/schemas/Union',
      oneOf: [
        { type: 'object', properties: { overridden: { type: 'string' } } },
      ],
    };
    const definitions = { Union: { oneOf: [person] } };
    expect(schemaVariants(input, definitions, true)?.choices[0]?.label).toBe(
      '1. Individual',
    );
    // Two simultaneous validation unions require an intersection, not a replacement choice.
    expect(schemaVariants(input, definitions, false)).toBeUndefined();
  });
  it.each([
    {},
    { oneOf: [] },
    { oneOf: false },
    { oneOf: [false] },
    { oneOf: [person], anyOf: [organization] },
    { oneOf: Array.from({ length: 9 }, () => person) },
    { allOf: [{ oneOf: [person] }] },
  ])('leaves unsupported or excessive shapes in JSON (%j)', (input) => {
    expect(schemaVariants(input, schemas)).toBeUndefined();
  });
  it.each([
    { additionalProperties: false },
    { if: { required: ['name'] } },
    { $id: 'https://example.test/rebased' },
  ])(
    'preserves sibling constraints and lets the conservative model refuse them (%j)',
    (constraint) => {
      const selected = schemaVariants(
        { ...constraint, oneOf: [person] },
        schemas,
      )!.choices[0]!.schema;
      expect((selected.allOf as Schema[])[0]).toEqual(constraint);
      expect(
        bodyFieldModel(
          '{"kind":"person","name":"Ada"}',
          selected,
          schemas,
          false,
        ).available,
      ).toBe(false);
    },
  );
  it('leaves unresolved references and overlapping common properties unavailable', () => {
    const missing = schemaVariants(
      { oneOf: [{ $ref: '#/components/schemas/Missing' }] },
      {},
    )!.choices[0]!.schema;
    expect(bodyFieldModel('{}', missing, {}, false).available).toBe(false);
    const selected = schemaVariants(
      { properties: { name: { type: 'integer' } }, oneOf: [person] },
      schemas,
    )!.choices[0]!.schema;
    expect(
      bodyFieldModel('{"name":"Ada"}', selected, schemas, false).available,
    ).toBe(false);
  });
  it('bounds labels without exposing example values or discriminator mapping keys', () => {
    const variants = schemaVariants(
      {
        discriminator: {
          propertyName: 'kind',
          mapping: { PRIVATE_MAPPING_KEY: 'hidden' },
        },
        oneOf: [{ title: 'a'.repeat(200), example: 'PRIVATE_EXAMPLE' }, {}],
      },
      {},
    )!;
    expect(variants.choices[0]!.label.length).toBe(99);
    expect(
      JSON.stringify(variants.choices.map((choice) => choice.label)),
    ).not.toMatch(/PRIVATE/);
  });
  it('retains existing shared control budgets for a selected branch', () => {
    const selected = schemaVariants(
      {
        oneOf: [
          {
            type: 'object',
            properties: Object.fromEntries(
              Array.from({ length: 101 }, (_, i) => [
                'f' + i,
                { type: 'string' },
              ]),
            ),
          },
        ],
      },
      {},
    )!.choices[0]!.schema;
    expect(bodyFieldModel('{}', selected, {}, false).available).toBe(false);
  });
});
