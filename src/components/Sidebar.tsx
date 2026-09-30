import { useState, useRef } from 'react';
import { Folder, FolderPlus, Trash2, Plus, Square, ChevronRight, PanelLeftClose, PanelLeftOpen, Moon, Sun } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { invoke } from '@tauri-apps/api/core';
import { useProjectStore } from '../store/projectStore';
import { useSessionStore } from '../store/sessionStore';
import { useTabStore } from '../store/tabStore';
import { useTerminalStore } from '../store/terminalStore';
import { useAttentionStore } from '../store/attentionStore';
import { useActivityStore } from '../store/activityStore';
import { useThemeStore } from '../store/themeStore';
import { StatusDot, statusOf } from './StatusDot';
import { EmptyState } from './EmptyState';
import { ConfirmDialog } from './ConfirmDialog';
import { NewSessionModal } from './NewSessionModal';
import { AddProjectModal } from './AddProjectModal';
import { UpdateButton } from './UpdateButton';
import { Project, Session, Tab } from '../types';

const EMPTY_TABS: Tab[] = [];
const EMPTY_SESSIONS: Session[] = [];

function SessionItem({ session }: { session: Session; projectId?: string }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: session.id });
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const removeSession = useSessionStore((s) => s.removeSession);
  const tabs = useTabStore((s) => s.tabs[session.id] ?? EMPTY_TABS);
  const removeTab = useTabStore((s) => s.removeTab);
  const unregisterTerminal = useTerminalStore((s) => s.unregisterTerminal);
  const attentionTabs = useAttentionStore((s) => s.tabs);
  const runningTabs = useActivityStore((s) => s.running);
  const [confirmStop, setConfirmStop] = useState(false);

  const isActive = activeSessionId === session.id;
  const needsAttention = tabs.some((t) => attentionTabs[t.id]);
  const isRunning = tabs.some((t) => runningTabs[t.id]);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  async function doStop() {
    for (const tab of tabs) {
      unregisterTerminal(tab.id);
      removeTab(tab.id);
    }
    await invoke('stop_session', { id: session.id });
    removeSession(session.id);
    setConfirmStop(false);
  }

  const stopMessage = session.is_worktree
    ? `Kill session '${session.name}'? This will terminate all terminals and delete worktree at ${session.worktree_path}.`
    : `Kill session '${session.name}'? This will terminate all terminals.`;

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        className={`flex items-center gap-2 pl-2.5 pr-2 py-1 mx-1 my-0.5 rounded-md cursor-pointer text-xs transition-all duration-150 group border-l-2 ${
          isActive
            ? 'bg-cafe-primary/10 border-cafe-primary text-cafe-primary font-semibold'
            : 'border-transparent text-cafe-muted hover:text-cafe-text hover:bg-cafe-hover'
        }`}
        onClick={() => setActiveSession(session.id)}
      >
        <StatusDot status={statusOf(needsAttention, isRunning)} />
        <span className="truncate flex-1">{session.name}</span>
        <button
          onClick={(e) => { e.stopPropagation(); setConfirmStop(true); }}
          className="opacity-0 group-hover:opacity-100 text-cafe-danger hover:bg-cafe-danger/10 rounded p-0.5 transition-all"
          title="Stop session"
        >
          <Square size={10} fill="currentColor" />
        </button>
      </div>
      {confirmStop && (
        <ConfirmDialog
          title="Stop Session"
          message={stopMessage}
          confirmLabel="Stop"
          destructive
          onConfirm={doStop}
          onCancel={() => setConfirmStop(false)}
        />
      )}
    </>
  );
}

