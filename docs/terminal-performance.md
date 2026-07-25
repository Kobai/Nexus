# Terminal Performance Investigation

Findings from a resource-efficiency review of the terminal rendering pipeline (`src/components/XtermTerminal.tsx`, `src/store/terminalStore.ts`, `src/components/MainWindow.tsx`, `src/App.tsx`, `src-tauri/src/lib.rs`). Ranked by expected impact. No fixes applied yet.

## 1. PTY data is shuttled as JSON number-arrays over IPC (both directions)

`src-tauri/src/lib.rs:274-280` — each PTY read (up to 4096 bytes) does:

```rust
app_handle.emit("pty-output", PtyOutputPayload { tab_id, data: buf[..n].to_vec() });
```

`emit` JSON-serializes the payload, so a `Vec<u8>` becomes a JSON array of numbers (`[10,72,101,...]`). For heavy output (build logs, `cat` on a large file, `yes`) this means many events/sec, each doing per-byte JSON stringify/parse plus GC churn on both the Rust and JS sides.

Same pattern on the write path — `XtermTerminal.tsx:61`:

```ts
invoke('pty_write', { tabId, data: Array.from(new TextEncoder().encode(data)) });
```

Converts a compact `Uint8Array` into a plain number array just to satisfy JSON serialization. Matters most on large pastes.

**Fix direction:** use a Tauri v2 `Channel` (binary-friendly) instead of `emit`/`invoke` with JSON arrays, or at least base64-encode. Also consider coalescing rapid reads into fewer, larger emits.

## 2. No GPU-accelerated renderer

Only `@xterm/addon-fit` and `@xterm/addon-web-links` are installed (`package.json`); there's no `@xterm/addon-webgl` (or canvas addon). xterm.js falls back to the DOM renderer, the most CPU-expensive option, especially with scrollback-heavy output across multiple concurrently-mounted terminals.

## 3. All tabs in the active session stay fully mounted, not just the visible one

`MainWindow.tsx:66-85` — the comment says "only render the active session's terminals" (true across sessions), but within one session every tab gets a live `Terminal` instance (DOM tree, cursor-blink timer, ResizeObserver) even when hidden via `visibility: hidden`. Cost scales with tab count regardless of which tab is focused.

## 4. ResizeObserver fires for every mounted tab, including hidden ones

`XtermTerminal.tsx:64-68` — hidden tab containers still have `position: absolute; inset: 0`, so they resize along with the visible one on any window/pane resize. Every tab calls `fitAddon.fit()` + `invoke('pty_resize', ...)` — N redundant IPC calls per resize event for N open tabs, not just the active one. No debouncing either, so a drag-resize fires this repeatedly per frame.

## 5. `cursorBlink: true` always on

Includes background/hidden tabs — wastes a blink timer/repaint cycle on terminals the user can't see.

## 6. Minor allocation churn

`new TextEncoder()` is constructed fresh inside `term.onData` on every keystroke (`XtermTerminal.tsx:60-61`) instead of being created once and reused.

---

**Priority:** #1 (IPC serialization) and #2 (WebGL renderer) affect every terminal all the time — highest leverage. #3/#4 matter more as tab count grows.
