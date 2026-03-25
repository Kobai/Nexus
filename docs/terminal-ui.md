# Terminal UI

## xterm.js Addons

| Addon | Purpose |
|-|-|
| `@xterm/addon-fit` | Resizes terminal to fill its container |
| `@xterm/addon-web-links` | Makes URLs in terminal output clickable |

## Terminal Instance Lifecycle

Each tab gets exactly one `Terminal` instance, created on first mount and stored in `useTerminalStore` keyed by `tab_id`.

**Creation:**
```ts
const term = new Terminal({ fontFamily: 'monospace', theme: darkTheme });
const fitAddon = new FitAddon();
term.loadAddon(fitAddon);
term.loadAddon(new WebLinksAddon());
term.open(containerRef.current);
fitAddon.fit();
invoke('pty_resize', { tabId, cols: term.cols, rows: term.rows });
```

**Input routing:**
```ts
term.onData((data) => invoke('pty_write', { tabId, data }));
```

**Resize handling:**
```ts
const observer = new ResizeObserver(() => {
  fitAddon.fit();
  invoke('pty_resize', { tabId, cols: term.cols, rows: term.rows });
});
observer.observe(containerRef.current);
```

**Tab switching:**
Inactive tabs are hidden with `display: none` — the DOM node and xterm.js instance stay mounted, preserving scroll history and buffer state. On becoming visible:
```ts
requestAnimationFrame(() => fitAddon.fit());
```

**Teardown:**
When a tab is closed, `term.dispose()` is called and the instance is removed from `useTerminalStore`.

## Global Event Listeners

Set up once at app mount (e.g., in a top-level `useEffect`):

```ts
const unlistenOutput = await listen('pty-output', ({ payload }) => {
  terminalStore.write(payload.tab_id, new Uint8Array(payload.data));
});

const unlistenExit = await listen('pty-exit', ({ payload }) => {
  tabStore.closeTab(payload.tab_id);
});
```

Clean up on app unmount.

## Tab Bar

- Rendered above the terminal pane for the active session
- Each tab: draggable handle + title + `×` close button
- Title is editable on double-click (inline `<input>`, blur/Enter to commit via `rename_tab` command)
- `+` button at the right end calls `create_tab` for the current session
- Drag-and-drop reordering via `@dnd-kit/core` `SortableContext` (horizontal axis)
- Active tab highlighted with a bottom border or background change

## Dark Theme

```ts
const darkTheme = {
  background: '#1a1a1a',
  foreground: '#d4d4d4',
  cursor: '#d4d4d4',
  black: '#1a1a1a',
  // ... standard 16-color palette
};
```

Terminal uses the same background as the surrounding UI to avoid visible borders.
