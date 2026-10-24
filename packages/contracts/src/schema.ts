import type { Schema } from './index.js';
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown): string =>
  typeof value === 'string' ? value : '';
export function resolveSchema(
  schema: Schema,
  schemas: Record<string, Schema>,
  options: { ignoreReferenceSiblings?: boolean } = {},
): Schema {
  let actual = schema;
  const seen = new Set<string>();
  for (let depth = 0; depth < 64; depth++) {
    const ref = text(actual.$ref);
    if (!ref) return actual;
    if (seen.has(ref))
      return options.ignoreReferenceSiblings ? { $ref: ref } : actual;
    seen.add(ref);
    const key = ref.startsWith('#/components/schemas/')
      ? ref
          .slice('#/components/schemas/'.length)
          .replace(/~1/g, '/')
          .replace(/~0/g, '~')
      : ref;
    const target = Object.hasOwn(schemas, ref)
      ? schemas[ref]
      : Object.hasOwn(schemas, key)
        ? schemas[key]
        : undefined;
    if (!target) return actual;
    const siblings = options.ignoreReferenceSiblings
      ? {}
      : Object.fromEntries(
          Object.entries(actual).filter(([key]) => key !== '$ref'),
        );
    const annotations = new Set([
      'title',
      'description',
      'deprecated',
      'example',
      'examples',
      'default',
      'readOnly',
      'writeOnly',
      'nullable',
      'externalDocs',
      'xml',
    ]);
    if (Object.keys(siblings).some((key) => !annotations.has(key)))
      return {
        ...Object.fromEntries(
          Object.entries(target).filter(([key]) => annotations.has(key)),
        ),
        ...Object.fromEntries(
          Object.entries(siblings).filter(([key]) => annotations.has(key)),
        ),
        allOf: [target, siblings],
      };
    actual = { ...target, ...siblings };
  }
  return actual;
}

export function exampleFor(
  schema: Schema,
  schemas: Record<string, Schema> = {},
  depth = 0,
  seen = new Set<Schema>(),
): unknown {
  if (depth > 5 || seen.has(schema)) return null;
  if (schema['x-doctopus-boolean-schema'] === false) return null;
  if (schema.const !== undefined) return schema.const;
  if (schema.example !== undefined) return schema.example;
  if (Array.isArray(schema.examples) && schema.examples.length)
    return schema.examples[0];
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum)) return schema.enum[0];
  const actual = resolveSchema(schema, schemas);
  if (actual !== schema)
    return exampleFor(actual, schemas, depth + 1, new Set(seen).add(schema));
  for (const key of ['oneOf', 'anyOf'])
    if (Array.isArray(schema[key]) && schema[key].length)
      return exampleFor(record(schema[key][0]), schemas, depth + 1, seen);
  if (Array.isArray(schema.allOf))
    return Object.assign(
      {},
      ...schema.allOf.map((child) =>
        record(exampleFor(record(child), schemas, depth + 1, seen)),
      ),
    );
  const type = Array.isArray(schema.type)
    ? (schema.type.find((item) => item !== 'null') ?? 'null')
    : schema.type;
  if (type === 'object' || schema.properties)
    return Object.fromEntries(
      Object.entries(record(schema.properties))
        .filter(([, child]) => child !== false)
        .map(([key, child]) => [
          key,
          exampleFor(
            record(child),
            schemas,
            depth + 1,
            new Set(seen).add(schema),
          ),
        ]),
    );
  if (type === 'array')
    return schema.items === false
      ? []
      : [
          exampleFor(
            record(schema.items),
            schemas,
            depth + 1,
            new Set(seen).add(schema),
          ),
        ];
  if (type === 'integer' || type === 'number')
    return typeof schema.minimum === 'number' ? schema.minimum : 1;
  if (type === 'boolean') return true;
  if (type === 'null') return null;
  if (schema.format === 'date-time') return '2026-01-01T00:00:00Z';
  if (schema.format === 'email') return 'reader@example.com';
  if (schema.format === 'uuid') return '123e4567-e89b-12d3-a456-426614174000';
  return 'string';
}
