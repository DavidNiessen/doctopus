import { RepositoryUnavailableError } from '@davidniessen/doctopus-domain';

const unavailableCodes = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'EAI_AGAIN',
  'ENOTFOUND',
  '53200',
  '53300',
  '57014',
  '57P01',
  '57P02',
  '57P03',
]);
// pg/pg-pool use these exact messages for failures without an error code.
const unavailableMessages = new Set([
  'Query read timeout',
  'timeout exceeded when trying to connect',
  'Connection terminated',
  'Connection terminated unexpectedly',
  'Connection terminated due to connection timeout',
]);

/** Preserve existing driver diagnostics/codes for SDK callers; HTTP adapters expose a generic response. */
export function databaseError(error: unknown): unknown {
  if (!(error instanceof Error) || error instanceof RepositoryUnavailableError)
    return error;
  const code = (error as Error & { code?: unknown }).code;
  if (
    (typeof code === 'string' &&
      (unavailableCodes.has(code) || /^08[0-9A-Z]{3}$/.test(code))) ||
    unavailableMessages.has(error.message)
  )
    return new RepositoryUnavailableError(error.message, {
      cause: error,
      ...(typeof code === 'string' ? { code } : {}),
    });
  return error;
}
