import {
  themePresets,
  normalizeThemeName,
} from '@davidniessen/doctopus-contracts';
import type { Theme } from '@davidniessen/doctopus-contracts';
export type ReaderTheme = 'published' | keyof typeof themePresets;
export interface ReaderPreferences {
  version: 2;
  mode: 'system' | 'light' | 'dark';
  layout: 'modern' | 'classic';
  theme: ReaderTheme;
}
export function defaultReaderPreferences(): ReaderPreferences {
  return {
    version: 2,
    mode: 'system',
    layout: 'modern',
    theme: 'published',
  };
}
export const readerPreferencesKey = (basePath: string) =>
  'doctopus:reader-settings:v2:' + (basePath || '/');
export const legacyReaderPreferencesKey = (basePath: string) =>
  'doctopus:reader-settings:v1:' + (basePath || '/');
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const choice = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T => (allowed.includes(value as T) ? (value as T) : fallback);
/** Restore prepared choices only. Legacy custom palettes and named themes are discarded. */
export function parseReaderPreferences(
  source: string | null,
): ReaderPreferences {
  const result = defaultReaderPreferences();
  if (!source || source.length > 65536) return result;
  let data: unknown;
  try {
    data = JSON.parse(source);
  } catch {
    return result;
  }
  if (!record(data) || (data.version !== 1 && data.version !== 2))
    return result;
  result.mode = choice(data.mode, ['system', 'light', 'dark'], 'system');
  result.layout = choice(data.layout, ['modern', 'classic'], 'modern');
  const theme =
    data.version === 1 && record(data.theme) ? data.theme.preset : data.theme;
  result.theme = normalizeThemeName(theme) ?? 'published';
  return result;
}
export function readerTheme(published: Theme, selection: ReaderTheme): Theme {
  if (selection === 'published') return published;
  const theme = {
    ...published,
    preset: selection,
    accent: themePresets[selection],
  };
  delete theme.colors;
  return theme;
}
