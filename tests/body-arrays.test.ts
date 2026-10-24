import { describe, it, expect } from 'vitest';
import type { Schema } from '@davidniessen/doctopus-contracts';
import { serializeJsonValue } from '@davidniessen/doctopus-contracts';
import {
  bodyFieldModel as createModel,
  bodyFieldLabel,
} from '../apps/reader/src/body-fields.js';
import type {
  BodyFieldModel,
  BodyArrayModel,
} from '../apps/reader/src/body-fields.js';

/** These fixtures require object fields; an accidental root-array model must fail. */
function bodyFieldModel(
  ...args: Parameters<typeof createModel>
): BodyFieldModel {
  const model = createModel(...args);
  if (model.available && !('fields' in model))
    throw new Error('Expected object fields');
  return model;
}

function array(
  raw: string,
  schema: Schema,
  schemas: Record<string, Schema> = {},
) {
  const model = bodyFieldModel(
    '{"values":' + raw + '}',
    { type: 'object', properties: { values: schema } },
    schemas,
    false,
  );
  if (!model.available || !model.fields[0]!.array)
    throw new Error('Missing array model');
  return model.fields[0]!.array;
}
function count(model: BodyFieldModel | BodyArrayModel): number {
  if (!model.available) return 0;
  const fields = 'fields' in model ? model.fields : model.items;
  return (
    fields.length +
    fields.reduce(
      (sum, field) =>
        sum +
        (field.nested ? count(field.nested) : 0) +
        (field.array ? count(field.array) : 0),
      0,
    )
  );
}

describe('bounded array request fields', () => {
  it('resolves object items and retains exact numbers, read-only and unknown data', () => {
    const raw = '[{"id":9007199254740993,"serverOnly":"keep","unknown":1e400}]';
    const model = array(
      raw,
      { type: 'array', items: { $ref: '#/components/schemas/Item' } },
      {
        Item: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            serverOnly: { type: 'string', readOnly: true },
          },
        },
      },
    );
    if (!model.available) throw new Error(model.error);
    expect(serializeJsonValue(model.value)).toBe(raw);
    const nested = model.items[0]!.nested;
    if (!nested?.available) throw new Error('Missing item fields');
    expect(nested.fields.map((field) => field.name)).toEqual(['id']);
    expect(nested.value.entries).toContainEqual([
      'id',
      { kind: 'number', text: '9007199254740993' },
    ]);
    expect(bodyFieldLabel(['values', 0, 'id'])).toBe('values[0].id');
    expect(bodyFieldLabel(['values', '0', 'id'])).toBe('values["0"].id');
  });
  it('supports empty, nullable and nested homogeneous arrays', () => {
    const schema = {
      type: ['array', 'null'],
      items: { type: 'array', items: { type: 'number' } },
    };
    const empty = array('[]', schema),
      nested = array('[[1.234567890123456789],[]]', schema);
    expect(empty.available).toBe(true);
    if (!nested.available || !nested.items[0]!.array?.available)
      throw new Error('Missing nested array');
    expect(nested.items[0]!.array.items[0]!.value).toEqual({
      kind: 'number',
      text: '1.234567890123456789',
    });
    expect(nested.items[1]!.array?.available).toBe(true);
  });
  it('inherits sensitive annotations through array and object items without source mutations', () => {
    const schema = {
      type: 'array',
      writeOnly: true,
      items: {
        type: 'object',
        properties: { tokens: { type: 'array', items: { type: 'string' } } },
      },
    };
    const source = JSON.stringify(schema),
      model = array('[{"tokens":["secret"]}]', schema);
    if (!model.available || !model.items[0]!.nested?.available)
      throw new Error('Missing nested object');
    const tokens = model.items[0]!.nested.fields[0]!.array;
    if (!tokens?.available) throw new Error('Missing secret array');
    expect(tokens.items[0]!.schema.writeOnly).toBe(true);
    expect(JSON.stringify(schema)).toBe(source);
  });
  it('shares the control budget across arrays and object fields', () => {
    const model = bodyFieldModel(
      JSON.stringify({ first: Array(50).fill(1), second: Array(50).fill(2) }),
      {
        type: 'object',
        properties: {
          first: { type: 'array', items: { type: 'number' } },
          second: { type: 'array', items: { type: 'number' } },
        },
      },
      {},
      false,
    );
    if (!model.available) throw new Error(model.error);
    expect(count(model)).toBe(52);
    expect(model.fields[0]!.array?.available).toBe(true);
    expect(model.fields[1]!.array).toEqual({
      available: false,
      error: 'Use JSON when nested editing exceeds 100 controls.',
    });
  });
  it('falls back without truncating oversized or recursively nested arrays', () => {
    const schema = {
      type: 'array',
      items: { $ref: '#/components/schemas/Recursive' },
    };
    let raw = '[]';
    for (let level = 0; level < 12; level++) raw = '[' + raw + ']';
    let model = array(raw, schema, { Recursive: schema });
    let depth = 0;
    while (model.available) {
      depth++;
      model = model.items[0]!.array!;
    }
    expect(depth).toBe(7);
    expect(model.error).toContain('eight field-editor levels');
    const oversized = array(JSON.stringify(Array(51).fill(1)), {
      type: 'array',
      items: { type: 'integer' },
    });
    expect(oversized).toEqual({
      available: false,
      error: 'Use JSON for arrays with more than 50 items.',
    });
  });
  it('uses JSON for tuples, complex items arrays and ambiguous container unions', () => {
    for (const schema of [
      { type: 'array', prefixItems: [{ type: 'string' }] },
      { type: 'array', items: [{ type: 'string' }] },
      { type: 'array', items: false },
      { type: 'array', contains: { type: 'number' } },
      { type: 'array', allOf: [{ items: { type: 'string' } }] },
      { type: ['array', 'string'], items: { type: 'number' } },
    ])
      expect(array('[]', schema).available).toBe(false);
    const enumModel = bodyFieldModel(
      '{"values":[1]}',
      { properties: { values: { type: 'array', enum: [[1], [2]] } } },
      {},
      false,
    );
    if (!enumModel.available) throw new Error(enumModel.error);
    expect(enumModel.fields[0]!.array).toBeUndefined();
  });
});

