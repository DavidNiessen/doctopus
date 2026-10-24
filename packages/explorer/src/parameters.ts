import {
  isJsonMediaType,
  resolveSchema,
} from '@davidniessen/doctopus-contracts';
import type { Parameter, Schema } from '@davidniessen/doctopus-contracts';

export const encodeValue = (value: unknown): string =>
  encodeURIComponent(String(value)).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
type Scalar = string | number | boolean | null;
type Value = Scalar | Scalar[] | Record<string, Scalar>;
export interface QueryPart {
  name: string;
  value: string;
}
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isScalar = (value: unknown): value is Scalar =>
  value === null || ['string', 'number', 'boolean'].includes(typeof value);
// Scan validated JSON once; no regular expression retries at quotes or escapes.
function rewriteJson(raw: string, quoteNumbers: boolean): string {
  JSON.parse(raw);
  const output: string[] = [];
  let offset = 0;
  while (offset < raw.length) {
    const start = offset,
      first = raw[offset++]!;
    if (first === '"') {
      while (offset < raw.length) {
        const character = raw[offset++];
        if (character === '\\') offset++;
        else if (character === '"') break;
      }
      output.push(raw.slice(start, offset));
    } else if (first === '-' || (first >= '0' && first <= '9')) {
      while (offset < raw.length && '0123456789.eE+-'.includes(raw[offset]!))
        offset++;
      const number = raw.slice(start, offset);
      output.push(quoteNumbers ? JSON.stringify(number) : number);
    } else if (quoteNumbers || ![' ', '\t', '\r', '\n'].includes(first))
      output.push(first);
  }
  return output.join('');
}
function shape(
  schema: Schema,
  schemas: Record<string, Schema>,
  legacy: boolean,
  depth = 0,
): 'array' | 'object' | undefined {
  if (depth > 16)
    throw new Error('Parameter schema exceeds the resolution limit');
  const actual = resolveSchema(schema, schemas, {
    ignoreReferenceSiblings: legacy,
  });
  if (actual.$ref)
    throw new Error('Parameter schema reference could not resolve');
  const types = Array.isArray(actual.type) ? actual.type : [actual.type];
  if (types.includes('array')) return 'array';
  if (types.includes('object') || actual.properties) return 'object';
  if (Array.isArray(actual.allOf)) {
    const shapes = new Set(
      actual.allOf
        .filter(isObject)
        .map((child) => shape(child, schemas, legacy, depth + 1))
        .filter(Boolean),
    );
    if (shapes.size > 1) throw new Error('Conflicting parameter schema types');
    return [...shapes][0];
  }
  if (actual.oneOf || actual.anyOf)
    throw new Error(
      'Parameter alternatives without an explicit structured type require parameter content',
    );
  return undefined;
}
function valueFor(
  parameter: Parameter,
  raw: string,
  schemas: Record<string, Schema>,
  legacy: boolean,
): Value {
  const expected = shape(parameter.schema, schemas, legacy);
  if (!expected) return raw;
  let value: unknown;
  try {
    // Styled scalars become wire text. Preserve numeric lexemes before JS can round them.
    value = JSON.parse(rewriteJson(raw, true));
  } catch {
    throw new Error(`${parameter.name} must be valid JSON`);
  }
  if (expected === 'array' ? !Array.isArray(value) : !isObject(value))
    throw new Error(`${parameter.name} must be a JSON ${expected}`);
  if (
    !(Array.isArray(value) ? value : Object.values(value as object)).every(
      isScalar,
    )
  )
    throw new Error(
      `${parameter.name}: nested parameter values have no defined serialization; use parameter content`,
    );
  return value as Value;
}
const pairs = (value: Value): [string, Scalar][] =>
  isObject(value) ? (Object.entries(value) as [string, Scalar][]) : [];
