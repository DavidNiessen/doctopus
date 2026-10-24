import type {
  Diagnostic,
  SiteData,
  Theme,
  ApiDocument,
  Operation,
  CodeSample,
} from '@davidniessen/doctopus-contracts';
import { validatePluginSite } from './validation.js';
import { applyThemePatch } from './theme.js';
import type { ThemePatch } from './theme.js';
import type { SpecSource } from './sources.js';
import { applySnippetPlugins } from './snippets.js';
export type { SpecSource } from './sources.js';
export type { ThemePatch } from './theme.js';
export { validatePluginSite as validateSiteData } from './validation.js';
export type BuildPluginCapability =
  'transform' | 'theme' | 'source' | 'snippets';
export interface SnippetInput {
  api: Readonly<Omit<ApiDocument, 'operations'>>;
  operation: Omit<Operation, 'codeSamples'>;
}
export type SnippetSample = Omit<CodeSample, 'plugin'>;
export interface BuildPluginContext {
  signal: AbortSignal;
  diagnostic: (message: Diagnostic) => void;
}
export interface BuildPlugin {
  name: string;
  version: string;
  pluginApi: '1';
  inputs?: string[];
  capabilities?: readonly BuildPluginCapability[];
  generateSnippets?: (
    input: Readonly<SnippetInput>,
    context: BuildPluginContext,
  ) => Promise<SnippetSample[]> | SnippetSample[];
  loadSpec?: (
    source: Readonly<SpecSource>,
    context: BuildPluginContext,
  ) => Promise<string> | string;
  theme?: (
    theme: Readonly<Theme>,
    context: BuildPluginContext,
  ) => Promise<ThemePatch> | ThemePatch;
  transform?: (
    site: Readonly<SiteData>,
    context: BuildPluginContext,
  ) => Promise<SiteData> | SiteData;
}
export function definePlugin(plugin: BuildPlugin): BuildPlugin {
  if (
    !plugin ||
    typeof plugin !== 'object' ||
    !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(plugin.name) ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
      plugin.version,
    ) ||
    plugin.pluginApi !== '1' ||
    (plugin.transform !== undefined &&
      typeof plugin.transform !== 'function') ||
    (plugin.theme !== undefined &&
      (typeof plugin.theme !== 'function' ||
        !plugin.capabilities?.includes('theme'))) ||
    (plugin.loadSpec !== undefined &&
      (typeof plugin.loadSpec !== 'function' ||
        !plugin.capabilities?.includes('source'))) ||
    (plugin.generateSnippets !== undefined &&
      (typeof plugin.generateSnippets !== 'function' ||
        !plugin.capabilities?.includes('snippets'))) ||
    (plugin.inputs !== undefined &&
      (!Array.isArray(plugin.inputs) ||
        plugin.inputs.length > 128 ||
        plugin.inputs.some(
          (input) => typeof input !== 'string' || !input || input.length > 1024,
        ))) ||
    (plugin.capabilities !== undefined &&
      (!Array.isArray(plugin.capabilities) ||
        plugin.capabilities.length < 1 ||
        plugin.capabilities.length > 4 ||
        new Set(plugin.capabilities).size !== plugin.capabilities.length ||
        plugin.capabilities.some(
          (capability) =>
            capability !== 'transform' &&
            capability !== 'theme' &&
            capability !== 'source' &&
            capability !== 'snippets',
        ) ||
        (plugin.transform !== undefined &&
          !plugin.capabilities.includes('transform'))))
  )
    throw new Error('Invalid plugin name, version or pluginApi (supported: 1)');
  return Object.freeze(plugin);
}
export {
  runPluginFiles,
  checkPluginConformance,
  runSourcePluginFiles,
  checkSourcePluginConformance,
} from './runner.js';
export type {
  PluginExecution,
  SourcePluginExecution,
  PluginWorkerOptions,
} from './runner.js';
export async function applyPlugins(
  site: SiteData,
  plugins: BuildPlugin[],
  timeout = 10_000,
): Promise<SiteData> {
  const names = new Set<string>();
  let current = site;
  for (const candidate of plugins) {
    const plugin = definePlugin(candidate);
    if (names.has(plugin.name))
      throw new Error(`Duplicate plugin: ${plugin.name}`);
    names.add(plugin.name);
    if (!plugin.transform && !plugin.theme) continue;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const diagnostics: Diagnostic[] = [];
    try {
      current = await Promise.race([
        (async () => {
          const cloned = structuredClone(current);
          const context: BuildPluginContext = {
            signal: controller.signal,
            diagnostic: (message) => diagnostics.push(message),
          };
          if (plugin.theme)
            cloned.config.theme = applyThemePatch(
              cloned.config.theme,
              await plugin.theme(structuredClone(cloned.config.theme), context),
            );
          return plugin.transform ? plugin.transform(cloned, context) : cloned;
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error(`Plugin timed out: ${plugin.name}`));
          }, timeout);
        }),
      ]);
      if (
        current.schemaVersion !== 1 ||
        !Array.isArray(current.apis) ||
        !Array.isArray(current.guides)
      )
        throw new Error(`Invalid plugin output: ${plugin.name}`);
      current.diagnostics.push(...diagnostics);
      current = validatePluginSite(current);
    } finally {
      clearTimeout(timer);
    }
  }
  return applySnippetPlugins(current, plugins, timeout);
}
