import {
  parseJsonValue,
  serializeJsonValue,
  resolveSchema,
} from '@davidniessen/doctopus-contracts';
import type { JsonValueNode, Schema } from '@davidniessen/doctopus-contracts';

export interface BodyRedaction {
  schema: Schema;
  schemas: Record<string, Schema>;
  openapiVersion?: string | undefined;
}
const object = (value: unknown): Schema =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Schema)
    : {};
/** Annotation-based redaction is conservative; it is not a substitute for reviewing a snippet. */
export function redactJsonBody(
  body: string,
  context: BodyRedaction,
  credentials: string[] = [],
): string {
  try {
    let visited = 0,
      changed = false;
    const branches = (
      input: Schema[],
      depth = 0,
      active = new WeakSet<Schema>(),
    ): Schema[] =>
      input.flatMap((schema) => {
        if (active.has(schema)) return [];
        if (depth > 16 || ++visited > 10_000)
          throw new Error('Redaction budget exceeded');
        const actual = resolveSchema(schema, context.schemas, {
          ignoreReferenceSiblings:
            context.openapiVersion?.startsWith('3.0') ?? false,
        });
        if (actual.$ref) throw new Error('Unresolved redaction schema');
        active.add(schema);
        const children = [
          ...['allOf', 'anyOf', 'oneOf'].flatMap((key) =>
            Array.isArray(actual[key])
              ? actual[key].filter(
                  (value): value is Schema =>
                    !!value &&
                    typeof value === 'object' &&
                    !Array.isArray(value),
                )
              : [],
          ),
          ...['if', 'then', 'else']
            .filter((key) => actual[key] && typeof actual[key] === 'object')
            .map((key) => object(actual[key])),
          ...Object.values(object(actual.dependentSchemas)).map(object),
        ];
        const result = [actual, ...branches(children, depth + 1, active)];
        active.delete(schema);
        return result;
      });
    const walk = (
      node: JsonValueNode,
      definitions: Schema[],
      depth: number,
    ): JsonValueNode => {
      if (depth > 32 || ++visited > 10_000)
        throw new Error('Redaction budget exceeded');
      const schemas = branches(definitions);
      if (
        schemas.some(
          (schema) => schema.writeOnly === true || schema.format === 'password',
        )
      ) {
        changed = true;
        return { kind: 'string', value: 'YOUR_SENSITIVE_VALUE' };
      }
      if (node.kind === 'string') {
        let value = node.value;
        for (const credential of credentials
          .filter(Boolean)
          .sort((a, b) => b.length - a.length))
          value = value.split(credential).join('YOUR_CREDENTIAL');
        if (value !== node.value) changed = true;
        return { kind: 'string', value };
      }
      if (node.kind === 'object')
        return {
          kind: 'object',
          entries: node.entries.map(([name, value]) => [
            name,
            walk(
              value,
              schemas.flatMap((schema) => {
                const properties = object(schema.properties);
                return [
                  ...(Object.hasOwn(properties, name)
                    ? [object(properties[name])]
                    : [object(schema.additionalProperties)]),
                  // Pattern evaluation could run untrusted regular expressions. Apply all candidates conservatively.
                  ...Object.values(object(schema.patternProperties)).map(
                    object,
                  ),
                ];
              }),
              depth + 1,
            ),
          ]),
        };
      if (node.kind === 'array')
        return {
          kind: 'array',
          items: node.items.map((value, index) =>
            walk(
              value,
              schemas.map((schema) =>
                Array.isArray(schema.prefixItems) &&
                index < schema.prefixItems.length
                  ? object(schema.prefixItems[index])
                  : object(schema.items),
              ),
              depth + 1,
            ),
          ),
        };
      return node;
    };
    const value = walk(parseJsonValue(body), [context.schema], 0);
    return changed ? serializeJsonValue(value, true) : body;
  } catch {
    // Fail closed for invalid, duplicate-key, too-large or unresolved documents.
    return 'YOUR_REQUEST_BODY';
  }
}
