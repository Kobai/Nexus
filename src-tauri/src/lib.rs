use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;

use anyhow::Result;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

// ─── Types ───────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub sort_order: i64,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Session {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub branch: String,
    pub is_worktree: bool,
    pub worktree_path: Option<String>,
    pub sort_order: i64,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Tab {
    pub id: String,
    pub session_id: String,
    pub title: String,
    pub sort_order: i64,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AppData {
    pub projects: Vec<Project>,
    pub sessions: Vec<Session>,
    pub tabs: Vec<Tab>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Vec<FileNode>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PtyOutputPayload {
    pub tab_id: String,
    /// Base64-encoded bytes — avoids JSON-serializing a raw Vec<u8> as a
    /// per-byte number array, which is far heavier over IPC for chatty PTY output.
    pub data: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PtyExitPayload {
    pub tab_id: String,
}

// ─── Usage Types ─────────────────────────────────────────────────────────────

/// Returned by get_claude_usage.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UsageResult {
    /// Tokens summed from all assistant messages whose timestamp falls within
    /// the rolling window [now - window_hours, now].
    pub tokens_in_window: u64,
    /// Unix seconds of the oldest assistant message still inside the window,
    /// or None if the window is empty. Used by the frontend to compute the
    /// countdown to when that message rolls off and capacity is freed.
    pub oldest_in_window_secs: Option<u64>,
    /// Current server time as Unix seconds (so the frontend can derive
    /// "seconds until reset" without its own clock drift).
    pub now_secs: u64,
    /// Window size in hours, echoed from settings (default 5).
    pub window_hours: u64,
}

/// Returned by / accepted by get_usage_settings / set_usage_settings.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UsageSettings {
    /// Rolling window size in hours. Default 5.
    pub window_hours: u64,
    /// Optional soft token limit. 0 means unset.
    pub limit: u64,
}

#[derive(Debug, Deserialize)]
struct JournalEntry {
    #[serde(rename = "type")]
    entry_type: Option<String>,
    timestamp: Option<String>,
    message: Option<JournalMessage>,
}

#[derive(Debug, Deserialize)]
struct JournalMessage {
    usage: Option<TokenUsage>,
}

#[derive(Debug, Deserialize)]
struct TokenUsage {
    #[serde(default)]
    input_tokens: u64,
    #[serde(default)]
    output_tokens: u64,
    #[serde(default)]
    cache_creation_input_tokens: u64,
    #[serde(default)]
    cache_read_input_tokens: u64,
}

// ─── PTY State ───────────────────────────────────────────────────────────────

struct PtyHandle {
    master: Box<dyn portable_pty::MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    writer: Box<dyn Write + Send>,
}

pub struct PtyManager {
    handles: HashMap<String, PtyHandle>,
}

impl PtyManager {
    fn new() -> Self {
        Self {
            handles: HashMap::new(),
        }
    }
}

// ─── App State ────────────────────────────────────────────────────────────────

pub struct DbState(pub Mutex<Connection>);
pub struct PtyState(pub Mutex<PtyManager>);
/// Cache for get_claude_usage — invalidated after 60 s so the countdown stays
/// reasonably fresh without hammering the filesystem on every render.
pub struct UsageCache(pub Mutex<Option<(Instant, UsageResult)>>);

// ─── DB Helpers ──────────────────────────────────────────────────────────────

fn run_migrations(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
         );",
    )?;

    let current_version: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_version",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if current_version < 1 {
        let migration = include_str!("../migrations/0001_initial.sql");
        conn.execute_batch(migration)?;
        conn.execute(
            "INSERT INTO schema_version (version) VALUES (1)",
            [],
        )?;
    }

    if current_version < 2 {
        let migration = include_str!("../migrations/0002_settings.sql");
        conn.execute_batch(migration)?;
        conn.execute(
            "INSERT INTO schema_version (version) VALUES (2)",
            [],
        )?;
    }

    Ok(())
}

