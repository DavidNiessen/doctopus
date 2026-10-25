import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  directDocumentationConfig,
  encodeHtmlJson,
  escapeHtml,
} from '@davidniessen/doctopus-contracts';
import type { DirectDocumentationOptions } from '@davidniessen/doctopus-contracts';
export const integrationAssetsDirectory = fileURLToPath(
  new URL('./client/', import.meta.url),
);
export async function integrationAssets(): Promise<Record<string, string>> {
  return JSON.parse(
    await readFile(
      new URL('./client/direct-assets.json', import.meta.url),
      'utf8',
    ),
  ) as Record<string, string>;
}
export async function renderDirectDocumentation(
  options: DirectDocumentationOptions,
  basePath: string,
): Promise<string> {
  const config = directDocumentationConfig(options, basePath);
  const template = await readFile(
    new URL('./client/direct.html', import.meta.url),
    'utf8',
  );
  // A single replacement pass keeps placeholder-like user text literal.
  return template.replace(
    /__DOCTOPUS_(TITLE|BASE|CONFIG)__/g,
    (_, key: string) =>
      ({
        TITLE: escapeHtml(config.title ?? 'API Reference'),
        BASE: escapeHtml(basePath),
        CONFIG: encodeHtmlJson(config),
      })[key]!,
  );
}
