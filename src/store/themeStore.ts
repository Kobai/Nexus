import { create } from 'zustand';

export type Theme = 'light' | 'dark';

const KEY = 'nexus-theme';

function initial(): Theme {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch { /* storage unavailable */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function apply(theme: Theme, animate: boolean) {
  const root = document.documentElement;
  if (animate) {
    root.classList.add('theme-transition');
    window.setTimeout(() => root.classList.remove('theme-transition'), 250);
  }
  root.classList.toggle('dark', theme === 'dark');
}

interface ThemeStore {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

const start = initial();
apply(start, false);

export const useThemeStore = create<ThemeStore>((set, get) => ({
  theme: start,
  setTheme: (theme) => {
    try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
    apply(theme, true);
    set({ theme });
  },
  toggle: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
}));
