import { describe, expect, it } from 'vitest';
import type { Schema } from '@davidniessen/doctopus-contracts';
import { serializeJsonValue } from '@davidniessen/doctopus-contracts';
import {
  bodyFieldModel,
  bodyPathWithin,
} from '../apps/reader/src/body-fields.js';
import type {
  BodyFieldModel,
  BodyArrayModel,
} from '../apps/reader/src/body-fields.js';

type Model = BodyFieldModel | BodyArrayModel;
const named: Schema = {
  title: 'Named',
  type: 'object',
  properties: { name: { type: 'string' }, id: { type: 'integer' } },
};
const counted: Schema = {
  title: 'Counted',
  type: 'object',
  properties: { count: { type: 'integer' } },
};
const definitions: Record<string, Schema> = {
  Named: named,
  Counted: counted,
  Choice: {
    oneOf: [
      { $ref: '#/components/schemas/Named' },
      { $ref: '#/components/schemas/Counted' },
      { title: 'Server', readOnly: true, ...named },
    ],
  },
};
const root: Schema = {
  type: 'object',
  properties: {
    choice: { $ref: '#/components/schemas/Choice' },
    items: { type: 'array', items: { $ref: '#/components/schemas/Choice' } },
    secret: { $ref: '#/components/schemas/Choice', writeOnly: true },
  },
};
const body =
  '{"choice":{"name":"Ada","id":9007199254740993,"unknown":1.234567890123456789},"items":[{"name":"First","id":9007199254740993},{"count":2}],"secret":{"name":"private"}}';
const selections = (...entries: [readonly (string | number)[], number][]) =>
  new Map(entries.map(([path, choice]) => [JSON.stringify(path), choice]));
function fields(model: Model) {
  if (!model.available || !('fields' in model))
    throw new Error('Expected object fields');
  return model.fields;
}
function count(model: Model | undefined): number {
  if (!model?.available) return 0;
  const entries = 'fields' in model ? model.fields : model.items;
  return (
    entries.length +
    entries.reduce(
      (sum, entry) => sum + count(entry.nested) + count(entry.array),
      0,
    )
  );
}

