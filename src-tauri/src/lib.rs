use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Mutex;

use anyhow::Result;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use regex::Regex;
use reqwest::blocking::Client;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use serde_yaml;
use walkdir::WalkDir;
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

// ─── API Addon Types ──────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EnvVar {
    pub key: String,
    pub value: String,
    pub env_name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ApiEndpoint {
    pub method: String,
    pub path: String,
    pub summary: String,
    pub operation_id: String,
    pub parameters: Vec<ApiParameter>,
    pub request_body: Option<JsonValue>,
    pub tags: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ApiParameter {
    pub name: String,
    pub param_in: String,
    pub required: bool,
    pub param_type: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ApiSpecData {
    pub spec_path: String,
    pub spec_name: String,
    pub base_url: String,
    pub endpoints: Vec<ApiEndpoint>,
    pub tags: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct ApiCallRequest {
    pub url: String,
    pub method: String,
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ApiCallResponse {
    pub status: u16,
    pub body: String,
    pub headers: HashMap<String, String>,
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
/// Shared blocking client so `call_api` reuses pooled TCP/TLS connections
/// instead of paying a fresh handshake on every request.
pub struct HttpClientState(pub Client);

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
    // Gather everything we need from the DB up front, then release the lock
    // before doing any slow filesystem work (git worktree remove can take a
    // long time on large worktrees) — holding the DB mutex across that call
    // would freeze every other command in the app.
    let (tab_ids, worktree_sessions, project_path) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;

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

        let project_path: String = conn
            .query_row("SELECT path FROM projects WHERE id = ?1", [&id], |row| {
                row.get(0)
            })
            .map_err(|e| e.to_string())?;

        (tab_ids, worktree_sessions, project_path)
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

    // Remove worktrees (slow filesystem work, done without holding the DB lock)
    for (worktree_path, _) in worktree_sessions {
        let _ = std::process::Command::new("git")
            .args(["-C", &project_path, "worktree", "remove", "--force", &worktree_path])
            .output();
    }

    let conn = db.0.lock().map_err(|e| e.to_string())?;
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
            // All worktrees live under a single shared directory rather than
            // next to their project, so they're easy to find/clean up in one place.
            let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
            let worktrees_root = PathBuf::from(&home).join("Documents").join("nexus-worktrees");
            std::fs::create_dir_all(&worktrees_root).map_err(|e| e.to_string())?;
            let wt_path = worktrees_root.join(format!("{}-{}", project_name, args.branch));
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
    // Gather everything we need from the DB up front, then release the lock
    // before doing any slow filesystem work (git worktree remove can take a
    // long time on large worktrees) — holding the DB mutex across that call
    // would freeze every other command in the app.
    let (tab_ids, worktree_session) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;

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

        let worktree_session: Option<(String, String)> = conn
            .query_row(
                "SELECT s.worktree_path, p.path FROM sessions s JOIN projects p ON p.id = s.project_id WHERE s.id = ?1 AND s.is_worktree = 1",
                [&id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .ok();

        (tab_ids, worktree_session)
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

    // Worktree cleanup (slow filesystem work, done without holding the DB lock)
    if let Some((worktree_path, project_path)) = worktree_session {
        let _ = std::process::Command::new("git")
            .args(["-C", &project_path, "worktree", "remove", "--force", &worktree_path])
            .output();
    }

    let conn = db.0.lock().map_err(|e| e.to_string())?;
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
    eprintln!("[DEBUG] close_tab invoked for {}", tab_id);
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
fn get_openapi_specs(project_id: String, db: State<DbState>) -> Result<Vec<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let path: String = conn
        .query_row("SELECT path FROM projects WHERE id = ?1", [&project_id], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    drop(conn);

    eprintln!("[API] Looking for openapi specs in: {:?}", path);
    eprintln!("[API] Project path exists: {}", std::path::PathBuf::from(&path).exists());
    let openapi_names = ["openapi.json", "openapi.yaml", "openapi.yml", "swagger.json", "swagger.yaml", "swagger.yml"];
    const EXCLUDED_DIRS: [&str; 10] = [
        "node_modules", ".git", "target", "dist", "build", ".venv", "venv", "vendor", ".next", "__pycache__",
    ];
    let mut spec_files = Vec::new();
    let project_path = std::path::PathBuf::from(&path);
    if project_path.exists() {
        let walker = WalkDir::new(&project_path)
            .follow_links(false)
            .max_depth(8)
            .into_iter()
            .filter_entry(|e| !e.file_type().is_dir() || !EXCLUDED_DIRS.contains(&e.file_name().to_string_lossy().as_ref()));
        for entry in walker {
            match entry {
                Ok(e) => {
                    if !e.file_type().is_file() { continue; }
                    let name = e.file_name().to_string_lossy().to_lowercase();
                    if openapi_names.iter().any(|n| name == *n) {
                        eprintln!("[API] Found spec: {}", e.path().to_string_lossy());
                        spec_files.push(e.path().to_string_lossy().to_string());
                    }
                }
                Err(e) => {
                    eprintln!("[API] WalkDir error: {:?}", e);
                    continue;
                }
            }
        }
    } else {
        eprintln!("[API] Project path does not exist!");
    }
    eprintln!("[API] Found {} spec files total", spec_files.len());
    Ok(spec_files)
}

#[tauri::command]
#[allow(non_snake_case)]
fn read_openapi_spec(_project_id: String, specPath: String) -> Result<ApiSpecData, String> {
    eprintln!("[API] read_openapi_spec called with path: {}", specPath);
    eprintln!("[API] Reading file: {}", specPath);
    let content = fs::read_to_string(&specPath).map_err(|e| {
        eprintln!("[API] Failed to read file: {} - {}", specPath, e);
        e.to_string()
    })?;
    eprintln!("[API] Spec content length: {}", content.len());
    let spec_name = PathBuf::from(&specPath)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "openapi.json".to_string());

    let json_value: JsonValue = if specPath.to_lowercase().ends_with(".yaml") || specPath.to_lowercase().ends_with(".yml") {
        serde_yaml::from_str(&content).map_err(|e| e.to_string())?
    } else {
        serde_json::from_str(&content).map_err(|e| e.to_string())?
    };

    let base_url = json_value.get("servers")
        .and_then(|s| s.as_array())
        .and_then(|arr| arr.first())
        .and_then(|s| s.get("url"))
        .and_then(|u| u.as_str())
        .unwrap_or("http://localhost")
        .to_string();
    eprintln!("[API] Base URL: {}", base_url);

    let empty_map = serde_json::Map::new();

    // Map security scheme name -> header name, for apiKey/header schemes only.
    let mut api_key_header_schemes: HashMap<String, String> = HashMap::new();
    if let Some(schemes) = json_value.get("components").and_then(|c| c.get("securitySchemes")).and_then(|s| s.as_object()) {
        for (scheme_name, scheme) in schemes {
            let scheme_type = scheme.get("type").and_then(|t| t.as_str()).unwrap_or("");
            let scheme_in = scheme.get("in").and_then(|i| i.as_str()).unwrap_or("");
            if scheme_type == "apiKey" && scheme_in == "header" {
                if let Some(header_name) = scheme.get("name").and_then(|n| n.as_str()) {
                    api_key_header_schemes.insert(scheme_name.clone(), header_name.to_string());
                }
            }
        }
    }
    let global_security = json_value.get("security").and_then(|s| s.as_array());

    let paths = json_value.get("paths").and_then(|p| p.as_object()).unwrap_or(&empty_map);
    eprintln!("[API] Number of paths: {}", paths.len());
    let mut endpoints = Vec::new();
    let mut tags = Vec::new();

    for (path_str, path_item) in paths {
        let path_obj = path_item.as_object().unwrap_or(&empty_map);
        for (method, operation) in path_obj {
            let method_lower = method.to_lowercase();
            if ["get", "post", "put", "delete", "patch", "options", "head"].contains(&method_lower.as_str()) {
                let op_obj = operation.as_object().unwrap_or(&empty_map);
                let summary = op_obj.get("summary").and_then(|s| s.as_str()).unwrap_or("").to_string();
                let default_id = format!("{}_{}", method_lower, path_str.replace('/', "_"));
                let operation_id = op_obj.get("operationId").and_then(|s| s.as_str()).map(|s| s.to_string()).unwrap_or(default_id);
                let tag = op_obj.get("tags").and_then(|t| t.as_array()).and_then(|arr| arr.first()).and_then(|t| t.as_str()).map(|s| s.to_string()).unwrap_or_else(|| method_lower.clone());
                if !tags.contains(&tag) { tags.push(tag.clone()); }
                let endpoint_tags = op_obj.get("tags").and_then(|t| t.as_array()).map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_else(|| vec![tag.clone()]);

                let mut parameters = Vec::new();
                if let Some(params) = op_obj.get("parameters").and_then(|p| p.as_array()) {
                    for param in params {
                        let param_obj = param.as_object().unwrap_or(&empty_map);
                        parameters.push(ApiParameter {
                            name: param_obj.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string(),
                            param_in: param_obj.get("in").and_then(|i| i.as_str()).unwrap_or("").to_string(),
                            required: param_obj.get("required").and_then(|r| r.as_bool()).unwrap_or(false),
                            param_type: param_obj.get("schema").and_then(|s| s.get("type")).and_then(|t| t.as_str()).unwrap_or("string").to_string(),
                        });
                    }
                }

                if !api_key_header_schemes.is_empty() {
                    let security = op_obj.get("security").and_then(|s| s.as_array()).or(global_security);
                    if let Some(security) = security {
                        for requirement in security {
                            if let Some(scheme_names) = requirement.as_object().map(|o| o.keys()) {
                                for scheme_name in scheme_names {
                                    if let Some(header_name) = api_key_header_schemes.get(scheme_name) {
                                        let already_present = parameters.iter().any(|p: &ApiParameter| p.name.eq_ignore_ascii_case(header_name));
                                        if !already_present {
                                            parameters.push(ApiParameter {
                                                name: header_name.clone(),
                                                param_in: "header".to_string(),
                                                required: true,
                                                param_type: "string".to_string(),
                                            });
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                let request_body = op_obj.get("requestBody").cloned();

                endpoints.push(ApiEndpoint {
                    method: method_upper(&method_lower),
                    path: path_str.clone(),
                    summary,
                    operation_id,
                    parameters,
                    request_body,
                    tags: endpoint_tags,
                });
            }
        }
    }

    tags.sort();
    endpoints.sort_by(|a, b| a.method.cmp(&b.method).then(a.path.cmp(&b.path)));
    eprintln!("[API] Total endpoints: {}, tags: {:?}", endpoints.len(), tags);

    Ok(ApiSpecData {
        spec_path: specPath,
        spec_name,
        base_url,
        endpoints,
        tags,
    })
}
#[tauri::command]
fn get_env_file(project_id: String, db: State<DbState>) -> Result<Vec<EnvVar>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let path: String = conn
        .query_row("SELECT path FROM projects WHERE id = ?1", [&project_id], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    drop(conn);

    let env_names = [".env.local", ".env.prod"];
    let mut env_vars = Vec::new();

    for env_file in &env_names {
        let env_path = PathBuf::from(&path).join(env_file);
        if env_path.exists() {
            let content = fs::read_to_string(&env_path).map_err(|e| e.to_string())?;
            let re = Regex::new(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$").unwrap();
            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() || trimmed.starts_with('#') { continue; }
                if let Some(caps) = re.captures(trimmed) {
                    let key = caps[1].to_string();
                    let value = caps[2].trim().trim_matches('"').trim_matches('\'').to_string();
                    env_vars.push(EnvVar {
                        key: key.clone(),
                        value: value.clone(),
                        env_name: env_file.to_string(),
                    });
                }
            }
        }
    }

    Ok(env_vars)
}

#[tauri::command]
fn call_api(request: ApiCallRequest, client: State<HttpClientState>) -> Result<ApiCallResponse, String> {
    let client = &client.0;
    let method = match request.method.to_lowercase().as_str() {
        "get" => reqwest::Method::GET,
        "post" => reqwest::Method::POST,
        "put" => reqwest::Method::PUT,
        "delete" => reqwest::Method::DELETE,
        "patch" => reqwest::Method::PATCH,
        _ => reqwest::Method::GET,
    };

    let mut req = client.request(method.clone(), &request.url);

    for (key, value) in &request.headers {
        req = req.header(key, value);
    }

    if let Some(body) = &request.body {
        req = req.body(body.clone());
    }

    let response = req.send().map_err(|e| e.to_string())?;
    let status = response.status().as_u16();
    let headers: HashMap<String, String> = response.headers().iter()
        .map(|(k, v)| (k.as_str().to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    let body = response.text().map_err(|e| e.to_string())?;

    Ok(ApiCallResponse { status, body, headers })
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

fn method_upper(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        None => String::new(),
        Some(f) => f.to_uppercase().collect::<String>() + chars.as_str(),
    }
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let conn = open_db(app.handle()).expect("Failed to open database");
            app.manage(DbState(Mutex::new(conn)));
            app.manage(PtyState(Mutex::new(PtyManager::new())));
            app.manage(HttpClientState(Client::new()));
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
            restore_ptys,
            fetch_and_pull_branch,
            get_openapi_specs,
            read_openapi_spec,
            get_env_file,
            call_api,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
