import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  verifyArtifact,
  createArtifactPathFilter,
} from '@davidniessen/doctopus-compiler';
import type { SiteData } from '@davidniessen/doctopus-contracts';
export const headers: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self'; connect-src http: https:; base-uri 'none'; frame-ancestors 'none'",
  'Cache-Control': 'no-cache',
};
export async function prepare(directory: string, mountPath?: string) {
  const root = resolve(directory);
  const manifest = await verifyArtifact(root);
  if (!Object.hasOwn(manifest.files, 'site.json'))
    throw new Error('Publication configuration must be listed in the manifest');
  const site = JSON.parse(
    await readFile(join(root, 'site.json'), 'utf8'),
  ) as SiteData;
  const basePath = mountPath ?? site.config.basePath;
  if (basePath !== site.config.basePath)
    throw new Error('Adapter mount path must match the publication basePath');
  return {
    root,
    basePath,
    allowsPath: createArtifactPathFilter(manifest),
    hasNotFoundPage: Object.hasOwn(manifest.files, '404.html'),
  };
}
