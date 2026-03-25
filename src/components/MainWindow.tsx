import { useSessionStore } from '../store/sessionStore';
import { useTabStore } from '../store/tabStore';
import { TabBar } from './TabBar';
import { XtermTerminal } from './XtermTerminal';
import type { Tab } from '../types';

const EMPTY_TABS: Tab[] = [];

export function MainWindow() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const tabs = useTabStore((s) => (activeSessionId ? s.tabs[activeSessionId] ?? EMPTY_TABS : EMPTY_TABS));
  const activeTabId = useTabStore((s) => (activeSessionId ? s.activeTabId[activeSessionId] ?? '' : ''));

  if (!activeSessionId) {
    return (
      <div className="flex-1 flex items-center justify-center text-[#555]">
        <p>Select or create a session to get started.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <TabBar sessionId={activeSessionId} />
      <div className="flex-1 relative min-h-0">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            style={{
              position: 'absolute',
              inset: 0,
              display: tab.id === activeTabId ? 'flex' : 'none',
            }}
          >
            <XtermTerminal
              tabId={tab.id}
              sessionId={activeSessionId}
              isActive={tab.id === activeTabId}
            />
          </div>
        ))}
        {tabs.length === 0 && (
          <div className="flex items-center justify-center h-full text-[#555]">
            <p>No terminals open.</p>
          </div>
        )}
      </div>
    </div>
  );
}
