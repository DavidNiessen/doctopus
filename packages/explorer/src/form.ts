import {
  isJsonMediaType,
  parseJsonValue,
  serializeJsonValue,
  resolveSchema,
  objectFieldSchema,
} from '@davidniessen/doctopus-contracts';
import type {
  JsonValueNode,
  Media,
  Schema,
} from '@davidniessen/doctopus-contracts';
import { encodeValue } from './parameters.js';
import { hasBodyStyle, styledBodyParts } from './body-style.js';

export const isFormMediaType = (type: string): boolean =>
  type.split(';', 1)[0]!.trim().toLowerCase() ===
  'application/x-www-form-urlencoded';
const object = (value: unknown): Schema =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Schema)
    : {};
const scalar = (value: JsonValueNode): string => {
  if (value.kind === 'string' || value.kind === 'boolean')
    return String(value.value);
  if (value.kind === 'number') return value.text;
  if (value.kind === 'null') return '';
  throw new Error(
    'Styled form values must be flat. Use JSON content encoding for nested data.',
  );
};
function contentType(schema: Schema, value: JsonValueNode): string {
  const type = Array.isArray(schema.type)
    ? schema.type.find((type) => type !== 'null')
    : schema.type;
  if (
    schema.contentEncoding ||
    schema.format === 'binary' ||
    schema.format === 'byte'
  )
    return 'application/octet-stream';
  return type === 'object' ||
    type === 'array' ||
    (!type && (value.kind === 'object' || value.kind === 'array'))
    ? 'application/json'
    : 'text/plain';
}
/** Encode logical JSON form values. Pre-serialized bodies do not call this helper. */
export function encodeFormBody(
  input: string,
  media: Media,
  options: {
    schemas?: Record<string, Schema>;
    openapiVersion?: string | undefined;
  } = {},
): string {
  const values = parseJsonValue(input);
  if (values.kind !== 'object')
    throw new Error('Form values must be a JSON object.');
  const resolve = (schema: Schema) => {
    const actual = resolveSchema(schema, options.schemas ?? {}, {
      ignoreReferenceSiblings:
        options.openapiVersion?.startsWith('3.0') ?? false,
    });
    if (actual.$ref)
      throw new Error('Form schema reference could not resolve.');
    return actual;
  };
  let schema = resolve(media.schema);
  try {
    schema = objectFieldSchema(
      schema,
      options.schemas ?? {},
      options.openapiVersion?.startsWith('3.0') ?? false,
    );
  } catch {
    throw new Error(
      'Composed or conditional form schemas require a pre-serialized body.',
    );
  }
  if (
    schema.type &&
    schema.type !== 'object' &&
    !(Array.isArray(schema.type) && schema.type.includes('object'))
  )
    throw new Error('Logical form values require an object schema.');
  if (
    schema.allOf ||
    schema.oneOf ||
    schema.anyOf ||
    schema.if ||
    schema.then ||
    schema.else
  )
    throw new Error(
      'Composed or conditional form schemas require a pre-serialized body.',
    );
  const parts: string[] = [];
  for (const [name, value] of values.entries) {
    const properties = object(schema.properties);
    const property = resolve(
      object(
        Object.hasOwn(properties, name)
          ? properties[name]
          : schema.additionalProperties,
      ),
    );
    const encoding = object(media.encoding?.[name]);
    if (hasBodyStyle(encoding)) {
      const query = styledBodyParts(name, value, property, encoding);
      parts.push(
        ...query.map(({ name, value }) => `${encodeValue(name)}=${value}`),
      );
      continue;
    }
    const items = value.kind === 'array' ? value.items : [value];
    const itemSchema =
      value.kind === 'array' ? resolve(object(property.items)) : property;
    for (const item of items) {
      const type =
        typeof encoding.contentType === 'string'
          ? encoding.contentType.trim()
          : contentType(itemSchema, item);
      if (type.includes(',') || type.includes('*'))
        throw new Error(
          `${name}: choose one concrete content type for a form field.`,
        );
      const serialized = isJsonMediaType(type)
        ? serializeJsonValue(item)
        : scalar(item);
      // Content-based form encoding follows the browser's WHATWG form algorithm.
      parts.push(new URLSearchParams([[name, serialized]]).toString());
    }
  }
  return parts.join('&');
}
