import {
  objectFieldSchema,
  resolveSchema,
} from '@davidniessen/doctopus-contracts';
import type { Schema } from '@davidniessen/doctopus-contracts';

const object = (value: unknown): Schema =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Schema)
    : {};

/** Bounded synthetic examples for ordinary schemas; unsupported constraints fail explicitly. */
export function mockSchemaValue(
  schema: Schema,
  schemas: Record<string, Schema>,
  seed: string,
  legacy: boolean,
): unknown {
  let state = 2166136261,
    nodes = 0;
  for (const char of seed)
    state = Math.imul(state ^ char.codePointAt(0)!, 16777619) >>> 0;
  const random = () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const unsupported = () =>
    new Error(
      'This schema needs an explicit mock example; synthetic generation cannot satisfy its constraints.',
    );
  const finite = (value: unknown, fallback: number) =>
    value === undefined
      ? fallback
      : typeof value === 'number' && Number.isFinite(value)
        ? value
        : (() => {
            throw unsupported();
          })();
  const count = (value: unknown, fallback: number, cap: number) => {
    const result = finite(value, fallback);
    if (!Number.isInteger(result) || result < 0 || result > cap)
      throw unsupported();
    return result;
  };
  const walk = (input: Schema, depth: number): unknown => {
    if (++nodes > 500 || depth > 8)
      throw new Error(
        'Mock schema exceeds the 500-node/eight-level generation budget.',
      );
    let actual = resolveSchema(input, schemas, {
      ignoreReferenceSiblings: legacy,
    });
    if (actual.$ref || actual['x-doctopus-boolean-schema'] === false)
      throw unsupported();
    for (const key of ['const', 'example', 'default'])
      if (Object.hasOwn(actual, key)) return actual[key];
    if (Array.isArray(actual.examples) && actual.examples.length)
      return actual.examples[0];
    if (Array.isArray(actual.enum)) {
      if (!actual.enum.length) throw unsupported();
      return actual.enum[Math.floor(random() * actual.enum.length)];
    }
    if (
      [
        'oneOf',
        'anyOf',
        'not',
        'if',
        'then',
        'else',
        'dependentSchemas',
        'dependentRequired',
        'patternProperties',
        'propertyNames',
        'unevaluatedProperties',
        'contains',
        'contentEncoding',
      ].some((key) => Object.hasOwn(actual, key))
    )
      throw unsupported();
    if (actual.allOf) actual = objectFieldSchema(actual, schemas, legacy);
    const type = Array.isArray(actual.type)
      ? (actual.type.find((item) => item !== 'null') ?? 'null')
      : (actual.type ??
        (actual.properties ? 'object' : actual.items ? 'array' : 'string'));
    if (type === 'null') return null;
    if (type === 'boolean') return random() >= 0.5;
    if (type === 'object') {
      const properties = object(actual.properties);
      if (Object.keys(properties).length > 50) throw unsupported();
      const hidden = (name: string) =>
        resolveSchema(
          object(Object.hasOwn(properties, name) ? properties[name] : {}),
          schemas,
          { ignoreReferenceSiblings: legacy },
        ).writeOnly === true;
      const required = Array.isArray(actual.required)
        ? actual.required.filter(
            (name): name is string => typeof name === 'string',
          )
        : [];
      const minimum = count(actual.minProperties, 0, 50),
        maximum = count(actual.maxProperties, 50, Number.MAX_SAFE_INTEGER);
      const names = [
        ...new Set([...required, ...Object.keys(properties)]),
      ].filter((name) => !hidden(name));
      if (
        names.length > 50 ||
        required.filter((name) => !hidden(name)).length > maximum ||
        minimum > maximum
      )
        throw unsupported();
      const selected = names.slice(0, maximum);
      for (let index = 0; selected.length < minimum; index++) {
        if (actual.additionalProperties === false) throw unsupported();
        const name = `field${index + 1}`;
        if (!selected.includes(name)) selected.push(name);
      }
      return Object.fromEntries(
        selected.map((name) => {
          if (
            !Object.hasOwn(properties, name) &&
            actual.additionalProperties === false
          )
            throw unsupported();
          return [
            name,
            walk(
              object(
                Object.hasOwn(properties, name)
                  ? properties[name]
                  : actual.additionalProperties,
              ),
              depth + 1,
            ),
          ];
        }),
      );
    }
    if (type === 'array') {
      if (actual.prefixItems || actual.unevaluatedItems) throw unsupported();
      const min = count(actual.minItems, 0, 8),
        max = count(actual.maxItems, 8, Number.MAX_SAFE_INTEGER);
      if (min > max) throw unsupported();
      const length = Math.max(min, Math.min(max, 1));
      if (actual.items === false && length) throw unsupported();
      const values: unknown[] = [];
      for (let index = 0; index < length; index++) {
        let value = walk(object(actual.items), depth + 1),
          attempts = 0;
        while (
          actual.uniqueItems === true &&
          values.some((item) => JSON.stringify(item) === JSON.stringify(value))
        ) {
          if (++attempts > 8) throw unsupported();
          value = walk(object(actual.items), depth + 1);
        }
        values.push(value);
      }
      return values;
    }
    if (type === 'integer' || type === 'number') {
      let minimum = finite(
          actual.minimum,
          typeof actual.exclusiveMinimum === 'number'
            ? actual.exclusiveMinimum
            : typeof actual.maximum === 'number'
              ? Math.min(0, actual.maximum - 100)
              : typeof actual.exclusiveMaximum === 'number'
                ? Math.min(0, actual.exclusiveMaximum - 100)
                : 0,
        ),
        maximum = finite(
          actual.maximum,
          typeof actual.exclusiveMaximum === 'number'
            ? actual.exclusiveMaximum
            : minimum + 100,
        );
      const above = (value: number) =>
        type === 'integer'
          ? Math.floor(value) + 1
          : value +
            Math.max(
              Number.MIN_VALUE,
              Math.abs(value) * Number.EPSILON,
              Number.EPSILON,
            );
      const below = (value: number) =>
        type === 'integer'
          ? Math.ceil(value) - 1
          : value -
            Math.max(
              Number.MIN_VALUE,
              Math.abs(value) * Number.EPSILON,
              Number.EPSILON,
            );
      if (typeof actual.exclusiveMinimum === 'number')
        minimum = Math.max(minimum, above(actual.exclusiveMinimum));
      else if (legacy && actual.exclusiveMinimum === true)
        minimum = above(minimum);
      if (typeof actual.exclusiveMaximum === 'number')
        maximum = Math.min(maximum, below(actual.exclusiveMaximum));
      else if (legacy && actual.exclusiveMaximum === true)
        maximum = below(maximum);
      if (
        minimum > maximum ||
        Math.abs(minimum) > Number.MAX_SAFE_INTEGER ||
        Math.abs(maximum) > Number.MAX_SAFE_INTEGER
      )
        throw unsupported();
      const step = finite(actual.multipleOf, 1);
      if (!Number.isSafeInteger(step) || step <= 0) throw unsupported();
      if (type === 'integer' || actual.multipleOf !== undefined) {
        const low = Math.ceil(minimum / step),
          high = Math.floor(maximum / step);
        if (low > high) throw unsupported();
        return (
          (low + Math.floor(random() * (Math.min(high - low, 1000) + 1))) * step
        );
      }
      return minimum + (maximum - minimum) * random();
    }
    if (
      type !== 'string' ||
      actual.pattern ||
      actual.format === 'binary' ||
      actual.format === 'byte'
    )
      throw unsupported();
    const min = count(actual.minLength, 0, 256),
      max = count(
        actual.maxLength,
        Math.max(256, min),
        Number.MAX_SAFE_INTEGER,
      );
    if (min > max) throw unsupported();
    const hex = () =>
      Math.floor(random() * 4294967296)
        .toString(16)
        .padStart(8, '0');
    const formats: Record<string, () => string> = {
      'date-time': () =>
        `2026-01-${String(1 + Math.floor(random() * 28)).padStart(2, '0')}T00:00:00Z`,
      date: () =>
        `2026-01-${String(1 + Math.floor(random() * 28)).padStart(2, '0')}`,
      time: () => '12:00:00Z',
      email: () => `reader-${hex()}@example.com`,
      uri: () => `https://example.com/${hex()}`,
      uuid: () =>
        `${hex()}-${hex().slice(0, 4)}-4${hex().slice(0, 3)}-8${hex().slice(0, 3)}-${hex()}${hex().slice(0, 4)}`,
      hostname: () => `host-${hex()}.example.com`,
      ipv4: () => `192.0.2.${1 + Math.floor(random() * 254)}`,
      ipv6: () => `2001:db8::${hex().slice(0, 4)}`,
    };
    if (
      typeof actual.format === 'string' &&
      Object.hasOwn(formats, actual.format)
    ) {
      const value = formats[actual.format]!();
      if (value.length < min || value.length > max) throw unsupported();
      return value;
    }
    const length = Math.min(max, Math.max(min, 16));
    return `example-${hex()}`.repeat(Math.ceil(length / 16)).slice(0, length);
  };
  return walk(schema, 0);
}
