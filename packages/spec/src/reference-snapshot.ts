import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { basename, dirname, join } from 'node:path';
import { readdir, lstat } from 'node:fs/promises';
import { requestAllowedOrigin, abortableOutbound } from './outbound.js';
import { importDestination } from './remote-policy.js';
import { confinedPath, readTextFile, readBoundedFile } from './source.js';
import { toolVersion } from '@davidniessen/doctopus-contracts';
import {
  parseReferencePolicy,
  parseReferenceManifest,
  referenceDigest,
  REFERENCE_BYTES,
  REFERENCE_TIMEOUT,
  canonicalReferenceUrl,
} from './reference-manifest.js';
import type {
  ReferencePolicy,
  ReferenceManifest,
} from './reference-manifest.js';
export {
  parseReferencePolicy,
  parseReferenceManifest,
  referenceDigest,
} from './reference-manifest.js';
export type {
  ReferencePolicy,
  ReferenceManifest,
  ReferenceDocument,
} from './reference-manifest.js';
export interface ReferenceSnapshotOptions {
  allowedOrigins: readonly string[];
  allowHttp?: boolean;
  allowPrivateNetwork?: boolean;
  credentials?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
  maxBytes?: number;
  timeoutMs?: number;
}
export interface ReferenceSnapshot {
  manifest: ReferenceManifest;
  sources: { path: string; source: Buffer }[];
}
const hash = (source: Buffer) =>
  createHash('sha256').update(source).digest('hex');
async function validate(
  root: string,
  sources: { url: string; source: Buffer }[],
  signal: AbortSignal,
) {
  if (signal.aborted)
    throw new Error('Reference snapshot cancelled or timed out');
  const worker = new Worker(
    new URL('./reference-validation-worker.js', import.meta.url),
    {
      workerData: { root, sources },
      resourceLimits: { maxOldGenerationSizeMb: 256, stackSizeMb: 4 },
    },
  );
  try {
    await abortableOutbound(
      new Promise<void>((resolve, reject) => {
        worker.once('message', (message: { valid?: boolean }) =>
          message.valid === true
            ? resolve()
            : reject(
                new Error(
                  'Pinned reference validation failed. Require approved JSON Pointer references without URI rebasing or dynamic keywords.',
                ),
              ),
        );
        worker.once('error', () =>
          reject(
            new Error('Pinned reference validation exceeded worker resources'),
          ),
        );
        worker.once('exit', () =>
          reject(
            new Error('Pinned reference validation stopped without a result'),
          ),
        );
      }),
      signal,
    );
  } finally {
    await worker.terminate();
  }
}
/** Explicit network operation; all exact sources are approved and pinned before any request. */
export async function downloadReferenceSnapshot(
  input: ReferencePolicy,
  options: ReferenceSnapshotOptions,
): Promise<ReferenceSnapshot> {
  const policy = parseReferencePolicy(input),
    maxBytes = options.maxBytes ?? REFERENCE_BYTES,
    timeout = options.timeoutMs ?? REFERENCE_TIMEOUT;
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > REFERENCE_BYTES ||
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > REFERENCE_TIMEOUT
  )
    throw new Error('Reference snapshot limits exceed 16 MiB or 30 seconds');
  const ordered = [
    policy.sources.find((source) => source.url === policy.root)!,
    ...policy.sources
      .filter((source) => source.url !== policy.root)
      .sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0)),
  ];
  for (const source of ordered)
    importDestination(
      source.url,
      options.allowedOrigins,
      options.allowHttp === true,
    );
  const credentials = new Map<string, string>();
  for (const [url, token] of Object.entries(options.credentials ?? {})) {
    const key = canonicalReferenceUrl(url);
    if (
      !ordered.some((source) => source.url === key) ||
      credentials.has(key) ||
      typeof token !== 'string' ||
      !token.trim() ||
      token.length > 8192 ||
      /[\r\n]/.test(token)
    )
      throw new Error('Invalid exact-source bearer credential binding');
    credentials.set(key, token);
  }
  const signal = AbortSignal.any([
    AbortSignal.timeout(timeout),
    ...(options.signal ? [options.signal] : []),
  ]);
  const downloaded: { url: string; source: Buffer }[] = [];
  let total = 0;
  for (const source of ordered) {
    if (total >= maxBytes)
      throw new Error('Reference snapshot exceeds its shared byte budget');
    const token = credentials.get(source.url);
    const response = await requestAllowedOrigin(source.url, {
      allowedOrigins: options.allowedOrigins,
      allowHttp: options.allowHttp === true,
      allowPrivateNetwork: options.allowPrivateNetwork === true,
      maxBytes: maxBytes - total,
      timeoutMs: timeout,
      signal,
      expectedStatus: 200,
      headers: {
        accept: 'application/json, application/yaml, text/yaml, text/plain',
        'user-agent': 'doctopus/' + toolVersion,
        ...(token ? { authorization: 'Bearer ' + token } : {}),
      },
    });
    if (hash(response.body) !== source.sha256)
      throw new Error('Pinned reference source SHA-256 mismatch');
    total += response.body.length;
    downloaded.push({ url: source.url, source: response.body });
  }
  await validate(policy.root, downloaded, signal);
  const documents = downloaded.map((item, index) => ({
    url: item.url,
    path: `source-${index}.yaml`,
    sha256: hash(item.source),
    bytes: item.source.length,
  }));
  const manifest: ReferenceManifest = {
    schemaVersion: 1,
    root: policy.root,
    documents,
    digest: referenceDigest({ root: policy.root, documents }),
  };
  return {
    manifest,
    sources: downloaded.map((item, index) => ({
      path: documents[index]!.path,
      source: item.source,
    })),
  };
}
/** Offline hash-verified cache. Every file remains inside the project; no network API is called. */
export async function loadReferenceSnapshot(project: string, path: string) {
  const file = await confinedPath(project, path);
  let raw: unknown;
  try {
    raw = JSON.parse(await readTextFile(file, 64 * 1024));
  } catch {
    throw new Error('Invalid reference snapshot manifest');
  }
  const manifest = parseReferenceManifest(raw);
  const directory = dirname(file);
  if (basename(directory) !== manifest.digest)
    throw new Error('Reference snapshot directory must match its digest');
  const expected = new Set([
    'snapshot.json',
    ...manifest.documents.map((item) => item.path),
  ]);
  const actual = await readdir(directory);
  if (
    actual.length !== expected.size ||
    actual.some((name) => !expected.has(name))
  )
    throw new Error('Reference snapshot contains missing or unexpected files');
  const sources = new Map<string, Buffer>();
  for (const document of manifest.documents) {
    const filename = join(directory, document.path),
      info = await lstat(filename);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error('Reference snapshot entries must be regular files');
    const source = await readBoundedFile(filename, Math.max(1, document.bytes));
    if (source.length !== document.bytes || hash(source) !== document.sha256)
      throw new Error('Reference snapshot source integrity failed');
    sources.set(document.url, source);
  }
  return { manifest, directory, sources };
}
