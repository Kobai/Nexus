# Data Model

## SQLite Schema

### `projects`

```sql
CREATE TABLE projects (
  id         TEXT PRIMARY KEY,  -- UUID
  name       TEXT NOT NULL,
  path       TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### `sessions`

```sql
CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,  -- UUID
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  branch        TEXT NOT NULL,
  is_worktree   INTEGER NOT NULL DEFAULT 0,  -- boolean
  worktree_path TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### `terminal_tabs`

```sql
CREATE TABLE terminal_tabs (
  id         TEXT PRIMARY KEY,  -- UUID
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  title      TEXT NOT NULL DEFAULT 'Terminal',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

## Indexes

```sql
CREATE INDEX idx_sessions_project_id ON sessions(project_id);
CREATE INDEX idx_terminal_tabs_session_id ON terminal_tabs(session_id);
```

## Migration Strategy

- DB file stored at Tauri app data dir: `<app_data>/nexus.db`
- Single `schema_version` table tracks applied migrations:

```sql
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- Numbered migration files: `migrations/0001_initial.sql`, `migrations/0002_*.sql`, etc.
- On startup: read current version → run all unapplied migrations in order → commit
- Migrations are embedded in the binary via `include_str!` (or a migrations directory bundled with the app)

## Ephemeral State

PTY state lives entirely in Rust `AppState` at runtime. No PTY/process info is persisted to SQLite. On restart:

- Projects, sessions, and tab metadata are restored from DB
- PTY processes are **not** restored — tabs show a fresh shell
- Frontend detects tabs with no live PTY and spawns a new shell on first focus

## Relationships

```
projects (1) ──< sessions (1) ──< terminal_tabs
```

Cascade deletes flow downward: deleting a project removes all its sessions and tabs. Deleting a session removes all its tabs. Tab rows are also removed when a session is stopped.
