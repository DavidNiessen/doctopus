import { useEffect, useLayoutEffect, useState } from 'react';

type Appearance = 'system' | 'light' | 'dark';
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
  useLayoutEffect(() => {
    document.documentElement.dataset.appearance = appearance;
  }, [appearance]);
  useEffect(() => {
    const synchronize = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null)
        setAppearance(appearanceFrom(event.newValue));
    };
    window.addEventListener('storage', synchronize);
    return () => window.removeEventListener('storage', synchronize);
  }, []);
  return (
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
  );
}
