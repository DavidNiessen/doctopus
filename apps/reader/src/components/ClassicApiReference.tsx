import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ApiDocument, Operation } from '@davidniessen/doctopus-contracts';
import {
  readExpandedOperation,
  readOperationCatalog,
  readOperationRows,
  referenceJson,
} from '../classic-reference-data.js';
import type {
  OperationCatalog,
  OperationRow,
} from '../classic-reference-data.js';
import type { CredentialSession } from '../credential-session.js';
import { Playground } from './Playground.js';
import type { PlaygroundHandle } from './Playground.js';
import { Icon } from './Icon.js';
import { useUi } from '../ui-translation.js';

type Expanded = { api: ApiDocument; operation: Operation };
async function loadOperation(
  slug: string,
  api: ApiDocument,
  activeOperation: Operation,
  operationBase: string,
  basePath: string,
  signal: AbortSignal,
  direct = false,
): Promise<Expanded> {
  if (slug === activeOperation.slug) return { api, operation: activeOperation };
  if (direct) {
    const operation = api.operations.find((item) => item.slug === slug);
    if (!operation) throw new Error('Unknown operation');
    return { api, operation };
  }
  return readExpandedOperation(
    await referenceJson(
      `${operationBase}${slug}/page-data.json`,
      signal,
      16 * 1024 * 1024,
    ),
    api,
    slug,
    basePath,
  );
}
const fragment = () => {
  const match = /^#classic-(\d{1,4})-([a-z0-9-]{1,512})$/.exec(location.hash);
  return match ? { page: Number(match[1]), slug: match[2]! } : undefined;
};
export default function ClassicApiReference({
  api,
  activeOperation,
  apis,
  basePath,
  operationBase,
  onChooseApi,
  renderDetails,
  relayEndpoint,
  mockOnly = false,
  credentialSession,
  oauthClients,
  direct = false,
}: {
  api: ApiDocument;
  activeOperation: Operation;
  apis: ApiDocument[];
  basePath: string;
  direct?: boolean;
  operationBase: string;
  onChooseApi: (api: ApiDocument) => void;
  renderDetails: (
    api: ApiDocument,
    operation: Operation,
    prefix: string,
  ) => ReactNode;
  relayEndpoint?: string | undefined;
  mockOnly?: boolean;
  credentialSession?: CredentialSession | undefined;
  oauthClients?:
    Record<string, { clientId: string; issuer: string }> | undefined;
}) {
  const t = useUi();
  const [catalog, setCatalog] = useState<OperationCatalog | null>(null),
    [rows, setRows] = useState<OperationRow[]>([]);
  const [page, setPage] = useState(0),
    [catalogRevision, setCatalogRevision] = useState(0),
    [pageRevision, setPageRevision] = useState(0),
    [detailRevision, setDetailRevision] = useState(0);
  const [error, setError] = useState<'list' | 'page' | ''>(''),
    [loading, setLoading] = useState(true),
    [expanded, setExpanded] = useState<string | null>(null);
  const [details, setDetails] = useState<Expanded | null>(null),
    [detailError, setDetailError] = useState(false);
  const [selection, setSelection] = useState<
    (Expanded & { trigger?: HTMLElement }) | null
  >(null);
  const playground = useRef<PlaygroundHandle>(null);
  const tryButton = useRef<HTMLButtonElement>(null);
  const versionSelect = useRef<HTMLSelectElement>(null);
  const openingRequest = useRef<AbortController | null>(null);
  const returnTrigger = useRef<HTMLElement | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [tryError, setTryError] = useState<{
    slug: string;
    trigger: HTMLButtonElement;
  } | null>(null);
  useEffect(() => {
    setOpening(null);
    setTryError(null);
    return () => {
      openingRequest.current?.abort();
      openingRequest.current = null;
    };
  }, [api.id, api.version, operationBase, activeOperation.slug, page]);
  async function openRow(row: OperationRow, trigger: HTMLButtonElement) {
    openingRequest.current?.abort();
    const controller = new AbortController();
    openingRequest.current = controller;
    setOpening(row.slug);
    setTryError(null);
    try {
      const next =
        details?.operation.slug === row.slug
          ? details
          : await loadOperation(
              row.slug,
              api,
              activeOperation,
              operationBase,
              basePath,
              controller.signal,
              direct,
            );
      if (next.operation.kind && next.operation.kind !== 'endpoint')
        throw new Error('This operation does not accept outbound requests');
      if (!controller.signal.aborted && openingRequest.current === controller)
        setSelection({ ...next, trigger });
    } catch {
      if (!controller.signal.aborted && openingRequest.current === controller)
        setTryError({ slug: row.slug, trigger });
    } finally {
      if (openingRequest.current === controller) {
        openingRequest.current = null;
        setOpening(null);
      }
    }
  }
  const hadSelection = useRef(false);
  useEffect(() => {
    if (selection)
      returnTrigger.current =
        selection.trigger ?? tryButton.current ?? versionSelect.current;
    else if (hadSelection.current)
      (returnTrigger.current?.isConnected
        ? returnTrigger.current
        : (tryButton.current ?? versionSelect.current)
      )?.focus({ preventScroll: true });
    hadSelection.current = !!selection;
  }, [selection]);
  const index = api.operationIndex;
  const indexRoot = index?.replace(/catalog\.json$/, '');
  useEffect(() => {
    const controller = new AbortController();
    setCatalog(null);
    setRows([]);
    setError('');
    setLoading(true);
    void (async () => {
      if (direct) {
        const total = api.operations.length;
        const pages = Math.ceil(total / 100);
        setPage(Math.min(fragment()?.page ?? 0, Math.max(0, pages - 1)));
        setCatalog({
          schemaVersion: 1,
          apiId: api.id,
          version: api.version,
          total,
          pageSize: 100,
          pages,
        });
        if (!pages) setLoading(false);
        return;
      }
      if (!index || !/^api-index\/\d+\/catalog\.json$/.test(index))
        throw new Error('Endpoint index unavailable');
      const next = readOperationCatalog(
        await referenceJson(`${basePath}/${index}`, controller.signal, 65536),
        api,
      );
      if (controller.signal.aborted) return;
      setPage(Math.min(fragment()?.page ?? 0, Math.max(0, next.pages - 1)));
      setCatalog(next);
      if (!next.pages) setLoading(false);
    })().catch(() => {
      if (!controller.signal.aborted) {
        setError('list');
        setLoading(false);
      }
    });
    return () => controller.abort();
  }, [api.id, api.version, index, basePath, catalogRevision]);
  useEffect(() => {
    if (!catalog?.pages || (!direct && !indexRoot)) return;
    const controller = new AbortController();
    setLoading(true);
    setRows([]);
    setExpanded(null);
    setDetails(null);
    setError('');
    void (async () => {
      if (direct) {
        setRows(
          api.operations
            .slice(page * 100, (page + 1) * 100)
            .map((operation) => ({
              slug: operation.slug,
              method: operation.method,
              path: operation.path,
              summary: operation.summary,
              tag: operation.tags[0] ?? 'Endpoints',
              deprecated: operation.deprecated,
              ...(operation.kind ? { kind: operation.kind } : {}),
            })),
        );
        setLoading(false);
        const target = fragment();
        if (target?.page === page) setExpanded(target.slug);
        return;
      }
      const next = readOperationRows(
        await referenceJson(
          `${basePath}/${indexRoot}${page}.json`,
          controller.signal,
          8 * 1024 * 1024,
        ),
        api,
        page,
        catalog,
      );
      if (controller.signal.aborted) return;
      setRows(next);
      setLoading(false);
      const target = fragment();
      if (target?.page === page && next.some((row) => row.slug === target.slug))
        setExpanded(target.slug);
    })().catch(() => {
      if (!controller.signal.aborted) {
        setError('page');
        setLoading(false);
      }
    });
    return () => controller.abort();
  }, [catalog, page, pageRevision, indexRoot, basePath, api.id, api.version]);
  useEffect(() => {
    if (!expanded) return;
    const row = rows.find((item) => item.slug === expanded);
    if (!row) return;
    const controller = new AbortController();
    setDetails(null);
    setDetailError(false);
    void (async () => {
      const next = await loadOperation(
        expanded,
        api,
        activeOperation,
        operationBase,
        basePath,
        controller.signal,
        direct,
      );
      if (!controller.signal.aborted) setDetails(next);
    })().catch(() => {
      if (!controller.signal.aborted) setDetailError(true);
    });
    return () => controller.abort();
  }, [
    expanded,
    rows,
    detailRevision,
    api,
    activeOperation,
    operationBase,
    basePath,
  ]);
  useEffect(() => {
    if (selection?.trigger) {
      const url = new URL(location.href);
      url.hash = `classic-${page}-${selection.operation.slug}`;
      history.replaceState(
        history.state,
        '',
        url.pathname + url.search + url.hash,
      );
      playground.current?.open(selection.trigger);
    }
  }, [selection, page]);
  useEffect(() => {
    if (
      new URL(location.href).searchParams.get('playground') !== 'open' ||
      fragment() ||
      (activeOperation.kind && activeOperation.kind !== 'endpoint')
    )
      return;
    setSelection({ api, operation: activeOperation });
  }, [api, activeOperation]);
  useEffect(() => {
    if (
      !details ||
      selection ||
      new URL(location.href).searchParams.get('playground') !== 'open' ||
      fragment()?.slug !== details.operation.slug ||
      (details.operation.kind && details.operation.kind !== 'endpoint')
    )
      return;
    setSelection({
      ...details,
      ...(tryButton.current ? { trigger: tryButton.current } : {}),
    });
  }, [details, selection]);
  const groups = [...new Set(rows.map((row) => row.tag))];
  useEffect(() => {
    const target = fragment();
    if (
      !details ||
      target?.slug !== details.operation.slug ||
      target.page !== page
    )
      return;
    const frame = requestAnimationFrame(() =>
      document
        .getElementById(`classic-${page}-${target.slug}`)
        ?.scrollIntoView({ block: 'start' }),
    );
    return () => cancelAnimationFrame(frame);
  }, [details, page]);
  return (
    <section className="classic-reference" aria-label={t('classic.region')}>
      <header className="classic-reference-header">
        <div>
          <p className="eyebrow">{t('navigation.api')}</p>
          <h1>{api.title}</h1>
          <p className="page-description">{api.description}</p>
        </div>
        <label>
          {t('navigation.version')}
          <select
            ref={versionSelect}
            value={`${api.id}:${api.version}`}
            onChange={(event) => {
              const next = apis.find(
                (item) => `${item.id}:${item.version}` === event.target.value,
              );
              if (next) onChooseApi(next);
            }}
          >
            {apis.map((item) => (
              <option
                key={`${item.id}:${item.version}`}
                value={`${item.id}:${item.version}`}
              >
                {item.title} · {item.version}
              </option>
            ))}
          </select>
        </label>
      </header>
      <p className="classic-reference-help">{t('classic.help')}</p>
      {catalog && (
        <div className="classic-pagination">
          <span>
            {t('classic.count', { count: catalog.total })} ·{' '}
            {catalog.pages
              ? t('classic.page', { page: page + 1, pages: catalog.pages })
              : t('classic.empty')}
          </span>
          <button
            type="button"
            disabled={page === 0 || loading}
            onClick={() => {
              setSelection(null);
              setPage((value) => value - 1);
            }}
          >
            {t('classic.previous')}
          </button>
          <button
            type="button"
            disabled={page + 1 >= catalog.pages || loading}
            onClick={() => {
              setSelection(null);
              setPage((value) => value + 1);
            }}
          >
            {t('classic.next')}
          </button>
        </div>
      )}
      {loading && <p role="status">{t('classic.loading')}</p>}
      {error && (
        <div className="classic-reference-error" role="alert">
          <p>
            {t(error === 'list' ? 'classic.listError' : 'classic.pageError')}
          </p>
          <button
            type="button"
            onClick={() =>
              catalog
                ? setPageRevision((value) => value + 1)
                : setCatalogRevision((value) => value + 1)
            }
          >
            {t('classic.retry')}
          </button>
        </div>
      )}
      {groups.map((group) => (
        <section className="classic-endpoint-group" key={group}>
          <h2>{group}</h2>
          {rows
            .filter((row) => row.tag === group)
            .map((row) => (
              <div className="classic-endpoint-row" key={row.slug}>
                <details
                  className={`endpoint-disclosure method-${row.method}`}
                  id={`classic-${page}-${row.slug}`}
                  open={expanded === row.slug}
                  onToggle={(event) => {
                    if (event.currentTarget.open) {
                      setDetailError(false);
                      setExpanded(row.slug);
                    } else
                      setExpanded((current) =>
                        current === row.slug ? null : current,
                      );
                  }}
                >
                  <summary id={`classic-${page}-${row.slug}-summary`}>
                    <span className={`method-badge ${row.method}`}>
                      {row.method}
                    </span>
                    <code>{row.path}</code>
                    <span className="endpoint-summary">{row.summary}</span>
                    {row.deprecated && (
                      <span className="classic-deprecated">
                        {t('classic.deprecated')}
                      </span>
                    )}
                    <Icon name="chevron" size={18} />
                  </summary>
                  {expanded === row.slug && (
                    <div className="classic-endpoint-content">
                      {(!details || details.operation.slug !== row.slug) &&
                        !detailError && (
                          <p role="status">{t('classic.detailsLoading')}</p>
                        )}
                      {detailError && (
                        <div role="alert">
                          <p>{t('classic.detailsError')}</p>
                          <button
                            type="button"
                            onClick={() =>
                              setDetailRevision((value) => value + 1)
                            }
                          >
                            {t('classic.detailsRetry')}
                          </button>
                        </div>
                      )}
                      {details && details.operation.slug === row.slug && (
                        <>
                          <p>{details.operation.description}</p>
                          {renderDetails(
                            details.api,
                            details.operation,
                            `classic-${row.slug}-`,
                          )}
                        </>
                      )}
                    </div>
                  )}
                </details>
                {(!row.kind || row.kind === 'endpoint') && (
                  <button
                    ref={expanded === row.slug ? tryButton : undefined}
                    className="button-primary classic-header-try"
                    type="button"
                    aria-haspopup="dialog"
                    aria-describedby={`classic-${page}-${row.slug}-summary`}
                    aria-busy={opening === row.slug}
                    aria-label={t('playground.try')}
                    disabled={opening === row.slug}
                    onClick={(event) => void openRow(row, event.currentTarget)}
                  >
                    {t(
                      opening === row.slug
                        ? 'classic.opening'
                        : 'playground.try',
                    )}
                  </button>
                )}
                {tryError?.slug === row.slug && (
                  <div className="classic-try-error" role="alert">
                    <p>{t('classic.detailsError')}</p>
                    <button
                      type="button"
                      onClick={() => void openRow(row, tryError.trigger)}
                    >
                      {t('classic.detailsRetry')}
                    </button>
                  </div>
                )}
              </div>
            ))}
        </section>
      ))}
      {selection && (
        <Playground
          ref={playground}
          hidePreview
          onClosed={() => setSelection(null)}
          key={`${selection.api.id}:${selection.api.version}:${selection.operation.slug}`}
          api={selection.api}
          operation={selection.operation}
          basePath={basePath}
          mockOnly={mockOnly}
          relayEndpoint={relayEndpoint}
          credentialSession={credentialSession}
          oauthClients={oauthClients}
        />
      )}
    </section>
  );
}