fn open_db(app_handle: &AppHandle) -> Result<Connection> {
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| anyhow::anyhow!("Failed to get app data dir: {}", e))?;
    std::fs::create_dir_all(&data_dir)?;
    let db_path = data_dir.join("nexus.db");
    let conn = Connection::open(db_path)?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    run_migrations(&conn)?;
    Ok(conn)
}

// ─── venv Detection ──────────────────────────────────────────────────────────

fn detect_venv(working_dir: &std::path::Path) -> Option<PathBuf> {
    for name in &[".venv", "venv", "env"] {
        let activate = working_dir.join(name).join("bin").join("activate");
        if activate.exists() {
            return Some(activate);
        }
    }
    None
}

// ─── Spawn PTY ───────────────────────────────────────────────────────────────

fn spawn_pty(
    app_handle: AppHandle,
    tab_id: String,
    working_dir: PathBuf,
    pty_manager: &mut PtyManager,
) -> Result<()> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

    let pty_system = NativePtySystem::default();
    let pair = pty_system.openpty(PtySize {
        rows: 24,
        cols: 80,
        pixel_width: 0,
        pixel_height: 0,
    })?;

    let mut cmd = CommandBuilder::new(&shell);
    cmd.cwd(&working_dir);

    // Pass current environment
    for (key, val) in std::env::vars() {
        cmd.env(key, val);
    }

    // Ensure terminal type is set so shells handle backspace/escape sequences correctly
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    let child = pair.slave.spawn_command(cmd)?;
    let mut writer = pair.master.take_writer()?;
    let mut reader = pair.master.try_clone_reader()?;

    // venv activation
    if let Some(activate_path) = detect_venv(&working_dir) {
        let cmd_str = format!("source {}\r", activate_path.display());
        let _ = writer.write_all(cmd_str.as_bytes());
    }

    // Reader thread
    let tab_id_clone = tab_id.clone();
    let app_handle_clone = app_handle.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => {
                    let _ = app_handle_clone.emit(
                        "pty-exit",
                        PtyExitPayload {
                            tab_id: tab_id_clone.clone(),
                        },
                    );
                    break;
                }
                Ok(n) => {
                    let _ = app_handle_clone.emit(
                        "pty-output",
                        PtyOutputPayload {
                            tab_id: tab_id_clone.clone(),
                            data: BASE64.encode(&buf[..n]),
                        },
                    );
                }
            }
        }
    });

    pty_manager.handles.insert(
        tab_id,
        PtyHandle {
            master: pair.master,
            child,
            writer,
        },
    );

    Ok(())
}

// ─── Tauri Commands ──────────────────────────────────────────────────────────

