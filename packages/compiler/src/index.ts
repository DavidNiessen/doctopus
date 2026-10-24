import { mkdir, writeFile, readdir, realpath, lstat } from 'node:fs/promises';
import { join, resolve, relative, sep } from 'node:path';
import {
  digest,
  artifactIdentity,
  parseArtifactManifest,
  digestFile,
} from './manifest.js';
export {
  digest,
  artifactIdentity,
  parseArtifactManifest,
  createArtifactPathFilter,
} from './manifest.js';
import {
  loadSpec,
  parseConfig,
  parseSource,
  confinedPath,
  readTextFile,
  readBoundedFile,
} from '@davidniessen/doctopus-spec';
import { loadGuides, renderMarkdown } from '@davidniessen/doctopus-content';
import {
  runPluginFiles,
  runSourcePluginFiles,
} from '@davidniessen/doctopus-plugin-sdk';
import type {
  SpecSource,
  SourcePluginExecution,
} from '@davidniessen/doctopus-plugin-sdk';
import { loadReaderExtensions } from './reader-extensions.js';
export { loadReaderExtensions } from './reader-extensions.js';
import { loadPublicAssets } from './assets.js';
export { loadPublicAssets } from './assets.js';
export { auditDocumentation } from './doctor.js';
import type {
  SiteData,
  ArtifactManifest,
} from '@davidniessen/doctopus-contracts';
import { loadTranslatedGuides } from './translated-guides.js';
import { validateGuideTranslations } from '@davidniessen/doctopus-contracts';
import { toolVersion } from '@davidniessen/doctopus-contracts';

export async function compileProject(
  root: string,
  configFile = 'docs.config.yaml',
  options: {
    trustPlugins?: boolean;
    trustContent?: boolean;
    skipPlugins?: boolean;
    /** Tooling override; still requires explicit trust and project-local entry files. */
    pluginFiles?: string[];
  } = {},
): Promise<SiteData> {
  root = await realpath(root);
  const file = await confinedPath(root, configFile);
  let config = parseConfig(
    parseSource(await readTextFile(file, 1024 * 1024), configFile),
  );
  if (options.pluginFiles !== undefined)
    config = parseConfig({ ...config, plugins: options.pluginFiles });
  const pluginsEnabled = config.plugins.length > 0 && !options.skipPlugins;
  if (pluginsEnabled && !options.trustPlugins)
    throw new Error(
      'Project requests executable build plugins. Review them and use --trust-plugins to opt in.',
    );
  let sourceExecution: SourcePluginExecution | undefined;
  const sources: SpecSource[] = [];
  const sourceFiles: string[] = [];
  if (pluginsEnabled) {
    let bytes = 0;
    if (config.specs.length > 128)
      throw new Error('Source plugins support at most 128 specs');
    for (const spec of config.specs) {
      const filename = await confinedPath(root, spec.path);
      const content = await readTextFile(filename);
      bytes += Buffer.byteLength(content);
      if (bytes > 64 * 1024 * 1024)
        throw new Error('Source plugin documents exceed 64 MiB total');
      sources.push({ ...spec, content });
      sourceFiles.push(filename);
    }
    sourceExecution = await runSourcePluginFiles(root, config.plugins, sources);
  }
  const apis = [];
  for (const [i, spec] of config.specs.entries())
    apis.push(
      await loadSpec(
        root,
        spec,
        sourceExecution ? { source: sourceExecution.sources[i]!.content } : {},
      ),
    );
  for (const api of apis)
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(api.version))
      throw new Error(
        `API version must be URL-safe: ${api.version}. Set specs[].version explicitly.`,
      );
  const identities = apis.map((api) => `${api.id}:${api.version}`);
  if (new Set(identities).size !== identities.length)
    throw new Error('Duplicate API id/version after spec loading');
  const assets = await loadPublicAssets(root, config);
  const guideBudget = { entries: 0, bytes: 0, guides: 0 };
  let site: SiteData = {
    assetMetadata: [...assets].map(([path, value]) => ({
      path,
      hash: digest(value),
    })),
    schemaVersion: 1,
    config,
    apis,
    guides: await loadGuides(root, config.guides, {
      trustContent: options.trustContent ?? false,
      basePath: config.basePath,
      budget: guideBudget,
    }),
    diagnostics: [
      ...(sourceExecution?.diagnostics ?? []),
      ...apis.flatMap((api) => api.diagnostics),
    ],
  };
  await loadTranslatedGuides(
    root,
    site,
    options.trustContent ?? false,
    guideBudget,
  );
  if (pluginsEnabled) {
    const execution = await runPluginFiles(root, config.plugins, site);
    if (
      JSON.stringify(execution.plugins) !==
      JSON.stringify(sourceExecution!.plugins)
    )
      throw new Error(
        'Plugin declared inputs changed between source and graph stages',
      );
    for (const [i, filename] of sourceFiles.entries())
      if (
        (await confinedPath(root, config.specs[i]!.path)) !== filename ||
        (await readTextFile(filename)) !== sources[i]!.content
      )
        throw new Error('Spec input changed during plugin execution');
    site = execution.site;
    try {
      site.config = parseConfig(site.config);
    } catch {
      throw new Error(
        'Invalid plugin project configuration. Review the configuration contract.',
      );
    }
    validateGuideTranslations(site);
    for (const guide of [
      ...site.guides,
      ...Object.values(site.guideTranslations ?? {}).flat(),
    ]) {
      const safe = await renderMarkdown(guide.html, true);
      guide.html = safe.html;
      guide.text = safe.text;
      guide.headings = safe.headings;
      guide.links = safe.links;
      guide.anchors = safe.anchors;
    }
    site.pluginVersions = execution.plugins;
  }
  if (!options.skipPlugins) {
    const browser = await loadReaderExtensions(
      root,
      site.config,
      options.trustPlugins ?? false,
    );
    if (browser.extensions.length) site.readerExtensions = browser.extensions;
    else delete site.readerExtensions;
  } else delete site.readerExtensions;
  return site;
}

