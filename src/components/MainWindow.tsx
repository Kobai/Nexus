import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useSessionStore } from '../store/sessionStore';
import { useTabStore } from '../store/tabStore';
import { useTerminalStore } from '../store/terminalStore';
import { TabBar } from './TabBar';
import { XtermTerminal } from './XtermTerminal';
import { EmptyState } from './EmptyState';
import { Coffee, TerminalSquare } from 'lucide-react';
import { Tab } from '../types';

export function MainWindow() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const allTabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);

  const activeTabs = activeSessionId ? (allTabs[activeSessionId] ?? []) : [];
  const setActiveTab = useTabStore((s) => s.setActiveTab);

  const activeTabsRef = useRef(activeTabs);
  useEffect(() => { activeTabsRef.current = activeTabs; }, [activeTabs]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!e.metaKey || !activeSessionId) return;

      // cmd+w — close active tab
      if (e.key === 'w') {
        e.preventDefault();
        const { activeTabId, removeTab } = useTabStore.getState();
        const tabId = activeTabId[activeSessionId];
        if (!tabId) return;
        useTerminalStore.getState().unregisterTerminal(tabId);
        invoke('close_tab', { tabId }).catch(() => {});
        removeTab(tabId);
        return;
      }

      // cmd+t — new tab
      if (e.key === 't') {
        e.preventDefault();
        invoke<Tab>('create_tab', { sessionId: activeSessionId })
          .then((tab) => useTabStore.getState().addTab(tab))
          .catch(() => {});
        return;
      }

      // cmd+1–9 — switch to tab by index
      const num = parseInt(e.key);
      if (num >= 1 && num <= 9) {
        const tab = activeTabsRef.current[num - 1];
        if (tab) {
          e.preventDefault();
          setActiveTab(activeSessionId, tab.id);
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeSessionId, setActiveTab]);

  const hasAnySessions = Object.values(allTabs).some((tabs) => tabs.length > 0);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {activeSessionId && <TabBar sessionId={activeSessionId} />}

      <div className="flex-1 relative min-h-0">
        {/* Render terminals for every session, not just the active one, so switching
            projects only hides them instead of unmounting (and disposing) xterm. */}
        {Object.entries(allTabs).flatMap(([sessionId, tabs]) =>
          tabs.map((tab) => {
            const visible = sessionId === activeSessionId && activeTabId[sessionId] === tab.id;
            return (
              <div
                key={tab.id}
                style={{
                  position: 'absolute',
                  inset: 0,
                  visibility: visible ? 'visible' : 'hidden',
                }}
              >
                <XtermTerminal
                  tabId={tab.id}
                  sessionId={sessionId}
                  visible={visible}
                />
              </div>
            );
          })
        )}

        {!activeSessionId && !hasAnySessions && (
          <EmptyState
            icon={Coffee}
            title="No sessions yet"
            hint="Add a project and create a session to get started."
          />
        )}

        {activeSessionId && activeTabs.length === 0 && (
          <EmptyState
            icon={TerminalSquare}
            title="No terminals open"
            hint="Open a new terminal in this session."
            action={
              <span className="text-cafe-muted text-xs">
                Press <span className="kbd">⌘T</span>
              </span>
            }
          />
        )}
      </div>
    </div>
  );
}
