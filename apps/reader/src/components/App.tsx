import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  lazy,
  Suspense,
} from 'react';
import { createCredentialSession } from '../credential-session.js';
import { sanitizeGuideHtml } from '../sanitize-guide.server.js';
import {
  EditorThemeContext,
  useReaderPreferences,
} from '../use-reader-preferences.js';
import { readerTheme } from '../reader-preferences.js';
import type {
  CSSProperties,
  MouseEvent,
  KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createSearchIndex, search } from '@davidniessen/doctopus-search';
import {
  guideHref,
  operationHref,
  withBase,
  safeNavigationHref,
  normalizePagePath,
  readableAccent,
  resolvePalette,
  pageMetadata,
  createUiTranslation,
  localeRoute,
  localizePath,
  localeName,
} from '@davidniessen/doctopus-contracts';
import type {
  ApiDocument,
  Operation,
  SiteData,
  SearchResult,
  DirectDocumentationConfig,
} from '@davidniessen/doctopus-contracts';
import { PanelResizeHandle } from './PanelResizeHandle.js';
import { LocaleMenu } from './LocaleMenu.js';
import { UiContext, useUi } from '../ui-translation.js';
import { Icon } from './Icon.js';
import { Playground } from './Playground.js';
import type { PlaygroundHandle } from './Playground.js';
import { SchemaView } from './SchemaView.js';
import { MediaExamples } from './MediaExamples.js';
import { CopyButton } from './CopyButton.js';
import { ResponsePreview } from './ResponsePreview.js';
import {
  ResponseSelectionProvider,
  useResponseSelection,
} from './ResponseSelection.js';
import { PageFooter } from './PageFooter.js';
import { DeprecationCenter, OperationLifecycle } from './Lifecycle.js';

