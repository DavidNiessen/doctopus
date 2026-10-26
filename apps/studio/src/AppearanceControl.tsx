import {
  themeCssVariables,
  themePresets,
} from '@davidniessen/doctopus-contracts';
import { useEffect, useLayoutEffect, useState } from 'react';

type Appearance = 'system' | 'light' | 'dark';
const themeKey = 'doctopus-studio-theme';
type ThemeName = keyof typeof themePresets;
const themeFrom = (value: string | null): ThemeName =>
  value && Object.hasOwn(themePresets, value) ? (value as ThemeName) : 'violet';
const storageKey = 'doctopus-studio-appearance';
function appearanceFrom(value: string | null): Appearance {
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function AppearanceControl() {
  const [appearance, setAppearance] = useState<Appearance>(() => {
    try {
      return appearanceFrom(localStorage.getItem(storageKey));
    } catch {
      return 'system';
    }
  });
  const [theme, setTheme] = useState<ThemeName>(() => {
    try {
      return themeFrom(localStorage.getItem(themeKey));
    } catch {
      return 'violet';
    }
  });
  useLayoutEffect(() => {
    for (const [name, value] of Object.entries(
      themeCssVariables({ preset: theme }),
    ))
      document.documentElement.style.setProperty(name, value);
  }, [theme]);
  useLayoutEffect(() => {
    document.documentElement.dataset.appearance = appearance;
  }, [appearance]);
  useEffect(() => {
    const synchronize = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null)
        setAppearance(appearanceFrom(event.newValue));
      if (event.key === themeKey || event.key === null)
        setTheme(themeFrom(event.newValue));
    };
    window.addEventListener('storage', synchronize);
    return () => window.removeEventListener('storage', synchronize);
  }, []);
  return (
    <>
      <label className="studio-appearance">
        <span>Theme</span>
        <select
          value={theme}
          onChange={(event) => {
            const next = themeFrom(event.target.value);
            setTheme(next);
            try {
              localStorage.setItem(themeKey, next);
            } catch {
              /* In-memory preferences remain usable. */
            }
          }}
        >
          <option value="violet">Violet</option>
          <option value="ocean">Ocean</option>
          <option value="mint">Forest</option>
          <option value="neutral">Graphite</option>
        </select>
      </label>
      <label className="studio-appearance">
        <span>Appearance</span>
        <select
          value={appearance}
          onChange={(event) => {
            const next = appearanceFrom(event.target.value);
            setAppearance(next);
            try {
              localStorage.setItem(storageKey, next);
            } catch {
              /* Appearance remains usable when storage is unavailable. */
            }
          }}
        >
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
    </>
  );
}
