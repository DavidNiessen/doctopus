import type { Theme } from '@davidniessen/doctopus-contracts';
import { ThemePicker } from './ThemePicker.js';
import { useUi } from '../ui-translation.js';
import type { ReaderPreferences } from '../reader-preferences.js';
export function ReaderSettingsControls({
  value,
  onChange,
  stored,
  publishedTheme,
}: {
  value: ReaderPreferences;
  onChange: (value: ReaderPreferences) => void;
  stored: boolean;
  publishedTheme?: Theme | undefined;
}) {
  const t = useUi();
  const change = (update: Partial<ReaderPreferences>) =>
    onChange({ ...value, ...update });
  return (
    <section
      className="reader-settings-controls"
      aria-label={t('settings.region')}
    >
      <p className="settings-privacy">
        {stored ? t('settings.saved') : t('settings.unavailable')}
      </p>
      <ThemePicker
        value={value.theme}
        publishedTheme={publishedTheme}
        onChange={(theme) => change({ theme })}
      />
      <div className="reader-settings-grid">
        <label>
          {t('settings.mode')}
          <select
            value={value.mode}
            onChange={(event) =>
              change({ mode: event.target.value as ReaderPreferences['mode'] })
            }
          >
            <option value="system">{t('settings.system')}</option>
            <option value="light">{t('settings.light')}</option>
            <option value="dark">{t('settings.dark')}</option>
          </select>
        </label>
        <label>
          {t('settings.layout')}
          <select
            value={value.layout}
            onChange={(event) =>
              change({
                layout: event.target.value as ReaderPreferences['layout'],
              })
            }
          >
            <option value="modern">{t('settings.modern')}</option>
            <option value="classic">{t('settings.classic')}</option>
          </select>
        </label>
      </div>
      <p className="settings-description">{t('settings.layoutHelp')}</p>
    </section>
  );
}