function ProjectItem({
  project,
  sidebarCollapsed,
}: {
  project: Project;
  sidebarCollapsed: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: project.id });
  const sessions = useSessionStore((s) => s.sessions[project.id] ?? EMPTY_SESSIONS);
  const removeProject = useProjectStore((s) => s.removeProject);
  const removeSession = useSessionStore((s) => s.removeSession);
  const tabs = useTabStore((s) => s.tabs);
  const removeTab = useTabStore((s) => s.removeTab);
  const unregisterTerminal = useTerminalStore((s) => s.unregisterTerminal);
  const attentionTabs = useAttentionStore((s) => s.tabs);
  const reorderSessions = useSessionStore((s) => s.reorderSessions);
  const [collapsed, setCollapsed] = useState(false);
  const [showNewSession, setShowNewSession] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const needsAttention = sessions.some((session) =>
    (tabs[session.id] ?? EMPTY_TABS).some((t) => attentionTabs[t.id]),
  );

  function handleSessionDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sessions.findIndex((s) => s.id === active.id);
    const newIndex = sessions.findIndex((s) => s.id === over.id);
    const newOrder = arrayMove(sessions, oldIndex, newIndex);
    reorderSessions(project.id, newOrder.map((s) => s.id));
  }

  async function doRemove() {
    for (const session of sessions) {
      const sessionTabs = tabs[session.id] || [];
      for (const tab of sessionTabs) {
        unregisterTerminal(tab.id);
        removeTab(tab.id);
      }
      removeSession(session.id);
    }
    await invoke('remove_project', { id: project.id });
    removeProject(project.id);
    setConfirmRemove(false);
  }

  if (sidebarCollapsed) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        title={project.name}
        className="relative w-12 h-12 flex items-center justify-center text-cafe-muted hover:text-cafe-primary hover:bg-cafe-hover cursor-pointer transition-colors rounded-md mx-auto my-0.5"
        {...attributes}
        {...listeners}
      >
        <Folder size={16} />
        {needsAttention && (
          <StatusDot status="waiting" className="absolute top-2 right-2" />
        )}
      </div>
    );
  }

  return (
    <div ref={setNodeRef} style={style} className="mx-2 my-1">
      <div
        className="flex items-center justify-between px-2 py-1.5 group cursor-pointer rounded-md hover:bg-cafe-hover transition-colors"
        {...attributes}
        {...listeners}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setContextMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            onClick={(e) => { e.stopPropagation(); setCollapsed((c) => !c); }}
            className="text-cafe-muted/70 hover:text-cafe-primary w-4 flex-shrink-0 transition-colors"
          >
            <ChevronRight size={13} className={`transition-transform duration-150 ${collapsed ? '' : 'rotate-90'}`} />
          </button>
          <Folder size={14} className="text-cafe-primary/60 flex-shrink-0" />
          <span className="text-cafe-text text-xs font-semibold truncate tracking-wide uppercase">{project.name}</span>
          {needsAttention && <StatusDot status="waiting" />}
        </div>
        <div className="opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); setShowNewSession(true); }}
            className="text-cafe-primary hover:bg-cafe-primary/10 rounded p-0.5 transition-colors"
            title="New session"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setContextMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }}
          />
          <div
            ref={contextMenuRef}
            className="fixed z-50 bg-cafe-surface border border-cafe-border rounded-lg shadow-cafe-lg py-1 min-w-[160px] animate-scale-in"
            style={{ top: contextMenu.y, left: contextMenu.x }}
          >
            <button
              onClick={(e) => { e.stopPropagation(); setContextMenu(null); setConfirmRemove(true); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-cafe-danger hover:bg-cafe-hover transition-colors"
            >
              <Trash2 size={13} />
              Remove project
            </button>
          </div>
        </>
      )}

      {!collapsed && (
        <div className="mt-1 ml-5 pb-0.5 animate-fade-in">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleSessionDragEnd}>
            <SortableContext items={sessions.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              {sessions.map((session) => (
                <SessionItem key={session.id} session={session} projectId={project.id} />
              ))}
            </SortableContext>
          </DndContext>
          {sessions.length === 0 && (
            <p className="pl-3 py-0.5 text-cafe-muted/70 text-[11px] italic">No sessions</p>
          )}
        </div>
      )}

      {showNewSession && (
        <NewSessionModal projectId={project.id} onClose={() => setShowNewSession(false)} />
      )}
      {confirmRemove && (
        <ConfirmDialog
          title="Remove Project"
          message={`Remove project '${project.name}'? All sessions and terminals will be closed.`}
          confirmLabel="Remove"
          destructive
          onConfirm={doRemove}
          onCancel={() => setConfirmRemove(false)}
        />
      )}
    </div>
  );
}

