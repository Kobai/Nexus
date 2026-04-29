import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { invoke } from '@tauri-apps/api/core';
import { useTerminalStore } from '../store/terminalStore';
import '@xterm/xterm/css/xterm.css';

const cafeTheme = {
  background: '#F9F7F5',
  foreground: '#3E2B1E',
  cursor: '#5D4432',
  cursorAccent: '#F9F7F5',
  selectionBackground: '#D9CFC8',
  black: '#3E2B1E',
  brightBlack: '#9E8E84',
  red: '#DC2626',
  brightRed: '#EF4444',
  green: '#16A34A',
  brightGreen: '#22C55E',
  yellow: '#D97706',
  brightYellow: '#F59E0B',
  blue: '#2563EB',
  brightBlue: '#3B82F6',
  magenta: '#7C3AED',
  brightMagenta: '#8B5CF6',
  cyan: '#0891B2',
  brightCyan: '#06B6D4',
  white: '#E9E3DD',
  brightWhite: '#F9F7F5',
};

interface Props {
  tabId: string;
  sessionId: string;
}

export function XtermTerminal({ tabId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { registerTerminal, unregisterTerminal } = useTerminalStore();

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 12,
      theme: cafeTheme,
      cursorBlink: true,
      allowTransparency: false,
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
        boxSizing: 'border-box',
        background: '#F9F7F5',
      }}
    />
  );
}
