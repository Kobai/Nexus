import { create } from 'zustand';
import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';

interface TerminalEntry {
  term: Terminal;
  fitAddon: FitAddon;
}

interface TerminalStore {
  terminals: Record<string, TerminalEntry>;
  pendingOutput: Record<string, Uint8Array[]>;
  registerTerminal: (tabId: string, term: Terminal, fitAddon: FitAddon) => void;
  unregisterTerminal: (tabId: string) => void;
  write: (tabId: string, data: Uint8Array) => void;
  fit: (tabId: string) => void;
}

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  terminals: {},
  pendingOutput: {},
  registerTerminal: (tabId, term, fitAddon) => {
    const pending = get().pendingOutput[tabId];
    if (pending?.length) {
      for (const chunk of pending) term.write(chunk);
    }
    set((s) => {
      const { [tabId]: _, ...restPending } = s.pendingOutput;
      return {
        terminals: { ...s.terminals, [tabId]: { term, fitAddon } },
        pendingOutput: restPending,
      };
    });
  },
  unregisterTerminal: (tabId) =>
    set((s) => {
      const { [tabId]: removed, ...rest } = s.terminals;
      removed?.term.dispose();
      const { [tabId]: _p, ...restPending } = s.pendingOutput;
      return { terminals: rest, pendingOutput: restPending };
    }),
  write: (tabId, data) => {
    const entry = get().terminals[tabId];
    if (entry) {
      entry.term.write(data);
    } else {
      set((s) => ({
        pendingOutput: {
          ...s.pendingOutput,
          [tabId]: [...(s.pendingOutput[tabId] ?? []), data],
        },
      }));
    }
  },
  fit: (tabId) => {
    const entry = get().terminals[tabId];
    if (entry) entry.fitAddon.fit();
  },
}));