describe('nested editing choices under one shared model budget', () => {
  it('offers per-property choices without projecting or rewriting an unselected value', () => {
    const model = bodyFieldModel(body, root, definitions, false, {
      variants: true,
    });
    const field = fields(model)[0]!;
    expect(field.variants?.choices).toHaveLength(3);
    expect(field.variants?.selected).toBeUndefined();
    expect(field.nested?.available).toBe(false);
    if (!model.available) throw new Error('Missing model');
    expect(serializeJsonValue(model.value)).toBe(body);
  });
  it('selects referenced object branches and retains exact, unknown and sensitive values', () => {
    const before = structuredClone(root),
      beforeDefinitions = structuredClone(definitions);
    const model = bodyFieldModel(body, root, definitions, false, {
      variants: true,
      selections: selections([['choice'], 0], [['secret'], 0]),
    });
    const choice = fields(model)[0]!;
    expect(choice.variants?.selected).toBe(0);
    expect(fields(choice.nested!).map((field) => field.name)).toEqual([
      'name',
      'id',
    ]);
    if (!choice.nested?.available) throw new Error('Missing nested value');
    expect(serializeJsonValue(choice.nested.value)).toContain(
      '9007199254740993',
    );
    expect(serializeJsonValue(choice.nested.value)).toContain(
      '1.234567890123456789',
    );
    expect(
      fields(fields(model)[2]!.nested!).every(
        (field) => field.schema.writeOnly === true,
      ),
    ).toBe(true);
    expect(root).toEqual(before);
    expect(definitions).toEqual(beforeDefinitions);
  });
  it('keeps independent array item selections and does not attach one choice to every item', () => {
    const model = bodyFieldModel(body, root, definitions, false, {
      variants: true,
      selections: selections([['items', 0], 0], [['items', 1], 1]),
    });
    const array = fields(model)[1]!.array;
    if (!array?.available) throw new Error('Missing array');
    expect(fields(array.items[0]!.nested!).map((field) => field.name)).toEqual([
      'name',
      'id',
    ]);
    expect(fields(array.items[1]!.nested!).map((field) => field.name)).toEqual([
      'count',
    ]);
    expect(array.items.map((item) => item.variants?.selected)).toEqual([0, 1]);
  });
  it('keeps a read-only branch selector available while suppressing its nested controls', () => {
    const model = bodyFieldModel(body, root, definitions, false, {
      variants: true,
      selections: selections([['choice'], 2]),
    });
    const selected = fields(model)[0]!;
    expect(selected.schema.readOnly).toBe(true);
    expect(selected.variants?.selected).toBe(2);
    expect(selected.nested).toBeUndefined();
    const alwaysReadOnly = bodyFieldModel(
      '{"x":{}}',
      {
        properties: {
          x: { ...definitions.Choice, readOnly: true },
          normal: { type: 'string' },
        },
      },
      definitions,
      false,
      { variants: true },
    );
    expect(fields(alwaysReadOnly).map((field) => field.name)).toEqual([
      'normal',
    ]);
  });
  it.each([-1, 99, 0.5, Number.NaN])(
    'ignores invalid selection %s and retains a usable JSON fallback',
    (selected) => {
      const model = bodyFieldModel(body, root, definitions, false, {
        variants: true,
        selections: selections([['choice'], selected]),
      });
      expect(fields(model)[0]!.variants?.selected).toBeUndefined();
      expect(fields(model)[0]!.nested?.available).toBe(false);
    },
  );
  it('keeps choices opt-in for existing form and multipart model callers', () => {
    const model = bodyFieldModel(body, root, definitions, false);
    expect(fields(model)[0]!.variants).toBeUndefined();
    expect(fields(model)[0]!.nested?.available).toBe(false);
  });
  it('uses typed paths so literal dotted property names do not share choices', () => {
    const schema = {
      properties: {
        x: { properties: { name: definitions.Choice } },
        'x.name': definitions.Choice,
      },
    };
    const model = bodyFieldModel(
      '{"x":{"name":{"count":1}},"x.name":{"name":"literal"}}',
      schema,
      definitions,
      false,
      {
        variants: true,
        selections: selections([['x', 'name'], 1], [['x.name'], 0]),
      },
    );
    expect(fields(fields(model)[0]!.nested!)[0]!.variants?.selected).toBe(1);
    expect(fields(model)[1]!.variants?.selected).toBe(0);
  });
  it('bounds all selected object branches with the original 100-control budget', () => {
    const large = {
      type: 'object',
      properties: Object.fromEntries(
        Array.from({ length: 50 }, (_, i) => ['field' + i, { type: 'string' }]),
      ),
    };
    const schema = {
      properties: Object.fromEntries(
        Array.from({ length: 20 }, (_, i) => [
          'branch' + i,
          { oneOf: [large] },
        ]),
      ),
    };
    const value = JSON.stringify(
      Object.fromEntries(
        Array.from({ length: 20 }, (_, i) => ['branch' + i, {}]),
      ),
    );
    const selected = selections(
      ...Array.from({ length: 20 }, (_, i): [string[], number] => [
        ['branch' + i],
        0,
      ]),
    );
    const model = bodyFieldModel(value, schema, {}, false, {
      variants: true,
      selections: selected,
    });
    expect(count(model)).toBe(70);
    expect(fields(model)[1]!.nested).toEqual({
      available: false,
      error: 'Use JSON when nested editing exceeds 100 controls.',
    });
  });
  it('bounds selected recursive branches with the original eight-container limit', () => {
    const node: Schema = {
      oneOf: [
        {
          type: 'object',
          properties: {
            name: { type: 'string' },
            next: { $ref: '#/components/schemas/Node' },
          },
        },
      ],
    };
    let value: unknown = { name: 'leaf' };
    for (let i = 0; i < 12; i++) value = { name: 'node', next: value };
    const selected = selections(
      ...Array.from({ length: 13 }, (_, i): [string[], number] => [
        ['node', ...Array.from({ length: i }, () => 'next')],
        0,
      ]),
    );
    const model = bodyFieldModel(
      JSON.stringify({ node: value }),
      { properties: { node: { $ref: '#/components/schemas/Node' } } },
      { Node: node },
      false,
      { variants: true, selections: selected },
    );
    expect(count(model)).toBe(15);
    let nested = fields(model)[0]!.nested!;
    for (let i = 0; i < 7; i++)
      nested = fields(nested).find((field) => field.name === 'next')!.nested!;
    expect(nested).toEqual({
      available: false,
      error: 'Use JSON for objects beyond eight field-editor levels.',
    });
  });
  it('shares the same budget with selected branches inside arrays', () => {
    const large = {
      type: 'object',
      properties: Object.fromEntries(
        Array.from({ length: 40 }, (_, i) => ['f' + i, { type: 'string' }]),
      ),
    };
    const model = bodyFieldModel(
      '[{},{},{}]',
      { type: 'array', items: { anyOf: [large] } },
      {},
      false,
      { variants: true, selections: selections([[0], 0], [[1], 0], [[2], 0]) },
    );
    expect(count(model)).toBe(83);
    if (!model.available || !('items' in model))
      throw new Error('Missing array');
    expect(model.items[2]!.nested?.available).toBe(false);
  });
  it('offers selections before an optional value is included', () => {
    const field = fields(
      bodyFieldModel('{}', root, definitions, false, {
        variants: true,
        selections: selections([['choice'], 1]),
      }),
    )[0]!;
    expect(field.schema.type).toBe('object');
    expect(field.variants?.selected).toBe(1);
    expect(field.nested).toBeUndefined();
  });
  it('preserves unsupported intersection constraints as local JSON while siblings stay editable', () => {
    const schema = {
      properties: {
        plain: { type: 'string' },
        choice: { additionalProperties: false, oneOf: [named] },
      },
    };
    const model = bodyFieldModel(
      '{"plain":"safe","choice":{"name":"Ada"}}',
      schema,
      {},
      false,
      { variants: true, selections: selections([['choice'], 0]) },
    );
    expect(fields(model)[0]!.schema.type).toBe('string');
    expect(fields(model)[1]!.nested?.available).toBe(false);
  });
});

describe('typed path cleanup boundaries', () => {
  it.each([
    ['["x","id"]', ['x'], true],
    ['["x"]', ['x'], true],
    ['["x.name"]', ['x'], false],
    ['["x",10]', ['x', 1], false],
    ['["x","0"]', ['x', 0], false],
    ['["x",0,"id"]', ['x', 0], true],
    ['not-json', ['x'], false],
    ['null', ['x'], false],
  ] as const)(
    'matches %s under %j only when structurally related',
    (key, path, expected) => {
      expect(bodyPathWithin(key, path)).toBe(expected);
    },
  );
  it('can remove descendants while keeping the container choice', () => {
    expect(bodyPathWithin('["x"]', ['x'], true)).toBe(false);
    expect(bodyPathWithin('["x",0]', ['x'], true)).toBe(true);
  });
});