describe('root array request models', () => {
  it('resolves root and item references while retaining precise and sensitive values', () => {
    const raw = '[{"id":9007199254740993,"token":"private","unknown":1e400}]';
    const model = createModel(
      raw,
      { $ref: '#/components/schemas/List' },
      {
        List: { type: 'array', items: { $ref: '#/components/schemas/Item' } },
        Item: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            token: { type: 'string', writeOnly: true },
          },
        },
      },
      false,
    );
    if (!model.available || !('items' in model))
      throw new Error('Expected array controls');
    expect(serializeJsonValue(model.value)).toBe(raw);
    const item = model.items[0]!.nested;
    if (!item?.available) throw new Error('Expected item fields');
    expect(
      item.fields.find((field) => field.name === 'token')!.schema.writeOnly,
    ).toBe(true);
    const empty = createModel(
      '[]',
      { type: 'array', items: { type: 'integer', default: 5 } },
      {},
      false,
    );
    if (!empty.available || !('items' in empty))
      throw new Error('Expected empty array controls');
    expect(empty.items).toEqual([]);
    expect(empty.schema.default).toBe(5);
  });
  it('retains JSON fallback for scalar roots, incompatible and constrained arrays', () => {
    for (const value of ['42', 'null', '"text"', 'true'])
      expect(createModel(value, {}, {}, false).available).toBe(false);
    for (const schema of [
      { type: 'object', properties: { name: { type: 'string' } } },
      { type: ['array', 'string'] },
      { type: 'array', enum: [[1], [2]] },
      { type: 'array', const: [1] },
    ])
      expect(createModel('[1]', schema, {}, false).available).toBe(false);
  });
});
