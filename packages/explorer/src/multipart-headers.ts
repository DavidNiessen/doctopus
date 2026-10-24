import { resolveHeaderObject } from '@davidniessen/doctopus-contracts';
import type {
  Media,
  Parameter,
  Schema,
} from '@davidniessen/doctopus-contracts';
import { serializeHeaderValue } from './parameters.js';

export type MultipartHeaders = Record<string, Record<string, string>>;
export interface MultipartHeaderField {
  field: string;
  parameter: Parameter;
}
type Options = {
  schemas?: Record<string, Schema>;
  openapiVersion?: string | undefined;
};
export const MULTIPART_HEADER_LIMITS = Object.freeze({
  fields: 100,
  perPart: 16,
  bytes: 8192,
});
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const namePattern = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/;
const owned =
  /^(content-type|content-disposition|content-length|transfer-encoding)$/i;

/** Validate already serialized MIME extension headers independently of HTTP transport headers. */
export function multipartHeaderLines(
  headers: Record<string, string> = {},
): string {
  if (
    !object(headers) ||
    Object.keys(headers).length > MULTIPART_HEADER_LIMITS.perPart
  )
    throw new Error('Multipart parts support at most 16 custom headers.');
  const names = new Set<string>();
  let text = '';
  for (const [name, value] of Object.entries(headers)) {
    if (
      !namePattern.test(name) ||
      owned.test(name) ||
      names.has(name.toLowerCase())
    )
      throw new Error(
        'Invalid, duplicate or encoder-owned multipart header name.',
      );
    if (typeof value !== 'string' || /[^\x20-\x7e]/.test(value))
      throw new Error(
        'Multipart header values must be printable ASCII without control characters.',
      );
    names.add(name.toLowerCase());
    text += `${name}: ${value}\r\n`;
    if (text.length > MULTIPART_HEADER_LIMITS.bytes)
      throw new Error('Multipart custom headers exceed 8192 bytes per part.');
  }
  return text;
}
const encoder = new TextEncoder();

/** Resolve Header Objects from the portable schema/reference registry. Never loads example URLs. */
export function multipartHeaderFields(
  media: Media,
  options: Options = {},
): MultipartHeaderField[] {
  const result: MultipartHeaderField[] = [];
  const encodings = Object.entries(media.encoding ?? {}).filter(
    ([, value]) => object(value) && value.headers !== undefined,
  );
  if (encodings.length > MULTIPART_HEADER_LIMITS.fields)
    throw new Error('Multipart headers support at most 100 encoded fields.');
  for (const [field, raw] of encodings) {
    if (!object(raw) || raw.headers === undefined) continue;
    if (!object(raw.headers))
      throw new Error('Multipart encoding headers must be Header Object maps.');
    const entries = Object.entries(raw.headers).filter(
      ([name]) => name.toLowerCase() !== 'content-type',
    );
    if (entries.length > MULTIPART_HEADER_LIMITS.perPart)
      throw new Error('Multipart parts support at most 16 custom headers.');
    const names = new Set<string>();
    for (const [name, input] of entries) {
      if (
        !namePattern.test(name) ||
        owned.test(name) ||
        names.has(name.toLowerCase())
      )
        throw new Error(
          'Invalid, duplicate or encoder-owned multipart header name.',
        );
      names.add(name.toLowerCase());
      if (!object(input)) throw new Error('Invalid multipart Header Object.');
      const header = resolveHeaderObject(
        input,
        (reference) =>
          Object.hasOwn(options.schemas ?? {}, reference)
            ? options.schemas![reference]
            : undefined,
        options.openapiVersion?.startsWith('3.0') ?? false,
      );
      if (
        (header.style !== undefined && header.style !== 'simple') ||
        (header.explode !== undefined && typeof header.explode !== 'boolean')
      )
        throw new Error(
          'Multipart headers support simple style with a boolean explode setting.',
        );
      result.push({
        field,
        parameter: {
          name,
          in: 'header',
          required: header.required === true,
          description:
            typeof header.description === 'string' ? header.description : '',
          schema: object(header.schema) ? header.schema : {},
          ...(header.style === undefined ? {} : { style: 'simple' }),
          ...(typeof header.explode === 'boolean'
            ? { explode: header.explode }
            : {}),
          ...(object(header.content)
            ? { content: header.content as Record<string, Media> }
            : {}),
        },
      });
    }
  }
  return result;
}

export function prepareMultipartHeaders(
  media: Media,
  input: MultipartHeaders = {},
  options: Options = {},
): (field: string) => Record<string, string> | undefined {
  const definitions = multipartHeaderFields(media, options);
  if (
    !object(input) ||
    Object.keys(input).length > MULTIPART_HEADER_LIMITS.fields
  )
    throw new Error('Invalid multipart header field values.');
  const values = new Map<string, Map<string, string>>();
  for (const [field, headers] of Object.entries(input)) {
    if (
      !object(headers) ||
      Object.keys(headers).filter(
        (name) => name.toLowerCase() !== 'content-type',
      ).length > MULTIPART_HEADER_LIMITS.perPart
    )
      throw new Error('Invalid multipart header values.');
    const current = new Map<string, string>();
    for (const [name, value] of Object.entries(headers)) {
      const key = name.toLowerCase();
      if (key === 'content-type') continue; // Required by the OpenAPI Encoding Object contract.
      if (
        !namePattern.test(name) ||
        current.has(key) ||
        typeof value !== 'string' ||
        encoder.encode(value).length > MULTIPART_HEADER_LIMITS.bytes
      )
        throw new Error('Invalid or excessive multipart header input.');
      if (
        value &&
        !definitions.some(
          (definition) =>
            definition.field === field &&
            definition.parameter.name.toLowerCase() === key,
        )
      )
        throw new Error(
          'Multipart header input must be declared by its encoding.',
        );
      current.set(key, value);
    }
    values.set(field, current);
  }
  return (field) => {
    const entries: [string, string][] = [];
    for (const definition of definitions) {
      if (definition.field !== field) continue;
      const parameter = definition.parameter;
      const raw = values.get(field)?.get(parameter.name.toLowerCase()) ?? '';
      if (!raw && parameter.required)
        throw new Error(
          `Required multipart header missing for ${field}: ${parameter.name}`,
        );
      if (raw)
        entries.push([
          parameter.name,
          serializeHeaderValue(parameter, raw, options),
        ]);
    }
    if (!entries.length) return undefined;
    const headers = Object.fromEntries(entries);
    multipartHeaderLines(headers);
    return headers;
  };
}
