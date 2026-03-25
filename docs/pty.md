# PTY Management

## Rust State

`PtyManager` is stored in Tauri `AppState`:

```rust
pub struct PtyManager {
    handles: HashMap<String, PtyHandle>,  // key: tab_id
}

pub struct PtyHandle {
    child: Box<dyn portable_pty::Child + Send>,
    writer: Sender<Vec<u8>>,
    reader_thread: JoinHandle<()>,
}
```

`AppState` wraps it in a `Mutex<PtyManager>` for safe concurrent access from Tauri commands.

## Spawn Flow

Triggered by `create_tab(session_id)`:

1. Insert `terminal_tabs` row into DB → get `tab_id`
2. Look up session → get `project_path` (or `worktree_path` if worktree)
3. Detect venv in working directory (priority order):
   - `.venv/bin/activate`
   - `venv/bin/activate`
   - `env/bin/activate`
4. Determine shell: `$SHELL` env var → fallback `/bin/zsh`
5. Spawn PTY via `portable-pty`:
   ```rust
   let pty = PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 };
   let pair = pty_system.openpty(pty)?;
   let cmd = CommandBuilder::new(&shell);
   cmd.cwd(&working_dir);
   let child = pair.slave.spawn_command(cmd)?;
   ```
6. If venv found: immediately write `source <venv_path>/bin/activate\r` to PTY master
7. Spawn reader thread:
   ```rust
   thread::spawn(move || {
       let mut buf = [0u8; 4096];
       loop {
           match reader.read(&mut buf) {
               Ok(0) | Err(_) => {
                   app_handle.emit("pty-exit", PtyExitPayload { tab_id });
                   break;
               }
               Ok(n) => {
                   app_handle.emit("pty-output", PtyOutputPayload {
                       tab_id,
                       data: buf[..n].to_vec(),
                   });
               }
           }
       }
   });
   ```
8. Store `PtyHandle` in `PtyManager`
9. Return `tab_id` to frontend

## Tauri Commands

### `pty_write(tab_id: String, data: Vec<u8>)`
Sends bytes to the PTY's write channel. Used for keyboard input and programmatic writes (e.g., venv activation).

### `pty_resize(tab_id: String, cols: u16, rows: u16)`
Calls `pair.master.resize(PtySize { rows, cols, .. })`. Called whenever the terminal container is resized.

### `close_tab(tab_id: String)`
1. Remove `PtyHandle` from `PtyManager`
2. Kill child process
3. Delete `terminal_tabs` row from DB
4. Reader thread will detect EOF and exit naturally (or is dropped)

## Frontend Events

| Event | Payload | Description |
|-|-|-|
| `pty-output` | `{ tab_id: string, data: number[] }` | Raw bytes to write to xterm.js |
| `pty-exit` | `{ tab_id: string }` | PTY process exited; frontend should close tab |

## venv Detection

Check relative to the session's working directory (project root or worktree path). Detection is path-existence only — no content validation. The activate script is sourced in the new shell immediately after spawn so the user's prompt reflects the venv from the start.
