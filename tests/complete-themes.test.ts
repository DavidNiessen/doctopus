import { describe, it, expect } from 'vitest';
import {
  resolvePalette,
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
          Object.values(themePalettes).map((theme) => theme[mode].background),
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
