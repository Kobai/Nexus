import { create } from 'zustand';

interface AttentionStore {
  tabs: Record<string, boolean>;
  markAttention: (tabId: string) => void;
  clearAttention: (tabId: string) => void;
}

export const useAttentionStore = create<AttentionStore>((set) => ({
  tabs: {},
  markAttention: (tabId) =>
    set((s) => (s.tabs[tabId] ? s : { tabs: { ...s.tabs, [tabId]: true } })),
  clearAttention: (tabId) =>
    set((s) => {
      if (!s.tabs[tabId]) return s;
      const { [tabId]: _, ...rest } = s.tabs;
      return { tabs: rest };
    }),
}));
