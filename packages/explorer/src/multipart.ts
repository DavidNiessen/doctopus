import {
  isJsonMediaType,
  parseJsonValue,
  resolveSchema,
  serializeJsonValue,
  objectFieldSchema,
} from '@davidniessen/doctopus-contracts';
import type {
  JsonValueNode,
  Media,
  Schema,
} from '@davidniessen/doctopus-contracts';
import {
  multipartHeaderLines,
  prepareMultipartHeaders,
} from './multipart-headers.js';
import type { MultipartHeaders } from './multipart-headers.js';
import { hasBodyStyle, styledBodyParts } from './body-style.js';

export interface MultipartFile {
  data: Blob;
  filename: string;
}
export type MultipartFiles = Record<string, readonly MultipartFile[]>;
export type MultipartPart = {
  name: string;
  contentType: string;
  headers?: Record<string, string>;
} & (
  | { kind: 'text'; value: string; collection?: boolean; styled?: true }
  | { kind: 'file'; file: MultipartFile }
);
export const MULTIPART_LIMITS = Object.freeze({
  parts: 100,
  bytes: 32 * 1024 * 1024,
  nameBytes: 1024,
});
export const isMultipartMediaType = (type: string): boolean =>
  type.split(';', 1)[0]!.trim().toLowerCase() === 'multipart/form-data';
const object = (value: unknown): Schema =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Schema)
    : {};
const typeOf = (schema: Schema) =>
  Array.isArray(schema.type)
    ? schema.type.find((type) => type !== 'null')
    : schema.type;
const encoder = new TextEncoder();
const controls = (text: string) =>
  Array.from(text).some(
    (char) => char.codePointAt(0)! < 32 || char.codePointAt(0) === 127,
  );
