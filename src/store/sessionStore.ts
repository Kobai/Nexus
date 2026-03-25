import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { Session } from '../types';

interface SessionStore {
  sessions: Record<string, Session[]>;
  activeSessionId: string | null;
  setSessions: (sessions: Session[]) => void;
  addSession: (session: Session) => void;
  removeSession: (id: string) => void;
  setActiveSession: (id: string | null) => void;
  reorderSessions: (projectId: string, ids: string[]) => void;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: {},
  activeSessionId: null,
  setSessions: (sessions) => {
    const grouped: Record<string, Session[]> = {};
    for (const s of sessions) {
      if (!grouped[s.project_id]) grouped[s.project_id] = [];
      grouped[s.project_id].push(s);
    }
    set({ sessions: grouped });
  },
  addSession: (session) =>
    set((s) => ({
      sessions: {
        ...s.sessions,
        [session.project_id]: [
          ...(s.sessions[session.project_id] || []),
          session,
        ],
      },
    })),
  removeSession: (id) =>
    set((s) => {
      const next: Record<string, Session[]> = {};
      for (const [pid, list] of Object.entries(s.sessions)) {
        next[pid] = list.filter((sess) => sess.id !== id);
      }
      const activeSessionId =
        s.activeSessionId === id ? null : s.activeSessionId;
      return { sessions: next, activeSessionId };
    }),
  setActiveSession: (id) => set({ activeSessionId: id }),
  reorderSessions: (projectId, ids) => {
    const prev = get().sessions;
    const list = prev[projectId] || [];
    const reordered = ids
      .map((id, i) => {
        const s = list.find((x) => x.id === id);
        return s ? { ...s, sort_order: i } : null;
      })
      .filter(Boolean) as Session[];
    set({ sessions: { ...prev, [projectId]: reordered } });
    invoke('reorder_sessions', { ids }).catch(() => set({ sessions: prev }));
  },
}));
