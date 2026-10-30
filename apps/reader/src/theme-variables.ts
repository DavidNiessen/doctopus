import {
  normalizeThemeName,
  readableAccent,
  resolvePalette,
  themeCssVariables,
} from '@davidniessen/doctopus-contracts';
import type { Theme } from '@davidniessen/doctopus-contracts';
export function readerThemeVariables(theme: Theme) {
  const minimum = normalizeThemeName(theme.preset) === 'contrast' ? 7 : 5;
  const color = (seed: string) =>
    `light-dark(${readableAccent(seed, 'light', resolvePalette(theme, 'light'), minimum)}, ${readableAccent(seed, 'dark', resolvePalette(theme, 'dark'), minimum)})`;
  return {
    ...themeCssVariables(theme),
    '--code-string': color('#b45d34'),
    '--code-key': color('#237da3'),
    '--code-number': color('#b0662d'),
    '--code-keyword': color('#8e65b9'),
    '--code-comment': 'var(--muted)',
    '--code-flag': color('#2787c0'),
    '--success-text': color('#169965'),
    '--error-text': color('#b03642'),
  };
}
