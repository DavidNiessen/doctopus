import { methods } from '@davidniessen/doctopus-contracts';
import type { ApiDocument, Operation } from '@davidniessen/doctopus-contracts';

export interface OperationCatalog {
  schemaVersion: 1;
  apiId: string;
  version: string;
  total: number;
  pageSize: 100;
  pages: number;
}
export interface OperationRow {
  slug: string;
  method: Operation['method'];
  path: string;
  summary: string;
  tag: string;
  deprecated: boolean;
  kind?: Operation['kind'];
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown, max: number) =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= max;
export function readOperationCatalog(
  value: unknown,
  api: Pick<ApiDocument, 'id' | 'version'>,
): OperationCatalog {
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    value.apiId !== api.id ||
    value.version !== api.version ||
    value.pageSize !== 100 ||
    !integer(value.total, 100000) ||
    value.pages !== Math.ceil((value.total as number) / 100)
  )
    throw new Error('Invalid endpoint catalog');
  return value as unknown as OperationCatalog;
}
export function readOperationRows(
  value: unknown,
  api: Pick<ApiDocument, 'id' | 'version'>,
  page: number,
  catalog: OperationCatalog,
): OperationRow[] {
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    value.apiId !== api.id ||
    value.version !== api.version ||
    value.page !== page ||
    !Array.isArray(value.operations) ||
    value.operations.length !== Math.min(100, catalog.total - page * 100)
  )
    throw new Error('Invalid endpoint page');
  const slugs = new Set();
  for (const row of value.operations) {
    if (
      !record(row) ||
      typeof row.slug !== 'string' ||
      !/^[a-z0-9-]{1,512}$/.test(row.slug) ||
      slugs.has(row.slug) ||
      !methods.includes(row.method as Operation['method']) ||
      typeof row.path !== 'string' ||
      row.path.length > 65536 ||
      typeof row.summary !== 'string' ||
      row.summary.length > 1024 ||
      typeof row.tag !== 'string' ||
      row.tag.length > 256 ||
      typeof row.deprecated !== 'boolean' ||
      (row.kind !== undefined &&
        !['endpoint', 'webhook', 'callback'].includes(row.kind as string))
    )
      throw new Error('Invalid endpoint row');
    slugs.add(row.slug);
  }
  return value.operations as unknown as OperationRow[];
}
export function readExpandedOperation(
  value: unknown,
  api: Pick<ApiDocument, 'id' | 'version'>,
  slug: string,
  basePath: string,
): { api: ApiDocument; operation: Operation } {
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    !record(value.config) ||
    value.config.basePath !== basePath ||
    !Array.isArray(value.apis)
  )
    throw new Error('Invalid endpoint details');
  const document = value.apis.find(
    (candidate) =>
      record(candidate) &&
      candidate.id === api.id &&
      candidate.version === api.version,
  );
  const operation =
    record(document) && Array.isArray(document.operations)
      ? document.operations.find(
          (candidate) => record(candidate) && candidate.slug === slug,
        )
      : undefined;
  if (
    !record(document) ||
    !record(document.schemas) ||
    !record(document.securitySchemes) ||
    !record(operation) ||
    typeof operation.source !== 'string' ||
    !operation.source ||
    typeof operation.summary !== 'string' ||
    typeof operation.description !== 'string' ||
    !Array.isArray(operation.parameters) ||
    !Array.isArray(operation.responses) ||
    !Array.isArray(operation.security) ||
    !Array.isArray(operation.servers)
  )
    throw new Error('Invalid endpoint details');
  return {
    api: document as unknown as ApiDocument,
    operation: operation as unknown as Operation,
  };
}
export async function referenceJson(
  url: string,
  signal: AbortSignal,
  limit: number,
): Promise<unknown> {
  const response = await fetch(url, {
    credentials: 'same-origin',
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
  });
  if (!response.ok || !response.body)
    throw new Error('Endpoint data unavailable');
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit)
        throw new Error('Endpoint data exceeds its byte budget');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(joined));
}
