import {
  isJsonMediaType,
  parseJsonValue,
  resolveSchema,
  serializeJsonValue,
  objectFieldSchema,
} from '@davidniessen/doctopus-contracts';
import type { JsonValueNode, Schema } from '@davidniessen/doctopus-contracts';
import { redactJsonBody } from './redact-body.js';
import type { BodyRedaction } from './redact-body.js';
import type { MultipartPart } from './multipart.js';

const object = (value: unknown): Schema =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Schema)
    : {};
const placeholder = (part: MultipartPart) =>
  isJsonMediaType(part.contentType)
    ? JSON.stringify('YOUR_PART_VALUE')
    : 'YOUR_PART_VALUE';
/** Reconstruct logical arrays for schema annotations without ever examining uploaded files. */
export function redactMultipartParts(
  parts: readonly MultipartPart[],
  context: BodyRedaction | undefined,
  credentials: string[],
  scrub: (value: string) => string,
): MultipartPart[] {
  const values = new Map<number, string>();
  const opaque = new Set<number>();
  const fileNames = new Set(
    parts.filter((part) => part.kind === 'file').map((part) => part.name),
  );
  if (context) {
    try {
      let visited = 0;
      const resolve = (schema: Schema) => {
        if (++visited > 10_000) throw new Error('Redaction budget exceeded');
        return resolveSchema(schema, context.schemas, {
          ignoreReferenceSiblings:
            context.openapiVersion?.startsWith('3.0') ?? false,
        });
      };
      const root = objectFieldSchema(
        resolve(context.schema),
        context.schemas,
        context.openapiVersion?.startsWith('3.0') ?? false,
      );
      if (root.$ref) throw new Error('Unresolved schema');
      const groups = new Map<
        string,
        { indexes: number[]; nodes: JsonValueNode[]; collection: boolean }
      >();
      for (const [index, part] of parts.entries()) {
        if (part.kind !== 'text') continue;
        // Styled flat wire values cannot be reconstructed from the JSON schema alone.
        if (part.styled) opaque.add(index);
        if (fileNames.has(part.name)) opaque.add(index);
        const properties = object(root.properties);
        const property = resolve(
          object(
            Object.hasOwn(properties, part.name)
              ? properties[part.name]
              : root.additionalProperties,
          ),
        );
        if (!isJsonMediaType(part.contentType)) {
          const plain =
            part.contentType.split(';', 1)[0]!.trim().toLowerCase() ===
            'text/plain';
          const collection =
            part.collection === true ||
            property.type === 'array' ||
            (Array.isArray(property.type) && property.type.includes('array'));
          const candidates = [
            property,
            ...Object.values(object(root.patternProperties)).map(object),
          ];
          const structured = candidates.some((candidate) => {
            const resolved = resolve(candidate);
            if (Array.isArray(resolved.prefixItems)) return true;
            const item = collection
              ? resolve(object(resolved.items))
              : resolved;
            return (
              item.$ref ||
              item.properties ||
              item.type === 'object' ||
              (Array.isArray(item.type) && item.type.includes('object')) ||
              [
                'allOf',
                'oneOf',
                'anyOf',
                'if',
                'then',
                'else',
                'dependentSchemas',
              ].some((key) => Object.hasOwn(item, key))
            );
          });
          if (
            !plain ||
            structured ||
            [
              'allOf',
              'oneOf',
              'anyOf',
              'if',
              'then',
              'else',
              'dependentSchemas',
            ].some((key) => Object.hasOwn(root, key))
          )
            opaque.add(index);
        }
        const group = groups.get(part.name) ?? {
          indexes: [],
          nodes: [],
          collection:
            part.collection === true ||
            property.type === 'array' ||
            (Array.isArray(property.type) && property.type.includes('array')),
        };
        group.indexes.push(index);
        group.nodes.push(
          opaque.has(index)
            ? { kind: 'string', value: 'YOUR_PART_VALUE' }
            : isJsonMediaType(part.contentType)
              ? parseJsonValue(part.value)
              : { kind: 'string', value: part.value },
        );
        group.collection ||=
          part.collection === true || group.indexes.length > 1;
        groups.set(part.name, group);
      }
      const logical: JsonValueNode = {
        kind: 'object',
        entries: [...groups].map(([name, group]) => [
          name,
          group.collection
            ? { kind: 'array', items: group.nodes }
            : group.nodes[0]!,
        ]),
      };
      const result = parseJsonValue(
        redactJsonBody(serializeJsonValue(logical), context, credentials),
      );
      if (result.kind !== 'object')
        throw new Error('Redacted root is not an object');
      for (const [name, group] of groups) {
        const node = result.entries.find(([key]) => key === name)?.[1];
        if (!node) continue;
        for (let cursor = 0; cursor < group.indexes.length; cursor++) {
          const index = group.indexes[cursor]!,
            part = parts[index]!;
          if (opaque.has(index)) continue;
          const child =
            group.collection && node.kind === 'array'
              ? node.items[cursor]
              : node;
          if (!child) continue;
          const text = scrub(
            isJsonMediaType(part.contentType)
              ? serializeJsonValue(child)
              : child.kind === 'string'
                ? child.value
                : serializeJsonValue(child),
          );
          // Credential replacement can change a numeric token; retain valid JSON or fail closed.
          if (isJsonMediaType(part.contentType)) parseJsonValue(text);
          values.set(index, text);
        }
      }
    } catch {
      values.clear();
    }
  }
  return parts.map((part, index): MultipartPart =>
    part.kind === 'file'
      ? {
          name: scrub(part.name),
          kind: 'file',
          contentType: scrub(part.contentType),
          ...(part.headers
            ? {
                headers: Object.fromEntries(
                  Object.keys(part.headers).map((name) => [
                    scrub(name),
                    'YOUR_PART_HEADER',
                  ]),
                ),
              }
            : {}),
          file: { filename: 'upload.bin', data: new Blob([]) },
        }
      : {
          name: scrub(part.name),
          kind: 'text',
          contentType: scrub(part.contentType),
          ...(part.headers
            ? {
                headers: Object.fromEntries(
                  Object.keys(part.headers).map((name) => [
                    scrub(name),
                    'YOUR_PART_HEADER',
                  ]),
                ),
              }
            : {}),
          ...(part.collection ? { collection: true } : {}),
          ...(part.styled ? { styled: true } : {}),
          value: values.get(index) ?? placeholder(part),
        },
  );
}
