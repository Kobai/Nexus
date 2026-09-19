# Performance Guidelines

Principles distilled from real regressions found in this codebase (mainly the `ApiPanel.tsx` / `call_api` work). Kept here so new features don't repeat them. See also `docs/terminal-performance.md` for a deeper investigation into the terminal rendering pipeline specifically.

## 1. DOM node count is the cost — not how the nodes are created

`ApiPanel.tsx`'s JSON response highlighter originally rendered one React `<span>` per token (key/string/number/etc). Closing the panel after a large response meant tearing down thousands of fiber nodes — slow.

The instinctive fix — replace per-token React elements with one `dangerouslySetInnerHTML` string — looked right (skips React's diffing) but **made it worse**, because it removed a size cap along the way. The underlying mistake: `dangerouslySetInnerHTML` skips React's fiber bookkeeping, but the browser's HTML parser still creates one real DOM node per `<span>` tag. Node count — and therefore mount/layout/paint/unmount cost — was unchanged.

**Rule:** for large or variable-size structured data (JSON, logs, big lists), cap the number of *individually styled* elements and fall back to a single plain block past the cap. Cap by item/token count, not byte count — a dense array of small objects (e.g. a product list) can blow past a byte threshold in node count while staying well under it in bytes.

## 2. Reuse expensive resources across calls — don't reconstruct per-invocation

`call_api` built a fresh `reqwest::blocking::Client` on every request, paying a new TCP/TLS handshake each time. Fixed by managing a single `Client` as Tauri state (`HttpClientState`), constructed once in `.setup()`. Same applies to DB connections, compiled regexes, or anything expensive to build that has no per-call state — build once, store in managed state, reuse.

## 3. Filesystem scans must exclude dependency/build directories

`get_openapi_specs`'s `WalkDir` over a project root had no exclusions, so every refresh walked `node_modules`, `.git`, `target`, `.venv`, etc. Any feature that walks a project directory (spec discovery, file search, future git-status features, ...) needs an exclusion list applied via `filter_entry` — not a post-hoc filter after the walk already paid the traversal cost. Current exclusion list lives next to `get_openapi_specs` in `src-tauri/src/lib.rs`; extend it there if a new heavy directory shows up (e.g. `.next`, `__pycache__`).

## 4. Gate actions on async state — don't let stale/empty state silently ship

The "x-api-key missing" bug was a race: the Call button was clickable before `fetchEnv()` resolved, so headers were silently built from an empty env-var array with no error. Any control that depends on async-loaded state (env vars, specs, auth) should be disabled — not just functionally inert — until that state is ready. And loading-state `catch` blocks should log the error, not swallow it silently; silent swallowing is what made this race invisible in the first place.

## 5. IPC payloads should be size/binary-aware, not naively JSON

From `docs/terminal-performance.md`: PTY bytes are shuttled as JSON number-arrays (`[10,72,101,...]`) instead of base64 or a binary `Channel`, costing per-byte JSON stringify/parse plus GC churn on both sides of the Tauri bridge. Watch for the same pattern in any new command moving bulk data (file contents, HTTP response bodies, etc.) — prefer base64 or a `Channel` over a `Vec<u8>` field serialized through default JSON `invoke`/`emit`.

## 6. When a fix "should" work, verify the mechanism, not just the symptom

The `dangerouslySetInnerHTML` regression happened because the fix was reasoned about ("fewer React elements = faster") without checking what actually determines the cost (DOM node count, not element-creation mechanism). Before trusting a performance fix, restate in one sentence *why* it should be faster in terms of the actual bottleneck (nodes, network round-trips, allocations, re-renders) — if that sentence doesn't hold up, the fix probably doesn't either. Cheap to check empirically: a small Node/Rust script simulating the real data shape (see the token-cap verification in the ApiPanel work) is often faster and more conclusive than reasoning from first principles.