function pathValue(value: Value, parameter: Parameter): string {
  const style = parameter.style ?? 'simple';
  const explode = parameter.explode ?? false;
  const object = pairs(value);
  const parts = Array.isArray(value)
    ? value.map(encodeValue)
    : isObject(value)
      ? object.flatMap(([key, item]) =>
          explode
            ? [`${encodeValue(key)}=${encodeValue(item)}`]
            : [encodeValue(key), encodeValue(item)],
        )
      : [encodeValue(value)];
  if (style === 'label') return `.${parts.join(explode ? '.' : ',')}`;
  if (style === 'matrix')
    return explode && (Array.isArray(value) || isObject(value))
      ? parts
          .map(
            (part) =>
              `;${Array.isArray(value) ? `${encodeValue(parameter.name)}=` : ''}${part}`,
          )
          .join('')
      : `;${encodeValue(parameter.name)}=${parts.join(',')}`;
  if (style !== 'simple') throw new Error(`Unsupported path style: ${style}`);
  return parts.join(',');
}
const forbiddenHeader =
  /^(accept-charset|accept-encoding|access-control-request-headers|access-control-request-method|connection|content-length|cookie|date|dnt|expect|host|keep-alive|origin|permissions-policy|referer|te|trailer|transfer-encoding|upgrade|user-agent|via|sec-.*|proxy-.*|x-http-method.*)$/i;
/** HTTP names are case-insensitive. Avoid Node fetch's lowercase __proto__ dictionary collision. */
export function fetchHeaderEntries(
  headers: Record<string, string>,
): [string, string][] {
  return Object.entries(headers).map(([name, value]) => [
    name.toLowerCase() === '__proto__' ? '__Proto__' : name,
    value,
  ]);
}
export function setRequestHeader(
  headers: Record<string, string>,
  name: string,
  value: string,
): void {
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || forbiddenHeader.test(name))
    throw new Error(`Header cannot be set by the browser: ${name}`);
  if (
    Array.from(value).some((character) => {
      const point = character.codePointAt(0)!;
      return point > 255 || point === 127 || (point < 32 && point !== 9);
    })
  )
    throw new Error(
      `Header ${name} contains characters that cannot be sent by the browser`,
    );
  const existing = Object.keys(headers).find(
    (key) => key.toLowerCase() === name.toLowerCase(),
  );
  if (existing) delete headers[existing];
  Object.defineProperty(headers, name, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}
