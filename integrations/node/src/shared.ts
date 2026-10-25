import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { directDocumentationConfig } from '@davidniessen/doctopus-contracts';
import {
  integrationAssets,
  integrationAssetsDirectory,
  renderDirectDocumentation,
} from '@davidniessen/doctopus-reader/integration';
import type { DirectDocumentationOptions } from '@davidniessen/doctopus-contracts';
import type { SiteData } from '@davidniessen/doctopus-contracts';
export const headers: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self'; connect-src http: https:; base-uri 'none'; frame-ancestors 'none'",
  'Cache-Control': 'no-cache',
};
export interface DocumentationOptions extends DirectDocumentationOptions {
  /** Optional verified publication. Omit it to load the OpenAPI URL directly. */
  directory?: string;
  mountPath?: string;
  /** External mount when a trusted reverse proxy adds a path prefix. */
  publicBasePath?: string;
}
export async function prepare(options: DocumentationOptions) {
  const { directory, mountPath } = options;
  if (directory === undefined) {
    const basePath = mountPath === '/' ? '' : (mountPath ?? '/docs');
    directDocumentationConfig(options, basePath);
    const publicPath =
      options.publicBasePath === '/'
        ? ''
        : (options.publicBasePath ?? basePath);
    const html = await renderDirectDocumentation(options, publicPath);
    const files = await integrationAssets();
    const entries = Object.entries(files);
    if (!entries.length || entries.length > 500)
      throw new Error('Invalid bundled reader assets.');
    await Promise.all(
      entries.map(async ([path, hash]) => {
        if (
          !/^assets\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(path) ||
          !/^[a-f0-9]{64}$/.test(hash)
        )
          throw new Error('Invalid bundled reader asset entry.');
        const actual = createHash('sha256')
          .update(await readFile(join(integrationAssetsDirectory, path)))
          .digest('hex');
        if (actual !== hash)
          throw new Error('Bundled reader asset integrity check failed.');
      }),
    );
    return {
      root: integrationAssetsDirectory,
      basePath,
      html: html as string | undefined,
      allowsPath: (path: string) =>
        Object.hasOwn(files, path.replace(/^\//, '')),
      hasNotFoundPage: false,
    };
  }
  if (
    [
      'url',
      'title',
      'description',
      'theme',
      'layout',
      'appearance',
      'logo',
      'logoDark',
      'favicon',
      'publicBasePath',
    ].some((key) => options[key as keyof DocumentationOptions] !== undefined)
  )
    throw new Error(
      'Choose a prebuilt directory or direct specification settings, not both.',
    );
  const { verifyArtifact, createArtifactPathFilter } =
    await import('@davidniessen/doctopus-compiler');
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
    html: undefined as string | undefined,
  };
}
