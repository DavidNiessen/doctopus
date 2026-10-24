import type { Diagnostic, SiteData } from '@davidniessen/doctopus-contracts';
import type { BuildPlugin, BuildPluginContext } from './index.js';
import { validatePluginSite, validateCodeSamples } from './validation.js';

function freezeSnapshot<T extends object>(value: T): Readonly<T> {
  const pending: object[] = [value];
  const visited = new Set<object>();
  while (pending.length) {
    const item = pending.pop()!;
    if (visited.has(item)) continue;
    visited.add(item);
    for (const child of Object.values(item))
      if (child !== null && typeof child === 'object') pending.push(child);
    Object.freeze(item);
  }
  return value;
}

/** Generate after all graph transforms, so examples use the final operation snapshots. */
export async function applySnippetPlugins(
  site: SiteData,
  plugins: BuildPlugin[],
  timeout: number,
): Promise<SiteData> {
  let current = site;
  for (const plugin of plugins) {
    if (!plugin.generateSnippets) continue;
    const cloned = structuredClone(current);
    const controller = new AbortController();
    const diagnostics: Diagnostic[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let totalBytes = cloned.apis.reduce(
      (total, api) =>
        total +
        api.operations.reduce(
          (sum, operation) =>
            sum +
            (operation.codeSamples ?? []).reduce(
              (bytes, sample) => bytes + Buffer.byteLength(sample.code),
              0,
            ),
          0,
        ),
      0,
    );
    try {
      current = await Promise.race([
        (async () => {
          const context: BuildPluginContext = {
            signal: controller.signal,
            diagnostic: (message) => diagnostics.push(message),
          };
          for (const api of cloned.apis) {
            const { operations, ...metadata } = api;
            // Share one immutable schema snapshot rather than copying it for every endpoint.
            const apiInput = freezeSnapshot(structuredClone(metadata));
            for (const operation of operations) {
              const { codeSamples: previous, ...input } = operation;
              const samples = await plugin.generateSnippets!(
                {
                  api: apiInput,
                  operation: structuredClone(input),
                },
                context,
              );
              if (
                !Array.isArray(samples) ||
                samples.length > 8 ||
                samples.some(
                  (sample) =>
                    !sample ||
                    typeof sample !== 'object' ||
                    Object.keys(sample).some(
                      (key) =>
                        !['id', 'label', 'language', 'code'].includes(key),
                    ),
                )
              )
                throw new Error('Invalid generated snippet samples');
              if (samples.length) {
                const added = validateCodeSamples(
                  samples.map((sample) => ({ ...sample, plugin: plugin.name })),
                );
                operation.codeSamples = validateCodeSamples([
                  ...(previous ?? []),
                  ...added,
                ]);
                totalBytes += added.reduce(
                  (bytes, sample) => bytes + Buffer.byteLength(sample.code),
                  0,
                );
                if (totalBytes > 16 * 1024 * 1024)
                  throw new Error('Generated code samples exceed 16 MiB total');
              }
            }
          }
          cloned.diagnostics.push(...diagnostics);
          return validatePluginSite(cloned);
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
  return current;
}
