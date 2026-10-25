import { describe, expect, it } from 'vitest';
import { parseJsonValue } from '@davidniessen/doctopus-contracts';
import {
  bodyTableRows,
  bodyTableValue,
  type BodyTableRow,
} from '../apps/reader/src/body-table.js';
import { bodyFieldModel } from '../apps/reader/src/body-fields.js';

function rows(json: string): BodyTableRow[] {
  const node = parseJsonValue(json);
  if (node.kind !== 'object') throw new Error('Expected object');
  return bodyTableRows(node);
}

describe('request body table serialization', () => {
  it('supports empty and dictionary objects without enabling schema field controls', () => {
    const schema = { type: 'object', additionalProperties: { type: 'string' } };
    expect(bodyFieldModel('{}', schema, {}, false).available).toBe(false);
    const model = bodyFieldModel('{}', schema, {}, false, { table: true });
    expect(model.available).toBe(true);
    if (!model.available || !('fields' in model))
      throw new Error('Expected object');
    expect(model.fields).toEqual([]);
    expect(bodyTableValue(bodyTableRows(model.value))).toBe('{}');
  });
  it('preserves nested JSON, exact numbers, empty strings and special keys', () => {
    const body =
      '{"name":"","count":900719925474099312345,"ratio":1.2300e-40,"nested":{"a":[true,null]},"__proto__":"safe"}';
    expect(bodyTableValue(rows(body)).replace(/\s/g, '')).toBe(body);
  });
  it('adds and removes fields without serializing disabled drafts', () => {
    const draft = rows('{"keep":true,"omit":42}');
    draft[1]!.enabled = false;
    draft[1]!.value = 'invalid number';
    draft.push({
      id: 2,
      name: 'new',
      value: 'hello & café',
      type: 'string',
      enabled: true,
    });
    expect(JSON.parse(bodyTableValue(draft))).toEqual({
      keep: true,
      new: 'hello & café',
    });
    expect(
      JSON.parse(bodyTableValue(draft.filter((row) => row.name !== 'keep'))),
    ).toEqual({ new: 'hello & café' });
  });
  it('ignores the empty insertion row but rejects missing or duplicate keys', () => {
    expect(
      bodyTableValue([
        { id: 0, name: '', value: '', type: 'string', enabled: true },
      ]),
    ).toBe('{}');
    expect(() =>
      bodyTableValue([
        { id: 0, name: '', value: 'orphan', type: 'string', enabled: true },
      ]),
    ).toThrow('Enter a key');
    expect(() =>
      bodyTableValue([...rows('{"name":"one"}'), ...rows('{"name":"two"}')]),
    ).toThrow('Duplicate body field');
  });
  it.each(['number', 'boolean', 'null', 'array', 'object'] as const)(
    'rejects invalid or mismatched %s drafts',
    (type) => {
      expect(() =>
        bodyTableValue([
          { id: 0, name: 'field', value: '"text"', type, enabled: true },
        ]),
      ).toThrow(`valid ${type}`);
      expect(() =>
        bodyTableValue([
          { id: 0, name: 'field', value: 'unfinished', type, enabled: true },
        ]),
      ).toThrow(`valid ${type}`);
    },
  );
});
