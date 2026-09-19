# Performance Audit — Nexus vs. well-optimized Tauri apps

Full read-only audit comparing Nexus's current implementation against typical practice in well-built Tauri v2 apps. Ranked by expected impact. No fixes applied — see `docs/performance.md` for principles already applied this session and `docs/terminal-performance.md` for the original terminal-pipeline investigation (status of each item there is corrected below; several are already fixed).

## Already addressed (verified current state)

- **PTY IPC as JSON number-arrays** (`terminal-performance.md` #1) — **fixed**. `spawn_pty`'s reader thread (`src-tauri/src/lib.rs:338-344`) and `pty_write` (`:845-852`) both use base64 strings now, not `Vec<u8>` JSON arrays.
- **`TextEncoder` recreated per keystroke** (`terminal-performance.md` #6) — **fixed**. `XtermTerminal.tsx:12` creates one module-level `encoder`, reused in `onData`.
- **ResizeObserver / cursorBlink firing for hidden tabs** (`terminal-performance.md` #4, #5) — **fixed**. `XtermTerminal.tsx:82-89` guards the observer callback on `visibleRef.current`; `cursorBlink` is tied to the `visible` prop (`:108`).
- **WebGL renderer** (`terminal-performance.md` #2) — **implemented**. `XtermTerminal.tsx:66-68` loads `WebglAddon` with a context-loss fallback.
- `docs/terminal-performance.md` is now stale on 4 of its 6 points — worth a follow-up edit so it doesn't mislead future readers into re-fixing solved problems.

---

## 1. Frontend bundle: heavy libraries loaded eagerly on every startup (High — startup time, bundle size) — **fixed**

`FileTreePanel.tsx` now lazy-loads `FileViewerModal` via `React.lazy()` + `Suspense`, wrapping the same conditional-render site that already existed. Verified with a real build: main entry chunk dropped from 2.14MB to 719KB; the `react-markdown`/`react-syntax-highlighter`/`mermaid` chain now lives in its own `FileViewerModal-*.js` chunk (1.42MB) loaded only when a file preview is actually opened. The `react-syntax-highlighter` full-Prism-vs-light-build follow-up below is still open.

**Original finding (for context):** `dist/assets/index-*.js` was 2.14 MB, loaded synchronously before anything rendered. Root cause: `App.tsx` always mounts `RightSidebar` → `FileTreePanel` → `FileViewerModal` (`RightSidebar.tsx:5,110`), and `FileViewerModal.tsx:4-8` statically imports `react-markdown`, `remark-gfm`, full `react-syntax-highlighter` (every language grammar, not the light build), and `mermaid` — none of it behind a `React.lazy`/dynamic-`import()` boundary, so it all loaded on every cold start regardless of whether the user ever opened a file preview.

**Still open — follow-up:** consider `react-syntax-highlighter/dist/esm/prism-async-light` with only the languages actually needed, registered explicitly, instead of the full `Prism` import inside `FileViewerModal` — the full build ships grammars for languages this app will never render, and now that the whole chunk is lazy this is the next-highest-leverage trim inside it.

## 2. No release build tuning in `Cargo.toml` (Medium — binary size, steady-state runtime)

`src-tauri/Cargo.toml` has no `[profile.release]` section at all — every dependency (`reqwest`, `rusqlite` bundled sqlite, `regex`, `tauri` itself) compiles under Cargo's default release settings (`opt-level = 3`, `lto = false`, `codegen-units = 16`, unwinding panics, no symbol stripping). Well-optimized Tauri apps typically set:
```toml
[profile.release]
lto = true
codegen-units = 1
strip = true
panic = "abort"   # only if no code relies on catching unwinds across threads
```
`codegen-units = 1` + `lto = true` gives the optimizer cross-crate visibility (meaningfully faster hot paths, e.g. the JSON/YAML spec parsing and regex-heavy `.env` parsing) at the cost of slower release builds. `strip = true` shrinks the shipped binary (smaller download/update size via the already-configured updater).

**Status: fixed.** `[profile.release]` added to `src-tauri/Cargo.toml` with all four settings. Verified `panic = "abort"` is safe first: no `catch_unwind` anywhere in the crate, and the only `.unwrap()`/`.expect()` calls are two startup-critical ones (`open_db`, the Tauri builder's `.run()`) plus one static, always-valid regex compile — none inside the PTY reader thread (`spawn_pty`'s `std::thread::spawn`, `src-tauri/src/lib.rs:324-348`), which handles its read errors via `match` rather than unwrapping. Verified the profile parses and compiles cleanly with `cargo check --release`.

## 3. `get_env_file` holds the global DB mutex across file I/O (Medium — command latency under contention) — **fixed**

`src-tauri/lib.rs:1382-1389`:
```rust
let conn = db.0.lock().map_err(|e| e.to_string())?;
let path: String = conn.query_row(...)?;
// conn (MutexGuard) is still alive here — not dropped —
// while the function goes on to read .env.local / .env.prod and regex-parse them
```
Unlike its siblings — `get_openapi_specs` (`drop(conn)`) and `read_openapi_spec` (which locked-then-immediately-dropped a connection it never used) — `get_env_file` kept the single global `Mutex<Connection>` (`DbState`) held for the full duration of two file reads plus regex parsing, blocking every other DB-touching command meanwhile.

**Status: fixed.** Added `drop(conn);` right after the `query_row` in `get_env_file`, matching `get_openapi_specs`. Also removed the dead `db: State<DbState>` parameter and lock/drop entirely from `read_openapi_spec`, since it never queried anything — one less pointless mutex acquisition per spec load.

## 4. All terminals across all sessions stay mounted indefinitely (Medium-High — steady-state memory/GPU, grows with usage)

`MainWindow.tsx:69-89` intentionally mounts an `XtermTerminal` (own DOM tree, own WebGL context, own PTY reader thread in Rust) for **every tab in every session**, not just the active session — the comment explains this is deliberate so switching projects doesn't dispose xterm state. This is a legitimate tradeoff (instant session switching) but it's uncapped: a user with many projects × many sessions × many tabs accumulates that many live WebGL contexts and background reader threads simultaneously, none of which are ever torn down until the tab is explicitly closed. Chrome-based WebViews typically cap concurrent WebGL contexts (historically ~16 on some platforms) — past that, `WebglAddon`'s context-loss fallback (`XtermTerminal.tsx:66-68`) kicks in and silently degrades those terminals to the slower DOM renderer, which is easy to miss without profiling. Not urgent for typical usage, but worth an explicit cap or LRU-unmount-of-truly-inactive-sessions strategy if heavy users report slowdowns as their tab count grows — a debug overlay or `get_claude_usage`-style counter of live terminal/thread count would make this visible instead of silent.

## 5. Whole-store Zustand subscriptions instead of selectors in a few hot spots (Low-Medium — extra re-renders, not per-keystroke)

Not the narrow-selector pattern used almost everywhere else in this codebase (`Sidebar.tsx`, `RightSidebar.tsx`, most of `TabBar.tsx` correctly use `useXStore(s => s.field)`), but three spots subscribe to the entire store:
- `App.tsx:19` — `const terminalStore = useTerminalStore();` used only inside a `listen()` callback (`terminalStore.write(...)`, line 50), never in render. This is unnecessary — `write` doesn't need reactive subscription and can be called via `useTerminalStore.getState().write(...)` inside the callback, removing the subscription (and the re-render it causes on every `registerTerminal`/`unregisterTerminal`, i.e. every tab open/close anywhere) entirely.
- `XtermTerminal.tsx:46` — `const { registerTerminal, unregisterTerminal } = useTerminalStore();` — same issue, and because *every* mounted terminal (see #4 — potentially many) subscribes to the whole store, every tab open/close anywhere re-renders every other terminal component. Low real cost today since the re-render is a single `<div>` with no reconciliation work (xterm lives outside React's tree via the imperative `term.open()` call), but it's needless churn that scales with total tab count. Fix the same way: pull the two actions via `useTerminalStore.getState()` at call sites, or select them individually (`useTerminalStore(s => s.registerTerminal)`) — Zustand action references are stable, so a proper selector subscribes to nothing that ever changes.
- `TabBar.tsx:104-105` — two whole-store destructures purely to grab action references; same fix, lower impact since only one `TabBar` is mounted (for the active session) at a time.

## 6. No `PRAGMA journal_mode=WAL` on the SQLite connection (Low)

`open_db` (`src-tauri/lib.rs:256-267`) opens the connection with only `PRAGMA foreign_keys = ON`. Default SQLite journal mode (`DELETE`) does more fsync work per write and blocks concurrent readers more than `WAL` mode does. For a single-user desktop app with infrequent writes this is unlikely to be felt, but it's a one-line, zero-risk change (`PRAGMA journal_mode=WAL;`) that's standard in Tauri/desktop SQLite setups and slightly reduces write latency for the tab/session CRUD commands that fire during normal use (tab open/close, drag-reorder).

## 7. Bundle config builds every target on every release (Low — CI/build time only, not app runtime)

`tauri.conf.json:26` — `"targets": "all"`. Not a runtime performance issue, but worth flagging since it means every `tauri build` produces every bundle format for the current OS (dmg + app + updater artifact, etc.) rather than just what's actually distributed via the GitHub-releases updater endpoint already configured (`tauri.conf.json:39-44`). Narrowing `targets` to what's actually shipped shortens release build time; doesn't affect the shipped app itself.

## 8. CSP disabled (Low — not perf, flagging since it diverges from typical Tauri setups)

`tauri.conf.json:21` — `"security": { "csp": null }`. Not a performance finding, but well-built Tauri apps typically scope a CSP rather than disabling it outright. Noted for completeness since it's the kind of divergence-from-typical-setup the audit was asked to surface; doesn't belong in a perf priority ranking.

---

## Priority

1. **#1, #2, #3 — fixed.** Lazy-loaded `FileViewerModal`'s dependency chain (main chunk 2.14MB → 719KB, verified with a real build), added `[profile.release]` tuning to `Cargo.toml` (verified `cargo check --release` compiles clean and `panic = "abort"` is safe), and fixed `get_env_file`'s DB mutex hold plus removed a dead mutex acquisition in `read_openapi_spec`.
2. **#4 (uncapped mounted terminals)** — still open. Architectural tradeoff, not a bug; worth instrumenting/capping only if users with many sessions report slowdowns.
3. **#5 (whole-store subscriptions)** — still open. Cheap to fix, low urgency given actual measured impact (no per-keystroke re-renders, since `terminalStore.write` already bypasses `set()` in the hot path).
4. **#6–#8** — still open. Low-risk, low-urgency cleanup; batch with unrelated work rather than a dedicated pass.
