import { createContext, useEffect, useState } from 'react';
import { resolvePalette, themePresets } from '@davidniessen/doctopus-contracts';
import type { Palette } from '@davidniessen/doctopus-contracts';
import {
  defaultReaderPreferences,
  parseReaderPreferences,
  readerPreferencesKey,
  legacyReaderPreferencesKey,
} from './reader-preferences.js';

export const EditorThemeContext = createContext<{
  palette: Palette;
  accent: string;
  mode: 'light' | 'dark';
}>({
  palette: resolvePalette({}, 'light'),
  accent: themePresets.mint,
  mode: 'light',
});
export function useReaderPreferences(
  basePath: string,
  defaults?: Partial<import('./reader-preferences.js').ReaderPreferences>,
) {
  const initial = () => ({ ...defaultReaderPreferences(), ...defaults });
  const [preferences, setPreferences] = useState(initial);
  const [ready, setReady] = useState(false);
  const [stored, setStored] = useState(true);
  const [systemDark, setSystemDark] = useState(false);
  const key = readerPreferencesKey(basePath);
  const legacyKey = legacyReaderPreferencesKey(basePath);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const syncSystem = () => setSystemDark(media.matches);
    syncSystem();
    media.addEventListener('change', syncSystem);
    const read = () => {
      try {
        const source =
          localStorage.getItem(key) ?? localStorage.getItem(legacyKey);
        const next = source ? parseReaderPreferences(source) : initial();
        if (!source) {
          const legacy = localStorage.getItem('doctopus-theme');
          if (legacy === 'light' || legacy === 'dark') next.mode = legacy;
        }
        setPreferences(next);
      } catch {
        setStored(false);
      }
      setReady(true);
    };
    read();
    const syncStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) read();
    };
    window.addEventListener('storage', syncStorage);
    return () => {
      media.removeEventListener('change', syncSystem);
      window.removeEventListener('storage', syncStorage);
    };
  }, [key, legacyKey]);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(key, JSON.stringify(preferences));
      localStorage.removeItem(legacyKey);
      setStored(true);
    } catch {
      setStored(false);
    }
  }, [preferences, key, legacyKey, ready]);
  const mode =
    preferences.mode === 'system'
      ? systemDark
        ? 'dark'
        : 'light'
      : preferences.mode;
  return { preferences, setPreferences, mode, stored, ready };
}
