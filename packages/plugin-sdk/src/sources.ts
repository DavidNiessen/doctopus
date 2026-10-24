import type { Diagnostic } from '@davidniessen/doctopus-contracts';
import { definePlugin } from './index.js';
import type { BuildPlugin, BuildPluginContext } from './index.js';

export interface SpecSource {
  id: string;
  path: string;
  version?: string;
  content: string;
  references?: string;
}

/** Bound source text before and after every hook, without interpreting OpenAPI here. */
export function validateSpecSources(value: unknown): SpecSource[] {
  if (!Array.isArray(value) || !value.length || value.length > 128)
    throw new Error('Source plugins require between 1 and 128 spec inputs');
  let bytes = 0;
  for (const source of value) {
    if (
      !source ||
      typeof source !== 'object' ||
      Array.isArray(source) ||
      Object.keys(source).some(
        (key) =>
          !['id', 'path', 'version', 'content', 'references'].includes(key),
      ) ||
      typeof source.id !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(source.id) ||
      source.id.length > 1024 ||
      typeof source.path !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(source.path) ||
      source.path.length > 1024 ||
      source.path.split('/').includes('..') ||
      (source.version !== undefined &&
        (typeof source.version !== 'string' ||
          !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(source.version) ||
          source.version.length > 1024)) ||
      (source.references !== undefined &&
        (typeof source.references !== 'string' ||
          source.references.length > 1024 ||
          !/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(source.references) ||
          source.references.split('/').includes('..'))) ||
      typeof source.content !== 'string' ||
      Buffer.byteLength(source.content) > 16 * 1024 * 1024
    )
      throw new Error('Invalid source plugin input or output');
    bytes += Buffer.byteLength(source.content);
    if (bytes > 64 * 1024 * 1024)
      throw new Error('Source plugin documents exceed 64 MiB total');
  }
  return value as SpecSource[];
}

export async function applySourcePlugins(
  sources: SpecSource[],
  plugins: BuildPlugin[],
  timeout = 10_000,
): Promise<{ sources: SpecSource[]; diagnostics: Diagnostic[] }> {
  let current = structuredClone(validateSpecSources(sources));
  const names = new Set<string>();
  const diagnostics: Diagnostic[] = [];
  for (const candidate of plugins) {
    const plugin = definePlugin(candidate);
    if (names.has(plugin.name))
      throw new Error(`Duplicate plugin: ${plugin.name}`);
    names.add(plugin.name);
    if (!plugin.loadSpec) continue;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      current = await Promise.race([
        (async () => {
          const context: BuildPluginContext = {
            signal: controller.signal,
            diagnostic: (message) => diagnostics.push(message),
          };
          const result: SpecSource[] = [];
          for (const source of current) {
            result.push({
              ...source,
              content: await plugin.loadSpec!(structuredClone(source), context),
            });
            // Reject oversized output before retaining more documents or invoking the next hook.
            validateSpecSources(result);
          }
          return result;
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error(`Plugin timed out: ${plugin.name}`));
          }, timeout);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  return { sources: current, diagnostics };
}
