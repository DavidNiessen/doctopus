import { confinedPath, readBoundedFile } from '@davidniessen/doctopus-spec';
import type {
  ProjectConfig,
  ReaderExtensionAsset,
} from '@davidniessen/doctopus-contracts';
import { digest } from './manifest.js';

/** Copy reviewed ESM bytes; source modules are never imported or evaluated by the builder. */
export async function loadReaderExtensions(
  root: string,
  config: ProjectConfig,
  trusted = false,
) {
  const declarations = config.readerExtensions ?? [];
  if (declarations.length && !trusted)
    throw new Error(
      'Reader extensions execute in visitors’ browsers. Review them and use --trust-plugins to opt in.',
    );
  if (
    declarations.reduce((sum, item) => sum + 1 + (item.files?.length ?? 0), 0) >
    64
  )
    throw new Error('Reader extensions exceed 64 declared files');
  const files = new Map<string, Uint8Array>(),
    extensions: ReaderExtensionAsset[] = [];
  let bytes = 0;
  for (const extension of declarations) {
    const paths = [extension.entry, ...(extension.files ?? [])];
    if (new Set(paths).size !== paths.length)
      throw new Error('Reader extension files must be distinct');
    const source = new Map<string, Buffer>();
    for (const path of paths.sort()) {
      const content = await readBoundedFile(
        await confinedPath(root, path),
        256 * 1024,
      );
      new TextDecoder('utf-8', { fatal: true }).decode(content);
      bytes += content.length;
      if (bytes > 2 * 1024 * 1024)
        throw new Error('Reader extension sources exceed 2 MiB');
      source.set(path, content);
    }
    const fingerprint = digest(
      JSON.stringify(
        [...source].map(([path, content]) => [path, digest(content)]),
      ),
    );
    const prefix = `reader-extensions/${extension.id}/${fingerprint}/`;
    for (const [path, content] of source) files.set(prefix + path, content);
    extensions.push({
      id: extension.id,
      digest: fingerprint,
      entry: prefix + extension.entry,
    });
  }
  return { files, extensions };
}
