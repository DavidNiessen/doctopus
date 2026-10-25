import { pointerEscape, record } from './portable-source.js';

export const unsupportedSchemaScopeKeywords: ReadonlySet<string> = new Set([
  '$id',
  '$anchor',
  '$dynamicRef',
  '$dynamicAnchor',
  '$recursiveRef',
  '$recursiveAnchor',
]);
const maps = [
  'properties',
  'patternProperties',
  '$defs',
  'definitions',
  'dependentSchemas',
  'dependencies',
] as const;
const arrays = ['allOf', 'anyOf', 'oneOf', 'prefixItems'] as const;
const singles = [
  'items',
  'additionalProperties',
  'unevaluatedProperties',
  'unevaluatedItems',
  'contains',
  'not',
  'if',
  'then',
  'else',
  'propertyNames',
  'additionalItems',
  'contentSchema',
] as const;

/** Visit schema positions, never example/default/enum data or property-name maps. */
export function validateSchemaBoundaries(
  roots: readonly (readonly [string, unknown])[],
  dialects: ReadonlySet<string>,
  filename: string,
) {
  const pending: [string, unknown][] = roots.map(([source, schema]) => [
    source.slice(0, 1024),
    schema,
  ]);
  const visited = new WeakSet<object>();
  let nodes = 0;
  const push = (source: string, schema: unknown) => {
    if (schema && typeof schema === 'object' && !Array.isArray(schema))
      pending.push([source.slice(0, 1024), schema]);
  };
  while (pending.length) {
    const [source, value] = pending.pop()!;
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      visited.has(value)
    )
      continue;
    visited.add(value);
    if (++nodes > 2_000_000)
      throw new Error(
        `${filename}: schema scope validation exceeds its node budget`,
      );
    const schema = record(value);
    if (
      Object.hasOwn(schema, '$schema') &&
      !dialects.has(String(schema.$schema))
    )
      throw new Error(
        `${filename} (${source}): unsupported JSON Schema dialect; use draft 2020-12 or the OpenAPI 3.1 base dialect`,
      );
    for (const keyword of unsupportedSchemaScopeKeywords)
      if (Object.hasOwn(schema, keyword))
        throw new Error(
          `${filename} (${source}): unsupported JSON Schema keyword ${keyword}; URI rebasing, anchors and dynamic references are not implemented`,
        );
    for (const keyword of maps)
      for (const [name, child] of Object.entries(record(schema[keyword])))
        push(`${source}/${keyword}/${pointerEscape(name)}`, child);
    for (const keyword of arrays) {
      const children = schema[keyword];
      if (Array.isArray(children))
        children.forEach((child, index) =>
          push(`${source}/${keyword}/${index}`, child),
        );
    }
    for (const keyword of singles)
      push(`${source}/${keyword}`, schema[keyword]);
  }
}
