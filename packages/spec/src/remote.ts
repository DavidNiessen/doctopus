import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { toolVersion } from '@davidniessen/doctopus-contracts';
import { importDestination } from './remote-policy.js';
import {
  requestAllowedOrigin,
  abortableOutbound as abortable,
} from './outbound.js';

export interface RemoteSpecOptions {
  allowedOrigins: readonly string[];
  allowHttp?: boolean;
  allowPrivateNetwork?: boolean;
  bearerToken?: string;
  expectedSha256?: string;
  maxBytes?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}
export interface RemoteSpecSnapshot {
  source: Buffer;
  sha256: string;
  origin: string;
}
async function validateSource(
  source: Buffer,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) throw new Error('Spec import cancelled or timed out');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(source);
  } catch {
    throw new Error('Imported spec must be valid UTF-8');
  }
  const worker = new Worker(
    new URL('./remote-validation-worker.js', import.meta.url),
    {
      workerData: text,
      resourceLimits: { maxOldGenerationSizeMb: 256, stackSizeMb: 4 },
    },
  );
  try {
    await abortable(
      new Promise<void>((resolve, reject) => {
        worker.once(
          'message',
          (message: { valid?: boolean; error?: string }) => {
            if (message.valid === true) resolve();
            else
              reject(
                new Error(message.error || 'Imported spec validation failed'),
              );
          },
        );
        worker.once('error', () =>
          reject(
            new Error('Imported spec validation exceeded worker resources'),
          ),
        );
        worker.once('exit', () =>
          reject(
            new Error('Imported spec validation stopped without a result'),
          ),
        );
      }),
      signal,
    );
  } finally {
    await worker.terminate();
  }
}

/** Explicit, bounded snapshot import. Builds never call this network operation. */
export async function downloadSpec(
  source: string,
  options: RemoteSpecOptions,
): Promise<RemoteSpecSnapshot> {
  const url = importDestination(
    source,
    options.allowedOrigins,
    options.allowHttp === true,
  );
  const maxBytes = options.maxBytes ?? 16 * 1024 * 1024;
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > 16 * 1024 * 1024 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 30_000
  )
    throw new Error(
      'Import limits must be positive integers up to 16 MiB and 30 seconds',
    );
  if (
    options.expectedSha256 !== undefined &&
    !/^[a-f0-9]{64}$/.test(options.expectedSha256)
  )
    throw new Error(
      'Expected source SHA-256 must be 64 lowercase hexadecimal characters',
    );
  if (
    options.bearerToken !== undefined &&
    (!options.bearerToken.trim() ||
      /[\r\n]/.test(options.bearerToken) ||
      options.bearerToken.length > 8192)
  )
    throw new Error('Invalid import bearer credential');
  const signal = AbortSignal.any([
    AbortSignal.timeout(timeoutMs),
    ...(options.signal ? [options.signal] : []),
  ]);
  if (signal.aborted) throw new Error('Spec import cancelled or timed out');
  const response = await requestAllowedOrigin(url.href, {
    allowedOrigins: options.allowedOrigins,
    allowHttp: options.allowHttp === true,
    allowPrivateNetwork: options.allowPrivateNetwork === true,
    maxBytes,
    timeoutMs,
    expectedStatus: 200,
    signal,
    headers: {
      accept: 'application/json, application/yaml, text/yaml, text/plain',
      'user-agent': 'doctopus/' + toolVersion,
      ...(options.bearerToken
        ? { authorization: 'Bearer ' + options.bearerToken }
        : {}),
    },
  });
  const bytes = response.body;
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (options.expectedSha256 !== undefined && options.expectedSha256 !== sha256)
    throw new Error('Imported source does not match the expected SHA-256');
  await validateSource(bytes, signal);
  return { source: bytes, sha256, origin: url.origin };
}
