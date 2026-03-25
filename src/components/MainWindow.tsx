import { useSessionStore } from '../store/sessionStore';
import { useTabStore } from '../store/tabStore';
import { TabBar } from './TabBar';
import { XtermTerminal } from './XtermTerminal';

export function MainWindow() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const allTabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);

  const activeTabs = activeSessionId ? (allTabs[activeSessionId] ?? []) : [];
  const hasAnySessions = Object.values(allTabs).some((tabs) => tabs.length > 0);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {activeSessionId && <TabBar sessionId={activeSessionId} />}

      <div className="flex-1 relative min-h-0">
        {/* Render all terminals across all sessions — hidden when not active to preserve scrollback */}
        {Object.entries(allTabs).map(([sessionId, tabs]) =>
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
                  isActive={visible}
                />
              </div>
            );
          })
        )}

        {!activeSessionId && !hasAnySessions && (
          <div className="flex items-center justify-center h-full text-[#555]">
            <p>Select or create a session to get started.</p>
          </div>
        )}

        {activeSessionId && activeTabs.length === 0 && (
          <div className="flex items-center justify-center h-full text-[#555]">
            <p>No terminals open.</p>
          </div>
        )}
      </div>
    </div>
  );
}
