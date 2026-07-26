import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { invoke } from '@tauri-apps/api/core';
import { useTerminalStore } from '../store/terminalStore';
import { bytesToBase64 } from '../utils/base64';
import '@xterm/xterm/css/xterm.css';

const encoder = new TextEncoder();

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
  white: '#7A6B61',
  brightWhite: '#5D4432',
};

interface Props {
  tabId: string;
  sessionId: string;
  visible: boolean;
}

export function XtermTerminal({ tabId, visible }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { registerTerminal, unregisterTerminal } = useTerminalStore();
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const visibleRef = useRef(visible);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 12,
      theme: cafeTheme,
      cursorBlink: visibleRef.current,
      allowTransparency: false,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());

    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      // WebGL unavailable in this webview — xterm falls back to its DOM renderer.
    }

    term.open(containerRef.current);
    fitAddon.fit();

    invoke('pty_resize', { tabId, cols: term.cols, rows: term.rows });

    term.onData((data) => {
      invoke('pty_write', { tabId, data: bytesToBase64(encoder.encode(data)) });
    });

    const observer = new ResizeObserver(() => {
      // Hidden tabs (background sessions, background tabs within a session)
      // still get layout via visibility:hidden, so this would otherwise fire
      // — and re-invoke pty_resize — for every mounted terminal on every resize.
      if (!visibleRef.current) return;
      fitAddon.fit();
      invoke('pty_resize', { tabId, cols: term.cols, rows: term.rows });
    });
    observer.observe(containerRef.current);

    termRef.current = term;
    fitAddonRef.current = fitAddon;
    registerTerminal(tabId, term, fitAddon);

    return () => {
      observer.disconnect();
      unregisterTerminal(tabId);
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [tabId]);

  useEffect(() => {
    visibleRef.current = visible;
    const term = termRef.current;
    if (!term) return;
    term.options.cursorBlink = visible;
    if (visible) {
      // Size may be stale if this tab was hidden while its container resized.
      fitAddonRef.current?.fit();
      invoke('pty_resize', { tabId, cols: term.cols, rows: term.rows });
    }
  }, [visible, tabId]);


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
