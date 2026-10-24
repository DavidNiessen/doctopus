import type {
  Operation,
  Schema,
  SecurityScheme,
} from '@davidniessen/doctopus-contracts';
import {
  encodeValue,
  serializeParameters,
  setRequestHeader,
  fetchHeaderEntries,
} from './parameters.js';
import { isJsonMediaType } from '@davidniessen/doctopus-contracts';
import { redactJsonBody } from './redact-body.js';
import type { BodyRedaction } from './redact-body.js';
import { encodeFormBody, isFormMediaType } from './form.js';
import {
  createMultipartParts,
  isMultipartMediaType,
  multipartBody,
} from './multipart.js';
import type { MultipartFiles, MultipartPart } from './multipart.js';
import type { MultipartHeaders } from './multipart-headers.js';
import { redactMultipartParts } from './redact-multipart.js';
import { appendAdditionalParameters } from './additional-parameters.js';
import type { AdditionalParameter } from './additional-parameters.js';
export {
  redactAdditionalParameters,
  isSensitiveAdditionalParameter,
} from './additional-parameters.js';
export type { AdditionalParameter } from './additional-parameters.js';
export interface RequestInput {
  server: string;
  parameters: Record<string, string>;
  /** Qualified in:name keys: true includes empty input, false omits an optional draft. */
  parameterPresence?: Readonly<Record<string, boolean>>;
  additionalParameters?: readonly AdditionalParameter[];
  body?: string;
  bodyFormat?: 'serialized' | 'json';
  files?: MultipartFiles;
  partHeaders?: MultipartHeaders;
  contentType?: string;
  accept?: string;
  credentials?: Record<string, string>;
  schemas?: Record<string, Schema>;
  openapiVersion?: string | undefined;
}
export interface PreparedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  multipart?: MultipartPart[];
}
const base64 = (value: string): string =>
  btoa(
    Array.from(new TextEncoder().encode(value), (byte) =>
      String.fromCharCode(byte),
    ).join(''),
  );
