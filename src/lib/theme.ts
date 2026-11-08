import { useEffect, useState } from 'react';

// Light / dark theme. index.html applies the saved choice before first paint;
// this module keeps it in sync afterwards (toggle, OS changes, other tabs).
export type ThemeChoice = 'light' | 'dark' | 'system';
export type Theme = 'light' | 'dark';

const KEY = 'agentdom.theme';
const META = { light: '#f6eee2', dark: '#17110d' } as const;
const listeners = new Set<(t: Theme) => void>();

function mq(): MediaQueryList | null {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)');
  } catch {
    return null;
  }
}

export function readChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function systemTheme(): Theme {
  return mq()?.matches ? 'dark' : 'light';
}

export function resolve(choice: ThemeChoice = readChoice()): Theme {
  return choice === 'system' ? systemTheme() : choice;
}

export function currentTheme(): Theme {
  const d = typeof document !== 'undefined' ? document.documentElement.dataset.theme : undefined;
  return d === 'dark' || d === 'light' ? d : resolve();
}

function apply(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', META[theme]);
  listeners.forEach((fn) => fn(theme));
}

export function setChoice(choice: ThemeChoice) {
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    /* storage blocked: still switch for this page view */
  }
  apply(resolve(choice));
}

// Flip to the other theme. If that matches the OS preference, go back to following the OS.
export function toggleTheme() {
  const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
  setChoice(next === systemTheme() ? 'system' : next);
}

let wired = false;
function wire() {
  if (wired || typeof window === 'undefined') return;
  wired = true;
  const m = mq();
  const onOs = () => {
    if (readChoice() === 'system') apply(systemTheme());
  };
  try {
    m?.addEventListener('change', onOs);
  } catch {
    /* very old Safari: no live OS switching */
  }
  window.addEventListener('storage', (e) => {
    if (e.key === KEY || e.key === null) apply(resolve());
  });
}

export function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(() => (typeof document === 'undefined' ? 'light' : currentTheme()));
  useEffect(() => {
    wire();
    listeners.add(setTheme);
    setTheme(currentTheme());
    return () => {
      listeners.delete(setTheme);
    };
  }, []);
  return theme;
}
