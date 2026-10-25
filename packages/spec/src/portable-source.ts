import { parseDocument } from 'yaml';

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}
export function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
export function parseSource(source: string, filename: string): unknown {
  if (new TextEncoder().encode(source).byteLength > 16 * 1024 * 1024)
    throw new Error(`Input exceeds 16 MiB: ${filename}`);
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length)
    throw new Error(
      `${filename}: ${document.errors.map((error) => error.message).join('; ')}`,
    );
  if (document.warnings.length)
    throw new Error(`${filename}: unsupported YAML syntax or tag`);
  // Maps retain key types until collisions and non-JSON keys can be rejected.
  const parsed: unknown = document.toJS({ maxAliasCount: 50, mapAsMap: true });
  const ancestors = new Set<object>();
  let nodes = 0,
    bytes = 0;
  const charge = (size: number) => {
    bytes += size;
    if (bytes > 64 * 1024 * 1024)
      throw new Error(`${filename}: expanded JSON exceeds 64 MiB`);
  };
  const stringBytes = (value: string) =>
    new TextEncoder().encode(JSON.stringify(value)).byteLength;
  const convert = (value: unknown, depth: number): unknown => {
    if (++nodes > 1_000_000)
      throw new Error(`${filename}: expanded JSON exceeds 1000000 nodes`);
    if (depth > 128)
      throw new Error(`${filename}: input exceeds 128 levels of nesting`);
    if (
      value === null ||
      typeof value === 'boolean' ||
      typeof value === 'string'
    ) {
      charge(
        typeof value === 'string'
          ? stringBytes(value)
          : value === null
            ? 4
            : value
              ? 4
              : 5,
      );
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      charge(JSON.stringify(value).length);
      return value;
    }
    if (
      typeof value !== 'object' ||
      (!Array.isArray(value) && !(value instanceof Map))
    )
      throw new Error(`${filename}: input contains a non-JSON value`);
    if (ancestors.has(value))
      throw new Error(
        `${filename}: cyclic YAML aliases are not supported; use $ref`,
      );
    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        charge(2 + Math.max(0, value.length - 1));
        return value.map((item) => convert(item, depth + 1));
      }
      charge(2 + Math.max(0, value.size - 1) + value.size);
      const result: Record<string, unknown> = {};
      for (const [key, child] of value) {
        if (
          typeof key !== 'string' &&
          !(typeof key === 'number' && Number.isFinite(key))
        )
          throw new Error(
            `${filename}: mapping keys must be strings or finite numbers`,
          );
        const name = String(key);
        if (Object.hasOwn(result, name))
          throw new Error(
            `${filename}: mapping keys collide after JSON conversion`,
          );
        charge(stringBytes(name));
        Object.defineProperty(result, name, {
          value: convert(child, depth + 1),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return result;
    } finally {
      ancestors.delete(value);
    }
  };
  return convert(parsed, 0);
}
export const pointerEscape = (segment: string): string =>
  segment.replace(/~/g, '~0').replace(/\//g, '~1');
export function pointerValue(document: unknown, ref: string): unknown {
  if (!ref.startsWith('#/')) throw new Error(`Unsupported reference: ${ref}`);
  let value: unknown = document;
  for (const raw of decodeURIComponent(ref.slice(2)).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key))
      throw new Error(`Unresolved reference: ${ref}`);
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}
export function resolvePointer(
  document: unknown,
  value: unknown,
  chain = new Set<string>(),
): Record<string, unknown> {
  const object = record(value);
  if (typeof object.$ref !== 'string') return object;
  if (chain.has(object.$ref))
    throw new Error(`Circular non-schema reference: ${object.$ref}`);
  if (chain.size >= 64) throw new Error('Reference chain exceeds 64 links');
  const next = new Set(chain).add(object.$ref);
  return {
    ...resolvePointer(document, pointerValue(document, object.$ref), next),
    ...Object.fromEntries(
      Object.entries(object).filter(([key]) => key !== '$ref'),
    ),
  };
}