const ReaderExtensions = lazy(() => import('./ReaderExtensions.js'));
const ReaderSettings = lazy(() => import('./ReaderSettings.js'));
const ClassicApiReference = lazy(() => import('./ClassicApiReference.js'));
function scrollFragment(hash: string) {
  if (!hash) return;
  try {
    document
      .getElementById(decodeURIComponent(hash.slice(1)).split(':~:text=')[0]!)
      ?.scrollIntoView();
  } catch {
    /* A malformed fragment cannot identify a local element. */
  }
}
function activateGuideTab(button: HTMLButtonElement) {
  const list = button.closest('[role="tablist"]');
  for (const tab of list?.querySelectorAll<HTMLButtonElement>(
    '[data-guide-tab]',
  ) ?? []) {
    const selected = tab === button;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    const panel = document.getElementById(
      tab.getAttribute('aria-controls') ?? '',
    );
    if (panel) panel.hidden = !selected;
  }
}
function guideTabKey(event: ReactKeyboardEvent<HTMLDivElement>) {
  const target = (event.target as Element).closest<HTMLButtonElement>(
    '[data-guide-tab]',
  );
  if (
    !target ||
    !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
  )
    return;
  const tabs = [
    ...target
      .closest('[role="tablist"]')!
      .querySelectorAll<HTMLButtonElement>('[data-guide-tab]'),
  ];
  const index =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabs.length - 1
        : (tabs.indexOf(target) +
            (event.key === 'ArrowRight' ? 1 : -1) +
            tabs.length) %
          tabs.length;
  event.preventDefault();
  const next = tabs[index];
  if (next) {
    activateGuideTab(next);
    next.focus();
  }
}
export function App({
  site: initialSite,
  initialPath,
  direct,
}: {
  site: SiteData;
  initialPath: string;
  direct?: DirectDocumentationConfig;
}) {
  const layout = useRef<HTMLDivElement>(null);
  const [site, setSite] = useState(initialSite);
  const {
    preferences,
    setPreferences,
    mode: preferredMode,
    stored,
    ready: preferencesReady,
  } = useReaderPreferences(
    site.config.basePath,
    direct ? { layout: direct.layout, mode: direct.appearance } : undefined,
  );
  const [credentialSession] = useState(createCredentialSession);
  useSyncExternalStore(
    credentialSession.subscribe,
    credentialSession.getRevision,
    () => 0,
  );
  useEffect(() => {
    const clear = () => credentialSession.clearAll();
    window.addEventListener('pagehide', clear);
    return () => {
      window.removeEventListener('pagehide', clear);
      clear();
    };
  }, [credentialSession]);
  useEffect(() => {
    if (site.config.explorer?.credentialReuse === false)
      credentialSession.clearAll();
  }, [site.config.explorer?.credentialReuse, credentialSession]);
  const [path, setPath] = useState(initialPath);
  const [loading, setLoading] = useState(false);
  const [slowLoading, setSlowLoading] = useState(false);
  useEffect(() => {
    if (!loading) {
      setSlowLoading(false);
      return;
    }
    const timer = setTimeout(() => setSlowLoading(true), 250);
    return () => clearTimeout(timer);
  }, [loading]);
  const [extensionsReady, setExtensionsReady] = useState(false);
  useEffect(() => {
    if (site.readerExtensions?.length) setExtensionsReady(true);
  }, [site.readerExtensions?.length]);
  const [searchIndex, setSearchIndex] = useState(() =>
    createSearchIndex(initialSite),
  );
  const searchLoaded = useRef(false);
  const searchWorker = useRef<Worker | null>(null);
  const searchRequest = useRef(0);
  const [workerFailed, setWorkerFailed] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchKind, setSearchKind] = useState('');
  const [searchVersion, setSearchVersion] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const navigationId = useRef(0);
  const [mobileNav, setMobileNav] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedNavigationMode, setNavigationMode] = useState<
    'all' | 'docs' | 'api'
  >('all');
  const [query, setQuery] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const playground = useRef<PlaygroundHandle>(null);
  useEffect(() => {
    performance.mark('doctopus:hydrated');
  }, []);
  const config = {
    ...site.config,
    theme: readerTheme(site.config.theme, preferences.theme),
  };
  const { locale, prefix, contentPath } = localeRoute(config, path);
  const contentLocale = site.contentLocale ?? config.defaultLocale;
  const ui = useMemo(
    () => createUiTranslation(locale, config.i18n),
    [locale, config.i18n],
  );
  const t = ui.text;
  const palette = resolvePalette(
    config.theme,
    theme === 'dark' ? 'dark' : 'light',
  );
  const href = (value: string) => withBase(config.basePath, value);
  const docHref = (value: string) => href(localizePath(config, value, locale));
  const activeGuide =
    site.guides.find((guide) => guideHref(guide) === contentPath) ??
    (contentPath === '/' ? site.guides[0] : undefined);
  const guideHtml = useMemo(
    () => (activeGuide ? sanitizeGuideHtml(activeGuide.html) : ''),
    [activeGuide?.html],
  );
  let activeApi =
    site.apis.find((api) =>
      api.operations.some(
        (operation) => operationHref(api, operation) === contentPath,
      ),
    ) ?? site.apis[0];
  const activeOperation =
    activeApi?.operations.find(
      (operation) => operationHref(activeApi!, operation) === contentPath,
    ) ??
    (contentPath === '/' && !site.guides.length
      ? activeApi?.operations[0]
      : undefined);
  const [selectedApi, setSelectedApi] = useState(
    activeApi ? `${activeApi.id}:${activeApi.version}` : '',
  );
  if (!activeOperation)
    activeApi =
      site.apis.find((api) => `${api.id}:${api.version}` === selectedApi) ??
      activeApi;
  const firstApi = activeApi?.operations[0];
  const lifecyclePage = site.lifecycle?.page;
  const navigationMode =
    preferences.layout === 'classic' && selectedNavigationMode === 'all'
      ? activeOperation || lifecyclePage || (contentPath === '/' && firstApi)
        ? 'api'
        : 'docs'
      : selectedNavigationMode;
  useEffect(() => {
    setNavigationMode((previous) =>
      previous === 'all' ? 'all' : activeOperation ? 'api' : 'docs',
    );
  }, [contentPath, !!activeOperation]);
  useEffect(() => {
    if (
      preferencesReady &&
      contentPath === '/' &&
      preferences.layout === 'modern'
    )
      setNavigationMode('all');
    if (
      !preferencesReady ||
      preferences.layout !== 'classic' ||
      contentPath !== '/' ||
      !activeApi ||
      !firstApi
    )
      return;
    const controller = new AbortController();
    void loadPage(
      new URL(
        docHref(operationHref(activeApi, firstApi)),
        window.location.origin,
      ),
      false,
      controller.signal,
      true,
    );
    return () => controller.abort();
  }, [
    preferencesReady,
    preferences.layout,
    contentPath,
    activeApi?.id,
    activeApi?.version,
    firstApi?.slug,
  ]);
  useEffect(() => {
    const pop = () => {
      void loadPage(new URL(window.location.href), false);
    };
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        openSearch();
      }
    };
    window.addEventListener('popstate', pop);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('popstate', pop);
      window.removeEventListener('keydown', key);
    };
  }, [config.basePath]);
  useEffect(() => {
    if (preferencesReady) setTheme(preferredMode);
  }, [preferredMode, preferencesReady]);
  useEffect(() => {
    document.documentElement.lang = ui.locale;
  }, [ui.locale]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    const metadata = pageMetadata(site, path);
    document.title = `${metadata.title} · ${config.name}`;
    for (const link of document.querySelectorAll('link[data-doc-locale]'))
      link.remove();
    if (config.siteUrl)
      for (const alternate of metadata.alternates) {
        const link = document.createElement('link');
        link.rel = 'alternate';
        link.hreflang = alternate.locale;
        link.href = config.siteUrl + config.basePath + alternate.href;
        link.dataset.docLocale = '';
        document.head.append(link);
      }
    for (const [selector, value] of [
      ['meta[name="description"]', metadata.description],
      ['meta[name="robots"]', metadata.robots],
      ['meta[property="og:title"]', document.title],
      ['meta[property="og:description"]', metadata.description],
    ] as const)
      document.querySelector(selector)?.setAttribute('content', value);
    for (const [selector, attribute, value] of [
      ['link[rel="canonical"]', 'href', metadata.canonical],
      ['meta[property="og:url"]', 'content', metadata.canonical],
    ] as const) {
      let element = document.querySelector(selector);
      if (value && !element) {
        element = document.createElement(
          selector.startsWith('link') ? 'link' : 'meta',
        );
        element.setAttribute(
          selector.startsWith('link') ? 'rel' : 'property',
          selector.startsWith('link') ? 'canonical' : 'og:url',
        );
        document.head.append(element);
      }
      if (value) element?.setAttribute(attribute, value);
      else element?.remove();
    }
  }, [site, path, config.name]);
  useEffect(() => {
    for (const tab of document.querySelectorAll<HTMLButtonElement>(
      '.guide-content [data-guide-tab][aria-selected="true"]',
    ))
      activateGuideTab(tab);
  }, [activeGuide?.html]);
  useEffect(() => {
    scrollFragment(window.location.hash);
  }, [site, path]);
  function navigate(event: MouseEvent<HTMLDivElement>) {
    const tab = (event.target as Element).closest<HTMLButtonElement>(
      '[data-guide-tab]',
    );
    if (tab) {
      activateGuideTab(tab);
      return;
    }
    const target = (event.target as Element).closest<HTMLAnchorElement>(
      'a[data-doc-route]',
    );
    if (
      !target ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    const url = new URL(target.href);
    if (
      url.pathname === window.location.pathname &&
      url.search === window.location.search &&
      url.hash
    ) {
      history.pushState({}, '', url.pathname + url.search + url.hash);
      scrollFragment(url.hash);
      return;
    }
    void loadPage(url, true);
  }
  function openSearch() {
    dialog.current?.showModal();
    if (!direct && !searchLoaded.current) {
      searchLoaded.current = true;
      setSearchLoading(true);
      if (!searchWorker.current && !workerFailed) {
        try {
          const worker = new Worker(
            new URL('../search.worker.ts', import.meta.url),
            { type: 'module' },
          );
          worker.onmessage = (
            event: MessageEvent<{ id: number; results: SearchResult[] }>,
          ) => {
            if (event.data.id === searchRequest.current)
              setSearchResults(event.data.results);
          };
          worker.onerror = () => {
            worker.terminate();
            searchWorker.current = null;
            setWorkerFailed(true);
          };
          searchWorker.current = worker;
        } catch {
          setWorkerFailed(true);
        }
      }
      void (async () => {
        const response = await fetch(
          href(
            site.searchLocale
              ? `/search/${site.searchLocale}/catalog.json`
              : '/search-manifest.json',
          ),
          {
            credentials: 'same-origin',
          },
        );
        if (!response.ok) throw new Error('Search unavailable');
        const manifest = (await response.json()) as {
          schemaVersion: number;
          shards: string[];
        };
        if (
          manifest.schemaVersion !== 1 ||
          !Array.isArray(manifest.shards) ||
          manifest.shards.length > 1000
        )
          throw new Error('Invalid search manifest');
        const index: ReturnType<typeof createSearchIndex> = [];
        const shardRoot = site.searchLocale
          ? `search/${site.searchLocale}/`
          : 'search/';
        for (let offset = 0; offset < manifest.shards.length; offset += 4) {
          const batch = await Promise.all(
            manifest.shards.slice(offset, offset + 4).map(async (file) => {
              if (
                typeof file !== 'string' ||
                !file.startsWith(shardRoot) ||
                !/^\d+\.json$/.test(file.slice(shardRoot.length))
              )
                throw new Error('Invalid search shard path');
              const response = await fetch(href('/' + file), {
                credentials: 'same-origin',
              });
              if (!response.ok) throw new Error('Search unavailable');
              return (await response.json()) as ReturnType<
                typeof createSearchIndex
              >;
            }),
          );
          for (const shard of batch) index.push(...shard);
        }
        searchWorker.current?.postMessage({ kind: 'load', index });
        setSearchIndex(index);
      })()
        .catch(() => {
          searchLoaded.current = false;
        })
        .finally(() => setSearchLoading(false));
    }
  }
  useEffect(() => {
    const id = ++searchRequest.current;
    const filter = {
      ...(searchKind ? { kind: searchKind } : {}),
      ...(searchVersion ? { version: searchVersion } : {}),
    };
    if (searchWorker.current && !workerFailed)
      searchWorker.current.postMessage({ kind: 'query', id, query, filter });
    else setSearchResults(search(searchIndex, query, filter));
  }, [query, searchIndex, searchKind, searchVersion, workerFailed]);
  useEffect(() => () => searchWorker.current?.terminate(), []);
  async function loadPage(
    url: URL,
    push: boolean,
    signal?: AbortSignal,
    replace = false,
  ) {
    const id = ++navigationId.current;
    const nextPath = normalizePagePath(
      url.pathname.slice(config.basePath.length) || '/',
    );
    setLoading(true);
    try {
      const next = direct
        ? initialSite
        : await (async () => {
            const response = await fetch(
              href(
                `${nextPath.endsWith('/') ? nextPath : `${nextPath}/`}page-data.json`,
              ),
              { credentials: 'same-origin', ...(signal ? { signal } : {}) },
            );
            if (!response.ok) throw new Error('Page data unavailable');
            return (await response.json()) as SiteData;
          })();
      if (
        next.schemaVersion !== 1 ||
        !next.config ||
        next.config.basePath !== config.basePath ||
        !Array.isArray(next.apis)
      )
        throw new Error('Invalid page data');
      if (id !== navigationId.current) return;
      if (push) history.pushState({}, '', url.pathname + url.search + url.hash);
      else if (replace)
        history.replaceState({}, '', url.pathname + url.search + url.hash);
      setSite(next);
      setPath(nextPath);
      setMobileNav(false);
      dialog.current?.close();
      window.scrollTo({ top: 0, behavior: 'instant' });
    } catch {
      if (id === navigationId.current && !signal?.aborted)
        window.location.assign(url.href);
    } finally {
      if (id === navigationId.current) setLoading(false);
    }
  }

  const groups = [...new Set(site.guides.map((guide) => guide.group))];
  const tags = [
    ...new Set(
      activeApi?.operations.flatMap((operation) =>
        operation.tags.length ? operation.tags.slice(0, 1) : ['Endpoints'],
      ) ?? [],
    ),
  ];
  const results = searchResults;
  const view = (
    <div
      ref={layout}
      className={`docs-shell layout-${preferences.layout}${preferences.layout === 'classic' && activeOperation ? ' classic-api-overview' : ''} density-${config.theme.density} font-${config.theme.font} code-${config.theme.codeTheme}`}
      data-layout={preferences.layout}
      style={
        {
          '--accent': config.theme.accent,
          '--code-string': readableAccent('#b45d34', theme, palette),
          '--code-key': readableAccent('#237da3', theme, palette),
          '--code-number': readableAccent('#b0662d', theme, palette),
          '--code-keyword': readableAccent('#8e65b9', theme, palette),
          '--code-comment': palette.muted,
          '--code-flag': readableAccent('#2787c0', theme, palette),
          '--success-text': readableAccent('#169965', theme, palette),
          '--error-text': readableAccent('#b03642', theme, palette),
          '--action-bg': readableAccent(config.theme.accent, 'light'),
          '--accent-text-light': readableAccent(
            config.theme.accent,
            'light',
            resolvePalette(config.theme, 'light'),
          ),
          '--accent-text-dark': readableAccent(
            config.theme.accent,
            'dark',
            resolvePalette(config.theme, 'dark'),
          ),
          '--bg': palette.background,
          '--surface': palette.surface,
          '--subtle': palette.subtle,
          '--border': palette.border,
          '--text': palette.text,
          '--muted': palette.muted,
          '--heading': palette.heading,
          '--sidebar-width': `${config.theme.sidebarWidth ?? 288}px`,
          '--content-width': `${config.theme.contentWidth ?? 760}px`,
          '--radius': `${config.theme.radius}px`,
        } as CSSProperties
      }
      onClick={navigate}
      onKeyDown={guideTabKey}
    >
      <a href="#main-content" className="skip-link">
        {t('navigation.skip')}
      </a>
      <header className="site-header">
        <div className="header-main">
          <a className="brand" href={docHref('/')} data-doc-route>
            {direct?.logo || config.logo ? (
              <>
                <img
                  className="brand-logo logo-light"
                  src={direct?.logo ?? href('/media/' + config.logo)}
                  alt=""
                />
                {(direct?.logoDark || config.logoDark) && (
                  <img
                    className="brand-logo logo-dark"
                    src={direct?.logoDark ?? href('/media/' + config.logoDark)}
                    alt=""
                  />
                )}
              </>
            ) : (
              <span className="brand-mark">
                <img
                  src={href('/assets/doctopus-mascot.webp')}
                  alt=""
                  width={36}
                  height={36}
                  decoding="async"
                />
              </span>
            )}
            <span>{config.name}</span>
            <span className="docs-label">docs</span>
          </a>
          <button
            className="search-trigger"
            type="button"
            aria-label={t('search.label')}
            onClick={() => openSearch()}
          >
            <Icon name="search" size={17} />
            <span>{t('search.placeholder')}</span>
            <kbd>⌘ K</kbd>
          </button>
          <div className="header-actions">
            <LocaleMenu
              config={config}
              path={
                activeGuide ||
                activeOperation ||
                lifecyclePage ||
                contentPath === '/'
                  ? path
                  : '/'
              }
              ui={ui}
              contentLocale={contentLocale}
            />
            {site.config.explorer?.credentialReuse !== false &&
              credentialSession.hasRemembered() && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t('credentials.forget')}
                  title={t('credentials.forget')}
                  onClick={(event) => {
                    const search = event.currentTarget
                      .closest('header')
                      ?.querySelector<HTMLButtonElement>('.search-trigger');
                    credentialSession.clearAll();
                    search?.focus();
                  }}
                >
                  <Icon name="lock" />
                </button>
              )}
            {config.links.map((link) => (
              <a
                key={link.href}
                href={safeNavigationHref(link.href)}
                target={link.href.startsWith('https:') ? '_blank' : undefined}
                rel="noreferrer"
              >
                {link.label}
                <Icon name="external" size={13} />
              </a>
            ))}
            <button
              type="button"
              className="icon-button reader-settings-trigger"
              aria-label={t('theme.settings')}
              title={t('theme.settings')}
              onClick={() => setSettingsOpen(true)}
            >
              <Icon name="settings" />
            </button>
            <button
              type="button"
              className="icon-button theme-toggle"
              aria-label={t(theme === 'light' ? 'theme.dark' : 'theme.light')}
              onClick={() => {
                const next = theme === 'light' ? 'dark' : 'light';
                setTheme(next);
                setPreferences((previous) => ({ ...previous, mode: next }));
                try {
                  localStorage.setItem('doctopus-theme', next);
                } catch {
                  /* Optional preference. */
                }
              }}
            >
              <Icon name={theme === 'light' ? 'moon' : 'sun'} />
            </button>
            {!(preferences.layout === 'classic' && activeOperation) && (
              <button
                type="button"
                className="icon-button mobile-menu"
                aria-label={t('navigation.toggle')}
                aria-expanded={mobileNav}
                onClick={() => setMobileNav(!mobileNav)}
              >
                <Icon name={mobileNav ? 'close' : 'menu'} />
              </button>
            )}
          </div>
        </div>
        <nav className="header-tabs" aria-label={t('navigation.sections')}>
          {preferences.layout !== 'classic' && (
            <span className="section-fallback active" hidden={preferencesReady}>
              {t('navigation.all')}
            </span>
          )}
          {firstApi && activeApi && (
            <a
              className="section-fallback"
              hidden={preferencesReady}
              href={docHref(operationHref(activeApi, firstApi))}
            >
              <Icon name="code" size={16} />
              {t('navigation.api')}
            </a>
          )}
          <a
            className="section-fallback"
            hidden={preferencesReady}
            href={docHref(site.guides[0] ? guideHref(site.guides[0]) : '/')}
          >
            <Icon name="book" size={16} />
            {t('navigation.docs')}
          </a>
          {preferences.layout !== 'classic' && (
            <button
              type="button"
              hidden={!preferencesReady}
              className={navigationMode === 'all' ? 'active' : ''}
              aria-pressed={navigationMode === 'all'}
              aria-controls="documentation-navigation"
              onClick={() => setNavigationMode('all')}
            >
              <Icon name="globe" size={16} />
              {t('navigation.all')}
            </button>
          )}
          {firstApi && activeApi && (
            <button
              type="button"
              hidden={!preferencesReady}
              className={navigationMode === 'api' ? 'active' : ''}
              aria-pressed={navigationMode === 'api'}
              aria-controls="documentation-navigation"
              onClick={() => {
                setNavigationMode('api');
                if (!activeOperation)
                  void loadPage(
                    new URL(
                      docHref(operationHref(activeApi, firstApi)),
                      window.location.origin,
                    ),
                    true,
                  );
              }}
            >
              <Icon name="code" size={16} />
              {t('navigation.api')}
            </button>
          )}
          <button
            type="button"
            hidden={!preferencesReady}
            className={navigationMode === 'docs' ? 'active' : ''}
            aria-pressed={navigationMode === 'docs'}
            aria-controls="documentation-navigation"
            onClick={() => {
              setNavigationMode('docs');
              if (!activeGuide && site.guides[0])
                void loadPage(
                  new URL(
                    docHref(guideHref(site.guides[0])),
                    window.location.origin,
                  ),
                  true,
                );
            }}
          >
            <Icon name="book" size={16} />
            {t('navigation.docs')}
          </button>
          {(site.lifecycle?.total ?? 0) > 0 && (
            <a
              className={lifecyclePage ? 'active' : ''}
              href={docHref('/deprecations/')}
              data-doc-route
              aria-current={lifecyclePage ? 'page' : undefined}
            >
              <Icon name="info" size={16} />
              {t('navigation.deprecations')}
            </a>
          )}
        </nav>
      </header>
      <div className="docs-layout">
        <aside
          id="documentation-navigation"
          className={`sidebar ${mobileNav ? 'is-open' : ''}`}
          aria-label={t('navigation.sidebar')}
        >
          {preferences.layout !== 'classic' &&
          navigationMode !== 'docs' &&
          site.apis.length > 1 ? (
            <label className="version-select">
              {t('navigation.version')}
              <select
                value={selectedApi}
                onChange={(event) => {
                  setSelectedApi(event.target.value);
                  const api = site.apis.find(
                    (item) =>
                      `${item.id}:${item.version}` === event.target.value,
                  );
                  if (api?.operations[0]) {
                    const target = operationHref(api, api.operations[0]);
                    void loadPage(
                      new URL(docHref(target), window.location.origin),
                      true,
                    );
                  }
                }}
              >
                {site.apis.map((api) => (
                  <option
                    key={`${api.id}:${api.version}`}
                    value={`${api.id}:${api.version}`}
                  >
                    {api.title} · {api.version}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="sidebar-project">
              <Icon name="globe" size={16} />
              <span>{t('navigation.resources')}</span>
              {activeApi && (
                <span className="version-pill">{activeApi.version}</span>
              )}
            </div>
          )}
          {navigationMode !== 'api' &&
            groups.map((group) => (
              <nav className="nav-group" key={group} aria-label={group}>
                <h2>{group}</h2>
                {site.guides
                  .filter((guide) => guide.group === group)
                  .map((guide, index) => (
                    <a
                      className={
                        activeGuide?.slug === guide.slug
                          ? 'nav-link active'
                          : 'nav-link'
                      }
                      key={guide.slug}
                      href={docHref(guideHref(guide))}
                      data-doc-route
                      aria-current={
                        activeGuide?.slug === guide.slug ? 'page' : undefined
                      }
                    >
                      <Icon
                        name={
                          ['book', 'bolt', 'shield', 'settings'][index % 4] ??
                          'book'
                        }
                        size={16}
                      />
                      <span>{guide.title}</span>
                    </a>
                  ))}
              </nav>
            ))}
          {preferences.layout !== 'classic' &&
            navigationMode !== 'docs' &&
            activeApi &&
            tags.map((tag) => (
              <nav
                className="nav-group"
                key={tag}
                aria-label={`${tag} endpoints`}
              >
                <h2>{tag}</h2>
                {activeApi!.operations
                  .filter(
                    (operation) => (operation.tags[0] ?? 'Endpoints') === tag,
                  )
                  .map((operation) => (
                    <a
                      key={operation.slug}
                      href={docHref(operationHref(activeApi!, operation))}
                      data-doc-route
                      className={
                        activeOperation?.slug === operation.slug
                          ? 'nav-link endpoint-link active'
                          : 'nav-link endpoint-link'
                      }
                      aria-current={
                        activeOperation?.slug === operation.slug
                          ? 'page'
                          : undefined
                      }
                    >
                      <span className={`method-badge ${operation.method}`}>
                        {operation.method}
                      </span>
                      <span>{operation.summary}</span>
                    </a>
                  ))}
              </nav>
            ))}
          {site.navigationTruncated && (
            <button
              type="button"
              className="nav-search-more"
              onClick={openSearch}
            >
              <Icon name="search" size={14} />
              {t('navigation.searchAll', {
                count: site.navigationTotal ?? 0,
              })}
            </button>
          )}
          <a
            className="sidebar-bottom"
            href="https://github.com/DavidNiessen/doctopus"
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="brand-mark small">
              <img
                src={href('/assets/doctopus-icon.svg')}
                width={20}
                height={20}
                alt=""
              />
            </span>
            <span>
              Powered by <strong>Doctopus</strong>
            </span>
          </a>
        </aside>
        <div
          className="navigation-resize-controls"
          role="region"
          aria-label={t('layout.navigationControls')}
        >
          <PanelResizeHandle
            target={layout}
            property="--sidebar-width"
            initial={config.theme.sidebarWidth ?? 288}
            min={220}
            max={380}
            label={t('layout.navigation')}
            controls="documentation-navigation"
            storageKey={config.basePath}
            className="navigation-resize"
          />
        </div>
        <main
          id="main-content"
          aria-busy={loading}
          className={
            lifecyclePage
              ? 'main-area lifecycle-layout'
              : preferences.layout === 'classic' && activeOperation
                ? 'main-area classic-reference-layout'
                : activeOperation
                  ? 'main-area api-layout'
                  : 'main-area guide-layout'
          }
          tabIndex={-1}
        >
          {loading && slowLoading ? (
            <div
              className="page-skeleton"
              role="status"
              aria-label={t('navigation.loading')}
            >
              <h1 className="sr-only">{t('navigation.loading')}</h1>
              <div aria-hidden="true">
                <div className="skeleton-title" />
                <div className="skeleton-description" />
                <div className="skeleton-endpoint" />
                <div className="skeleton-section" />
                <div className="skeleton-line" />
                <div className="skeleton-line" />
                <div className="skeleton-line" />
              </div>
            </div>
          ) : (
            <>
              {locale !== contentLocale && (
                <aside className="locale-fallback" role="note">
                  <Icon name="info" size={16} />
                  <p>
                    {t('locale.fallback', {
                      language: localeName(contentLocale),
                      locale: localeName(locale),
                    })}
                  </p>
                </aside>
              )}
              {lifecyclePage ? (
                <DeprecationCenter
                  key={path}
                  page={lifecyclePage}
                  basePath={config.basePath + prefix}
                />
              ) : direct && contentPath === '/' && !activeOperation ? (
                <article className="article">
                  <p className="eyebrow">{t('navigation.api')}</p>
                  <h1>{activeApi?.title ?? config.name}</h1>
                  <p>{activeApi?.description}</p>
                  <p className="subtle">{t('classic.empty')}</p>
                </article>
              ) : preferences.layout === 'classic' &&
                activeOperation &&
                activeApi ? (
                <Suspense
                  fallback={<p role="status">Loading API reference…</p>}
                >
                  <ClassicApiReference
                    key={`${activeApi.id}:${activeApi.version}`}
                    api={activeApi}
                    activeOperation={activeOperation}
                    direct={!!direct}
                    apis={site.apis}
                    basePath={config.basePath}
                    operationBase={docHref(
                      operationHref(activeApi, activeOperation),
                    ).slice(0, -activeOperation.slug.length - 1)}
                    onChooseApi={(api) => {
                      setSelectedApi(`${api.id}:${api.version}`);
                      if (api.operations[0])
                        void loadPage(
                          new URL(
                            docHref(operationHref(api, api.operations[0])),
                            location.origin,
                          ),
                          true,
                        );
                    }}
                    renderDetails={(api, operation, prefix) => (
                      <OperationDetails
                        key={operation.slug}
                        api={api}
                        operation={operation}
                        idPrefix={prefix}
                        headingLevel={3}
                      />
                    )}
                    mockOnly={site.config.explorer?.mode === 'mock'}
                    relayEndpoint={site.config.explorer?.relay}
                    credentialSession={
                      site.config.explorer?.credentialReuse === false
                        ? undefined
                        : credentialSession
                    }
                    oauthClients={
                      site.config.explorer?.oauthClients?.[activeApi.id]
                    }
                  />
                </Suspense>
              ) : activeOperation && activeApi ? (
                <ResponseSelectionProvider
                  key={`${activeApi.id}:${activeApi.version}:${activeOperation.slug}`}
                  operation={activeOperation}
                >
                  <article lang={contentLocale} className="article api-article">
                    <div className="breadcrumb">
                      {t('navigation.api')}
                      <Icon name="chevron" size={12} />
                      {activeOperation.tags[0] ?? activeApi.title}
                    </div>
                    <div className="eyebrow">
                      {activeOperation.tags[0] ?? 'API Reference'}
                    </div>
                    <h1>{activeOperation.summary}</h1>
                    <p className="page-description">
                      {activeOperation.description ||
                        `Use this endpoint to ${activeOperation.summary.toLowerCase()}.`}
                    </p>
                    {activeOperation.kind &&
                      activeOperation.kind !== 'endpoint' && (
                        <div className="callout">
                          <Icon name="info" />
                          <span>
                            {activeOperation.kind === 'webhook'
                              ? 'Webhook'
                              : 'Callback'}
                            : your application receives this request from the
                            API provider.
                            {activeOperation.callback && (
                              <>
                                {' '}
                                Triggered by{' '}
                                <code>
                                  {activeOperation.callback.operationId}
                                </code>{' '}
                                using{' '}
                                <code>
                                  {activeOperation.callback.expression}
                                </code>
                                .
                              </>
                            )}
                          </span>
                        </div>
                      )}
                    {site.lifecycle?.current ? (
                      <OperationLifecycle
                        entry={site.lifecycle.current}
                        basePath={config.basePath + prefix}
                      />
                    ) : (
                      activeOperation.deprecated && (
                        <div className="callout warning">
                          <Icon name="info" />
                          This endpoint is deprecated. Check the migration guide
                          before integrating.
                        </div>
                      )
                    )}
                    <div className="endpoint-address">
                      <span
                        className={`method-badge ${activeOperation.method}`}
                      >
                        {activeOperation.method}
                      </span>
                      <code>{activeOperation.path}</code>
                      <span className="endpoint-version">
                        {activeApi.version}
                      </span>
                      <CopyButton
                        text={activeOperation.path}
                        label={t('api.copyPath')}
                      />
                      {(!activeOperation.kind ||
                        activeOperation.kind === 'endpoint') && (
                        <button
                          type="button"
                          className="try-now"
                          aria-label={t('playground.tryEndpoint')}
                          aria-haspopup="dialog"
                          onClick={(event) =>
                            playground.current?.open(event.currentTarget)
                          }
                        >
                          {t('playground.try')} <Icon name="arrow" size={14} />
                        </button>
                      )}
                    </div>
                    <OperationDetails
                      key={`${activeApi.id}:${activeApi.version}:${activeOperation.slug}`}
                      api={activeApi}
                      operation={activeOperation}
                    />
                    <PageFooter
                      source={activeOperation.source}
                      config={config}
                      path={path}
                    />
                  </article>
                  <PanelResizeHandle
                    target={layout}
                    property="--api-panel-width"
                    initial={448}
                    min={260}
                    max={560}
                    reverse
                    label={t('layout.inspector')}
                    controls="documentation-inspector"
                    storageKey={config.basePath}
                    className="inspector-resize"
                  />
                  <div className="api-examples" id="documentation-inspector">
                    {!activeOperation.kind ||
                    activeOperation.kind === 'endpoint' ? (
                      <Playground
                        ref={playground}
                        key={`${activeApi.id}:${activeApi.version}:${activeOperation.slug}`}
                        api={activeApi}
                        operation={activeOperation}
                        basePath={site.config.basePath}
                        mockOnly={site.config.explorer?.mode === 'mock'}
                        relayEndpoint={site.config.explorer?.relay}
                        credentialSession={
                          site.config.explorer?.credentialReuse === false
                            ? undefined
                            : credentialSession
                        }
                        oauthClients={
                          site.config.explorer?.oauthClients?.[activeApi.id]
                        }
                      />
                    ) : (
                      <aside
                        className="explorer-column"
                        aria-label={t('api.eventExamples')}
                      >
                        {Object.entries(
                          activeOperation.requestBody?.content ?? {},
                        ).map(([type, media]) => (
                          <MediaExamples
                            key={type}
                            title={t('api.incomingPayload', { type })}
                            media={media}
                            mediaType={type}
                            schemas={activeApi.schemas}
                          />
                        ))}
                      </aside>
                    )}
                    <ResponsePreview
                      api={activeApi}
                      operation={activeOperation}
                    />
                  </div>
                </ResponseSelectionProvider>
              ) : activeGuide ? (
                <>
                  <article
                    lang={contentLocale}
                    className="article guide-article"
                  >
                    <div className="breadcrumb">
                      {t('navigation.docs')}
                      <Icon name="chevron" size={12} />
                      {activeGuide.group}
                    </div>
                    <div className="eyebrow">{activeGuide.group}</div>
                    <h1>{activeGuide.title}</h1>
                    {activeGuide.description && (
                      <p className="page-description">
                        {activeGuide.description}
                      </p>
                    )}
                    <div
                      className="guide-content"
                      dangerouslySetInnerHTML={{
                        __html: guideHtml,
                      }}
                    />
                    <div className="next-pages">
                      {site.guides
                        .filter((guide) => guide.slug !== activeGuide.slug)
                        .slice(0, 2)
                        .map((guide) => (
                          <a
                            key={guide.slug}
                            href={docHref(guideHref(guide))}
                            data-doc-route
                          >
                            <Icon name="book" />
                            <strong>{guide.title}</strong>
                            <span>
                              {guide.description || t('navigation.continue')}
                            </span>
                            <Icon name="arrow" />
                          </a>
                        ))}
                    </div>
                    <PageFooter
                      source={activeGuide.source}
                      config={config}
                      path={path}
                    />
                  </article>
                  <PanelResizeHandle
                    target={layout}
                    property="--guide-panel-width"
                    initial={210}
                    min={160}
                    max={340}
                    reverse
                    label={t('layout.inspector')}
                    controls="documentation-inspector"
                    storageKey={config.basePath}
                    className="inspector-resize"
                  />
                  <aside className="page-toc" id="documentation-inspector">
                    <h2>
                      <Icon name="menu" size={14} />
                      {t('navigation.onPage')}
                    </h2>
                    <nav>
                      {activeGuide.headings
                        .filter(
                          (heading) => heading.level > 1 && heading.level < 4,
                        )
                        .map((heading) => (
                          <a
                            key={heading.id}
                            href={safeNavigationHref(`#${heading.id}`)}
                            className={heading.level === 3 ? 'nested' : ''}
                          >
                            {heading.text}
                          </a>
                        ))}
                    </nav>
                  </aside>
                </>
              ) : (
                <article lang={contentLocale} className="article">
                  <div className="eyebrow">404</div>
                  <h1>{t('navigation.notFound')}</h1>
                  <p>{t('navigation.notFoundHelp')}</p>
                  <a
                    className="button-primary"
                    href={docHref('/')}
                    data-doc-route
                  >
                    {t('navigation.back')}
                    <Icon name="arrow" />
                  </a>
                </article>
              )}
              {extensionsReady && !!site.readerExtensions?.length && (
                <Suspense fallback={null}>
                  <ReaderExtensions
                    assets={site.readerExtensions}
                    basePath={config.basePath}
                    page={{
                      path,
                      title: pageMetadata(site, path).title,
                      locale,
                      kind: lifecyclePage
                        ? 'lifecycle'
                        : activeOperation
                          ? 'operation'
                          : activeGuide
                            ? 'guide'
                            : 'not-found',
                    }}
                  />
                </Suspense>
              )}
            </>
          )}
        </main>
      </div>
      {settingsOpen && (
        <Suspense fallback={<div role="status">Loading reader settings…</div>}>
          <ReaderSettings
            value={preferences}
            onChange={setPreferences}
            stored={stored}
            onClose={() => setSettingsOpen(false)}
          />
        </Suspense>
      )}
      <dialog
        className="search-dialog"
        ref={dialog}
        aria-label={t('search.label')}
        onClick={(event) => {
          if (event.target === dialog.current) dialog.current?.close();
        }}
      >
        <div className="search-input-row">
          <Icon name="search" />
          <input
            autoFocus
            aria-label={t('search.label')}
            placeholder={t('search.placeholder')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            aria-label={t('search.close')}
          >
            <kbd>Esc</kbd>
          </button>
        </div>
        <div className="search-filters">
          <label>
            {t('search.content')}
            <select
              aria-label={t('search.type')}
              value={searchKind}
              onChange={(event) => setSearchKind(event.target.value)}
            >
              <option value="">{t('search.allContent')}</option>
              <option value="guide">{t('search.guides')}</option>
              <option value="operation">{t('search.endpoints')}</option>
            </select>
          </label>
          <label>
            {t('navigation.version')}
            <select
              aria-label={t('search.version')}
              value={searchVersion}
              onChange={(event) => setSearchVersion(event.target.value)}
            >
              <option value="">{t('search.allVersions')}</option>
              {[
                ...new Set(
                  searchIndex.map((entry) => entry.version).filter(Boolean),
                ),
              ].map((version) => (
                <option key={version}>{version}</option>
              ))}
            </select>
          </label>
          {searchLoading && <small role="status">{t('search.loading')}</small>}
        </div>
        <div className="search-results">
          {query ? (
            results.length ? (
              results.map((result) => (
                <a key={result.id} href={docHref(result.href)} data-doc-route>
                  <span className="search-result-icon">
                    {result.method ? (
                      <span className={`method-badge ${result.method}`}>
                        {result.method}
                      </span>
                    ) : (
                      <Icon name="book" />
                    )}
                  </span>
                  <span>
                    <small>
                      {result.group}
                      {result.version ? ` · ${result.version}` : ''}
                    </small>
                    <strong>{result.title}</strong>
                    <p>{result.excerpt}</p>
                  </span>
                  <Icon name="arrow" size={16} />
                </a>
              ))
            ) : (
              <div className="search-empty">
                <Icon name="search" size={28} />
                <h3>{t('search.empty')}</h3>
                <p>{t('search.emptyHelp')}</p>
              </div>
            )
          ) : (
            <div className="search-empty">
              <Icon name="spark" size={28} />
              <h3>{t('search.start')}</h3>
              <p>{t('search.startHelp')}</p>
            </div>
          )}
        </div>
        <div className="search-dialog-footer">
          {t('search.privacy')}
          <span>⌘ K</span>
        </div>
      </dialog>
    </div>
  );
  return (
    <UiContext.Provider value={ui}>
      <EditorThemeContext.Provider
        value={{ palette, accent: config.theme.accent, mode: theme }}
      >
        {view}
      </EditorThemeContext.Provider>
    </UiContext.Provider>
  );
}
function OperationDetails({
  api,
  operation,
  idPrefix = '',
  headingLevel = 2,
}: {
  api: ApiDocument;
  operation: Operation;
  idPrefix?: string;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  const t = useUi();
  const selection = useResponseSelection(operation);
  const {
    response,
    status: responseStatus,
    setStatus: setResponseStatus,
    types: responseTypes,
    type: mediaType,
    setType: setResponseType,
  } = selection;
  const responseMedia = response?.content[mediaType];
  return (
    <>
      {operation.security.length > 0 && (
        <section id={idPrefix + 'authentication'}>
          <Heading>
            <Icon name="lock" size={19} />
            {t('api.authorization')}
          </Heading>
          <div
            className={
              operation.security.length === 1 &&
              Object.keys(operation.security[0]!).length > 0
                ? 'sr-only'
                : 'authorization-policy'
            }
          >
            <span>
              {operation.security.some(
                (alternative) => Object.keys(alternative).length === 0,
              )
                ? t('api.authOptional')
                : t('api.authRequired')}{' '}
              {operation.security
                .map(
                  (alternative) =>
                    Object.keys(alternative).join(' + ') || t('api.anonymous'),
                )
                .join(' ' + t('api.or') + ' ')}
              <br />
              <small>{t('api.credentialsHint')}</small>
            </span>
          </div>
          {[
            ...new Set(
              operation.security.flatMap((alternative) =>
                Object.keys(alternative),
              ),
            ),
          ].map((name) => {
            const scheme = api.securitySchemes[name];
            const header = scheme?.type !== 'apiKey';
            const required = operation.security.every((alternative) =>
              Object.hasOwn(alternative, name),
            );
            return (
              <div className="parameter-row authorization-reference" key={name}>
                <div className="field-heading">
                  <code>
                    {header ? 'Authorization' : (scheme.name ?? name)}
                  </code>
                  <span className="type-label">string</span>
                  <span className="type-label">
                    {header ? 'header' : (scheme.in ?? 'header')}
                  </span>
                  {required && (
                    <span className="required">{t('schema.required')}</span>
                  )}
                </div>
                <p>
                  {scheme?.description ??
                    (scheme?.scheme === 'bearer' ||
                    scheme?.type === 'oauth2' ||
                    scheme?.type === 'openIdConnect'
                      ? t('api.bearerDescription')
                      : name)}
                </p>
              </div>
            );
          })}
        </section>
      )}
      {(['path', 'query', 'header', 'cookie'] as const).map((location) => {
        const parameters = operation.parameters.filter(
          (parameter) => parameter.in === location,
        );
        return parameters.length ? (
          <section key={location} id={`${idPrefix}${location}-parameters`}>
            <Heading>
              {t(
                (
                  {
                    path: 'api.pathParameters',
                    query: 'api.queryParameters',
                    header: 'api.headerParameters',
                    cookie: 'api.cookieParameters',
                  } as const
                )[location],
              )}
            </Heading>
            {parameters.map((parameter) => (
              <div className="parameter-row" key={parameter.name}>
                <div className="field-heading">
                  <code>{parameter.name}</code>
                  <span className="type-label">
                    {String(parameter.schema.type ?? 'string')}
                  </span>
                  {parameter.required && (
                    <span className="required">{t('schema.required')}</span>
                  )}
                </div>
                <p>
                  {parameter.description ||
                    t('api.parameterDescription', {
                      name: parameter.name,
                      location,
                    })}
                </p>
                <SchemaView
                  schema={parameter.schema}
                  schemas={api.schemas}
                  legacyNullable={
                    api.openapiVersion?.startsWith('3.0') === true
                  }
                />
              </div>
            ))}
          </section>
        ) : null;
      })}
      {operation.requestBody && (
        <section id={idPrefix + 'request-body'}>
          <Heading>
            {t('api.requestBody')}
            {operation.requestBody.required && (
              <span className="required">{t('schema.required')}</span>
            )}
            {Object.keys(operation.requestBody.content).length === 1 && (
              <span className="section-media-label">
                {Object.keys(operation.requestBody.content)[0]}
              </span>
            )}
          </Heading>
          {operation.requestBody.description && (
            <p>{operation.requestBody.description}</p>
          )}
          {Object.entries(operation.requestBody.content).map(
            ([type, media]) => (
              <div key={type}>
                {Object.keys(operation.requestBody!.content).length > 1 && (
                  <span className="media-label">{type}</span>
                )}
                <SchemaView
                  schema={media.schema}
                  schemas={api.schemas}
                  legacyNullable={
                    api.openapiVersion?.startsWith('3.0') === true
                  }
                />
              </div>
            ),
          )}
        </section>
      )}
      <section id={idPrefix + 'responses'}>
        <Heading>{t('response.title')}</Heading>
        {!operation.responses.length && <p>{t('api.noResponses')}</p>}
        <div className="status-tabs">
          {operation.responses.map((item) => (
            <button
              type="button"
              key={item.status}
              className={responseStatus === item.status ? 'active' : ''}
              aria-pressed={responseStatus === item.status}
              onClick={() => {
                setResponseStatus(item.status);
              }}
            >
              <span
                className={
                  item.status.startsWith('2') ? 'live-dot' : 'status-dot'
                }
              />
              {item.status}
            </button>
          ))}
        </div>
        <p>{response?.description}</p>
        {responseMedia && (
          <>
            {responseTypes.length > 1 ? (
              <label className="example-selector">
                {t('api.responseContentType')}
                <select
                  value={mediaType}
                  onChange={(event) => setResponseType(event.target.value)}
                >
                  {responseTypes.map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
              </label>
            ) : (
              <span className="media-label">{mediaType}</span>
            )}
            <SchemaView
              schema={responseMedia.schema}
              schemas={api.schemas}
              legacyNullable={api.openapiVersion?.startsWith('3.0') === true}
            />
            <details className="inline-response-example">
              <summary>{t('examples.responseTitle')}</summary>
              <MediaExamples
                key={`${responseStatus}:${mediaType}`}
                media={responseMedia}
                mediaType={mediaType}
                schemas={api.schemas}
                selectedId={selection.example}
                onSelect={selection.setExample}
              />
            </details>
          </>
        )}
      </section>
    </>
  );
}
