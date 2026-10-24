import { describe, it, expect } from 'vitest';
import type { Schema } from '@davidniessen/doctopus-contracts';
import {
  bodyFieldModel as createModel,
  bodyFieldLabel,
} from '../apps/reader/src/body-fields.js';
import type { BodyFieldModel } from '../apps/reader/src/body-fields.js';
/** These fixtures require object fields; an accidental root-array model must fail. */
function bodyFieldModel(
  ...args: Parameters<typeof createModel>
): BodyFieldModel {
  const model = createModel(...args);
  if (model.available && !('fields' in model))
    throw new Error('Expected object fields');
  return model;
}

const count = (model: BodyFieldModel): number =>
  model.available
    ? model.fields.length +
      model.fields.reduce(
        (sum, field) => sum + (field.nested ? count(field.nested) : 0),
        0,
      )
    : 0;

describe('bounded nested object form model', () => {
  it('resolves nested references and preserves unknown, read-only and exact numeric values', () => {
    const schemas: Record<string, Schema> = {
      Profile: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          id: { type: 'integer' },
          serverOnly: { type: 'string', readOnly: true },
          address: { $ref: '#/components/schemas/Address' },
        },
      },
      Address: { type: 'object', properties: { city: { type: 'string' } } },
    };
    const raw =
      '{"profile":{"name":"Ada","id":9007199254740993,"serverOnly":"retained","address":{"city":"Berlin","unknown":1.234567890123456789},"custom":1e400}}';
    const model = bodyFieldModel(
      raw,
      {
        type: 'object',
        properties: { profile: { $ref: '#/components/schemas/Profile' } },
      },
      schemas,
      false,
    );
    expect(model.available).toBe(true);
    if (!model.available) return;
    const nested = model.fields[0]!.nested;
    expect(nested?.available).toBe(true);
    if (!nested?.available) return;
    expect(nested.required).toEqual(['name']);
    expect(nested.fields.map((field) => field.name)).not.toContain(
      'serverOnly',
    );
    expect(nested.value.entries).toContainEqual([
      'serverOnly',
      { kind: 'string', value: 'retained' },
    ]);
    expect(nested.value.entries).toContainEqual([
      'id',
      { kind: 'number', text: '9007199254740993' },
    ]);
    expect(nested.value.entries).toContainEqual([
      'custom',
      { kind: 'number', text: '1e400' },
    ]);
    const address = nested.fields.find(
      (field) => field.name === 'address',
    )!.nested;
    if (!address?.available) throw new Error('Missing address fields');
    expect(address.value.entries).toContainEqual([
      'unknown',
      { kind: 'number', text: '1.234567890123456789' },
    ]);
  });
  it('limits all nested fields to 100 controls and uses local JSON fallback', () => {
    const group = {
      type: 'object',
      properties: Object.fromEntries(
        Array.from({ length: 50 }, (_, index) => [
          'field' + index,
          { type: 'string' },
        ]),
      ),
    };
    const model = bodyFieldModel(
      '{"first":{},"second":{}}',
      { type: 'object', properties: { first: group, second: group } },
      {},
      false,
    );
    expect(model.available).toBe(true);
    expect(count(model)).toBeLessThanOrEqual(100);
    if (!model.available) return;
    expect(model.fields[0]!.nested?.available).toBe(true);
    expect(model.fields[1]!.nested).toEqual({
      available: false,
      error: 'Use JSON when nested editing exceeds 100 controls.',
    });
  });
  it('bounds recursive schemas using the actual body depth', () => {
    const node: Schema = {
      type: 'object',
      properties: {
        next: { $ref: '#/components/schemas/Node' },
        name: { type: 'string' },
      },
    };
    let value: Record<string, unknown> = { name: 'leaf' };
    for (let depth = 0; depth < 12; depth++) value = { next: value };
    const model = bodyFieldModel(
      JSON.stringify(value),
      node,
      { Node: node },
      false,
    );
    expect(count(model)).toBe(16);
    let current = model;
    for (let depth = 0; depth < 8; depth++) {
      if (!current.available) throw new Error('Early recursion limit');
      current = current.fields.find((field) => field.name === 'next')!.nested!;
    }
    expect(current).toEqual({
      available: false,
      error: 'Use JSON for objects beyond eight field-editor levels.',
    });
  });
  it('inherits write-only context for nested strings without mutating source schemas', () => {
    const schema: Schema = {
      type: 'object',
      properties: {
        secrets: {
          type: 'object',
          writeOnly: true,
          properties: {
            token: { type: 'string' },
            child: {
              type: 'object',
              properties: { password: { type: 'string' } },
            },
          },
        },
      },
    };
    const original = JSON.stringify(schema),
      model = bodyFieldModel(
        '{"secrets":{"token":"private","child":{"password":"private"}}}',
        schema,
        {},
        false,
      );
    if (!model.available || !model.fields[0]!.nested?.available)
      throw new Error('Missing sensitive fields');
    const fields = model.fields[0]!.nested.fields;
    expect(fields[0]!.schema.writeOnly).toBe(true);
    const child = fields[1]!.nested;
    if (!child?.available) throw new Error('Missing child fields');
    expect(child.fields[0]!.schema.writeOnly).toBe(true);
    expect(JSON.stringify(schema)).toBe(original);
  });
  it('keeps conditional children in JSON while ordinary siblings remain editable', () => {
    const model = bodyFieldModel(
      '{"plain":{"name":"Ada"},"complex":{"value":1}}',
      {
        type: 'object',
        properties: {
          plain: { type: 'object', properties: { name: { type: 'string' } } },
          complex: {
            type: 'object',
            allOf: [{ if: { properties: { value: { type: 'number' } } } }],
          },
        },
      },
      {},
      false,
    );
    if (!model.available) throw new Error('Root unavailable');
    expect(model.fields[0]!.nested?.available).toBe(true);
    expect(model.fields[1]!.nested?.available).toBe(false);
    expect(
      bodyFieldModel(
        '{}',
        { type: 'object', oneOf: [{ type: 'object' }] },
        {},
        false,
      ).available,
    ).toBe(false);
  });
  it('projects referenced allOf objects without losing requirements, privacy or exact values', () => {
    const schemas = {
      Identity: {
        type: 'object',
        required: ['name', 'id'],
        properties: { name: { type: 'string' }, id: { type: 'integer' } },
      },
      Secret: {
        allOf: [
          { writeOnly: true },
          { properties: { token: { type: 'string' } } },
        ],
      },
    };
    const schema = {
      allOf: [
        { $ref: '#/components/schemas/Identity' },
        {
          required: ['secret'],
          properties: {
            secret: { $ref: '#/components/schemas/Secret' },
            server: {
              allOf: [
                { readOnly: true },
                { properties: { status: { type: 'string' } } },
              ],
            },
          },
        },
      ],
    };
    const before = JSON.stringify({ schema, schemas });
    const model = bodyFieldModel(
      '{"name":"Ada","id":9007199254740993,"secret":{"token":"private"},"server":{"status":"kept"},"extra":1e400}',
      schema,
      schemas,
      false,
    );
    if (!model.available) throw new Error(model.error);
    expect(model.required).toEqual(['name', 'id', 'secret']);
    expect(model.fields.map(({ name }) => name)).toEqual([
      'name',
      'id',
      'secret',
    ]);
    const secret = model.fields[2]!;
    expect(secret.schema.writeOnly).toBe(true);
    if (!secret.nested?.available) throw new Error('Missing secret controls');
    expect(secret.nested.fields[0]!.schema.writeOnly).toBe(true);
    expect(model.value.entries).toContainEqual([
      'id',
      { kind: 'number', text: '9007199254740993' },
    ]);
    expect(model.value.entries).toContainEqual([
      'extra',
      { kind: 'number', text: '1e400' },
    ]);
    expect(model.value.entries.some(([name]) => name === 'server')).toBe(true);
    expect(JSON.stringify({ schema, schemas })).toBe(before);
  });
  it('honors dialect-specific reference siblings when composing objects', () => {
    const schema = {
      $ref: '#/components/schemas/Base',
      required: ['extra'],
      properties: { extra: { type: 'boolean' } },
    };
    const schemas = { Base: { properties: { name: { type: 'string' } } } };
    const modern = bodyFieldModel('{}', schema, schemas, false);
    const legacy = bodyFieldModel('{}', schema, schemas, true);
    if (!modern.available || !legacy.available)
      throw new Error('Missing fields');
    expect(modern.fields.map(({ name }) => name)).toEqual(['name', 'extra']);
    expect(modern.required).toEqual(['extra']);
    expect(legacy.fields.map(({ name }) => name)).toEqual(['name']);
    expect(legacy.required).toEqual([]);
  });
  it.each([
    { properties: { a: { type: 'string' } } },
    { additionalProperties: false },
    { unevaluatedProperties: false },
    { patternProperties: { '^a': { type: 'string' } } },
    { const: { a: 'fixed' } },
    { oneOf: [{ type: 'object' }] },
    { type: 'string' },
    { $ref: '#/components/schemas/Missing' },
  ])('retains JSON for incompatible object compositions: %j', (branch) => {
    const model = bodyFieldModel(
      '{}',
      {
        allOf: [{ properties: { a: { type: 'string' } } }, branch],
      },
      {},
      false,
    );
    expect(model.available).toBe(false);
  });
  it('intersects nullable object types across composition branches', () => {
    for (const legacy of [true, false]) {
      const nullable = legacy
        ? { type: 'object', nullable: true }
        : { type: ['object', 'null'] };
      for (const allowNull of [true, false]) {
        const model = bodyFieldModel(
          '{"child":{}}',
          {
            properties: {
              child: {
                allOf: [
                  { ...nullable, properties: { a: { type: 'string' } } },
                  {
                    ...(allowNull ? nullable : { type: 'object' }),
                    properties: { b: { type: 'string' } },
                  },
                ],
              },
            },
          },
          {},
          legacy,
        );
        if (!model.available) throw new Error(model.error);
        const child = model.fields[0]!.schema;
        expect(
          legacy
            ? child.nullable
            : Array.isArray(child.type) && child.type.includes('null'),
        ).toBe(allowNull);
      }
    }
  });
  it('bounds wide, deep and recursive compositions with local JSON fallback', () => {
    let deep: Schema = { properties: { a: { type: 'string' } } };
    for (let depth = 0; depth < 9; depth++) deep = { allOf: [deep] };
    const recursive = { allOf: [{ $ref: '#/components/schemas/Loop' }] };
    const wide = { allOf: Array.from({ length: 33 }, () => ({})) };
    for (const child of [deep, wide, recursive]) {
      const model = bodyFieldModel(
        '{"safe":"kept","child":{}}',
        {
          properties: { safe: { type: 'string' }, child },
        },
        { Loop: recursive },
        false,
      );
      if (!model.available) throw new Error(model.error);
      expect(model.fields[0]!.name).toBe('safe');
      expect(model.fields[1]!.nested?.available).toBe(false);
    }
  });
  it('composes literal prototype property names without prototype mutation', () => {
    const schema = JSON.parse(
      '{"allOf":[{"properties":{"__proto__":{"type":"string"}}},{"properties":{"constructor":{"type":"string"}}}]}',
    ) as Schema;
    const model = bodyFieldModel(
      '{"__proto__":"own","constructor":"own"}',
      schema,
      {},
      false,
    );
    if (!model.available) throw new Error(model.error);
    expect(model.fields.map(({ name }) => name)).toEqual([
      '__proto__',
      'constructor',
    ]);
    expect(Object.hasOwn(Object.prototype, 'type')).toBe(false);
  });
  it('does not expand object enums, constants or ambiguous type unions', () => {
    const object = { type: 'object', properties: { name: { type: 'string' } } };
    const model = bodyFieldModel(
      '{"choice":{},"fixed":{},"union":{}}',
      {
        type: 'object',
        properties: {
          choice: { ...object, enum: [{ name: 'fixed' }] },
          fixed: { ...object, const: { name: 'fixed' } },
          union: { ...object, type: ['object', 'string'] },
        },
      },
      {},
      false,
    );
    if (!model.available) throw new Error('Root unavailable');
    expect(model.fields[0]!.nested).toBeUndefined();
    expect(model.fields[1]!.nested).toBeUndefined();
    expect(model.fields[2]!.nested?.available).toBe(false);
  });
  it('handles literal prototype keys and labels dotted names distinctly', () => {
    const schema = JSON.parse(
      '{"type":"object","properties":{"__proto__":{"type":"object","properties":{"constructor":{"type":"string"}}},"constructor":{"type":"string"},"a.b":{"type":"string"}}}',
    ) as Schema;
    const model = bodyFieldModel(
      '{"__proto__":{"constructor":"own"},"constructor":"own","a.b":"literal"}',
      schema,
      {},
      false,
    );
    if (!model.available) throw new Error('Root unavailable');
    expect(model.fields.map((field) => field.name)).toEqual([
      '__proto__',
      'constructor',
      'a.b',
    ]);
    expect(bodyFieldLabel(['a.b'])).toBe('["a.b"]');
    expect(bodyFieldLabel(['a', 'b'])).toBe('a.b');
    expect(bodyFieldLabel(['__proto__', 'constructor'])).toBe(
      '__proto__.constructor',
    );
    expect(bodyFieldLabel(['profile', 'weird"name'])).toBe(
      'profile["weird\\"name"]',
    );
  });
  it('preserves legacy reference siblings and nullable annotation rules', () => {
    const schema: Schema = {
        type: 'object',
        properties: {
          value: { $ref: '#/components/schemas/Value', readOnly: true },
        },
      },
      schemas = {
        Value: {
          type: 'object',
          nullable: true,
          properties: { name: { type: 'string' } },
        },
      };
    const legacy = bodyFieldModel(
        '{"value":{"name":"Ada"}}',
        schema,
        schemas,
        true,
      ),
      modern = bodyFieldModel(
        '{"value":{"name":"Ada"}}',
        schema,
        schemas,
        false,
      );
    expect(legacy.available).toBe(true);
    if (legacy.available) expect(legacy.fields[0]!.schema.nullable).toBe(true);
    expect(modern.available).toBe(false);
  });
});