const token = "[!#$%&'*+.^_`|~0-9A-Za-z-]+";
const mediaType = new RegExp(
  `^${token}/${token}(?: *; *${token}=(?:${token}|"[\\x20-\\x21\\x23-\\x5b\\x5d-\\x7e]*"))*$`,
);
function validateType(type: string) {
  if (
    type.length > 256 ||
    type.includes('*') ||
    type.includes(',') ||
    controls(type) ||
    !mediaType.test(type)
  )
    throw new Error(
      'Each multipart part needs one concrete content type without control characters.',
    );
}
function validateName(name: string, filename = false) {
  if (
    !name ||
    controls(name) ||
    (!filename && /["\\]/.test(name)) ||
    encoder.encode(name).length > MULTIPART_LIMITS.nameBytes ||
    (filename &&
      (name.includes('/') ||
        name.includes('\\') ||
        name === '.' ||
        name === '..'))
  )
    throw new Error(
      filename
        ? 'Upload filenames must be nonempty basenames without control characters, at most 1024 UTF-8 bytes.'
        : 'Multipart field names must be nonempty, without control characters, quotes or backslashes, at most 1024 UTF-8 bytes.',
    );
}
// Match browser multipart filename escaping across common server parsers.
const quoted = (text: string) => `"${text.replaceAll('"', '%22')}"`;
export function multipartPartHeader(part: MultipartPart): string {
  validateName(part.name);
  validateType(part.contentType);
  if (part.kind === 'file') validateName(part.file.filename, true);
  return `Content-Disposition: form-data; name=${quoted(part.name)}${part.kind === 'file' ? `; filename=${quoted(part.file.filename)}` : ''}\r\nContent-Type: ${part.contentType}\r\n${multipartHeaderLines(part.headers)}\r\n`;
}
export function validateMultipartParts(parts: readonly MultipartPart[]): void {
  if (!Array.isArray(parts) || parts.length > MULTIPART_LIMITS.parts)
    throw new Error('Multipart requests support at most 100 parts.');
  let size = 0;
  for (const part of parts) {
    if (part.kind !== 'text' && part.kind !== 'file')
      throw new Error('Invalid multipart part kind.');
    size += encoder.encode(multipartPartHeader(part)).length;
    if (part.kind === 'file') {
      if (!(part.file.data instanceof Blob))
        throw new Error('Multipart files must contain a Blob.');
      size += part.file.data.size;
    } else {
      if (typeof part.value !== 'string')
        throw new Error('Multipart text parts must contain strings.');
      size += encoder.encode(part.value).length;
    }
    // Allow room for independently generated boundaries and CRLF framing as well.
    size += 128;
    if (size > MULTIPART_LIMITS.bytes)
      throw new Error(
        'Multipart requests must fit within 32 MiB including part headers and framing.',
      );
  }
}
const scalar = (value: JsonValueNode): string => {
  if (value.kind === 'string' || value.kind === 'boolean')
    return String(value.value);
  if (value.kind === 'number') return value.text;
  if (value.kind === 'null') return '';
  throw new Error('Non-JSON multipart parts require already serialized text.');
};
/** Prepare parts without reading file bytes or creating a boundary. Safe for deterministic previews. */
export function createMultipartParts(
  input: string,
  files: MultipartFiles,
  media: Media,
  options: {
    schemas?: Record<string, Schema>;
    openapiVersion?: string | undefined;
    partHeaders?: MultipartHeaders;
  } = {},
): MultipartPart[] {
  const values = parseJsonValue(input);
  if (values.kind !== 'object')
    throw new Error('Multipart text values must be a JSON object.');
  const resolve = (schema: Schema) => {
    const result = resolveSchema(schema, options.schemas ?? {}, {
      ignoreReferenceSiblings:
        options.openapiVersion?.startsWith('3.0') ?? false,
    });
    if (result.$ref)
      throw new Error('Multipart schema reference could not resolve.');
    return result;
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
      'Multipart object composition cannot be serialized safely. Use a custom client.',
    );
  }
  if (
    schema['x-doctopus-boolean-schema'] === false ||
    (schema.type && typeOf(schema) !== 'object') ||
    ['allOf', 'anyOf', 'oneOf', 'if', 'then', 'else'].some((key) =>
      Object.hasOwn(schema, key),
    )
  )
    throw new Error(
      'Multipart input requires a direct object schema or compatible allOf branches; conditional roots are not supported.',
    );
  const properties = object(schema.properties);
  const property = (name: string) =>
    resolve(
      object(
        Object.hasOwn(properties, name)
          ? properties[name]
          : schema.additionalProperties,
      ),
    );
  const encoding = (name: string) => {
    const value = object(media.encoding?.[name]);
    if (!options.openapiVersion?.startsWith('3.0') && hasBodyStyle(value))
      return value;
    if (
      value.contentType !== undefined &&
      typeof value.contentType !== 'string'
    )
      throw new Error('Multipart part contentType must be a string.');
    return value;
  };
  const parts: MultipartPart[] = [];
  const headersFor = prepareMultipartHeaders(
    media,
    options.partHeaders,
    options,
  );
  const present = new Set<string>();
  const owners = new Map<string, string>();
  const add = (part: MultipartPart, field = part.name) => {
    if (owners.has(part.name) && owners.get(part.name) !== field)
      throw new Error(
        'Styled multipart field names collide with another logical property.',
      );
    owners.set(part.name, field);
    const headers = headersFor(field);
    parts.push(headers ? { ...part, headers } : part);
    if (parts.length > MULTIPART_LIMITS.parts)
      throw new Error('Multipart requests support at most 100 parts.');
    present.add(field);
  };
  for (const [name, value] of values.entries) {
    const definition = property(name);
    const array = typeOf(definition) === 'array' || value.kind === 'array';
    const item = array ? resolve(object(definition.items)) : definition;
    if (item.format === 'binary')
      throw new Error(
        'Binary multipart values must be supplied as selected files, separately from text values.',
      );
    const codec = encoding(name);
    if (!options.openapiVersion?.startsWith('3.0') && hasBodyStyle(codec)) {
      for (const part of styledBodyParts(name, value, definition, codec))
        add(
          {
            name: part.name,
            kind: 'text',
            contentType: 'text/plain; charset=utf-8',
            value: part.value,
            styled: true,
          },
          name,
        );
      continue;
    }
    for (const node of value.kind === 'array' ? value.items : [value]) {
      const json =
        typeOf(item) === 'object' ||
        typeOf(item) === 'array' ||
        (!item.type && (node.kind === 'object' || node.kind === 'array'));
      const contentType =
        typeof codec.contentType === 'string'
          ? codec.contentType.trim()
          : json
            ? 'application/json'
            : 'text/plain; charset=utf-8';
      add({
        name,
        kind: 'text',
        ...(value.kind === 'array' ? { collection: true } : {}),
        contentType,
        value: isJsonMediaType(contentType)
          ? serializeJsonValue(node)
          : scalar(node),
      });
    }
  }
  for (const [name, selected] of Object.entries(files)) {
    if (!Array.isArray(selected))
      throw new Error('Multipart file fields must contain arrays of files.');
    if (!selected.length) continue;
    if (values.entries.some(([key]) => key === name))
      throw new Error(
        'A multipart field cannot contain both text values and selected files.',
      );
    const definition = property(name);
    const array = typeOf(definition) === 'array';
    const item = array ? resolve(object(definition.items)) : definition;
    if (item.format !== 'binary')
      throw new Error(
        'File fields must declare format: binary, directly or in array items.',
      );
    if (!array && selected.length > 1)
      throw new Error('A single-file field cannot contain multiple files.');
    const codec = encoding(name);
    if (!options.openapiVersion?.startsWith('3.0') && hasBodyStyle(codec))
      throw new Error(
        'Style-based binary uploads require a custom client; use content-based file parts.',
      );
    for (const file of selected)
      add({
        name,
        kind: 'file',
        contentType:
          typeof codec.contentType === 'string'
            ? codec.contentType.trim()
            : 'application/octet-stream',
        file,
      });
  }
  if (Array.isArray(schema.required))
    for (const name of schema.required)
      if (
        typeof name === 'string' &&
        property(name).readOnly !== true &&
        !present.has(name)
      )
        throw new Error(`Required multipart field is missing: ${name}`);
  validateMultipartParts(parts);
  return parts;
}
/** Assemble a Blob from immutable file slices; this does not decode or buffer uploaded files as text. */
export function multipartBody(parts: readonly MultipartPart[]): {
  body: Blob;
  contentType: string;
} {
  validateMultipartParts(parts);
  const random = crypto.getRandomValues(new Uint8Array(24));
  const boundary =
    'doctopus-' +
    Array.from(random, (byte) => byte.toString(16).padStart(2, '0')).join('');
  const chunks: BlobPart[] = [];
  for (const part of parts) {
    chunks.push(
      `--${boundary}\r\n${multipartPartHeader(part)}`,
      part.kind === 'text' ? part.value : part.file.data,
      '\r\n',
    );
  }
  chunks.push(`--${boundary}--\r\n`);
  const contentType = `multipart/form-data; boundary=${boundary}`;
  return { body: new Blob(chunks, { type: contentType }), contentType };
}
