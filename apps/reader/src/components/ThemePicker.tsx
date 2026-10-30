import { useId } from 'react';
import type { CSSProperties } from 'react';
import { resolvePalette, themePresets } from '@davidniessen/doctopus-contracts';
import type { Theme } from '@davidniessen/doctopus-contracts';
import type { ReaderTheme } from '../reader-preferences.js';
import { useUi } from '../ui-translation.js';

export function ThemePicker({
  value,
  publishedTheme,
  onChange,
}: {
  value: ReaderTheme;
  publishedTheme?: Theme | undefined;
  onChange: (value: ReaderTheme) => void;
}) {
  const name = useId();
  const t = useUi();
  const choices = [
    {
      id: 'published',
      label: t('settings.themeDefault'),
      theme: publishedTheme ?? {
        preset: 'violet',
        accent: themePresets.violet,
      },
    },
    ...(['violet', 'ocean', 'ember', 'contrast'] as const).map((id) => ({
      id,
      label: t(`settings.theme.${id}`),
      theme: { preset: id, accent: themePresets[id] },
    })),
  ] as const;
  return (
    <fieldset className="theme-picker">
      <legend>{t('settings.theme')}</legend>
      <p className="theme-picker-help">{t('settings.themeHelp')}</p>
      <div className="theme-choices">
        {choices.map((choice) => {
          const light = resolvePalette(choice.theme, 'light'),
            dark = resolvePalette(choice.theme, 'dark');
          return (
            <label
              key={choice.id}
              className={
                'theme-choice' +
                (choice.id === 'published' ? ' theme-choice-default' : '')
              }
            >
              <input
                type="radio"
                name={name}
                value={choice.id}
                checked={value === choice.id}
                onChange={() => onChange(choice.id)}
              />
              <span className="theme-choice-content">
                <span
                  className="theme-miniature"
                  aria-hidden="true"
                  style={
                    {
                      '--preview-bg': `light-dark(${light.background}, ${dark.background})`,
                      '--preview-surface': `light-dark(${light.surface}, ${dark.surface})`,
                      '--preview-border': `light-dark(${light.border}, ${dark.border})`,
                      '--preview-text': `light-dark(${light.heading}, ${dark.heading})`,
                      '--preview-muted': `light-dark(${light.muted}, ${dark.muted})`,
                      '--preview-accent': choice.theme.accent,
                    } as CSSProperties
                  }
                >
                  <span className="theme-miniature-rail">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="theme-miniature-page">
                    <b />
                    <i />
                    <i />
                    <span />
                  </span>
                </span>
                <span className="theme-choice-label">
                  {choice.label}
                  <span className="theme-choice-indicator" aria-hidden="true" />
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
