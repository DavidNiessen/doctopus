import type { Palette } from './index.js';
function rgb(hex: string): number[] {
  if (!/^#[a-fA-F0-9]{6}$/.test(hex))
    throw new Error('Theme colors must use six-digit hex notation');
  return [1, 3, 5].map((index) =>
    Number.parseInt(hex.slice(index, index + 2), 16),
  );
}
function luminance(color: string): number {
  const channels = rgb(color).map((value) => {
    const n = value / 255;
    return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}
export function contrastRatio(a: string, b: string): number {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function blend(a: string, b: string, weight: number): string {
  const first = rgb(a),
    second = rgb(b);
  return (
    '#' +
    first
      .map((value, index) =>
        Math.round(value * (1 - weight) + second[index]! * weight)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
const readableAccentCache = new Map<string, string>();
/** Derive an accessible text color while retaining the configured brand hue. */
export function readableAccent(
  accent: string,
  mode: 'light' | 'dark',
  colors?: Pick<Palette, 'surface' | 'background'>,
): string {
  const key = JSON.stringify([
    accent,
    mode,
    colors?.surface,
    colors?.background,
  ]);
  const cached = readableAccentCache.get(key);
  if (cached) return cached;
  const result = computeReadableAccent(accent, mode, colors);
  if (key.length <= 256) {
    if (readableAccentCache.size >= 256)
      readableAccentCache.delete(readableAccentCache.keys().next().value!);
    readableAccentCache.set(key, result);
  }
  return result;
}
function computeReadableAccent(
  accent: string,
  mode: 'light' | 'dark',
  colors?: Pick<Palette, 'surface' | 'background'>,
): string {
  const palette = mode === 'light' ? light : dark;
  const surface = colors?.surface ?? palette.surface;
  const background = colors?.background ?? palette.background;
  const tinted = blend(background, accent, 0.08);
  const destination = ['#111b27', '#ffffff'].sort(
    (a, b) =>
      Math.min(
        ...[surface, background, tinted].map((color) =>
          contrastRatio(b, color),
        ),
      ) -
      Math.min(
        ...[surface, background, tinted].map((color) =>
          contrastRatio(a, color),
        ),
      ),
  )[0]!;
  for (let step = 0; step <= 100; step++) {
    const candidate = blend(accent, destination, step / 100);
    if (
      [surface, background, tinted].every(
        (value) => contrastRatio(candidate, value) >= 5,
      )
    )
      return candidate;
  }
  return destination;
}

export const themePresets = {
  mint: '#07c983',
  ocean: '#2563eb',
  violet: '#7c3aed',
  neutral: '#526071',
} as const;
const light: Palette = {
  background: '#ffffff',
  surface: '#f8faf9',
  subtle: '#f0f4f2',
  border: '#e5e9e7',
  text: '#3f4945',
  muted: '#626e68',
  heading: '#17211c',
};
const dark: Palette = {
  background: '#090d0d',
  surface: '#171b19',
  subtle: '#0d1712',
  border: '#262a27',
  text: '#ced3d0',
  muted: '#9fa3a0',
  heading: '#dfe3e0',
};
export function resolvePalette(
  theme: {
    colors?:
      | {
          light?:
            Partial<Record<keyof Palette, string | undefined>> | undefined;
          dark?: Partial<Record<keyof Palette, string | undefined>> | undefined;
        }
      | undefined;
  },
  mode: 'light' | 'dark',
): Palette {
  return {
    ...(mode === 'light' ? light : dark),
    ...Object.fromEntries(
      Object.entries(theme.colors?.[mode] ?? {}).filter(
        ([, value]) => value !== undefined,
      ),
    ),
  };
}
