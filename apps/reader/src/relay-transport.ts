import { isRelayEndpoint } from '@davidniessen/doctopus-contracts';
import { toFetchRequest } from '@davidniessen/doctopus-explorer';
import type { PreparedRequest } from '@davidniessen/doctopus-explorer';

const REQUEST_LIMIT = 1024 * 1024;
const RESPONSE_LIMIT = 2 * 1024 * 1024;
const ENVELOPE_LIMIT = Math.ceil(RESPONSE_LIMIT / 3) * 4 + 64 * 1024;
const methods = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
]);
const responseHeaders = new Set([
  'content-type',
  'content-language',
  'cache-control',
  'etag',
  'last-modified',
  'retry-after',
  'www-authenticate',
  'x-request-id',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
]);
const relayMessages = {
  invalidResponse:
    'The documentation server returned an invalid or excessive relay response.',
  invalidEndpoint: 'The configured relay endpoint is invalid.',
  signIn: 'Sign in to the documentation server before using its relay.',
  denied:
    'The documentation server denied relay access or this request policy.',
  busy: 'The documentation server relay is busy or rate limited. No automatic retry was made.',
  failed:
    'The documentation server could not complete the relay request. No automatic retry was made.',
  method: 'This method is not supported by the documentation server relay.',
  bodyLimit: 'The request body exceeds the documentation server relay limit.',
  header: 'A target header is not allowed by the documentation server relay.',
} as const;
export type RelayErrorCode = keyof typeof relayMessages;
export class RelayError extends Error {
  constructor(readonly code: RelayErrorCode) {
    super(relayMessages[code]);
  }
}
export interface ReaderRelayPolicy {
  maxRequestBytes: number;
  maxResponseBytes: number;
  timeoutMs: number;
  requestHeaders: string[];
  destinations: { origin: string; pathPrefix: string; methods: string[] }[];
}
function invalid(): never {
  throw new RelayError('invalidResponse');
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const limit = (value: unknown, maximum: number): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value > 0 &&
  value <= maximum;
function endpoint(path: string) {
  if (!isRelayEndpoint(path)) throw new RelayError('invalidEndpoint');
  return path;
}
async function json(response: Response, maximum: number): Promise<unknown> {
  if (!response.ok) {
    await response.body?.cancel();
    throw new RelayError(
      response.status === 401
        ? 'signIn'
        : response.status === 403
          ? 'denied'
          : response.status === 429
            ? 'busy'
            : 'failed',
    );
  }
  if (Number(response.headers.get('content-length')) > maximum) {
    await response.body?.cancel();
    invalid();
  }
  const reader = response.body?.getReader();
  if (!reader) invalid();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '',
    size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maximum) invalid();
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (
      error instanceof RelayError ||
      (error instanceof Error && error.name === 'AbortError')
    )
      throw error;
    invalid();
  } finally {
    reader.releaseLock();
  }
}
function parsePolicy(value: unknown): ReaderRelayPolicy {
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    !limit(value.maxRequestBytes, REQUEST_LIMIT) ||
    !limit(value.maxResponseBytes, RESPONSE_LIMIT) ||
    !limit(value.timeoutMs, 30_000) ||
    !Array.isArray(value.requestHeaders) ||
    value.requestHeaders.length > 64 ||
    !value.requestHeaders.every(
      (name) =>
        typeof name === 'string' &&
        /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(name),
    ) ||
    !Array.isArray(value.destinations) ||
    value.destinations.length < 1 ||
    value.destinations.length > 16
  )
    invalid();
  const destinations = value.destinations.map((rule: unknown) => {
    if (
      !record(rule) ||
      typeof rule.origin !== 'string' ||
      rule.origin.length > 2048 ||
      typeof rule.pathPrefix !== 'string' ||
      !/^\/(?:[A-Za-z0-9._~-]+\/)*$/.test(rule.pathPrefix) ||
      !Array.isArray(rule.methods) ||
      !rule.methods.length ||
      rule.methods.length > 7 ||
      !rule.methods.every(
        (method) => typeof method === 'string' && methods.has(method),
      )
    )
      invalid();
    let origin: URL;
    try {
      origin = new URL(rule.origin);
    } catch {
      invalid();
    }
    if (
      !['http:', 'https:'].includes(origin.protocol) ||
      origin.origin !== rule.origin
    )
      invalid();
    return {
      origin: rule.origin,
      pathPrefix: rule.pathPrefix,
      methods: rule.methods as string[],
    };
  });
  return {
    maxRequestBytes: value.maxRequestBytes,
    maxResponseBytes: value.maxResponseBytes,
    timeoutMs: value.timeoutMs,
    requestHeaders: value.requestHeaders as string[],
    destinations,
  };
}
export async function loadRelayPolicy(
  path: string,
  signal: AbortSignal,
): Promise<ReaderRelayPolicy> {
  return parsePolicy(
    await json(
      await fetch(endpoint(path), {
        method: 'GET',
        credentials: 'same-origin',
        redirect: 'error',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
        headers: { Accept: 'application/json' },
      }),
      64 * 1024,
    ),
  );
}
function encode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export async function sendViaRelay(
  path: string,
  policy: ReaderRelayPolicy,
  request: PreparedRequest,
  signal: AbortSignal,
): Promise<Response> {
  endpoint(path);
  signal.throwIfAborted();
  const prepared = toFetchRequest(request);
  if (!methods.has(prepared.method)) throw new RelayError('method');
  const blob =
    prepared.body instanceof Blob
      ? prepared.body
      : prepared.body !== undefined
        ? new Blob([prepared.body])
        : undefined;
  if (blob && blob.size > policy.maxRequestBytes)
    throw new RelayError('bodyLimit');
  const allowed = new Set(
    policy.requestHeaders.map((name) => name.toLowerCase()),
  );
  const headers = [...prepared.headers];
  if (headers.some(([name]) => !allowed.has(name)))
    throw new RelayError('header');
  const bodyBase64 = blob
    ? encode(new Uint8Array(await blob.arrayBuffer()))
    : undefined;
  signal.throwIfAborted();
  const value = await json(
    await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        url: request.url,
        method: prepared.method,
        headers,
        ...(bodyBase64 !== undefined ? { bodyBase64 } : {}),
      }),
    }),
    ENVELOPE_LIMIT,
  );
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    typeof value.status !== 'number' ||
    !Number.isInteger(value.status) ||
    value.status < 200 ||
    value.status > 599 ||
    !record(value.headers) ||
    Object.keys(value.headers).length > 11 ||
    typeof value.bodyBase64 !== 'string' ||
    value.bodyBase64.length > Math.ceil(policy.maxResponseBytes / 3) * 4 ||
    value.bodyBase64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value.bodyBase64)
  )
    invalid();
  const returned = new Headers();
  let headerSize = 0;
  for (const [name, valueHeader] of Object.entries(value.headers)) {
    headerSize +=
      name.length +
      (typeof valueHeader === 'string' ? valueHeader.length : 0) +
      4;
    if (
      !responseHeaders.has(name) ||
      typeof valueHeader !== 'string' ||
      headerSize > 16 * 1024 ||
      /[^\t\x20-\x7e\x80-\xff]/.test(valueHeader)
    )
      invalid();
    returned.set(name, valueHeader);
  }
  let binary: string;
  try {
    binary = atob(value.bodyBase64);
  } catch {
    invalid();
  }
  if (
    binary.length > policy.maxResponseBytes ||
    btoa(binary) !== value.bodyBase64
  )
    invalid();
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  if ([301, 302, 303, 305, 307, 308].includes(value.status)) invalid();
  const empty =
    prepared.method === 'HEAD' || [204, 205, 304].includes(value.status);
  if (empty && bytes.length) invalid();
  return new Response(empty ? null : bytes, {
    status: value.status,
    headers: returned,
  });
}
