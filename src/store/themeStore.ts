import { create } from 'zustand';

interface ThemeState {
  dark: boolean;
  toggle: () => void;
}

const stored = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

export const useThemeStore = create<ThemeState>((set, get) => ({
  dark: stored,
  toggle: () => {
    const next = !get().dark;
    document.documentElement.classList.toggle('dark', next);
    set({ dark: next });
  },
}));