#[tauri::command]
fn get_all_data(db: State<DbState>) -> Result<AppData, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let projects = {
        let mut stmt = conn
            .prepare("SELECT id, name, path, sort_order, created_at FROM projects ORDER BY sort_order")
            .map_err(|e| e.to_string())?;
        let result = stmt.query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                sort_order: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
        result
    };

    let sessions = {
        let mut stmt = conn
            .prepare("SELECT id, project_id, name, branch, is_worktree, worktree_path, sort_order, created_at FROM sessions ORDER BY sort_order")
            .map_err(|e| e.to_string())?;
        let result = stmt.query_map([], |row| {
            Ok(Session {
                id: row.get(0)?,
                project_id: row.get(1)?,
                name: row.get(2)?,
                branch: row.get(3)?,
                is_worktree: row.get::<_, i64>(4)? != 0,
                worktree_path: row.get(5)?,
                sort_order: row.get(6)?,
                created_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
        result
    };

    let tabs = {
        let mut stmt = conn
            .prepare("SELECT id, session_id, title, sort_order, created_at FROM terminal_tabs ORDER BY sort_order")
            .map_err(|e| e.to_string())?;
        let result = stmt.query_map([], |row| {
            Ok(Tab {
                id: row.get(0)?,
                session_id: row.get(1)?,
                title: row.get(2)?,
                sort_order: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
        result
    };

    Ok(AppData {
        projects,
        sessions,
        tabs,
    })
}

#[tauri::command]
fn add_project(name: String, path: String, db: State<DbState>) -> Result<Project, String> {
    // Validate git repo
    let output = std::process::Command::new("git")
        .args(["-C", &path, "rev-parse", "--is-inside-work-tree"])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err("Not a git repository".to_string());
    }

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();

    let sort_order: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM projects",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    conn.execute(
        "INSERT INTO projects (id, name, path, sort_order) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![id, name, path, sort_order],
    )
    .map_err(|e| e.to_string())?;

    Ok(Project {
        id,
        name,
        path,
        sort_order,
        created_at: chrono_now(),
    })
}

#[tauri::command]
fn remove_project(
    id: String,
    db: State<DbState>,
    pty_state: State<PtyState>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    // Get all tab IDs for this project's sessions
    let tab_ids: Vec<String> = {
        let mut stmt = conn
            .prepare(
                "SELECT tt.id FROM terminal_tabs tt
                 JOIN sessions s ON s.id = tt.session_id
                 WHERE s.project_id = ?1",
            )
            .map_err(|e| e.to_string())?;
        let result = stmt.query_map([&id], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        result
    };

    // Kill PTYs
    {
        let mut pty_manager = pty_state.0.lock().map_err(|e| e.to_string())?;
        for tab_id in &tab_ids {
            if let Some(mut handle) = pty_manager.handles.remove(tab_id) {
                let _ = handle.child.kill();
            }
        }
    }

    // Get worktree sessions and remove worktrees
    let worktree_sessions: Vec<(String, String)> = {
        let mut stmt = conn
            .prepare(
                "SELECT worktree_path, project_id FROM sessions WHERE project_id = ?1 AND is_worktree = 1 AND worktree_path IS NOT NULL",
            )
            .map_err(|e| e.to_string())?;
        let result = stmt.query_map([&id], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        result
    };

    // Get project path for worktree removal
    let project_path: String = conn
        .query_row("SELECT path FROM projects WHERE id = ?1", [&id], |row| {
            row.get(0)
        })
        .map_err(|e| e.to_string())?;

    for (worktree_path, _) in worktree_sessions {
        let _ = std::process::Command::new("git")
            .args(["-C", &project_path, "worktree", "remove", "--force", &worktree_path])
            .output();
    }

    conn.execute("DELETE FROM projects WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn list_branches(project_id: String, db: State<DbState>) -> Result<Vec<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let path: String = conn
        .query_row(
            "SELECT path FROM projects WHERE id = ?1",
            [&project_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let output = std::process::Command::new("git")
        .args(["-C", &path, "branch", "--format=%(refname:short)"])
        .output()
        .map_err(|e| e.to_string())?;

    let branches = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    Ok(branches)
}

#[derive(Deserialize)]
pub struct CreateSessionArgs {
    pub project_id: String,
    pub name: String,
    pub branch: String,
    pub branch_mode: String, // "new" or "existing"
    pub base_branch: Option<String>,
    pub use_worktree: bool,
}

#[tauri::command]
fn create_session(
    args: CreateSessionArgs,
    app_handle: AppHandle,
    db: State<DbState>,
    pty_state: State<PtyState>,
) -> Result<(Session, Tab), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let project_path: String = conn
        .query_row(
            "SELECT path FROM projects WHERE id = ?1",
            [&args.project_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let project_name: String = conn
        .query_row(
            "SELECT name FROM projects WHERE id = ?1",
            [&args.project_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let mut worktree_path: Option<String> = None;
    let working_dir: PathBuf;

    if args.branch_mode == "new" {
        let base = args.base_branch.as_deref().unwrap_or("HEAD");
        if args.use_worktree {
            // worktree path: <project_path>/../<project_name>-<branch_name>
            let wt_path = PathBuf::from(&project_path)
                .parent()
                .unwrap_or(std::path::Path::new("/tmp"))
                .join(format!("{}-{}", project_name, args.branch));
            let wt_path_str = wt_path.to_string_lossy().to_string();

            let output = std::process::Command::new("git")
                .args([
                    "-C", &project_path,
                    "worktree", "add",
                    &wt_path_str,
                    "-b", &args.branch,
                    base,
                ])
                .output()
                .map_err(|e| e.to_string())?;

            if !output.status.success() {
                return Err(String::from_utf8_lossy(&output.stderr).to_string());
            }

            worktree_path = Some(wt_path_str.clone());
            working_dir = wt_path;
        } else {
            let output = std::process::Command::new("git")
                .args(["-C", &project_path, "checkout", "-b", &args.branch, base])
                .output()
                .map_err(|e| e.to_string())?;

            if !output.status.success() {
                return Err(String::from_utf8_lossy(&output.stderr).to_string());
            }

            working_dir = PathBuf::from(&project_path);
        }
    } else {
        // existing branch — just use project path
        working_dir = PathBuf::from(&project_path);
    }

    let session_id = Uuid::new_v4().to_string();
    let sort_order: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM sessions WHERE project_id = ?1",
            [&args.project_id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    conn.execute(
        "INSERT INTO sessions (id, project_id, name, branch, is_worktree, worktree_path, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            session_id,
            args.project_id,
            args.name,
            args.branch,
            if args.use_worktree && args.branch_mode == "new" { 1 } else { 0 },
            worktree_path,
            sort_order
        ],
    )
    .map_err(|e| e.to_string())?;

    // Create first tab
    let tab_id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO terminal_tabs (id, session_id, title, sort_order) VALUES (?1, ?2, 'Terminal', 0)",
        rusqlite::params![tab_id, session_id],
    )
    .map_err(|e| e.to_string())?;

    // Spawn PTY
    {
        let mut pty_manager = pty_state.0.lock().map_err(|e| e.to_string())?;
        spawn_pty(app_handle, tab_id.clone(), working_dir, &mut pty_manager)
            .map_err(|e| e.to_string())?;
    }

    let session = Session {
        id: session_id.clone(),
        project_id: args.project_id,
        name: args.name,
        branch: args.branch,
        is_worktree: args.use_worktree && args.branch_mode == "new",
        worktree_path,
        sort_order,
        created_at: chrono_now(),
    };

    let tab = Tab {
        id: tab_id,
        session_id,
        title: "Terminal".to_string(),
        sort_order: 0,
        created_at: chrono_now(),
    };

    Ok((session, tab))
}

#[tauri::command]
fn stop_session(
    id: String,
    db: State<DbState>,
    pty_state: State<PtyState>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    // Get tab IDs for this session
    let tab_ids: Vec<String> = {
        let mut stmt = conn
            .prepare("SELECT id FROM terminal_tabs WHERE session_id = ?1")
            .map_err(|e| e.to_string())?;
        let result = stmt.query_map([&id], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        result
    };

    // Kill PTYs
    {
        let mut pty_manager = pty_state.0.lock().map_err(|e| e.to_string())?;
        for tab_id in &tab_ids {
            if let Some(mut handle) = pty_manager.handles.remove(tab_id) {
                let _ = handle.child.kill();
            }
        }
    }

    // Worktree cleanup
    let session: Option<(String, String)> = conn
        .query_row(
            "SELECT s.worktree_path, p.path FROM sessions s JOIN projects p ON p.id = s.project_id WHERE s.id = ?1 AND s.is_worktree = 1",
            [&id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .ok();

    if let Some((worktree_path, project_path)) = session {
        let _ = std::process::Command::new("git")
            .args(["-C", &project_path, "worktree", "remove", "--force", &worktree_path])
            .output();
    }

    conn.execute("DELETE FROM sessions WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn create_tab(
    session_id: String,
    app_handle: AppHandle,
    db: State<DbState>,
    pty_state: State<PtyState>,
) -> Result<Tab, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    // Get working dir for this session
    let (is_worktree, worktree_path, project_path): (bool, Option<String>, String) = conn
        .query_row(
            "SELECT s.is_worktree, s.worktree_path, p.path FROM sessions s JOIN projects p ON p.id = s.project_id WHERE s.id = ?1",
            [&session_id],
            |row| Ok((row.get::<_, i64>(0)? != 0, row.get(1)?, row.get(2)?)),
        )
        .map_err(|e| e.to_string())?;

    let working_dir = if is_worktree {
        PathBuf::from(worktree_path.unwrap_or(project_path))
    } else {
        PathBuf::from(project_path)
    };

    let sort_order: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM terminal_tabs WHERE session_id = ?1",
            [&session_id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let tab_id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO terminal_tabs (id, session_id, title, sort_order) VALUES (?1, ?2, 'Terminal', ?3)",
        rusqlite::params![tab_id, session_id, sort_order],
    )
    .map_err(|e| e.to_string())?;

    {
        let mut pty_manager = pty_state.0.lock().map_err(|e| e.to_string())?;
        spawn_pty(app_handle, tab_id.clone(), working_dir, &mut pty_manager)
            .map_err(|e| e.to_string())?;
    }

    Ok(Tab {
        id: tab_id,
        session_id,
        title: "Terminal".to_string(),
        sort_order,
        created_at: chrono_now(),
    })
}

#[tauri::command]
fn close_tab(tab_id: String, db: State<DbState>, pty_state: State<PtyState>) -> Result<(), String> {
    {
        let mut pty_manager = pty_state.0.lock().map_err(|e| e.to_string())?;
        if let Some(mut handle) = pty_manager.handles.remove(&tab_id) {
            let _ = handle.child.kill();
        }
    }

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM terminal_tabs WHERE id = ?1", [&tab_id])
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn pty_write(tab_id: String, data: String, pty_state: State<PtyState>) -> Result<(), String> {
    let bytes = BASE64.decode(&data).map_err(|e| e.to_string())?;
    let mut pty_manager = pty_state.0.lock().map_err(|e| e.to_string())?;
    if let Some(handle) = pty_manager.handles.get_mut(&tab_id) {
        handle.writer.write_all(&bytes).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn pty_resize(tab_id: String, cols: u16, rows: u16, pty_state: State<PtyState>) -> Result<(), String> {
    let pty_manager = pty_state.0.lock().map_err(|e| e.to_string())?;
    if let Some(handle) = pty_manager.handles.get(&tab_id) {
        handle
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn rename_tab(tab_id: String, title: String, db: State<DbState>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE terminal_tabs SET title = ?1 WHERE id = ?2",
        rusqlite::params![title, tab_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn reorder_projects(ids: Vec<String>, db: State<DbState>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    for (i, id) in ids.iter().enumerate() {
        conn.execute(
            "UPDATE projects SET sort_order = ?1 WHERE id = ?2",
            rusqlite::params![i as i64, id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn reorder_sessions(ids: Vec<String>, db: State<DbState>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    for (i, id) in ids.iter().enumerate() {
        conn.execute(
            "UPDATE sessions SET sort_order = ?1 WHERE id = ?2",
            rusqlite::params![i as i64, id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn reorder_tabs(ids: Vec<String>, db: State<DbState>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    for (i, id) in ids.iter().enumerate() {
        conn.execute(
            "UPDATE terminal_tabs SET sort_order = ?1 WHERE id = ?2",
            rusqlite::params![i as i64, id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_git_diff(project_id: String, db: State<DbState>) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let path: String = conn
        .query_row(
            "SELECT path FROM projects WHERE id = ?1",
            [&project_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let output = std::process::Command::new("git")
        .args(["-C", &path, "diff", "HEAD"])
        .output()
        .map_err(|e| e.to_string())?;

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn build_file_tree(dir: &std::path::Path, current_depth: u32, max_depth: u32) -> Vec<FileNode> {
    if current_depth >= max_depth {
        return vec![];
    }

    const SKIP: &[&str] = &[".git", "node_modules", "target"];

    let mut entries: Vec<_> = match std::fs::read_dir(dir) {
        Ok(e) => e.flatten().collect(),
        Err(_) => return vec![],
    };

    entries.sort_by(|a, b| {
        let a_dir = a.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let b_dir = b.file_type().map(|t| t.is_dir()).unwrap_or(false);
        match (a_dir, b_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.file_name().cmp(&b.file_name()),
        }
    });

    let mut nodes = Vec::new();
    for entry in entries {
        let name = entry.file_name().to_string_lossy().to_string();
        if SKIP.contains(&name.as_str()) {
            continue;
        }
        let path = entry.path().to_string_lossy().to_string();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let children = if is_dir {
            build_file_tree(&entry.path(), current_depth + 1, max_depth)
        } else {
            vec![]
        };
        nodes.push(FileNode { name, path, is_dir, children });
    }
    nodes
}

#[tauri::command]
fn get_file_tree(project_id: String, max_depth: u32, db: State<DbState>) -> Result<Vec<FileNode>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let path: String = conn
        .query_row(
            "SELECT path FROM projects WHERE id = ?1",
            [&project_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    Ok(build_file_tree(std::path::Path::new(&path), 0, max_depth))
}

fn read_settings_from_conn(conn: &Connection) -> UsageSettings {
    let read = |key: &str, default: u64| -> u64 {
        conn.query_row(
            "SELECT value FROM settings WHERE key = ?1",
            [key],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
    };
    UsageSettings {
        window_hours: read("window_hours", 5),
        limit: read("usage_limit", 0),
    }
}

/// Parse an ISO-8601 UTC timestamp like "2026-03-25T16:27:47.063Z" → Unix secs.
fn iso8601_to_unix(ts: &str) -> Option<u64> {
    let ts = ts.trim_end_matches('Z');
    let ts = ts.split('.').next()?;
    let (date, time) = ts.split_once('T')?;
    let mut dp = date.split('-');
    let mut tp = time.split(':');
    let year: i64 = dp.next()?.parse().ok()?;
    let month: i64 = dp.next()?.parse().ok()?;
    let day: i64 = dp.next()?.parse().ok()?;
    let hour: i64 = tp.next()?.parse().ok()?;
    let min: i64 = tp.next()?.parse().ok()?;
    let sec: i64 = tp.next()?.parse().ok()?;
    // Days from epoch via Rata Die
    let m = if month <= 2 { month + 9 } else { month - 3 };
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * m + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    let secs = days * 86400 + hour * 3600 + min * 60 + sec;
    if secs < 0 { None } else { Some(secs as u64) }
}

#[tauri::command]
fn get_claude_usage(
    cache: State<UsageCache>,
    db: State<DbState>,
) -> Result<UsageResult, String> {
    // 60-second cache so the countdown stays fresh
    {
        let guard = cache.0.lock().map_err(|e| e.to_string())?;
        if let Some((cached_at, ref result)) = *guard {
            if cached_at.elapsed().as_secs() < 60 {
                return Ok(result.clone());
            }
        }
    }

    let settings = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        read_settings_from_conn(&conn)
    };
    let window_secs = settings.window_hours * 3600;

    let now_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let cutoff = now_secs.saturating_sub(window_secs);

    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let projects_dir = PathBuf::from(&home).join(".claude").join("projects");

    let mut tokens_in_window: u64 = 0;
    let mut oldest_in_window_secs: Option<u64> = None;

    if projects_dir.exists() {
        for entry in walkdir::WalkDir::new(&projects_dir)
            .follow_links(false)
            .into_iter()
            .flatten()
        {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let Ok(content) = std::fs::read_to_string(path) else {
                continue;
            };
            for line in content.lines() {
                let Ok(entry) = serde_json::from_str::<JournalEntry>(line) else {
                    continue;
                };
                if entry.entry_type.as_deref() != Some("assistant") {
                    continue;
                }
                let ts_secs = entry.timestamp
                    .as_deref()
                    .and_then(iso8601_to_unix)
                    .unwrap_or(0);
                if ts_secs < cutoff {
                    continue;
                }
                if let Some(msg) = entry.message {
                    if let Some(usage) = msg.usage {
                        let total = usage.input_tokens
                            .saturating_add(usage.output_tokens)
                            .saturating_add(usage.cache_creation_input_tokens)
                            .saturating_add(usage.cache_read_input_tokens);
                        if total > 0 {
                            tokens_in_window = tokens_in_window.saturating_add(total);
                            oldest_in_window_secs = Some(match oldest_in_window_secs {
                                Some(prev) => prev.min(ts_secs),
                                None => ts_secs,
                            });
                        }
                    }
                }
            }
        }
    }

    let result = UsageResult {
        tokens_in_window,
        oldest_in_window_secs,
        now_secs,
        window_hours: settings.window_hours,
    };

    {
        let mut guard = cache.0.lock().map_err(|e| e.to_string())?;
        *guard = Some((Instant::now(), result.clone()));
    }

    Ok(result)
}

#[tauri::command]
fn get_usage_settings(db: State<DbState>) -> Result<UsageSettings, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    Ok(read_settings_from_conn(&conn))
}

#[tauri::command]
fn set_usage_settings(
    window_hours: u64,
    limit: u64,
    db: State<DbState>,
    cache: State<UsageCache>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let upsert = |key: &str, val: u64| -> Result<(), String> {
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![key, val.to_string()],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    };
    upsert("window_hours", window_hours)?;
    upsert("usage_limit", limit)?;
    // Invalidate cache so next poll picks up the new window size
    let mut guard = cache.0.lock().map_err(|e| e.to_string())?;
    *guard = None;
    Ok(())
}

#[tauri::command]
fn invalidate_usage_cache(cache: State<UsageCache>) -> Result<(), String> {
    let mut guard = cache.0.lock().map_err(|e| e.to_string())?;
    *guard = None;
    Ok(())
}

#[tauri::command]
fn fetch_and_pull_branch(
    project_id: String,
    branch: String,
    db: State<DbState>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let path: String = conn
        .query_row("SELECT path FROM projects WHERE id = ?1", [&project_id], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    drop(conn);

    let fetch = std::process::Command::new("git")
        .args(["-C", &path, "fetch", "origin"])
        .output()
        .map_err(|e| e.to_string())?;
    if !fetch.status.success() {
        return Err(String::from_utf8_lossy(&fetch.stderr).trim().to_string());
    }

    let pull = std::process::Command::new("git")
        .args(["-C", &path, "pull", "origin", &branch])
        .output()
        .map_err(|e| e.to_string())?;
    if !pull.status.success() {
        return Err(String::from_utf8_lossy(&pull.stderr).trim().to_string());
    }

    Ok(())
}

#[tauri::command]
fn restore_ptys(
    app_handle: AppHandle,
    db: State<DbState>,
    pty_state: State<PtyState>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT tt.id, p.path, s.is_worktree, s.worktree_path
             FROM terminal_tabs tt
             JOIN sessions s ON s.id = tt.session_id
             JOIN projects p ON p.id = s.project_id
             ORDER BY tt.sort_order",
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<(String, String, bool, Option<String>)> = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)? != 0,
                row.get::<_, Option<String>>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(stmt);
    drop(conn);

    let mut pty_manager = pty_state.0.lock().map_err(|e| e.to_string())?;
    for (tab_id, project_path, is_worktree, worktree_path) in rows {
        let working_dir = if is_worktree {
            PathBuf::from(worktree_path.unwrap_or(project_path))
        } else {
            PathBuf::from(project_path)
        };
        let _ = spawn_pty(app_handle.clone(), tab_id, working_dir, &mut pty_manager);
    }

    Ok(())
}

fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{}", secs)
}

// ─── App Entry ───────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let conn = open_db(app.handle()).expect("Failed to open database");
            app.manage(DbState(Mutex::new(conn)));
            app.manage(PtyState(Mutex::new(PtyManager::new())));
            app.manage(UsageCache(Mutex::new(None)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_all_data,
            add_project,
            remove_project,
            list_branches,
            create_session,
            stop_session,
            create_tab,
            close_tab,
            pty_write,
            pty_resize,
            rename_tab,
            reorder_projects,
            reorder_sessions,
            reorder_tabs,
            read_file,
            get_git_diff,
            get_file_tree,
            get_claude_usage,
            get_usage_settings,
            set_usage_settings,
            invalidate_usage_cache,
            restore_ptys,
            fetch_and_pull_branch,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
