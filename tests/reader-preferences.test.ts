import { describe, expect, it } from 'vitest';
import { themePresets } from '@davidniessen/doctopus-contracts';
import type { Theme } from '@davidniessen/doctopus-contracts';
import {
  defaultReaderPreferences,
  parseReaderPreferences,
  readerPreferencesKey,
  legacyReaderPreferencesKey,
  readerTheme,
} from '../apps/reader/src/reader-preferences.js';
const published: Theme = {
  accent: '#aabbcc',
  radius: 12,
  font: 'serif',
  codeTheme: 'light',
  density: 'compact',
  colors: { dark: { background: '#111122', text: '#eeeeff' } },
  sidebarWidth: 300,
  contentWidth: 800,
};
describe('prepared reader preferences', () => {
  it.each([
    null,
    '',
    '{',
    'null',
    '[]',
    JSON.stringify({ version: 99, mode: 'dark' }),
    ' '.repeat(65537),
  ])('ignores corrupt, unsupported or excessive storage %s', (source) => {
    expect(parseReaderPreferences(source)).toEqual(defaultReaderPreferences());
  });
  it.each(['mint', 'ocean', 'violet', 'neutral'] as const)(
    'restores only the prepared %s theme and independent layout choices',
    (theme) => {
      expect(
        parseReaderPreferences(
          JSON.stringify({
            version: 2,
            mode: 'dark',
            layout: 'classic',
            theme,
          }),
        ),
      ).toEqual({
        version: 2,
        mode: 'dark',
        layout: 'classic',
        theme,
      });
    },
  );
  it('falls back per invalid token and never restores custom colors, names or arbitrary CSS', () => {
    const result = parseReaderPreferences(
      JSON.stringify({
        version: 2,
        mode: 'invalid',
        layout: 'classic',
        editorTheme: 'custom',
        theme: { ...published },
        savedThemes: [{ name: 'custom', theme: published }],
        editorColors: { background: '#abcdef' },
        stylesheet: 'https://invalid.example/style.css',
      }),
    );
    expect(result).toEqual({
      ...defaultReaderPreferences(),
      layout: 'classic',
    });
    expect(Object.keys(result).sort()).toEqual([
      'layout',
      'mode',
      'theme',
      'version',
    ]);
  });
  it('migrates legacy mode/layout/preset tokens while discarding all custom theme data', () => {
    const legacy = {
      version: 1,
      mode: 'dark',
      layout: 'classic',
      editorTheme: 'custom',
      editorColors: { background: '#abcdef' },
      theme: { ...published, preset: 'ocean' },
      savedThemes: [{ name: 'Private name', theme: published }],
    };
    const result = parseReaderPreferences(JSON.stringify(legacy));
    expect(result).toEqual({
      version: 2,
      mode: 'dark',
      layout: 'classic',
      theme: 'ocean',
    });
    expect(JSON.stringify(result)).not.toMatch(
      /Private name|abcdef|colors|radius/,
    );
    expect(
      parseReaderPreferences(JSON.stringify({ ...legacy, theme: published }))
        .theme,
    ).toBe('published');
  });
  it('applies a prepared palette without mutating published configuration or carrying custom reading colors', () => {
    const before = JSON.stringify(published);
    expect(readerTheme(published, 'published')).toBe(published);
    for (const preset of ['mint', 'ocean', 'violet', 'neutral'] as const) {
      const resolved = readerTheme(published, preset);
      expect(resolved).toMatchObject({
        preset,
        accent: themePresets[preset],
        font: published.font,
        contentWidth: published.contentWidth,
      });
      expect(resolved).not.toHaveProperty('colors');
    }
    expect(JSON.stringify(published)).toBe(before);
  });
  it.each(['auto', 'light', 'dark', 'contrast', 'custom'])(
    'discards the former independent editor choice %s',
    (editorTheme) => {
      expect(
        parseReaderPreferences(
          JSON.stringify({ version: 2, theme: 'custom', editorTheme }),
        ),
      ).toEqual(defaultReaderPreferences());
    },
  );
  it('scopes current and legacy storage by mount without sharing custom-theme data', () => {
    expect(readerPreferencesKey('')).toBe(readerPreferencesKey('/'));
    expect(readerPreferencesKey('/first')).not.toBe(
      readerPreferencesKey('/second'),
    );
    expect(readerPreferencesKey('/first')).not.toBe(
      legacyReaderPreferencesKey('/first'),
    );
  });
});