/** Full source → validation → theme/graph conformance using only the selected reviewed plugins. */
export async function checkProjectPluginConformance(
  root: string,
  paths: string[],
  configFile = 'docs.config.yaml',
  options: { trustContent?: boolean } = {},
): Promise<SiteData> {
  if (!paths.length)
    throw new Error('Select at least one plugin for conformance');
  const settings = { ...options, trustPlugins: true, pluginFiles: paths };
  const first = await compileProject(root, configFile, settings);
  const second = await compileProject(root, configFile, settings);
  if (JSON.stringify(first) !== JSON.stringify(second))
    throw new Error(
      'Plugin conformance failed: output or metadata differs between fresh executions',
    );
  return first;
}
/** Reuse the API graph only when a plain Markdown body changes without affecting shared navigation. */
export async function compileGuideUpdate(
  root: string,
  site: SiteData,
  changes: string[],
): Promise<SiteData | undefined> {
  if (
    !changes.length ||
    Object.keys(site.config.i18n?.guides ?? {}).length > 0 ||
    !!site.guideTranslations ||
    site.config.plugins.length ||
    site.guides.some(
      (guide) =>
        guide.source.endsWith('.mdx') || guide.sourceBytes === undefined,
    )
  )
    return undefined;
  root = await realpath(root);
  const known = new Set(
    site.guides.map((guide) => resolve(root, guide.source)),
  );
  const files = new Set<string>();
  for (const path of changes) {
    const candidate = resolve(root, path);
    if (!candidate.endsWith('.md') || !known.has(candidate)) return undefined;
    try {
      files.add(await confinedPath(root, candidate));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }
  const changed = await loadGuides(root, site.config.guides, {
    only: files,
    basePath: site.config.basePath,
  });
  if (changed.length !== files.size) return undefined;
  const navigation = (guide: SiteData['guides'][number]) =>
    JSON.stringify([
      guide.source,
      guide.slug,
      guide.title,
      guide.description,
      guide.group,
      guide.order,
    ]);
  const replacements = new Map(changed.map((guide) => [guide.source, guide]));
  for (const guide of site.guides) {
    const next = replacements.get(guide.source);
    if (next && navigation(next) !== navigation(guide)) return undefined;
  }
  const guides = site.guides.map(
    (guide) => replacements.get(guide.source) ?? guide,
  );
  if (
    guides.reduce((total, guide) => total + (guide.sourceBytes ?? 0), 0) >
    64 * 1024 * 1024
  )
    throw new Error('Guide sources exceed 64 MiB total');
  return { ...site, guides };
}
export async function writeManifest(
  directory: string,
  site: SiteData,
  routes: string[],
): Promise<ArtifactManifest> {
  const files: Record<string, string> = {};
  const walk = async (path: string): Promise<void> => {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort(
      (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    )) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (!entry.isFile())
        throw new Error(
          'Artifact output cannot contain symlinks or special files',
        );
      else if (entry.name !== 'manifest.json')
        files[relative(directory, file).split(sep).join('/')] =
          await digestFile(file);
    }
  };
  await walk(directory);
  const details: Omit<ArtifactManifest, 'artifactDigest'> = {
    schemaVersion: 2,
    compilerVersion: toolVersion,
    inputDigest: digest(JSON.stringify(site)),
    files,
    routes,
    diagnostics: site.diagnostics,
    plugins: site.pluginVersions ?? [],
  };
  const manifest: ArtifactManifest = {
    ...details,
    artifactDigest: artifactIdentity(details),
  };
  parseArtifactManifest(manifest);
  await writeFile(
    join(directory, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  );
  return manifest;
}
export async function verifyArtifact(
  directory: string,
): Promise<ArtifactManifest> {
  const manifest = parseArtifactManifest(
    JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        await readBoundedFile(await confinedPath(directory, 'manifest.json')),
      ),
    ),
  );
  for (const [path, hash] of Object.entries(manifest.files)) {
    const file = await confinedPath(directory, path);
    if ((await digestFile(file)) !== hash)
      throw new Error(`Artifact checksum mismatch: ${path}`);
  }
  return manifest;
}
export async function safeOutput(
  root: string,
  output: string,
): Promise<string> {
  const base = await realpath(root);
  const target = resolve(base, output);
  const local = relative(base, target);
  if (!local.startsWith('.doctopus' + sep) || local.split(sep).includes('..'))
    throw new Error(
      'Build output must be inside the project .doctopus directory to protect source files',
    );
  let current = base;
  for (const part of local.split(sep)) {
    current = join(current, part);
    try {
      await mkdir(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory())
      throw new Error(
        'Build output cannot contain symlinks or non-directory components',
      );
  }
  await confinedPath(base, target);
  return target;
}
