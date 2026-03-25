import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { Tab } from '../types';

interface TabStore {
  tabs: Record<string, Tab[]>;
  activeTabId: Record<string, string>;
  setTabs: (tabs: Tab[]) => void;
  addTab: (tab: Tab) => void;
  removeTab: (tabId: string) => void;
  setActiveTab: (sessionId: string, tabId: string) => void;
  renameTab: (tabId: string, title: string) => void;
  reorderTabs: (sessionId: string, ids: string[]) => void;
  getSessionIdForTab: (tabId: string) => string | undefined;
}

export const useTabStore = create<TabStore>((set, get) => ({
  tabs: {},
  activeTabId: {},
  setTabs: (tabs) => {
    const grouped: Record<string, Tab[]> = {};
    for (const t of tabs) {
      if (!grouped[t.session_id]) grouped[t.session_id] = [];
      grouped[t.session_id].push(t);
    }
    const activeTabId: Record<string, string> = {};
    for (const [sid, list] of Object.entries(grouped)) {
      if (list.length > 0) activeTabId[sid] = list[0].id;
    }
    set({ tabs: grouped, activeTabId });
  },
  addTab: (tab) =>
    set((s) => ({
      tabs: {
        ...s.tabs,
        [tab.session_id]: [...(s.tabs[tab.session_id] || []), tab],
      },
      activeTabId: { ...s.activeTabId, [tab.session_id]: tab.id },
    })),
  removeTab: (tabId) =>
    set((s) => {
      const next: Record<string, Tab[]> = {};
      const nextActive = { ...s.activeTabId };
      for (const [sid, list] of Object.entries(s.tabs)) {
        const filtered = list.filter((t) => t.id !== tabId);
        next[sid] = filtered;
        if (nextActive[sid] === tabId) {
          nextActive[sid] = filtered[filtered.length - 1]?.id || '';
        }
      }
      return { tabs: next, activeTabId: nextActive };
    }),
  setActiveTab: (sessionId, tabId) =>
    set((s) => ({ activeTabId: { ...s.activeTabId, [sessionId]: tabId } })),
  renameTab: (tabId, title) =>
    set((s) => {
      const next: Record<string, Tab[]> = {};
      for (const [sid, list] of Object.entries(s.tabs)) {
        next[sid] = list.map((t) => (t.id === tabId ? { ...t, title } : t));
      }
      return { tabs: next };
    }),
  reorderTabs: (sessionId, ids) => {
    const prev = get().tabs;
    const list = prev[sessionId] || [];
    const reordered = ids
      .map((id, i) => {
        const t = list.find((x) => x.id === id);
        return t ? { ...t, sort_order: i } : null;
      })
      .filter(Boolean) as Tab[];
    set({ tabs: { ...prev, [sessionId]: reordered } });
    invoke('reorder_tabs', { ids }).catch(() => set({ tabs: prev }));
  },
  getSessionIdForTab: (tabId) => {
    const { tabs } = get();
    for (const [sid, list] of Object.entries(tabs)) {
      if (list.find((t) => t.id === tabId)) return sid;
    }
    return undefined;
  },
}));
