# Terminal Performance Investigation

Findings from a resource-efficiency review of the terminal rendering pipeline (`src/components/XtermTerminal.tsx`, `src/store/terminalStore.ts`, `src/components/MainWindow.tsx`, `src/App.tsx`, `src-tauri/src/lib.rs`). Ranked by expected impact. Status per item updated below — most have since been fixed; see `docs/performance-audit.md` for the verification pass and newer findings elsewhere in the app.

## 1. PTY data is shuttled as JSON number-arrays over IPC (both directions) — **fixed**

Originally `src-tauri/src/lib.rs:274-280` emitted `Vec<u8>` PTY output straight through `emit`, which JSON-serialized it as a number array (`[10,72,101,...]`) — per-byte stringify/parse plus GC churn on both sides for heavy output. Now both directions use base64: the reader thread in `spawn_pty` (`src-tauri/src/lib.rs:338-344`) encodes with `BASE64.encode(&buf[..n])`, and `pty_write` (`:845-852`) accepts a base64 string instead of a JSON number array.

## 2. No GPU-accelerated renderer — **fixed**

`@xterm/addon-webgl` is now loaded in `XtermTerminal.tsx:66-68`, with a `onContextLoss` handler that disposes the addon (falls back to the DOM renderer) if the WebView's WebGL context is lost.

## 3. All tabs stay fully mounted, not just the visible one — **still open, and broader than originally scoped**

Originally described as within-session only; per `docs/performance-audit.md` #4, this is actually every tab across **every session**, not just the active one (`MainWindow.tsx:69-89`) — a deliberate tradeoff for instant switching, but uncapped: each hidden tab is a live WebGL context + background PTY reader thread that's never torn down until explicitly closed. Worth an explicit cap or LRU-unmount strategy if heavy users (many projects × sessions × tabs) report slowdowns.

## 4. ResizeObserver fires for every mounted tab, including hidden ones — **fixed**

`XtermTerminal.tsx:82-89` now guards the observer callback on `visibleRef.current`, so hidden tabs no longer call `fitAddon.fit()` + `invoke('pty_resize', ...)` on every resize event.

## 5. `cursorBlink: true` always on — **fixed**

`cursorBlink` is now tied to the `visible` prop (`XtermTerminal.tsx:108`), so background/hidden tabs no longer run a blink timer.

## 6. Minor allocation churn — **fixed**

`XtermTerminal.tsx:12` now creates one module-level `encoder`, reused across all `onData` calls instead of constructing a new `TextEncoder` per keystroke.

---

**Priority:** All of the original high-leverage items (#1 IPC serialization, #2 WebGL renderer) are fixed, along with the per-hidden-tab waste (#4, #5, #6). #3 (uncapped mounted terminals) remains a real but lower-urgency architectural tradeoff — see `docs/performance-audit.md` for current app-wide priorities.
