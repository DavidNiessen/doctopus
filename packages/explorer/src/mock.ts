import {
  exampleChoices,
  formatExample,
  isJsonMediaType,
} from '@davidniessen/doctopus-contracts';
import type { Operation, Schema } from '@davidniessen/doctopus-contracts';
import { mockSchemaValue } from './mock-schema.js';

export interface MockResponse {
  kind: 'mock';
  status: number;
  documentedStatus: string;
  contentType: string;
  headers: Record<string, string>;
  body: string;
  source: 'example' | 'schema' | 'empty';
}
export interface MockResponseOptions {
  response?: string;
  contentType?: string;
  exampleId?: string;
  seed?: string;
  schemas?: Record<string, Schema>;
  openapiVersion?: string | undefined;
}
/** Pure local preview. Never accepts request inputs, credentials, transports or external example URLs. */
export function generateMockResponse(
  operation: Operation,
  options: MockResponseOptions = {},
): MockResponse {
  const seed = options.seed ?? 'example';
  if (typeof seed !== 'string' || seed.length > 128)
    throw new Error('Mock seeds must be strings of at most 128 characters.');
  const response =
    options.response === undefined
      ? (operation.responses.find((response) =>
          /^2(?:\d\d|XX)$/.test(response.status),
        ) ?? operation.responses[0])
      : operation.responses.find(
          (response) => response.status === options.response,
        );
  if (!response) throw new Error('Select a documented mock response.');
  const status =
    response.status === 'default'
      ? 200
      : /^[1-5]XX$/.test(response.status)
        ? Number(response.status[0]) * 100
        : Number(response.status);
  if (!Number.isInteger(status) || status < 100 || status > 599)
    throw new Error('Invalid documented mock response status.');
  const types = Object.keys(response.content);
  const contentType =
    options.contentType ??
    types.find(isJsonMediaType) ??
    types[0] ??
    'text/plain';
  const media = response.content[contentType];
  if (options.contentType !== undefined && !media)
    throw new Error('Select a documented mock media type.');
  const result: MockResponse = {
    kind: 'mock',
    status,
    documentedStatus: response.status,
    contentType,
    headers: media ? { 'content-type': contentType } : {},
    body: '',
    source: 'empty',
  };
  if (
    operation.method === 'head' ||
    status < 200 ||
    status === 204 ||
    status === 304 ||
    !media
  )
    return result;
  // Do not invoke the ordinary unseeded schema-example fallback before our bounded generator.
  const choices = exampleChoices(
    { ...media, schema: {} },
    options.schemas,
  ).filter((choice) => choice.id !== 'generated');
  const example =
    options.exampleId === 'generated'
      ? undefined
      : options.exampleId === undefined
        ? choices.find((choice) => choice.id !== 'generated')
        : choices.find((choice) => choice.id === options.exampleId);
  if (options.exampleId && options.exampleId !== 'generated' && !example)
    throw new Error('Select a declared inline mock example.');
  const value = example
    ? example.value
    : mockSchemaValue(
        media.schema,
        options.schemas ?? {},
        seed,
        options.openapiVersion?.startsWith('3.0') ?? false,
      );
  const queue: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  let bytes = 0;
  for (let index = 0; index < queue.length; index++) {
    if (index >= 10000 || queue[index]!.depth > 32)
      throw new Error('Mock example exceeds its node/depth budget.');
    const { value: node, depth } = queue[index]!;
    if (typeof node === 'string')
      bytes += new TextEncoder().encode(node).length;
    else if (
      typeof node === 'number' &&
      (!Number.isFinite(node) ||
        (Number.isInteger(node) && !Number.isSafeInteger(node)))
    )
      throw new Error(
        'Mock numbers must be finite and preserve safe integer precision.',
      );
    else if (node !== null && typeof node === 'object') {
      const entries = Object.entries(node);
      if (queue.length + entries.length > 10000)
        throw new Error('Mock example exceeds its node budget.');
      for (const [key, child] of entries) {
        bytes += key.length;
        queue.push({ value: child, depth: depth + 1 });
      }
    } else if (
      node !== null &&
      !['boolean', 'number', 'string'].includes(typeof node)
    )
      throw new Error('Mock examples must contain JSON-compatible values.');
    if (bytes > 2 * 1024 * 1024)
      throw new Error('Mock response exceeds the 2 MiB preview limit.');
  }
  if (
    !isJsonMediaType(contentType) &&
    typeof value === 'object' &&
    value !== null
  )
    throw new Error(
      'Synthetic structured responses require JSON; supply a serialized example for another media type.',
    );
  const body = formatExample(value, contentType);
  if (new TextEncoder().encode(body).length > 2 * 1024 * 1024)
    throw new Error('Mock response exceeds the 2 MiB preview limit.');
  return { ...result, body, source: example ? 'example' : 'schema' };
}
