import {
  parseJsonValue,
  resolveSchema,
  serializeJsonValue,
  objectFieldSchema,
} from '@davidniessen/doctopus-contracts';
import type { Media, Schema } from '@davidniessen/doctopus-contracts';

const object = (value: unknown): Schema =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Schema)
    : {};
const array = (schema: Schema) =>
  schema.type === 'array' ||
  (Array.isArray(schema.type) && schema.type.includes('array'));
export function multipartEditorModel(
  media: Media,
  schemas: Record<string, Schema>,
  legacy: boolean,
) {
  const resolve = (schema: Schema) => {
    const result = resolveSchema(schema, schemas, {
      ignoreReferenceSiblings: legacy,
    });
    if (result.$ref)
      throw new Error('Multipart field schema could not resolve.');
    return result;
  };
  let root = resolve(media.schema);
  try {
    root = objectFieldSchema(root, schemas, legacy);
  } catch {
    throw new Error(
      'Multipart object composition cannot be edited safely. Use a custom client.',
    );
  }
  if (
    root['x-doctopus-boolean-schema'] === false ||
    ['allOf', 'oneOf', 'anyOf', 'if', 'then', 'else'].some((key) =>
      Object.hasOwn(root, key),
    ) ||
    (root.type &&
      root.type !== 'object' &&
      !(Array.isArray(root.type) && root.type.includes('object')))
  )
    throw new Error('Multipart editing requires a direct object schema.');
  const properties = Object.entries(object(root.properties));
  if (properties.length > 100)
    throw new Error(
      'Multipart editing supports at most 100 declared fields. Use a custom client for larger forms.',
    );
  const binary = new Set<string>();
  const files = properties.flatMap(([name, property]) => {
    const field = resolve(object(property));
    const multiple = array(field);
    const item = multiple ? resolve(object(field.items)) : field;
    if (item.format !== 'binary') return [];
    binary.add(name);
    if (field.readOnly === true) return [];
    return [
      {
        name,
        multiple,
        required: Array.isArray(root.required) && root.required.includes(name),
        description:
          typeof field.description === 'string' ? field.description : '',
      },
    ];
  });
  return {
    binary,
    files,
    textSchema: {
      ...root,
      properties: Object.fromEntries(
        properties.filter(([name]) => !binary.has(name)),
      ),
      ...(Array.isArray(root.required)
        ? {
            required: root.required.filter(
              (name) => typeof name === 'string' && !binary.has(name),
            ),
          }
        : {}),
    },
  };
}
/** Examples can describe files but cannot select a visitor's local file. */
export function multipartExampleBody(
  body: string,
  media: Media,
  schemas: Record<string, Schema>,
  legacy: boolean,
): string {
  try {
    const value = parseJsonValue(body || '{}');
    if (value.kind !== 'object') return body;
    const model = multipartEditorModel(media, schemas, legacy);
    return serializeJsonValue(
      {
        ...value,
        entries: value.entries.filter(([name]) => !model.binary.has(name)),
      },
      true,
    );
  } catch {
    return body;
  }
}
