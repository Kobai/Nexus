import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { invoke } from '@tauri-apps/api/core';
import { useTerminalStore } from '../store/terminalStore';
import '@xterm/xterm/css/xterm.css';

const darkTheme = {
  background: '#0d1117',
  foreground: '#e2e8f0',
  cursor: '#e2e8f0',
  cursorAccent: '#0d1117',
  black: '#0d1117',
  brightBlack: '#4a5a72',
  red: '#cd3131',
  brightRed: '#f14c4c',
  green: '#0dbc79',
  brightGreen: '#23d18b',
  yellow: '#e5e510',
  brightYellow: '#f5f543',
  blue: '#2472c8',
  brightBlue: '#3b8eea',
  magenta: '#bc3fbc',
  brightMagenta: '#d670d6',
  cyan: '#11a8cd',
  brightCyan: '#29b8db',
  white: '#eaf0f8',
  brightWhite: '#eaf0f8',
};

interface Props {
  tabId: string;
  sessionId: string;
  isActive: boolean;
}

export function XtermTerminal({ tabId, isActive }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { registerTerminal, unregisterTerminal } = useTerminalStore();

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      fontFamily: 'monospace',
      fontSize: 11,
      theme: darkTheme,
      cursorBlink: true,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    fitAddon.fit();

    invoke('pty_resize', { tabId, cols: term.cols, rows: term.rows });

    term.onData((data) => {
      invoke('pty_write', { tabId, data: Array.from(new TextEncoder().encode(data)) });
    });

    const observer = new ResizeObserver(() => {
      fitAddon.fit();
      invoke('pty_resize', { tabId, cols: term.cols, rows: term.rows });
    });
    observer.observe(containerRef.current);

    registerTerminal(tabId, term, fitAddon);

    return () => {
      observer.disconnect();
      unregisterTerminal(tabId);
    };
  }, [tabId]);


  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        height: '100%',
        width: '100%',
        padding: '4px',
        boxSizing: 'border-box'
      }}
    />
  );
}
