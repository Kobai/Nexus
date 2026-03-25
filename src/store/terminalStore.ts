import { create } from 'zustand';
import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';

interface TerminalEntry {
  term: Terminal;
  fitAddon: FitAddon;
}

interface TerminalStore {
  terminals: Record<string, TerminalEntry>;
  registerTerminal: (tabId: string, term: Terminal, fitAddon: FitAddon) => void;
  unregisterTerminal: (tabId: string) => void;
  write: (tabId: string, data: Uint8Array) => void;
  fit: (tabId: string) => void;
}

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  terminals: {},
  registerTerminal: (tabId, term, fitAddon) =>
    set((s) => ({ terminals: { ...s.terminals, [tabId]: { term, fitAddon } } })),
  unregisterTerminal: (tabId) =>
    set((s) => {
      const { [tabId]: removed, ...rest } = s.terminals;
      removed?.term.dispose();
      return { terminals: rest };
    }),
  write: (tabId, data) => {
    const entry = get().terminals[tabId];
    if (entry) entry.term.write(data);
  },
  fit: (tabId) => {
    const entry = get().terminals[tabId];
    if (entry) entry.fitAddon.fit();
  },
}));
