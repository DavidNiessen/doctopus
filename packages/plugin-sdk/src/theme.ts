import { themePresets } from '@davidniessen/doctopus-contracts';
import type { Theme } from '@davidniessen/doctopus-contracts';

export type ThemePatch = Partial<Theme>;
const fields: Record<keyof Theme, true> = {
  preset: true,
  colors: true,
  sidebarWidth: true,
  contentWidth: true,
  stylesheet: true,
  accent: true,
  radius: true,
  font: true,
  codeTheme: true,
  density: true,
};
const plain = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);

/** Compose token patches; the compiler still applies full configuration/contrast validation. */
export function applyThemePatch(current: Theme, value: unknown): Theme {
  if (
    !plain(value) ||
    Object.keys(value).some((key) => !Object.hasOwn(fields, key))
  )
    throw new Error(
      'Invalid theme hook result: return a plain object of supported theme tokens',
    );
  const patch = Object.fromEntries(
    Object.entries(value).filter(([, value]) => value !== undefined),
  ) as ThemePatch;
  const next = { ...current, ...patch };
  if (patch.preset !== undefined && patch.accent === undefined) {
    if (!Object.hasOwn(themePresets, patch.preset))
      throw new Error('Invalid theme hook preset');
    next.accent = themePresets[patch.preset];
  }
  if (patch.colors !== undefined) {
    if (
      !plain(patch.colors) ||
      Object.keys(patch.colors).some((key) => key !== 'light' && key !== 'dark')
    )
      throw new Error('Invalid theme hook palettes');
    const colors = { ...current.colors };
    for (const mode of ['light', 'dark'] as const) {
      const palette = patch.colors[mode];
      if (palette === undefined) continue;
      if (!plain(palette)) throw new Error('Invalid theme hook palette tokens');
      colors[mode] = { ...current.colors?.[mode], ...palette };
    }
    next.colors = colors;
  }
  return next;
}
