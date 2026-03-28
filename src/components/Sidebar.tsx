import { useState, useRef } from 'react';
import { Folder, Trash2 } from 'lucide-react';
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
import { ConfirmDialog } from './ConfirmDialog';
import { NewSessionModal } from './NewSessionModal';
import { AddProjectModal } from './AddProjectModal';
import { ClaudeUsageBar } from './ClaudeUsageBar';
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
  const [confirmStop, setConfirmStop] = useState(false);

  const isActive = activeSessionId === session.id;

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
        className={`flex items-center justify-between px-3 py-1.5 cursor-pointer text-sm group border border-[#1a2235] rounded mx-1 my-0.5 border-l-2 ${
          isActive
            ? 'bg-[#1a2235] border-l-blue-500 text-[#e2e8f0]'
            : 'text-[#8896ab] hover:text-[#e2e8f0] hover:bg-[#111827]'
        }`}
        onClick={() => setActiveSession(session.id)}
      >
        <span className="truncate">{session.name}</span>
        <button
          onClick={(e) => { e.stopPropagation(); setConfirmStop(true); }}
          className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-400 text-xs px-1"
          title="Stop session"
        >
          ■
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
        className="w-12 h-12 flex items-center justify-center text-[#8896ab] hover:text-[#e2e8f0] hover:bg-[#161d2e] cursor-pointer text-lg font-semibold"
        {...attributes}
        {...listeners}
      >
        {/* Folder icon for collapsed state */}
        <Folder size={16} />
      </div>
    );
  }

  return (
    <div ref={setNodeRef} style={style} className="border border-[#1a2740] rounded mx-2 my-1 pb-1">
      <div
        className="flex items-center justify-between px-3 py-2 group cursor-pointer hover:bg-[#111827]"
        {...attributes}
        {...listeners}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setContextMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={(e) => { e.stopPropagation(); setCollapsed((c) => !c); }}
            className="text-[#3d4e63] hover:text-[#e2e8f0] text-xs w-4 flex-shrink-0"
          >
            {collapsed ? '▶' : '▼'}
          </button>
          <Folder size={16} className="text-[#8be9fd]/50" />
          <span className="text-[#e2e8f0] text-sm font-medium truncate">{project.name}</span>
        </div>
        <div className="opacity-0 group-hover:opacity-100">
          <button
            onClick={(e) => { e.stopPropagation(); setShowNewSession(true); }}
            className="text-[#50fa7b] hover:text-[#50fa7b]/80 text-base leading-none px-0.5"
            title="New session"
          >
            +
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
            className="fixed z-50 bg-[#161d2e] border border-[#1e2d45] rounded shadow-xl py-1 min-w-[160px]"
            style={{ top: contextMenu.y, left: contextMenu.x }}
          >
            <button
              onClick={(e) => { e.stopPropagation(); setContextMenu(null); setConfirmRemove(true); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-400 hover:bg-[#1a2235] hover:text-red-300"
            >
              <Trash2 size={14} />
              Remove project
            </button>
          </div>
        </>
      )}

      {!collapsed && (
        <div className="pl-4">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleSessionDragEnd}>
            <SortableContext items={sessions.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              {sessions.map((session) => (
                <SessionItem key={session.id} session={session} projectId={project.id} />
              ))}
            </SortableContext>
          </DndContext>
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
  const [_dragging, setDragging] = useState(false);

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
      className="flex-shrink-0 bg-[#0d1117] border-r border-[#1e2d45] flex flex-col relative"
      style={{ width: effectiveWidth }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#1e2d45]">
        {!collapsed && <span className="text-[#e2e8f0] text-sm font-semibold">Projects</span>}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="text-[#3d4e63] hover:text-[#e2e8f0] text-xs"
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? '▶' : '◀'}
        </button>
      </div>

      {/* Project List */}
      <div className="flex-1 overflow-y-auto">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleProjectDragEnd}>
          <SortableContext items={projects.map((p) => p.id)} strategy={verticalListSortingStrategy}>
            {projects.map((project) => (
              <ProjectItem key={project.id} project={project} sidebarCollapsed={collapsed} />
            ))}
          </SortableContext>
        </DndContext>
      </div>

      {/* Add Project */}
      <div className="border-t border-[#1e2d45] p-2">
        <button
          onClick={() => setShowAddProject(true)}
          className="w-full text-[#3d4e63] hover:text-[#e2e8f0] text-sm py-1 hover:bg-[#161d2e] rounded"
          title="Add project"
        >
          {collapsed ? '+' : '+ Add Project'}
        </button>
      </div>

      {/* Claude Usage */}
      <ClaudeUsageBar collapsed={collapsed} />

      {/* Resize handle */}
      {!collapsed && (
        <div
          onMouseDown={startResize}
          className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500/50"
          style={{ userSelect: 'none' }}
        />
      )}

      {showAddProject && <AddProjectModal onClose={() => setShowAddProject(false)} />}
    </div>
  );
}
