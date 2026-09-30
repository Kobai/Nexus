import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { Search, Terminal, Plus, Moon, Sun, CornerDownLeft } from 'lucide-react';
import { useProjectStore } from '../store/projectStore';
import { useSessionStore } from '../store/sessionStore';
import { useTabStore } from '../store/tabStore';
import { useThemeStore } from '../store/themeStore';
import { Tab } from '../types';

interface Command {
  id: string;
  label: string;
  hint?: string;
  shortcut?: string;
  icon: React.ReactNode;
  run: () => void;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const projects = useProjectStore((s) => s.projects);
  const sessions = useSessionStore((s) => s.sessions);
  const theme = useThemeStore((s) => s.theme);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey && e.key === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [];
    const active = useSessionStore.getState().activeSessionId;
    if (active) {
      list.push({
        id: 'new-tab',
        label: 'New terminal tab',
        shortcut: '⌘T',
        icon: <Plus size={14} />,
        run: () =>
          invoke<Tab>('create_tab', { sessionId: active })
            .then((tab) => useTabStore.getState().addTab(tab))
            .catch(() => {}),
      });
    }
    list.push({
      id: 'toggle-theme',
      label: theme === 'dark' ? 'Switch to light theme' : 'Switch to espresso theme',
      icon: theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />,
      run: () => useThemeStore.getState().toggle(),
    });
    for (const p of projects) {
      for (const s of sessions[p.id] ?? []) {
        list.push({
          id: `session-${s.id}`,
          label: s.name,
          hint: p.name,
          icon: <Terminal size={14} />,
          run: () => useSessionStore.getState().setActiveSession(s.id),
        });
      }
    }
    return list;
  }, [open, projects, sessions, theme]);

  const filtered = commands.filter((c) =>
    `${c.label} ${c.hint ?? ''}`.toLowerCase().includes(query.toLowerCase()),
  );

  function run(c: Command | undefined) {
    if (!c) return;
    setOpen(false);
    c.run();
  }

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-cafe-text/30 backdrop-blur-sm animate-fade-in"
      onMouseDown={() => setOpen(false)}
    >
      <div
        className="w-[520px] max-w-[90vw] bg-cafe-surface border border-cafe-border rounded-xl shadow-cafe-lg overflow-hidden animate-scale-in"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-cafe-border">
          <Search size={14} className="text-cafe-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setIndex(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(i + 1, filtered.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
              if (e.key === 'Enter') run(filtered[index]);
            }}
            placeholder="Jump to a session or run a command…"
            className="flex-1 bg-transparent text-sm text-cafe-text placeholder:text-cafe-muted outline-none"
            spellCheck={false}
            autoCorrect="off"
          />
          <span className="kbd">esc</span>
        </div>
        <div className="max-h-[320px] overflow-y-auto p-1.5">
          {filtered.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-cafe-muted">No matches</p>
          )}
          {filtered.map((c, i) => (
            <button
              key={c.id}
              onMouseEnter={() => setIndex(i)}
              onClick={() => run(c)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-left transition-colors ${
                i === index ? 'bg-cafe-primary/10 text-cafe-primary' : 'text-cafe-text'
              }`}
            >
              <span className="text-cafe-muted">{c.icon}</span>
              <span className="flex-1 truncate font-medium">{c.label}</span>
              {c.hint && <span className="text-cafe-muted truncate">{c.hint}</span>}
              {c.shortcut && <span className="kbd">{c.shortcut}</span>}
              {i === index && !c.shortcut && <CornerDownLeft size={12} className="text-cafe-muted" />}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
