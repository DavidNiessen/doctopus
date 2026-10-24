import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import type { ArtifactManifest } from '@davidniessen/doctopus-contracts';
import { record } from '@davidniessen/doctopus-spec';
export const digest = (source: string | Buffer): string =>
  createHash('sha256').update(source).digest('hex');
/** Static membership for decoded local paths from an already verified manifest. */
export function createArtifactPathFilter(manifest: ArtifactManifest) {
  const files = new Set(Object.keys(manifest.files));
  return (pathname: string): boolean => {
    const path = pathname.startsWith('/') ? pathname.slice(1) : pathname;
    if (
      !/^[a-zA-Z0-9._/-]*$/.test(path) ||
      path
        .split('/')
        .some(
          (part, index, parts) =>
            part.startsWith('.') || (!part && index !== parts.length - 1),
        )
    )
      return false;
    return (
      files.has(path) ||
      files.has(path + (path && !path.endsWith('/') ? '/' : '') + 'index.html')
    );
  };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  const result = JSON.stringify(value);
  if (result === undefined) throw new Error('Invalid canonical manifest value');
  return result;
}
export function artifactIdentity(
  manifest: Omit<ArtifactManifest, 'artifactDigest'>,
): string {
  const identity = {
    schemaVersion: manifest.schemaVersion,
    compilerVersion: manifest.compilerVersion,
    inputDigest: manifest.inputDigest,
    files: manifest.files,
    routes: manifest.routes,
    diagnostics: manifest.diagnostics,
    plugins: manifest.plugins ?? [],
  };
  if (manifest.schemaVersion === 2) return digest(canonical(identity));
  return digest(
    JSON.stringify({
      schemaVersion: manifest.schemaVersion,
      compilerVersion: manifest.compilerVersion,
      inputDigest: manifest.inputDigest,
      files: Object.fromEntries(
        Object.entries(manifest.files).sort(([a], [b]) => a.localeCompare(b)),
      ),
      routes: manifest.routes,
      diagnostics: manifest.diagnostics,
      plugins: manifest.plugins ?? [],
    }),
  );
}
const hash = (value: unknown) =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const string = (value: unknown, limit: number) =>
  typeof value === 'string' && value.length > 0 && value.length <= limit;
const safePath = (value: string) =>
  value.length <= 4096 &&
  /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(value) &&
  value.split('/').every((part) => part.length > 0 && !part.startsWith('.'));
const only = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
/** Parse identity-bearing metadata before any path is trusted or cached. */
export function parseArtifactManifest(value: unknown): ArtifactManifest {
  const manifest = record(value),
    files = record(manifest.files);
  const keys = new Set([
    'schemaVersion',
    'compilerVersion',
    'inputDigest',
    'artifactDigest',
    'files',
    'routes',
    'diagnostics',
    'plugins',
  ]);
  if (
    Object.keys(manifest).some((key) => !keys.has(key)) ||
    (manifest.schemaVersion !== 1 && manifest.schemaVersion !== 2) ||
    !string(manifest.compilerVersion, 128) ||
    !hash(manifest.inputDigest) ||
    !hash(manifest.artifactDigest) ||
    !manifest.files ||
    typeof manifest.files !== 'object' ||
    Array.isArray(manifest.files) ||
    Object.keys(files).length > 200_000 ||
    Object.entries(files).some(
      ([path, value]) => !safePath(path) || !hash(value),
    ) ||
    !Array.isArray(manifest.routes) ||
    manifest.routes.length > 100_000 ||
    Array.from(manifest.routes).some(
      (route) =>
        typeof route !== 'string' ||
        (route !== '/' &&
          (!route.startsWith('/') ||
            !safePath(route.slice(1).replace(/\/$/, '')))),
    ) ||
    new Set(manifest.routes).size !== manifest.routes.length ||
    !Array.isArray(manifest.diagnostics) ||
    manifest.diagnostics.length > 10_000 ||
    Array.from(manifest.diagnostics).some((value) => {
      const item = record(value);
      return (
        !string(item.code, 200) ||
        typeof item.severity !== 'string' ||
        !['warning', 'error'].includes(item.severity) ||
        !string(item.message, 12_000) ||
        (manifest.schemaVersion === 2 &&
          !only(item, ['code', 'severity', 'message', 'source'])) ||
        (item.source !== undefined && !string(item.source, 4096))
      );
    }) ||
    !Array.isArray(manifest.plugins) ||
    manifest.plugins.length > 32 ||
    Array.from(manifest.plugins).some((value) => {
      const plugin = record(value);
      return (
        !string(plugin.name, 214) ||
        !string(plugin.version, 128) ||
        (manifest.schemaVersion === 2 &&
          !only(plugin, ['name', 'version', 'sourceDigest', 'inputs'])) ||
        (plugin.sourceDigest !== undefined && !hash(plugin.sourceDigest)) ||
        (plugin.inputs !== undefined &&
          (!Array.isArray(plugin.inputs) ||
            plugin.inputs.length > 129 ||
            Array.from(plugin.inputs).some((value) => {
              const item = record(value);
              return (
                !string(item.path, 4096) ||
                !hash(item.digest) ||
                (manifest.schemaVersion === 2 &&
                  !only(item, ['path', 'digest']))
              );
            })))
      );
    })
  )
    throw new Error('Invalid artifact manifest metadata');
  const result = manifest as unknown as ArtifactManifest;
  if (artifactIdentity(result) !== result.artifactDigest)
    throw new Error('Artifact manifest identity mismatch');
  return result;
}
/** Streaming verification bounds memory and rejects files that change size during the read. */
export async function digestFile(filename: string): Promise<string> {
  const file = await open(
    filename,
    constants.O_RDONLY |
      (constants.O_NONBLOCK ?? 0) |
      (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const info = await file.stat();
    if (!info.isFile())
      throw new Error('Artifact entries must be regular files');
    const hash = createHash('sha256');
    let bytes = 0;
    if (info.size <= 1024 * 1024) {
      const buffer = Buffer.allocUnsafe(info.size + 1);
      while (bytes < buffer.length) {
        const { bytesRead } = await file.read(
          buffer,
          bytes,
          buffer.length - bytes,
        );
        if (!bytesRead) break;
        bytes += bytesRead;
      }
      if (bytes !== info.size)
        throw new Error('Artifact file changed size during verification');
      return hash.update(buffer.subarray(0, bytes)).digest('hex');
    }
    for await (const chunk of file.createReadStream({
      autoClose: false,
      highWaterMark: 64 * 1024,
    })) {
      bytes += chunk.length;
      if (bytes > info.size)
        throw new Error('Artifact file grew during verification');
      hash.update(chunk);
    }
    if (bytes !== info.size)
      throw new Error('Artifact file changed size during verification');
    return hash.digest('hex');
  } finally {
    await file.close();
  }
}
