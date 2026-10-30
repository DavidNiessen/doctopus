import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { App } from './components/App.js';
import {
  directDocumentationConfig,
  normalizePagePath,
  themePresets,
} from '@davidniessen/doctopus-contracts';
import type {
  ApiDocument,
  DirectDocumentationConfig,
  SiteData,
} from '@davidniessen/doctopus-contracts';

async function readSpec(url: string, signal: AbortSignal) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    signal,
  });
  if (!response.ok)
    throw new Error(
      'The specification URL did not return a successful response.',
    );
  if (Number(response.headers.get('content-length')) > 16 * 1024 * 1024)
    throw new Error('The specification exceeds 16 MiB.');
  if (!response.body) throw new Error('The specification response is empty.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let source = '',
    bytes = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > 16 * 1024 * 1024)
        throw new Error('The specification exceeds 16 MiB.');
      source += decoder.decode(result.value, { stream: true });
    }
    source += decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
  }
  return { source, url: response.url };
}
function normalize(
  source: string,
  url: string,
  signal: AbortSignal,
): Promise<ApiDocument> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('./direct-spec.worker.ts', import.meta.url),
      { type: 'module' },
    );
    const stop = () => {
      clearTimeout(timer);
      worker.terminate();
      signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      stop();
      reject(new Error('Specification loading was cancelled.'));
    };
    const timer = setTimeout(() => {
      stop();
      reject(new Error('Specification processing exceeded ten seconds.'));
    }, 10_000);
    worker.onmessage = (
      event: MessageEvent<{ api?: ApiDocument; error?: string }>,
    ) => {
      stop();
      if (event.data.api) resolve(event.data.api);
      else reject(new Error(event.data.error ?? 'Invalid OpenAPI document.'));
    };
    worker.onerror = () => {
      stop();
      reject(new Error('Specification processing is unavailable.'));
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    else worker.postMessage({ source, url });
  });
}
function siteFor(
  config: DirectDocumentationConfig,
  api: ApiDocument,
): SiteData {
  return {
    schemaVersion: 1,
    apis: [api],
    guides: [],
    diagnostics: api.diagnostics,
    config: {
      schemaVersion: 1,
      name: config.title ?? api.title,
      description: config.description ?? api.description,
      basePath: config.basePath,
      guides: 'guides',
      specs: [{ id: api.id, path: 'openapi.yaml', version: api.version }],
      theme: {
        preset: config.theme,
        accent: themePresets[config.theme],
        radius: 14,
        font: 'system',
        density: 'comfortable',
        codeTheme: 'dark',
      },
      links: [],
      redirects: {},
      locales: ['en'],
      defaultLocale: 'en',
      plugins: [],
      explorer: { mode: 'live' },
    },
  };
}
function DirectReference({ config }: { config: DirectDocumentationConfig }) {
  const [site, setSite] = useState<SiteData>();
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timer = setTimeout(() => controller.abort(), 30_000);
    const skeleton = setTimeout(() => setSlow(true), 250);
    setError('');
    setSlow(false);
    setSite(undefined);
    const sourceUrl = new URL(
      config.url,
      location.origin + config.basePath + '/',
    ).href;
    void readSpec(sourceUrl, controller.signal)
      .then(({ source, url }) => normalize(source, url, controller.signal))
      .then((api) => {
        if (active && !controller.signal.aborted) setSite(siteFor(config, api));
      })
      .catch(() => {
        if (active)
          setError(
            controller.signal.aborted
              ? 'Loading the API specification timed out. Try again.'
              : 'Check that the specification URL is reachable and returns a self-contained OpenAPI 3.0 or 3.1 document.',
          );
      })
      .finally(() => {
        clearTimeout(timer);
        clearTimeout(skeleton);
      });
    return () => {
      active = false;
      clearTimeout(timer);
      clearTimeout(skeleton);
      controller.abort();
    };
  }, [config, revision]);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    if (config.favicon)
      document
        .querySelector('link[rel="icon"]')
        ?.setAttribute('href', config.favicon);
    if (document.documentElement.dataset.theme) return;
    document.documentElement.dataset.theme =
      config.appearance === 'system'
        ? media.matches
          ? 'dark'
          : 'light'
        : config.appearance;
  }, [config]);
  if (site)
    return (
      <App
        site={site}
        initialPath={normalizePagePath(
          location.pathname.slice(config.basePath.length) === '/index.html'
            ? '/'
            : location.pathname.slice(config.basePath.length) || '/',
        )}
        direct={config}
      />
    );
  return (
    <main className="direct-reference-status" aria-busy={!error}>
      <p className="eyebrow">API Reference</p>
      <h1>{config.title ?? 'API Reference'}</h1>
      {error ? (
        <div role="alert">
          <p>{error}</p>
          <button
            className="primary"
            type="button"
            onClick={() => setRevision((value) => value + 1)}
          >
            Try again
          </button>
        </div>
      ) : (
        <>
          <span className="sr-only" role="status">
            Loading API reference
          </span>
          {slow && (
            <div className="article-skeleton" aria-hidden="true">
              <div className="skeleton-title" />
              <div className="skeleton-line" />
              <div className="skeleton-line" />
              <div className="skeleton-block" />
            </div>
          )}
        </>
      )}
    </main>
  );
}
export function startDirectReference(element: HTMLElement, data: string) {
  try {
    const input = JSON.parse(data) as DirectDocumentationConfig;
    const config = directDocumentationConfig(input, input.basePath);
    for (const key of ['logo', 'logoDark', 'favicon'] as const)
      if (config[key])
        config[key] = new URL(
          config[key],
          location.origin + config.basePath + '/',
        ).href;
    createRoot(element).render(<DirectReference config={config} />);
  } catch {
    element.textContent = 'The API reference configuration is invalid.';
  }
}
