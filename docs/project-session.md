# Project & Session Lifecycle

## Projects

### Add Project

1. Invoke Tauri `dialog::open` with `directory: true` — user picks a folder
2. Validate: run `git rev-parse --is-inside-work-tree` in the selected path; reject if non-zero exit
3. Derive `name` from the directory basename (editable in a follow-up input if desired)
4. Insert into `projects` with a new UUID and `sort_order = MAX(sort_order) + 1`
5. Return the new project to the frontend; `useProjectStore` appends it

### Remove Project

1. Show confirmation: "Remove project '<name>'? All sessions and terminals will be closed."
2. Kill all PTYs associated with any session under this project
3. For each session with `is_worktree = 1`: run `git worktree remove --force <worktree_path>`
4. `DELETE FROM projects WHERE id = ?` — cascades to sessions and terminal_tabs
5. If the active session belonged to this project, clear active session in UI

---

## Sessions

### Create Session — Modal Flow

Triggered by clicking `+` on a project row.

**Fields:**
| Field | Notes |
|-|-|
| Session name | Required text input |
| Branch mode | Radio: "New branch" / "Existing branch" |
| [New] Base branch | `<select>` from `list_branches` command |
| [New] New branch name | Text input, validated as valid git ref |
| [New] Create as worktree | Checkbox |
| [Existing] Select branch | `<select>` from `list_branches` command |

**On confirm:**

1. Run the appropriate git operation (see below)
2. Insert session row into DB
3. Insert one `terminal_tabs` row (first tab)
4. Invoke `create_pty` for the new tab
5. Set the new session as active in `useSessionStore`

### Git Operations

**New branch, no worktree:**
```
git -C <project_path> checkout -b <branch_name> <base_branch>
```

**New branch, with worktree:**
```
git -C <project_path> worktree add <worktree_path> -b <branch_name> <base_branch>
```
Worktree path convention: `<project_path>/../<project_name>-<branch_name>`

**Existing branch:**
No git operation. Session record stores the branch name for reference only.

### Stop Session

1. Show confirmation dialog:
   - Default: "Kill session '<name>'? This will terminate all terminals."
   - If worktree: append "and delete worktree at `<worktree_path>`."
2. Kill all PTYs for the session (by iterating `terminal_tabs` for this session)
3. If `is_worktree`: run `git worktree remove --force <worktree_path>`
4. `DELETE FROM sessions WHERE id = ?` — cascades to terminal_tabs
5. If this was the active session, clear `activeSessionId` in UI
6. If this was the last session for the project, main window shows empty state

### Last Tab Closes → Session Stops

When `closeTab` is called and the session has no remaining tabs:
- Automatically trigger the stop-session flow (with confirmation dialog)
- User can cancel, which leaves the session alive with zero tabs (edge case: re-open one immediately, or just always require at least one)

**Decision:** If the user cancels the stop dialog after closing the last tab, reopen the tab (create a new PTY for the session) to keep the session alive.