export function Sidebar() {
  const COLLAPSED_WIDTH = 48;
  const DEFAULT_WIDTH = 240;

  const [width, setWidth] = useState(() => {
    const stored = localStorage.getItem('sidebar-width');
    return stored ? parseInt(stored) : DEFAULT_WIDTH;
  });
  const [collapsed, setCollapsed] = useState(false);
  const [showAddProject, setShowAddProject] = useState(false);
  const [dragging, setDragging] = useState(false);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggle);

  const projects = useProjectStore((s) => s.projects);
  const reorderProjects = useProjectStore((s) => s.reorderProjects);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function handleProjectDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = projects.findIndex((p) => p.id === active.id);
    const newIndex = projects.findIndex((p) => p.id === over.id);
    const newOrder = arrayMove(projects, oldIndex, newIndex);
    reorderProjects(newOrder.map((p) => p.id));
  }

  function startResize(e: React.MouseEvent) {
    e.preventDefault();
    setDragging(true);
    const startX = e.clientX;
    const startWidth = width;

    function onMove(e: MouseEvent) {
      const newWidth = Math.min(480, Math.max(COLLAPSED_WIDTH, startWidth + e.clientX - startX));
      setWidth(newWidth);
      localStorage.setItem('sidebar-width', String(newWidth));
      if (newWidth <= COLLAPSED_WIDTH + 10) setCollapsed(true);
      else setCollapsed(false);
    }

    function onUp() {
      setDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  const effectiveWidth = collapsed ? COLLAPSED_WIDTH : width;

  return (
    <div
      className="flex-shrink-0 bg-cafe-secondary border-r border-cafe-border shadow-cafe-sm flex flex-col relative z-10 transition-[width] duration-200 ease-out"
      style={{ width: effectiveWidth, transitionDuration: dragging ? '0ms' : undefined }}
    >
      {/* Title bar drag strip (traffic lights sit over this on macOS) */}
      <div data-tauri-drag-region className="h-7 shrink-0" />

      {/* Header */}
      <div className="flex items-center justify-between px-3 pb-2.5 pt-1 border-b border-cafe-border">
        {!collapsed && <span className="label-caps !text-cafe-primary">Projects</span>}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="text-cafe-muted hover:text-cafe-primary hover:bg-cafe-hover rounded p-1 transition-colors ml-auto"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
        </button>
      </div>

      {/* Project List */}
      <div className="flex-1 overflow-y-auto py-2">
        {projects.length === 0 && !collapsed && (
          <EmptyState
            icon={FolderPlus}
            title="No projects"
            hint="Add a folder to start your first session."
          />
        )}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleProjectDragEnd}>
          <SortableContext items={projects.map((p) => p.id)} strategy={verticalListSortingStrategy}>
            {projects.map((project) => (
              <ProjectItem key={project.id} project={project} sidebarCollapsed={collapsed} />
            ))}
          </SortableContext>
        </DndContext>
      </div>

      {/* Footer actions */}
      <div className="border-t border-cafe-border p-2 flex items-center gap-1">
        <button
          onClick={() => setShowAddProject(true)}
          className="flex-1 flex items-center justify-center gap-1.5 text-cafe-muted hover:text-cafe-primary text-xs py-1.5 hover:bg-cafe-hover rounded-md transition-colors font-medium"
          title="Add project"
        >
          <Plus size={13} />
          {!collapsed && 'Add Project'}
        </button>
        {!collapsed && (
          <>
            <span className="kbd" title="Command palette">⌘K</span>
            <button
              onClick={toggleTheme}
              className="p-1.5 rounded-md text-cafe-muted hover:text-cafe-primary hover:bg-cafe-hover transition-colors"
              title={theme === 'dark' ? 'Switch to light theme' : 'Switch to espresso theme'}
            >
              {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            </button>
          </>
        )}
      </div>

      {/* Update Checker */}
      <UpdateButton collapsed={collapsed} />

      {/* Resize handle */}
      {!collapsed && (
        <div
          onMouseDown={startResize}
          className={`absolute -right-0.5 top-0 bottom-0 w-1 cursor-col-resize transition-colors hover:bg-cafe-primary/40 ${
            dragging ? 'bg-cafe-primary/60' : ''
          }`}
          style={{ userSelect: 'none' }}
        />
      )}

      {showAddProject && <AddProjectModal onClose={() => setShowAddProject(false)} />}
    </div>
  );
}
