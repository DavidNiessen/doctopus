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
  colors?: Pick<Palette, 'surface' | 'background'> &
    Partial<Pick<Palette, 'subtle'>>,
  minimum = 5,
): string {
  const key = JSON.stringify([
    accent,
    mode,
    colors?.surface,
    colors?.background,
    colors?.subtle,
    minimum,
  ]);
  const cached = readableAccentCache.get(key);
  if (cached) return cached;
  const result = computeReadableAccent(accent, mode, colors, minimum);
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
  colors?: Pick<Palette, 'surface' | 'background'> &
    Partial<Pick<Palette, 'subtle'>>,
  minimum = 5,
): string {
  const palette = mode === 'light' ? light : dark;
  const surface = colors?.surface ?? palette.surface;
  const background = colors?.background ?? palette.background;
  const tinted = blend(background, accent, 0.08);
  const surfaces = [
    surface,
    background,
    tinted,
    colors?.subtle ?? palette.subtle,
  ];
  const destination = ['#111b27', '#ffffff'].sort(
    (a, b) =>
      Math.min(...surfaces.map((color) => contrastRatio(b, color))) -
      Math.min(...surfaces.map((color) => contrastRatio(a, color))),
  )[0]!;
  for (let step = 0; step <= 100; step++) {
    const candidate = blend(accent, destination, step / 100);
    if (surfaces.every((value) => contrastRatio(candidate, value) >= minimum))
      return candidate;
  }
  return destination;
}

export const themeNames = ['violet', 'ocean', 'ember', 'contrast'] as const;
export type ThemeName = (typeof themeNames)[number];
/** Legacy configuration and saved-preference IDs resolve to their replacements. */
export function normalizeThemeName(value: unknown): ThemeName | undefined {
  if (value === 'mint') return 'ember';
  if (value === 'neutral') return 'contrast';
  return themeNames.includes(value as ThemeName)
    ? (value as ThemeName)
    : undefined;
}
export const themePresets = {
  violet: '#7c3aed',
  ocean: '#2563eb',
  ember: '#c24c23',
  contrast: '#003366',
  mint: '#c24c23',
  neutral: '#003366',
} as const;
const palettes = {
  violet: {
    light: {
      background: '#ffffff',
      surface: '#f7f5fc',
      subtle: '#eee9f8',
      border: '#dfd9eb',
      text: '#403b4d',
      muted: '#665c74',
      heading: '#211a30',
    },
    dark: {
      background: '#121017',
      surface: '#1c1824',
      subtle: '#272132',
      border: '#383043',
      text: '#dad4e5',
      muted: '#aea2bf',
      heading: '#f3edf9',
    },
  },
  ocean: {
    light: {
      background: '#f4f8fd',
      surface: '#eaf1fa',
      subtle: '#dce7f5',
      border: '#cbd9ec',
      text: '#34485f',
      muted: '#496078',
      heading: '#142c48',
    },
    dark: {
      background: '#0b1421',
      surface: '#111f31',
      subtle: '#182b40',
      border: '#2b415a',
      text: '#ccdbed',
      muted: '#94abc6',
      heading: '#edf5ff',
    },
  },
  ember: {
    light: {
      background: '#fff9f2',
      surface: '#f8eee2',
      subtle: '#f0dfca',
      border: '#d8bfa2',
      text: '#4a3527',
      muted: '#705039',
      heading: '#2b180d',
    },
    dark: {
      background: '#1b1110',
      surface: '#281a16',
      subtle: '#35221b',
      border: '#634637',
      text: '#eedacc',
      muted: '#c9a58c',
      heading: '#fff2e6',
    },
  },
  contrast: {
    light: {
      background: '#ffffff',
      surface: '#f7f7f7',
      subtle: '#ededed',
      border: '#666666',
      text: '#111111',
      muted: '#333333',
      heading: '#000000',
    },
    dark: {
      background: '#000000',
      surface: '#080808',
      subtle: '#141414',
      border: '#999999',
      text: '#ffffff',
      muted: '#dedede',
      heading: '#ffffff',
    },
  },
} as const satisfies Record<ThemeName, { light: Palette; dark: Palette }>;
export const themePalettes = {
  ...palettes,
  mint: palettes.ember,
  neutral: palettes.contrast,
};
const light: Palette = themePalettes.violet.light;
const dark: Palette = themePalettes.violet.dark;
export function resolvePalette(
  theme: {
    preset?: keyof typeof themePresets;
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
    ...themePalettes[theme.preset ?? 'violet'][mode],
    ...Object.fromEntries(
      Object.entries(theme.colors?.[mode] ?? {}).filter(
        ([, value]) => value !== undefined,
      ),
    ),
  };
}

/** Semantic CSS roles automatically resolve with the element's color scheme. */
export function themeCssVariables(theme: {
  preset?: keyof typeof themePresets;
  accent?: string;
  colors?: { light?: Partial<Palette>; dark?: Partial<Palette> };
}): Record<string, string> {
  const light = resolvePalette(theme, 'light'),
    dark = resolvePalette(theme, 'dark');
  const accent = theme.accent ?? themePresets[theme.preset ?? 'violet'];
  const minimum = normalizeThemeName(theme.preset) === 'contrast' ? 7 : 5;
  const readable = (mode: 'light' | 'dark', palette: Palette) =>
    readableAccent(accent, mode, palette, minimum);
  const roles = {
    bg: 'background',
    surface: 'surface',
    subtle: 'subtle',
    border: 'border',
    text: 'text',
    muted: 'muted',
    heading: 'heading',
  } as const;
  const darkAction = readable('dark', dark);
  const darkActionText =
    contrastRatio('#111111', darkAction) >= contrastRatio('#ffffff', darkAction)
      ? '#111111'
      : '#ffffff';
  return {
    ...Object.fromEntries(
      Object.entries(roles).map(([name, role]) => [
        '--' + name,
        `light-dark(${light[role]}, ${dark[role]})`,
      ]),
    ),
    '--accent': accent,
    '--accent-text-light': readable('light', light),
    '--accent-text-dark': readable('dark', dark),
    '--accent-text': `light-dark(${readable('light', light)}, ${readable('dark', dark)})`,
    '--accent-surface': 'color-mix(in srgb, var(--accent) 10%, var(--bg))',
    '--action-bg': `light-dark(${readable('light', light)}, ${darkAction})`,
    '--action-text': `light-dark(#ffffff, ${darkActionText})`,
    '--action-hover': `light-dark(${blend(readable('light', light), '#000000', 0.12)}, ${blend(darkAction, darkActionText === '#ffffff' ? '#000000' : '#ffffff', 0.12)})`,
  };
}
