# State Management

All client state lives in Zustand stores. No Redux, no Context for data (Context only for stable refs like theme).

## Stores

### `useProjectStore`

```ts
interface ProjectStore {
  projects: Project[];
  addProject: (project: Project) => void;
  removeProject: (id: string) => void;
  reorderProjects: (ids: string[]) => void;  // optimistic + invoke
}
```

`reorderProjects` updates local `sort_order` immediately, then calls `invoke('reorder_projects', { ids })` in the background.

### `useSessionStore`

```ts
interface SessionStore {
  sessions: Record<string, Session[]>;  // projectId → Session[]
  activeSessionId: string | null;
  createSession: (session: Session) => void;
  stopSession: (id: string) => void;
  setActiveSession: (id: string | null) => void;
  reorderSessions: (projectId: string, ids: string[]) => void;
}
```

`activeSessionId` drives which session's tabs and terminals are visible. Persisted across renders but not to DB (restored by defaulting to first session on load).

### `useTabStore`

```ts
interface TabStore {
  tabs: Record<string, Tab[]>;          // sessionId → Tab[]
  activeTabId: Record<string, string>;  // sessionId → tabId
  createTab: (tab: Tab) => void;
  closeTab: (tabId: string) => void;    // last tab triggers stopSession flow
  setActiveTab: (sessionId: string, tabId: string) => void;
  renameTab: (tabId: string, title: string) => void;
  reorderTabs: (sessionId: string, ids: string[]) => void;
}
```

`closeTab` checks if the closed tab was the last in its session. If so, it triggers the stop-session confirmation dialog (see `docs/project-session.md`).

### `useTerminalStore`

```ts
interface TerminalStore {
  terminals: Record<string, { term: Terminal; fitAddon: FitAddon }>;
  registerTerminal: (tabId: string, term: Terminal, fitAddon: FitAddon) => void;
  unregisterTerminal: (tabId: string) => void;
  write: (tabId: string, data: Uint8Array) => void;
  fit: (tabId: string) => void;
}
```

This store holds live xterm.js instances — not serializable, never persisted to DB. It's the bridge between Tauri events and terminal instances.

## Startup Hydration

Single `invoke('get_all_data')` returns:

```ts
interface AppData {
  projects: Project[];
  sessions: Session[];   // all sessions, not nested
  tabs: Tab[];           // all tabs, not nested
}
```

Stores hydrate in one pass:
1. `useProjectStore` sets `projects`
2. `useSessionStore` groups sessions by `project_id`
3. `useTabStore` groups tabs by `session_id`
4. PTYs are **not** restored — tabs show a fresh shell on first focus

Default active session: first session of first project (if any).

## Optimistic Updates

Reorder operations (projects, sessions, tabs) update local state immediately without waiting for the Tauri command to complete. On command failure, the store should revert to the previous order — use a snapshot before the update:

```ts
reorderProjects: (ids) => {
  const prev = get().projects;
  set({ projects: reorder(prev, ids) });
  invoke('reorder_projects', { ids }).catch(() => set({ projects: prev }));
}
```
