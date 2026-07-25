import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useProjectStore } from './store/projectStore';
import { useSessionStore } from './store/sessionStore';
import { useTabStore } from './store/tabStore';
import { useTerminalStore } from './store/terminalStore';
import { Sidebar } from './components/Sidebar';
import { MainWindow } from './components/MainWindow';
import { RightSidebar } from './components/RightSidebar';
import { AppData } from './types';

export default function App() {
  const { setProjects } = useProjectStore();
  const { setSessions, setActiveSession } = useSessionStore();
  const { setTabs } = useTabStore();
  const terminalStore = useTerminalStore();

  useEffect(() => {
    // Hydrate on mount
    invoke<AppData>('get_all_data').then((data) => {
      setProjects(data.projects);
      setSessions(data.sessions);
      setTabs(data.tabs);

      // Default active session: first session of first project
      if (data.projects.length > 0) {
        const firstProjectSessions = data.sessions.filter(
          (s) => s.project_id === data.projects[0].id,
        );
        if (firstProjectSessions.length > 0) {
          setActiveSession(firstProjectSessions[0].id);
        }
      }

      // Re-spawn PTYs for tabs that persisted across restart
      if (data.tabs.length > 0) {
        invoke('restore_ptys').catch(() => {});
      }
    });

    // Global PTY event listeners
    let unlistenOutput: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;

    listen<{ tab_id: string; data: number[] }>('pty-output', ({ payload }) => {
      terminalStore.write(payload.tab_id, new Uint8Array(payload.data));
    }).then((f) => { unlistenOutput = f; });

    listen<{ tab_id: string }>('pty-exit', ({ payload }) => {
      const { unregisterTerminal } = useTerminalStore.getState();
      const { removeTab, getSessionIdForTab, tabs } = useTabStore.getState();
      const { removeSession } = useSessionStore.getState();

      const sessionId = getSessionIdForTab(payload.tab_id);
      unregisterTerminal(payload.tab_id);

      invoke('close_tab', { tabId: payload.tab_id }).catch(() => {});
      removeTab(payload.tab_id);

      // Check if this was the last tab in the session
      if (sessionId) {
        const remainingTabs = (tabs[sessionId] || []).filter(
          (t) => t.id !== payload.tab_id,
        );
        if (remainingTabs.length === 0) {
          invoke('stop_session', { id: sessionId }).catch(() => {});
          removeSession(sessionId);
        }
      }
    }).then((f) => { unlistenExit = f; });

    return () => {
      unlistenOutput?.();
      unlistenExit?.();
    };
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-cafe-surface">
      <Sidebar />
      <MainWindow />
      <RightSidebar />
    </div>
  );
}
