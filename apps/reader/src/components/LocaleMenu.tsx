import {
  localizePath,
  localeName,
  withBase,
} from '@davidniessen/doctopus-contracts';
import type {
  ProjectConfig,
  UiTranslation,
} from '@davidniessen/doctopus-contracts';
import { useUi } from '../ui-translation.js';
import { Icon } from './Icon.js';

export function LocaleMenu({
  config,
  path,
  ui,
  contentLocale,
}: {
  config: ProjectConfig;
  path: string;
  ui: UiTranslation;
  contentLocale: string;
}) {
  const t = useUi();
  if (config.locales.length < 2) return null;
  return (
    <details className="locale-menu">
      <summary aria-label={t('locale.choose')}>
        <Icon name="globe" size={16} />
        <span lang={ui.locale}>{localeName(ui.locale)}</span>
        <Icon name="chevron" size={12} />
      </summary>
      <nav aria-label={t('locale.choose')}>
        {config.locales.map((locale) => (
          <a
            key={locale}
            href={withBase(config.basePath, localizePath(config, path, locale))}
            hrefLang={locale}
            lang={locale}
            aria-current={locale === ui.locale ? 'true' : undefined}
          >
            {localeName(locale)}
            {locale === ui.locale && <Icon name="check" size={14} />}
          </a>
        ))}
        <p>{t('locale.content', { language: localeName(contentLocale) })}</p>
        <p>
          {t('locale.coverage', { translated: ui.translated, total: ui.total })}
        </p>
      </nav>
    </details>
  );
}
