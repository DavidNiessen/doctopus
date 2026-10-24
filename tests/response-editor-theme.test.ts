import { expect, it } from 'vitest';
import {
  contrastRatio,
  resolvePalette,
  themePresets,
} from '@davidniessen/doctopus-contracts';
import { responseEditorTheme } from '../apps/reader/src/response-editor-theme.js';

it.each(['light', 'dark'] as const)(
  'matches the %s reader palette with readable syntax across prepared themes',
  (mode) => {
    const palette = resolvePalette({}, mode);
    const keys = new Set<string>();
    for (const accent of Object.values(themePresets)) {
      const result = responseEditorTheme(palette, accent, mode);
      expect(result.base).toBe(mode === 'dark' ? 'vs-dark' : 'vs');
      expect(result.colors['editor.background']).toBe(palette.background);
      expect(result.colors['editor.foreground']).toBe(palette.text);
      expect(result.colors['editorGutter.background']).toBe(palette.background);
      expect(result.colors['editorLineNumber.foreground']).toBe(palette.muted);
      for (const rule of result.rules) {
        expect(
          contrastRatio('#' + rule.foreground, palette.background),
        ).toBeGreaterThanOrEqual(4.5);
      }
      keys.add(
        result.rules.find((rule) => rule.token === 'string.key.json')!
          .foreground!,
      );
    }
    expect(keys.size).toBe(4);
  },
);

it('follows the published custom palette automatically without a separate editor override', () => {
  const palette = resolvePalette(
    {
      colors: {
        dark: { background: '#171023', surface: '#21172f', text: '#eee6f5' },
      },
    },
    'dark',
  );
  const result = responseEditorTheme(palette, '#7c3aed', 'dark');
  expect(result.colors['editor.background']).toBe('#171023');
  expect(result.colors['editor.foreground']).toBe('#eee6f5');
  expect(result.colors['editorWidget.background']).toBe('#21172f');
  for (const rule of result.rules) {
    expect(
      contrastRatio('#' + rule.foreground, palette.background),
    ).toBeGreaterThanOrEqual(4.5);
  }
});
