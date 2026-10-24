import {
  mkdir,
  writeFile,
  readFile,
  cp,
  rename,
  rm,
  open,
  realpath,
} from 'node:fs/promises';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import {
  compileProject,
  safeOutput,
  writeManifest,
  verifyArtifact,
  compileGuideUpdate,
  artifactIdentity,
  loadPublicAssets,
  loadReaderExtensions,
  digest,
  createArtifactPathFilter,
} from '@davidniessen/doctopus-compiler';
import {
  guideHref,
  operationHref,
  createPageData,
  createPageDataFactory,
  lifecycleRoutes,
  localePaths,
  localeRoute,
  pageContentLocale,
  pageMetadata,
} from '@davidniessen/doctopus-contracts';
import type {
  SiteData,
  ArtifactManifest,
} from '@davidniessen/doctopus-contracts';
import { renderDocument } from '@davidniessen/doctopus-reader/render';
import { searchAssets } from './search-assets.js';
import { operationIndexAssets } from './operation-index.js';
import { confinedPath, readTextFile } from '@davidniessen/doctopus-spec';
import { activateDirectory } from './activate.js';
export { vendorRemoteSpec } from './vendor-spec.js';
export type { VendorSpecOptions } from './vendor-spec.js';
export { importRemoteSpec } from './import-spec.js';
export type { ImportSpecOptions } from './import-spec.js';
export { buildIsolatedSite, inspectIsolatedSource } from './isolation.js';
export type {
  IsolatedBuildOptions,
  IsolatedBuildReceipt,
  IsolatedSourceInfo,
  IsolatedSourceOptions,
} from './isolation.js';
export interface BuildOptions {
  config?: string;
  output?: string;
  trustPlugins?: boolean;
  trustContent?: boolean;
}
export async function buildSite(
  root: string,
  options: BuildOptions = {},
): Promise<{ directory: string; site: SiteData; manifest: ArtifactManifest }> {
  const project = resolve(root);
  const site = await compileProject(
    project,
    options.config ?? 'docs.config.yaml',
    {
      trustPlugins: options.trustPlugins ?? false,
      trustContent: options.trustContent ?? false,
    },
  );
  const directory = await safeOutput(
    project,
    options.output ?? '.doctopus/site',
  );
  const stage = await safeOutput(project, `.doctopus/build-${randomUUID()}`);
  const previous = await safeOutput(
    project,
    `.doctopus/previous-${randomUUID()}`,
  );
  const lockPath = join(dirname(directory), '.build.lock');
  const lock = await open(lockPath, 'wx').catch(() => {
    throw new Error(
      'Another build is active. If a process crashed, inspect and remove .doctopus/.build.lock before retrying.',
    );
  });
  try {
    const assets = fileURLToPath(
      new URL(
        './client/assets',
        import.meta.resolve('@davidniessen/doctopus-reader/render'),
      ),
    );
    await cp(assets, join(stage, 'assets'), { recursive: true });
    const browser = await loadReaderExtensions(
      project,
      site.config,
      options.trustPlugins ?? false,
    );
    if (
      JSON.stringify(browser.extensions) !==
      JSON.stringify(site.readerExtensions ?? [])
    )
      throw new Error('Reader extension sources changed during build; retry');
    for (const [path, value] of browser.files) {
      const output = join(stage, path);
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, value);
    }
    for (const [path, value] of await loadPublicAssets(project, site.config)) {
      if (
        site.assetMetadata?.find((asset) => asset.path === path)?.hash !==
        digest(value)
      )
        throw new Error(
          `Public asset changed during build: ${path}. Retry the build.`,
        );
      const output = join(stage, 'media', path);
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, value);
    }
    for (const [file, value] of operationIndexAssets(site)) {
      await mkdir(dirname(join(stage, file)), { recursive: true });
      await writeFile(join(stage, file), value);
    }
    const pages = new Map<string, string>([
      ['/', site.guides[0]?.title ?? site.config.name],
    ]);
    for (const guide of site.guides) pages.set(guideHref(guide), guide.title);
    for (const api of site.apis)
      for (const operation of api.operations)
        pages.set(operationHref(api, operation), operation.summary);
    for (const route of lifecycleRoutes(site)) pages.set(route, 'Deprecations');
    if (pages.size * site.config.locales.length + 1 > 100_000)
      throw new Error('Locale-expanded pages exceed the artifact route limit');
    for (const [path, title] of [...pages])
      for (const localized of localePaths(site.config, path))
        pages.set(localized, title);
    const callbackRoute = '/oauth/callback/';
    if (
      Object.keys(site.config.redirects).some(
        (route) => route.replace(/\/$/, '') === callbackRoute.slice(0, -1),
      )
    )
      throw new Error('Redirect overwrites the reserved OAuth callback route');
    await mkdir(join(stage, 'oauth/callback'), { recursive: true });
    await writeFile(
      join(stage, 'oauth/callback/index.html'),
      `<!doctype html><html lang="${site.config.defaultLocale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; base-uri 'none'; form-action 'none'"><title>Complete authorization</title><link rel="stylesheet" href="${site.config.basePath}/assets/reader.css"></head><body><main id="main-content" class="oauth-callback"><h1>Complete authorization</h1><p id="oauth-result" role="status">Completing authorization…</p></main><script type="module" src="${site.config.basePath}/assets/oauth-callback.js"></script></body></html>`,
    );
    const pageData = createPageDataFactory(site);
    const pageEntries = [...pages];
    for (let cursor = 0; cursor < pageEntries.length; cursor += 4) {
      const results = await Promise.allSettled(
        pageEntries.slice(cursor, cursor + 4).map(async ([path, title]) => {
          const destination = join(stage, path, 'index.html');
          await mkdir(dirname(destination), { recursive: true });
          const page = pageData(path);
          await writeFile(
            destination,
            renderDocument(page, path, {
              title:
                page.contentLocale === site.config.defaultLocale
                  ? title
                  : pageMetadata(page, path).title,
            }),
          );
          await writeFile(
            join(dirname(destination), 'page-data.json'),
            JSON.stringify(page),
          );
        }),
      );
      // Finish every bounded write before propagating an error and cleaning staging.
      for (const result of results)
        if (result.status === 'rejected') throw result.reason;
    }
    await writeFile(
      join(stage, '404.html'),
      renderDocument(site, '/not-found/', {
        title: 'Page not found',
        status: 404,
      }),
    );
    await writeFile(join(stage, 'site.json'), JSON.stringify(site));
    for (const [file, value] of searchAssets(site)) {
      await mkdir(dirname(join(stage, file)), { recursive: true });
      await writeFile(join(stage, file), value);
    }
    for (const [from, to] of Object.entries(site.config.redirects)) {
      if (pages.has(from) || pages.has(`${from}/`))
        throw new Error(`Redirect overwrites an existing page: ${from}`);
      const target = to.endsWith('/') ? to : `${to}/`;
      if (!pages.has(target))
        throw new Error(`Redirect destination is not a page: ${to}`);
      const destination = join(stage, from, 'index.html');
      await mkdir(dirname(destination), { recursive: true });
      const href = site.config.basePath + target;
      await writeFile(
        destination,
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${href}"><title>Page moved</title></head><body><a href="${href}">Continue to the new page</a></body></html>`,
      );
    }
    const indexed = site.config.seo?.index !== false;
    const sitemap =
      site.config.siteUrl && indexed
        ? site.config.siteUrl + site.config.basePath + '/sitemap.xml'
        : undefined;
    if (sitemap) {
      const xmlEscape = (value: string) =>
        value.replace(
          /[&<>"']/g,
          (char) =>
            ({
              '&': '&amp;',
              '<': '&lt;',
              '>': '&gt;',
              '"': '&quot;',
              "'": '&apos;',
            })[char]!,
        );
      await writeFile(
        join(stage, 'sitemap.xml'),
        `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[
          ...pages.keys(),
        ]
          .filter(
            (path) =>
              localeRoute(site.config, path).locale ===
              pageContentLocale(site, path),
          )
          .map(
            (path) =>
              `<url><loc>${xmlEscape(site.config.siteUrl! + site.config.basePath + path)}</loc></url>`,
          )
          .join('')}</urlset>`,
      );
    }
    await writeFile(
      join(stage, 'robots.txt'),
      `User-agent: *\n${indexed ? 'Allow: /' : 'Disallow: /'}\n${sitemap ? `Sitemap: ${sitemap}\n` : ''}`,
    );
    const manifest = await writeManifest(stage, site, [
      ...pages.keys(),
      callbackRoute,
    ]);
    await verifyArtifact(stage);
    await activateDirectory(stage, directory, previous);
    return { directory, site, manifest };
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    // Preserve a remaining backup if restoring the prior publication failed.
    throw error;
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}
export type StaticDocsServer = FastifyInstance & {
  reloadPublication(): Promise<void>;
};
export async function createStaticServer(
  directory: string,
  basePath?: string,
): Promise<StaticDocsServer> {
  const root = resolve(directory);
  async function loadPublication() {
    const manifest = await verifyArtifact(root);
    if (
      !Object.hasOwn(manifest.files, 'site.json') ||
      !Object.hasOwn(manifest.files, 'index.html')
    )
      throw new Error('Publication must list its configuration and root page');
    const site = JSON.parse(
      await readFile(join(root, 'site.json'), 'utf8'),
    ) as SiteData;
    const prefix = site?.config?.basePath;
    if (
      typeof prefix !== 'string' ||
      !(
        prefix === '' ||
        (/^\/[a-zA-Z0-9][a-zA-Z0-9/_-]*$/.test(prefix) && !prefix.endsWith('/'))
      )
    )
      throw new Error('Invalid publication basePath');
    return {
      prefix,
      allowsPath: createArtifactPathFilter(manifest),
      hasNotFoundPage: Object.hasOwn(manifest.files, '404.html'),
    };
  }
  let publication: Awaited<ReturnType<typeof loadPublication>> | undefined =
    await loadPublication();
  const prefix = basePath ?? publication.prefix;
  if (prefix !== publication.prefix)
    throw new Error('Server mount path must match the publication basePath');
  let revision = 0;
  /** Reverify a replacement publication; a failed reload makes readiness unavailable. */
  async function reloadPublication() {
    const generation = ++revision;
    publication = undefined;
    const next = await loadPublication();
    if (next.prefix !== prefix)
      throw new Error(
        'Publication basePath changed; restart the documentation server',
      );
    if (generation === revision) publication = next;
  }
  const app = Fastify({ logger: false, bodyLimit: 1024 });
  app.addHook('onRequest', async (request, reply) => {
    if (!publication && request.routeOptions.url !== '/health/live')
      return reply.code(503).send({ status: 'unavailable' });
  });
  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    reply.header(
      'Content-Security-Policy',
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self'; connect-src http: https:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    );
  });
  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async () => ({ status: 'ready' }));
  await app.register(fastifyStatic, {
    root,
    prefix: `${prefix}/`,
    index: ['index.html'],
    dotfiles: 'deny',
    maxAge: 0,
    redirect: true,
    allowedPath: (pathname) => publication?.allowsPath(pathname) ?? false,
  });
  app.setNotFoundHandler(async (_request, reply) => {
    reply.code(404).type('text/html');
    return publication?.hasNotFoundPage
      ? await readFile(join(root, '404.html'), 'utf8').catch(() => 'Not found')
      : 'Not found';
  });
  return Object.assign(app, { reloadPublication }) as StaticDocsServer;
}

