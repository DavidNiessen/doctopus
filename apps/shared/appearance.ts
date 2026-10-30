import {
  normalizeThemeName,
  themePresets,
  themeCssVariables,
} from '@davidniessen/doctopus-contracts';
import type { Theme } from '@davidniessen/doctopus-contracts';
import {
  defaultReaderPreferences,
  parseReaderPreferences,
  readerPreferencesKey,
  legacyReaderPreferencesKey,
  readerTheme,
} from '../reader/src/reader-preferences.js';
import { readerThemeVariables } from '../reader/src/theme-variables.js';
// Runs synchronously in the head, before any application surface can paint.
try {
  const root = document.documentElement;
  let variables: Record<string, string>;
  let mode: 'system' | 'light' | 'dark';
  if (document.currentScript?.getAttribute('data-surface') === 'studio') {
    let theme = 'violet',
      appearance = 'system';
    try {
      theme = localStorage.getItem('doctopus-studio-theme') ?? theme;
      appearance =
        localStorage.getItem('doctopus-studio-appearance') ?? appearance;
    } catch {
      /* Defaults remain usable. */
    }
    mode =
      appearance === 'light' || appearance === 'dark' ? appearance : 'system';
    variables = themeCssVariables({
      preset: normalizeThemeName(theme) ?? 'violet',
    });
    root.dataset.appearance = mode;
  } else {
    const data =
      document.getElementById('doctopus-appearance') ??
      document.getElementById('doctopus-direct-config');
    if (!data?.textContent || data.textContent.length > 65536)
      throw new Error('No appearance metadata.');
    const config = JSON.parse(data.textContent);
    const base = typeof config.basePath === 'string' ? config.basePath : '';
    let preferences = {
      ...defaultReaderPreferences(),
      ...(config.appearance === 'light' || config.appearance === 'dark'
        ? { mode: config.appearance }
        : {}),
      ...(config.layout === 'classic' ? { layout: 'classic' as const } : {}),
    };
    try {
      const saved =
        localStorage.getItem(readerPreferencesKey(base)) ??
        localStorage.getItem(legacyReaderPreferencesKey(base));
      if (saved) preferences = parseReaderPreferences(saved);
      else {
        const legacy = localStorage.getItem('doctopus-theme');
        if (legacy === 'light' || legacy === 'dark') preferences.mode = legacy;
      }
    } catch {
      /* Storage denial must not hide the page. */
    }
    const published: Theme =
      typeof config.theme === 'object' && config.theme
        ? config.theme
        : {
            preset: normalizeThemeName(config.theme) ?? 'violet',
            accent: themePresets[normalizeThemeName(config.theme) ?? 'violet'],
            radius: 10,
            font: 'system',
            codeTheme: 'dark',
            density: 'comfortable',
          };
    variables = readerThemeVariables(readerTheme(published, preferences.theme));
    mode = preferences.mode;
    root.dataset.readerLayout = preferences.layout;
    root.dataset.theme =
      mode === 'system'
        ? matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : mode;
    // Keep the server-rendered shell in the saved palette until React restores it.
    const style = document.createElement('style');
    style.id = 'doctopus-pending-appearance';
    style.textContent =
      '.docs-shell{' +
      Object.entries(variables)
        .map(([key, value]) => `${key}:${value} !important;`)
        .join('') +
      '}';
    document.head.append(style);
  }
  root.style.colorScheme = mode === 'system' ? 'light dark' : mode;
  for (const [key, value] of Object.entries(variables))
    root.style.setProperty(key, value);
  root.style.backgroundColor = 'var(--bg)';
  root.style.color = 'var(--text)';
} catch {
  /* Static/default documentation remains readable if bootstrap fails. */
}
