# Frontend

## Layout

CSS grid, two-column: sidebar + main window.

```
┌─────────────────────────────────────────┐
│  Sidebar (240px)  │  MainWindow          │
│                   │  ┌─────────────────┐ │
│  ProjectList      │  │ TabBar          │ │
│                   │  ├─────────────────┤ │
│                   │  │ TerminalPane    │ │
│                   │  └─────────────────┘ │
└─────────────────────────────────────────┘
```

Sidebar default width: 240px, resizable via drag handle on the right edge, collapsible to 48px icon rail.

## Sidebar Collapsed State

- Shows only project icons (first letter or favicon) at 48px width
- Hover tooltip shows project name
- `+` icon remains clickable to add a new project
- Session items are hidden; clicking a project icon expands it or sets its first session active

## Component Tree

```
App
├── Sidebar
│   ├── SidebarHeader (collapse toggle, app title)
│   └── ProjectList (dnd-kit SortableContext)
│       └── ProjectItem
│           ├── ProjectHeader (name, + session button, collapse chevron)
│           └── SessionList (dnd-kit SortableContext)
│               └── SessionItem (name → setActive, stop button)
├── MainWindow
│   ├── TabBar (dnd-kit SortableContext, horizontal)
│   │   ├── Tab[] (draggable, title, × close)
│   │   └── AddTabButton
│   └── TerminalPane
│       └── XtermTerminal[] (one per tab, display:none when inactive)
└── Modals (React Portal → document.body)
    ├── AddProjectModal
    ├── NewSessionModal
    └── ConfirmDialog
```

## Sidebar Drag-and-Drop

- **Projects:** `SortableContext` on `ProjectList`, vertical axis. Drag handle on `ProjectHeader`.
- **Sessions:** `SortableContext` on `SessionList` within each project, vertical axis. Drag handle on `SessionItem`.
- Both use `@dnd-kit/core` with `verticalListSortingStrategy`.
- On `DragEndEvent`: call `reorderProjects` or `reorderSessions` with new id order.

## NewSessionModal Fields

| Field | Type | Condition |
|-|-|-|
| Session name | `<input type="text">` | Always |
| Branch mode | `<radio>` New / Existing | Always |
| Base branch | `<select>` | New branch only |
| New branch name | `<input type="text">` | New branch only |
| Create as worktree | `<input type="checkbox">` | New branch only |
| Select branch | `<select>` | Existing branch only |

Branch selects are populated by `invoke('list_branches', { projectId })` on modal open.

## ConfirmDialog

Generic reusable modal:

```ts
interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;  // default: "Confirm"
  destructive?: boolean;  // red confirm button
  onConfirm: () => void;
  onCancel: () => void;
}
```

Used for: stop session, remove project. Always rendered via the Modals portal.

## Styling

- **Framework:** Tailwind CSS
- **Theme:** Dark by default (`bg-[#1a1a1a]` base, `text-[#d4d4d4]` foreground)
- **Font:** System monospace for terminals; system sans-serif for UI chrome
- **Active session:** highlighted in sidebar with a left accent border
- **Active tab:** bottom border or background tint

## Resize Handle (Sidebar)

A 4px-wide draggable div on the right edge of the sidebar. On `mousedown`, tracks `mousemove` to update sidebar width in local state. Clamped to `[48, 480]px`. Width stored in `localStorage` for persistence across restarts.
