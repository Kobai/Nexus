import { create } from 'zustand';

/** Tabs that produced PTY output within the last RUNNING_WINDOW_MS. */
const RUNNING_WINDOW_MS = 1500;
const timers: Record<string, number> = {};

interface ActivityStore {
  running: Record<string, boolean>;
  noteOutput: (tabId: string) => void;
  forget: (tabId: string) => void;
}

export const useActivityStore = create<ActivityStore>((set) => ({
  running: {},
  noteOutput: (tabId) => {
    window.clearTimeout(timers[tabId]);
    timers[tabId] = window.setTimeout(() => {
      delete timers[tabId];
      set((s) => {
        if (!s.running[tabId]) return s;
        const { [tabId]: _, ...rest } = s.running;
        return { running: rest };
      });
    }, RUNNING_WINDOW_MS);
    set((s) => (s.running[tabId] ? s : { running: { ...s.running, [tabId]: true } }));
  },
  forget: (tabId) => {
    window.clearTimeout(timers[tabId]);
    delete timers[tabId];
    set((s) => {
      if (!s.running[tabId]) return s;
      const { [tabId]: _, ...rest } = s.running;
      return { running: rest };
    });
  },
}));