export function prepareRequest(
  operation: Operation,
  schemes: Record<string, SecurityScheme>,
  input: RequestInput,
): PreparedRequest {
  if (operation.kind && operation.kind !== 'endpoint')
    throw new Error(
      'Webhooks and callbacks are inbound events and cannot be executed in the API explorer',
    );
  const base = new URL(input.server);
  if (
    !['https:', 'http:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.hash ||
    base.search
  )
    throw new Error(
      'Server must be an HTTP(S) URL without credentials, a query, or a fragment',
    );
  let path = operation.path;
  const serialized = serializeParameters(
    operation.parameters,
    input.parameters,
    input,
  );
  const query = serialized.query;
  const response = operation.responses.find((item) => /^2/.test(item.status));
  const accept =
    input.accept ?? Object.keys(response?.content ?? {})[0] ?? '*/*';
  if (/[\r\n]/.test(accept))
    throw new Error('Response format cannot contain newlines');
  const headers: Record<string, string> = { ...serialized.headers };
  setRequestHeader(headers, 'Accept', accept);
  appendAdditionalParameters(
    input.additionalParameters ?? [],
    query,
    headers,
    input.body || isMultipartMediaType(input.contentType ?? '')
      ? (input.contentType ?? 'application/json')
      : undefined,
    new Set(
      operation.security
        .flatMap((alternative) => Object.keys(alternative))
        .flatMap((name) => {
          const scheme = schemes[name];
          if (scheme?.type === 'apiKey' && scheme.in === 'query')
            return [`query:${scheme.name ?? name}`];
          if (scheme?.type === 'apiKey' && scheme.in === 'header')
            return [`header:${(scheme.name ?? name).toLowerCase()}`];
          return scheme &&
            ['http', 'oauth2', 'openIdConnect'].includes(scheme.type)
            ? ['header:authorization']
            : [];
        }),
    ),
  );
  for (const [name, value] of Object.entries(serialized.paths))
    path = path.replaceAll(`{${name}}`, value);
  if (path.split('/').some((segment) => /^(?:\.|%2e){1,2}$/i.test(segment)))
    throw new Error('Path parameters cannot resolve to URL dot segments');
  let placeholder = -1;
  for (let index = 0; index < path.length; index++) {
    if (path[index] === '{' && placeholder < 0) placeholder = index;
    else if (path[index] === '}') {
      if (placeholder >= 0 && index > placeholder + 1)
        throw new Error('Unresolved path parameter');
      placeholder = -1;
    }
  }
  const url = new URL(base.href.replace(/\/$/, '') + path);
  if (operation.security.length) {
    const alternative =
      operation.security.find(
        (requirement) =>
          Object.keys(requirement).length > 0 &&
          Object.keys(requirement).every((name) =>
            Boolean(input.credentials?.[name]),
          ),
      ) ??
      operation.security.find(
        (requirement) => Object.keys(requirement).length === 0,
      );
    if (!alternative)
      throw new Error(
        'Provide credentials for one complete authentication alternative',
      );
    for (const name of Object.keys(alternative)) {
      const scheme = schemes[name];
      const credential = input.credentials?.[name];
      if (!scheme || !credential) continue;
      if (/[\r\n]/.test(credential))
        throw new Error('Credentials cannot contain newlines');
      if (scheme.type === 'apiKey' && scheme.in === 'query') {
        const key = scheme.name ?? name;
        for (let i = query.length - 1; i >= 0; i--)
          if (query[i]!.name === key) query.splice(i, 1);
        query.push({ name: key, value: encodeValue(credential) });
      } else if (scheme.type === 'apiKey' && scheme.in === 'header')
        setRequestHeader(headers, scheme.name ?? name, credential);
      else if (
        scheme.type === 'http' &&
        scheme.scheme?.toLowerCase() === 'basic'
      )
        setRequestHeader(
          headers,
          'Authorization',
          `Basic ${base64(credential)}`,
        );
      else if (
        scheme.type === 'oauth2' ||
        scheme.type === 'openIdConnect' ||
        (scheme.type === 'http' && scheme.scheme?.toLowerCase() === 'bearer')
      )
        setRequestHeader(headers, 'Authorization', `Bearer ${credential}`);
      else throw new Error(`Unsupported authentication method: ${name}`);
    }
  }
  let body = input.body;
  let multipart: MultipartPart[] | undefined;
  if (isMultipartMediaType(input.contentType ?? '')) {
    if (input.bodyFormat !== 'json')
      throw new Error(
        'Multipart bodies require logical JSON text values and separate selected files.',
      );
    if (input.contentType!.includes(';'))
      throw new Error(
        'Multipart boundaries are generated when sending; do not supply media-type parameters.',
      );
    const declared = operation.requestBody?.content ?? {};
    const matches = Object.entries(declared).filter(([type]) =>
      isMultipartMediaType(type),
    );
    const media =
      declared[input.contentType!] ??
      (matches.length === 1 ? matches[0]![1] : undefined);
    if (!media)
      throw new Error(
        'The selected multipart media type is not declared by the operation.',
      );
    multipart = createMultipartParts(
      body || '{}',
      input.files ?? {},
      media,
      input,
    );
    body = undefined;
    for (const key of Object.keys(headers))
      if (key.toLowerCase() === 'content-type') delete headers[key];
  } else if (
    input.partHeaders &&
    Object.values(input.partHeaders).some((headers) =>
      Object.values(headers).some(Boolean),
    )
  ) {
    throw new Error('Custom part headers require multipart/form-data.');
  } else if (
    input.files &&
    Object.values(input.files).some((files) => files.length)
  ) {
    throw new Error('Selected files require a multipart/form-data body.');
  }
  if (
    body &&
    !multipart &&
    input.bodyFormat === 'json' &&
    isFormMediaType(input.contentType ?? '')
  ) {
    const declared = operation.requestBody?.content ?? {};
    const matches = Object.entries(declared).filter(([type]) =>
      isFormMediaType(type),
    );
    const media =
      declared[input.contentType!] ??
      (matches.length === 1 ? matches[0]![1] : undefined);
    if (!media)
      throw new Error(
        'The selected form media type is not declared by the operation.',
      );
    body = encodeFormBody(body, media, input);
  } else if (
    !multipart &&
    input.bodyFormat === 'json' &&
    !isJsonMediaType(input.contentType ?? 'application/json')
  )
    throw new Error(
      'Logical JSON body input is supported only for JSON or form-urlencoded content.',
    );
  if (
    (body || multipart !== undefined) &&
    ['get', 'head'].includes(operation.method)
  )
    throw new Error('GET and HEAD requests cannot have a body in the browser');
  if (!body && !multipart?.length && operation.requestBody?.required)
    throw new Error('Request body is required');
  if (body) {
    const contentType = input.contentType ?? 'application/json';
    if (isJsonMediaType(contentType)) {
      try {
        JSON.parse(body);
      } catch {
        throw new Error('Request body must be valid JSON');
      }
    }
    if (contentType.toLowerCase().startsWith('multipart/'))
      throw new Error(
        'Only logical multipart/form-data uploads are supported; other multipart media need a custom client.',
      );
    setRequestHeader(headers, 'Content-Type', contentType);
  }
  url.search = query
    .map(({ name, value }) => `${encodeValue(name)}=${value}`)
    .join('&');
  return {
    url: url.href,
    method: operation.method.toUpperCase(),
    headers,
    ...(body ? { body } : {}),
    ...(multipart ? { multipart } : {}),
  };
}
export function redactRequest(
  request: PreparedRequest,
  credentials: Record<string, string>,
  bodyContext?: BodyRedaction,
): PreparedRequest {
  const sensitive = Object.values(credentials)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const scrub = (input: string): string => {
    let output = input;
    for (const secret of sensitive) {
      const encodedForm = new URLSearchParams({ value: secret })
        .toString()
        .slice(6);
      for (const representation of [
        secret,
        encodeURIComponent(secret),
        encodeValue(secret),
        JSON.stringify(secret).slice(1, -1),
        encodedForm,
        base64(secret),
      ])
        output = output.split(representation).join('YOUR_CREDENTIAL');
    }
    return output;
  };
  return {
    url: scrub(request.url),
    method: request.method,
    headers: Object.fromEntries(
      Object.entries(request.headers).map(([key, value]) => [
        key,
        scrub(value),
      ]),
    ),
    ...(request.multipart
      ? {
          multipart: redactMultipartParts(
            request.multipart,
            bodyContext,
            sensitive,
            scrub,
          ),
        }
      : {}),
    ...(request.body === undefined
      ? {}
      : {
          body: scrub(
            bodyContext
              ? redactJsonBody(request.body, bodyContext, sensitive)
              : request.body,
          ),
        }),
  };
}
/** Materialize an actual fetch body. Multipart boundaries are fresh per invocation, never preview metadata. */
export function toFetchRequest(request: PreparedRequest): {
  method: string;
  headers: Headers;
  body?: string | Blob;
} {
  const headers = new Headers(fetchHeaderEntries(request.headers));
  if (request.multipart) {
    if (request.body !== undefined)
      throw new Error(
        'A request cannot have both a literal and multipart body.',
      );
    const { body, contentType } = multipartBody(request.multipart);
    headers.set('Content-Type', contentType);
    return { method: request.method, headers, body };
  }
  return {
    method: request.method,
    headers,
    ...(request.body === undefined ? {} : { body: request.body }),
  };
}
export { generateSnippet } from './snippets.js';
export { canSerializeEmptyParameter } from './parameters.js';
export type { SnippetLanguage } from './snippets.js';
export {
  multipartHeaderFields,
  MULTIPART_HEADER_LIMITS,
} from './multipart-headers.js';
export type {
  MultipartHeaders,
  MultipartHeaderField,
} from './multipart-headers.js';
export {
  oauthUrl,
  resolveOAuthEndpoint,
  calculatePkceChallenge,
  createPkceTransaction,
  exchangePkceCode,
} from './oauth.js';
export type {
  OAuthClient,
  PkceTransaction,
  OAuthAccessToken,
} from './oauth.js';
export { redactJsonBody } from './redact-body.js';
export type { BodyRedaction } from './redact-body.js';
export { encodeFormBody, isFormMediaType } from './form.js';
export {
  createMultipartParts,
  isMultipartMediaType,
  MULTIPART_LIMITS,
} from './multipart.js';
export type {
  MultipartFile,
  MultipartFiles,
  MultipartPart,
} from './multipart.js';
export { generateMockResponse } from './mock.js';
export type { MockResponse, MockResponseOptions } from './mock.js';
