import { useEffect, useState } from 'react';
import { withBase, safeNavigationHref } from '@davidniessen/doctopus-contracts';
import type {
  LifecyclePage,
  LifecycleRecord,
} from '@davidniessen/doctopus-contracts';
import { Icon } from './Icon.js';
import { useUi } from '../ui-translation.js';

function useUtcDate() {
  const [date, setDate] = useState<string>();
  useEffect(() => {
    const update = () => setDate(new Date().toISOString().slice(0, 10));
    update();
    const timer = setInterval(update, 60_000);
    return () => clearInterval(timer);
  }, []);
  return date;
}
function status(entry: LifecycleRecord, date: string | undefined) {
  const { sunsetOn, deprecatedOn } = entry.lifecycle;
  if (date && sunsetOn) {
    const days =
      (Date.parse(sunsetOn + 'T00:00:00Z') - Date.parse(date + 'T00:00:00Z')) /
      86_400_000;
    if (days <= 0) return 'lifecycle.reached' as const;
    if (days <= 30) return 'lifecycle.soon' as const;
  }
  return entry.deprecated || (date && deprecatedOn && deprecatedOn <= date)
    ? ('lifecycle.deprecated' as const)
    : ('lifecycle.announcement' as const);
}
function Guidance({
  entry,
  basePath,
}: {
  entry: LifecycleRecord;
  basePath: string;
}) {
  const t = useUi();
  const migration = entry.lifecycle.migrationUrl;
  return (
    <>
      {entry.lifecycle.message && <p>{entry.lifecycle.message}</p>}
      {(entry.lifecycle.deprecatedOn || entry.lifecycle.sunsetOn) && (
        <dl className="lifecycle-dates">
          {entry.lifecycle.deprecatedOn && (
            <div>
              <dt>{t('lifecycle.deprecation')}</dt>
              <dd>
                <time dateTime={entry.lifecycle.deprecatedOn}>
                  {entry.lifecycle.deprecatedOn}
                </time>
              </dd>
            </div>
          )}
          {entry.lifecycle.sunsetOn && (
            <div>
              <dt>{t('lifecycle.sunset')}</dt>
              <dd>
                <time dateTime={entry.lifecycle.sunsetOn}>
                  {entry.lifecycle.sunsetOn}
                </time>
              </dd>
            </div>
          )}
        </dl>
      )}
      <div className="lifecycle-links">
        {entry.replacementHref && (
          <a href={withBase(basePath, entry.replacementHref)} data-doc-route>
            {t('lifecycle.replacement')} <Icon name="arrow" size={14} />
          </a>
        )}
        {migration && (
          <a
            href={
              migration.startsWith('/')
                ? withBase(basePath, migration)
                : safeNavigationHref(migration)
            }
            data-doc-route={migration.startsWith('/') ? true : undefined}
            rel={migration.startsWith('/') ? undefined : 'noreferrer'}
          >
            {t('lifecycle.migration')}{' '}
            <Icon
              name={migration.startsWith('/') ? 'arrow' : 'external'}
              size={14}
            />
          </a>
        )}
      </div>
      {entry.replacementIssue && (
        <p className="lifecycle-note">
          {t('lifecycle.replacementUnavailable')}
        </p>
      )}
    </>
  );
}
export function OperationLifecycle({
  entry,
  basePath,
}: {
  entry: LifecycleRecord;
  basePath: string;
}) {
  const t = useUi();
  const date = useUtcDate();
  return (
    <aside
      className="callout warning lifecycle-notice"
      aria-label={t('lifecycle.region')}
    >
      <Icon name="info" />
      <div>
        <strong>{t(status(entry, date))}</strong>
        <Guidance entry={entry} basePath={basePath} />
        <a href={withBase(basePath, '/deprecations/')} data-doc-route>
          {t('lifecycle.viewAll')}
        </a>
      </div>
    </aside>
  );
}
export function DeprecationCenter({
  page,
  basePath,
}: {
  page: LifecyclePage;
  basePath: string;
}) {
  const t = useUi();
  const date = useUtcDate();
  const group = page.groups.find((group) => group.href === page.groupHref);
  return (
    <article className="article lifecycle-center">
      <div className="eyebrow">{t('lifecycle.eyebrow')}</div>
      <h1>{t('navigation.deprecations')}</h1>
      <p className="page-description">{t('lifecycle.help')}</p>
      <p className="lifecycle-note">
        {t('lifecycle.dateHelp')}{' '}
        {date ? t('lifecycle.asOf', { date }) : t('lifecycle.noScript')}
      </p>
      <nav className="lifecycle-filters" aria-label={t('lifecycle.filters')}>
        <a
          href={withBase(basePath, '/deprecations/')}
          data-doc-route
          aria-current={
            page.groupHref === '/deprecations/' ? 'page' : undefined
          }
        >
          {t('lifecycle.all')} <span>{page.total}</span>
        </a>
        {page.groups.length > 0 && (
          <details>
            <summary>
              {group
                ? `${group.title} · ${group.version}`
                : t('lifecycle.choose')}
            </summary>
            <div className="lifecycle-group-options">
              {page.groups.map((item) => (
                <a
                  key={item.href}
                  href={withBase(basePath, item.href)}
                  data-doc-route
                  aria-current={
                    item.href === page.groupHref ? 'page' : undefined
                  }
                >
                  {item.title} · {item.version} <span>{item.total}</span>
                </a>
              ))}
            </div>
          </details>
        )}
      </nav>
      <p className="lifecycle-note">
        {group
          ? t('lifecycle.inGroup', {
              count: t(
                page.matched === 1
                  ? 'lifecycle.countOne'
                  : 'lifecycle.countOther',
                { count: page.matched },
              ),
              title: group.title,
              version: group.version,
            })
          : t('lifecycle.acrossAll', {
              count: t(
                page.matched === 1
                  ? 'lifecycle.countOne'
                  : 'lifecycle.countOther',
                { count: page.matched },
              ),
            })}{' '}
        · {t('lifecycle.page', { page: page.number, pages: page.pages })}
      </p>
      {page.entries.length ? (
        <div className="lifecycle-entries">
          {page.entries.map((entry) => (
            <section
              className="lifecycle-card"
              key={entry.href}
              aria-label={`${entry.summary} · ${entry.version}`}
            >
              <div className="lifecycle-card-meta">
                <span>
                  {entry.apiTitle} · {entry.version}
                </span>
                <span className="lifecycle-status">
                  {t(status(entry, date))}
                </span>
              </div>
              <h2>
                <a href={withBase(basePath, entry.href)} data-doc-route>
                  {entry.summary}
                </a>
              </h2>
              <div className="lifecycle-operation">
                <span className={`method-badge ${entry.method.toLowerCase()}`}>
                  {entry.method}
                </span>
                <code>{entry.path}</code>
                {entry.kind !== 'endpoint' && <span>{entry.kind}</span>}
              </div>
              <Guidance entry={entry} basePath={basePath} />
              {!entry.lifecycle.sunsetOn && (
                <p className="lifecycle-note">{t('lifecycle.noSunset')}</p>
              )}
            </section>
          ))}
        </div>
      ) : (
        <div className="callout">
          <Icon name="check" />
          <p>{t('lifecycle.empty')}</p>
        </div>
      )}
      <nav className="lifecycle-pagination" aria-label={t('lifecycle.pages')}>
        {page.previous && (
          <a href={withBase(basePath, page.previous)} data-doc-route rel="prev">
            {t('lifecycle.previous')}
          </a>
        )}
        <span>
          {t('lifecycle.page', { page: page.number, pages: page.pages })}
        </span>
        {page.next && (
          <a href={withBase(basePath, page.next)} data-doc-route rel="next">
            {t('lifecycle.next')}
          </a>
        )}
      </nav>
    </article>
  );
}
