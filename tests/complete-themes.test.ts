import { describe, it, expect } from 'vitest';
import {
  resolvePalette,
  themeNames,
  readableAccent,
  themePalettes,
  themePresets,
  contrastRatio,
  themeCssVariables,
} from '@davidniessen/doctopus-contracts';
describe('complete themes', () => {
  it('defines distinct canvases and readable text for every complete light/dark palette', () => {
    for (const mode of ['light', 'dark'] as const) {
      expect(
        new Set(
          themeNames.map((name) => JSON.stringify(themePalettes[name][mode])),
        ).size,
      ).toBe(4);
      for (const preset of Object.keys(
        themePresets,
      ) as (keyof typeof themePresets)[]) {
        const palette = resolvePalette({ preset }, mode);
        for (const bg of [palette.background, palette.surface, palette.subtle])
          for (const fg of [palette.text, palette.muted, palette.heading])
            expect(
              contrastRatio(fg, bg),
              `${preset} ${mode}: ${fg} on ${bg}`,
            ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it('provides AAA text and clearly visible boundaries in both high-contrast appearances', () => {
    for (const mode of ['light', 'dark'] as const) {
      const palette = themePalettes.contrast[mode];
      for (const bg of [palette.background, palette.surface, palette.subtle]) {
        for (const fg of [
          palette.text,
          palette.muted,
          palette.heading,
          readableAccent(themePresets.contrast, mode, palette, 7),
        ])
          expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(7);
        expect(contrastRatio(palette.border, bg)).toBeGreaterThanOrEqual(3);
      }
    }
  });
  it('retains publisher overrides and emits paired CSS colors for system appearance before hydration', () => {
    const vars = themeCssVariables({ preset: 'ocean' });
    expect(vars['--bg']).toBe(
      `light-dark(${themePalettes.ocean.light.background}, ${themePalettes.ocean.dark.background})`,
    );
    expect(
      resolvePalette(
        { preset: 'ocean', colors: { dark: { background: '#010203' } } },
        'dark',
      ),
    ).toMatchObject({ ...themePalettes.ocean.dark, background: '#010203' });
    expect(resolvePalette({}, 'light')).toEqual(themePalettes.violet.light);
    expect(resolvePalette({}, 'dark')).toEqual(themePalettes.violet.dark);
  });
});