export function queryParts(value: Value, parameter: Parameter): QueryPart[] {
  const style = parameter.style ?? 'form';
  const explode = parameter.explode ?? style === 'form';
  const encode = (part: unknown) => {
    const text = String(part);
    if (!parameter.allowReserved) return encodeValue(part);
    if (/[&#+=]|\[|\]/.test(text))
      throw new Error(
        `${parameter.name}: allowReserved requires pre-encoding &, #, +, = and brackets to avoid ambiguous query values`,
      );
    return text
      .split(/(%[0-9A-Fa-f]{2})/)
      .map((piece) =>
        /^%[0-9A-Fa-f]{2}$/.test(piece)
          ? piece
          : encodeValue(piece).replace(
              /%([0-9A-F]{2})/g,
              (match, hex: string) => {
                const character = String.fromCharCode(parseInt(hex, 16));
                return ":/?@!$'()*,;".includes(character) ? character : match;
              },
            ),
      )
      .join('');
  };
  const entry = (name: string, text: string): QueryPart => ({
    name,
    value: text,
  });
  const object = pairs(value);
  if (style === 'deepObject') {
    if (!isObject(value) || parameter.explode === false)
      throw new Error(
        `${parameter.name}: deepObject requires a flat object with explode enabled`,
      );
    if (!object.length)
      throw new Error(
        `${parameter.name}: an empty deepObject has no defined query representation`,
      );
    return object.map(([key, item]) =>
      entry(`${parameter.name}[${key}]`, encode(item)),
    );
  }
  if (!['form', 'spaceDelimited', 'pipeDelimited'].includes(style))
    throw new Error(`Unsupported query style: ${style}`);
  if (
    style !== 'form' &&
    (explode || (!isObject(value) && !Array.isArray(value)))
  )
    throw new Error(
      `${parameter.name}: ${style} requires an array or object with explode disabled`,
    );
  if (explode && (Array.isArray(value) || isObject(value))) {
    if (!(Array.isArray(value) ? value.length : object.length))
      throw new Error(
        `${parameter.name}: an empty exploded collection has no defined query representation`,
      );
    return Array.isArray(value)
      ? value.map((item) => entry(parameter.name, encode(item)))
      : object.map(([key, item]) => entry(key, encode(item)));
  }
  const separator =
    style === 'spaceDelimited'
      ? '%20'
      : style === 'pipeDelimited'
        ? '%7C'
        : ',';
  const values = Array.isArray(value)
    ? value
    : isObject(value)
      ? object.flat()
      : [value];
  return [entry(parameter.name, values.map(encode).join(separator))];
}
type ParameterOptions = {
  schemas?: Record<string, Schema>;
  openapiVersion?: string | undefined;
};
function parameterValue(
  parameter: Parameter,
  raw: string,
  options: ParameterOptions,
) {
  let serialized: string | undefined;
  if (parameter.content) {
    const media = Object.keys(parameter.content);
    if (media.length !== 1)
      throw new Error(
        `${parameter.name}: parameter content requires exactly one media type`,
      );
    serialized = raw;
    if (isJsonMediaType(media[0]!)) {
      try {
        serialized = rewriteJson(raw, false);
      } catch {
        throw new Error(`${parameter.name} must be valid JSON`);
      }
    }
  }
  return {
    serialized,
    value:
      serialized === undefined
        ? valueFor(
            parameter,
            raw,
            options.schemas ?? {},
            options.openapiVersion?.startsWith('3.0') ?? false,
          )
        : serialized,
  };
}
function headerText(
  parameter: Parameter,
  value: Value,
  serialized: string | undefined,
): string {
  if (serialized === undefined && (parameter.style ?? 'simple') !== 'simple')
    throw new Error(`Unsupported header style: ${parameter.style}`);
  return (
    serialized ??
    (Array.isArray(value)
      ? value.map(String).join(',')
      : isObject(value)
        ? pairs(value)
            .flatMap(([key, item]) =>
              parameter.explode ? [`${key}=${item}`] : [key, String(item)],
            )
            .join(',')
        : String(value))
  );
}
/** Header representation only; each transport applies its own name/framing policy. */
export function serializeHeaderValue(
  parameter: Parameter,
  raw: string,
  options: ParameterOptions,
): string {
  const { value, serialized } = parameterValue(parameter, raw, options);
  return headerText(parameter, value, serialized);
}
export function serializeParameters(
  parameters: Parameter[],
  input: Record<string, string>,
  options: {
    schemas?: Record<string, Schema>;
    openapiVersion?: string | undefined;
    parameterPresence?: Readonly<Record<string, boolean>>;
  } = {},
): {
  paths: Record<string, string>;
  query: QueryPart[];
  headers: Record<string, string>;
} {
  const paths: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  const query: QueryPart[] = [],
    headers: Record<string, string> = {};
  const presence = options.parameterPresence;
  if (presence !== undefined && !isObject(presence))
    throw new Error(
      'Parameter presence must be a record of qualified keys and booleans',
    );
  for (const parameter of parameters) {
    // OpenAPI reserves these headers for its media/security definitions.
    if (
      parameter.in === 'header' &&
      /^(accept|content-type|authorization)$/i.test(parameter.name)
    )
      continue;
    const key = `${parameter.in}:${parameter.name}`;
    const raw = input[key] ?? '';
    const explicit = presence && Object.hasOwn(presence, key);
    if (explicit && typeof presence[key] !== 'boolean')
      throw new Error(`Parameter presence for ${key} must be a boolean`);
    const included = explicit ? presence[key] : raw !== '';
    if (!included) {
      if (parameter.required) throw new Error(`${parameter.name} is required`);
      continue;
    }
    if (parameter.in === 'cookie')
      throw new Error(
        'Cookie parameters require a same-origin authenticated session and cannot be set manually in a browser',
      );
    const { value, serialized } = parameterValue(parameter, raw, options);
    if (parameter.in === 'path')
      paths[parameter.name] =
        serialized === undefined
          ? pathValue(value, parameter)
          : encodeValue(serialized);
    else if (parameter.in === 'query')
      query.push(
        ...(serialized === undefined
          ? queryParts(value, parameter)
          : [{ name: parameter.name, value: encodeValue(serialized) }]),
      );
    else {
      setRequestHeader(
        headers,
        parameter.name,
        headerText(parameter, value, serialized),
      );
    }
  }
  return { paths, query, headers };
}

/** Whether empty text has a supported representation, before URL-level checks. */
export function canSerializeEmptyParameter(
  parameter: Parameter,
  options: ParameterOptions = {},
): boolean {
  if (
    parameter.in === 'cookie' ||
    (parameter.in === 'header' &&
      /^(accept|content-type|authorization)$/i.test(parameter.name))
  )
    return false;
  const key = `${parameter.in}:${parameter.name}`;
  try {
    serializeParameters(
      [parameter],
      { [key]: '' },
      { ...options, parameterPresence: { [key]: true } },
    );
    return true;
  } catch {
    return false;
  }
}