export async function stageArtifact(
  directory: string,
  store: string,
): Promise<string> {
  const manifest = await verifyArtifact(directory);
  if (!/^[a-f0-9]{64}$/.test(manifest.artifactDigest))
    throw new Error('Invalid artifact input digest');
  await mkdir(store, { recursive: true });
  const target = join(resolve(store), manifest.artifactDigest);
  try {
    const existing = await verifyArtifact(target);
    if (JSON.stringify(existing.files) !== JSON.stringify(manifest.files))
      throw new Error(
        'Artifact digest collision or inconsistent compiler output',
      );
    return manifest.artifactDigest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const stage = join(resolve(store), `.stage-${randomUUID()}`);
  await mkdir(stage);
  try {
    for (const file of [...Object.keys(manifest.files), 'manifest.json']) {
      const from = await confinedPath(directory, file);
      const destination = join(stage, file);
      await mkdir(dirname(destination), { recursive: true });
      await cp(from, destination);
    }
    await verifyArtifact(stage);
    try {
      await rename(stage, target);
    } catch (error) {
      if (
        !['ENOTEMPTY', 'EEXIST'].includes(
          (error as NodeJS.ErrnoException).code ?? '',
        )
      )
        throw error;
      const existing = await verifyArtifact(target);
      if (JSON.stringify(existing.files) !== JSON.stringify(manifest.files))
        throw new Error('Concurrent staging produced inconsistent output', {
          cause: error,
        });
    }
    return manifest.artifactDigest;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

/** Stateful preview builder; a full verified build establishes the reusable file hashes. */
export function createDevelopmentBuilder(
  root: string,
  options: BuildOptions = {},
) {
  const canonicalRoot = realpath(resolve(root));
  let state: Awaited<ReturnType<typeof buildSite>> | undefined;
  let queue: Promise<void> = Promise.resolve();
  async function execute(changes: string[]) {
    const project = await canonicalRoot;
    if (state) {
      try {
        const current = JSON.parse(
          await readTextFile(join(state.directory, 'manifest.json')),
        ) as ArtifactManifest;
        if (current.artifactDigest !== state.manifest.artifactDigest)
          state = undefined;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT')
          state = undefined;
        else throw error;
      }
    }
    const next = state
      ? await compileGuideUpdate(project, state.site, changes)
      : undefined;
    if (!state || !next) {
      state = await buildSite(project, options);
      return { ...state, mode: 'full' as const };
    }
    const prior = state;
    const changed = next.guides.filter(
      (guide) =>
        guide !==
        prior.site.guides.find((previous) => previous.source === guide.source),
    );
    const sourcePaths = new Set(changed.map((guide) => guideHref(guide)));
    if (changed.some((guide) => guide.source === next.guides[0]?.source))
      sourcePaths.add('/');
    const paths = new Set(
      [...sourcePaths].flatMap((path) => localePaths(next.config, path)),
    );
    const updates = new Map<string, string>();
    for (const path of paths) {
      const page = createPageData(next, path);
      const base = path === '/' ? '' : path.slice(1);
      updates.set(
        base + 'index.html',
        renderDocument(page, path, { title: pageMetadataTitle(next, path) }),
      );
      updates.set(base + 'page-data.json', JSON.stringify(page));
    }
    const serialized = JSON.stringify(next);
    updates.set('site.json', serialized);
    for (const [file, value] of searchAssets(next)) updates.set(file, value);
    const files = { ...prior.manifest.files };
    for (const [file, value] of updates) {
      if (!Object.hasOwn(files, file))
        throw new Error(`Incremental output changed its route set: ${file}`);
      const hash = digest(value);
      if (files[file] === hash) updates.delete(file);
      else files[file] = hash;
    }
    const manifest: ArtifactManifest = {
      ...prior.manifest,
      inputDigest: digest(serialized),
      files,
      artifactDigest: '',
    };
    manifest.artifactDigest = artifactIdentity(manifest);
    const lockPath = join(dirname(prior.directory), '.build.lock');
    const lock = await open(lockPath, 'wx');
    let temporary: string | undefined;
    try {
      temporary = await safeOutput(
        project,
        `.doctopus/preview-${randomUUID()}`,
      );
      for (const [file, value] of updates) {
        const staged = join(temporary, file);
        await mkdir(dirname(staged), { recursive: true });
        await writeFile(staged, value);
      }
      await writeFile(
        join(temporary, 'manifest.json'),
        JSON.stringify(manifest, null, 2),
      );
      // Files are replaced atomically; the manifest is committed last. Publishing
      // still runs the complete checksum verification, including unchanged files.
      for (const file of [...updates.keys(), 'manifest.json']) {
        const target = join(prior.directory, file);
        await safeOutput(project, relative(project, dirname(target)));
        await rename(join(temporary, file), target);
      }
      state = { directory: prior.directory, site: next, manifest };
      return { ...state, mode: 'incremental' as const };
    } catch (error) {
      state = undefined;
      throw error;
    } finally {
      await lock.close();
      await rm(lockPath, { force: true });
      if (temporary) await rm(temporary, { recursive: true, force: true });
    }
  }
  return {
    build(changes: string[] = []) {
      const result = queue.then(() => execute(changes));
      queue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}
function pageMetadataTitle(site: SiteData, inputPath: string): string {
  const path = localeRoute(site.config, inputPath).contentPath;
  return path === '/'
    ? (site.guides[0]?.title ?? site.config.name)
    : (site.guides.find((guide) => guideHref(guide) === path)?.title ??
        site.config.name);
}
