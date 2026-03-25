import { useState } from 'react';
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
        className={`flex items-center justify-between px-3 py-1.5 cursor-pointer text-sm group ${
          isActive
            ? 'bg-[#2a2a2a] border-l-2 border-blue-500 text-[#d4d4d4]'
            : 'text-[#888] hover:text-[#d4d4d4] hover:bg-[#1e1e1e] border-l-2 border-transparent'
        }`}
        onClick={() => setActiveSession(session.id)}
      >
        <span className="truncate">{session.name}</span>
        <button
          onClick={(e) => { e.stopPropagation(); setConfirmStop(true); }}
          className="opacity-0 group-hover:opacity-100 text-[#555] hover:text-red-400 text-xs px-1"
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
        className="w-12 h-12 flex items-center justify-center text-[#888] hover:text-[#d4d4d4] hover:bg-[#252525] cursor-pointer text-lg font-semibold"
        {...attributes}
        {...listeners}
      >
        {project.name[0].toUpperCase()}
      </div>
    );
  }

  return (
    <div ref={setNodeRef} style={style}>
      <div
        className="flex items-center justify-between px-3 py-2 group cursor-pointer hover:bg-[#1e1e1e]"
        {...attributes}
        {...listeners}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            onClick={(e) => { e.stopPropagation(); setCollapsed((c) => !c); }}
            className="text-[#555] hover:text-[#d4d4d4] text-xs w-4 flex-shrink-0"
          >
            {collapsed ? '▶' : '▼'}
          </button>
          <span className="text-[#d4d4d4] text-sm font-medium truncate">{project.name}</span>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
          <button
            onClick={(e) => { e.stopPropagation(); setShowNewSession(true); }}
            className="text-[#555] hover:text-[#d4d4d4] text-base leading-none px-0.5"
            title="New session"
          >
            +
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setConfirmRemove(true); }}
            className="text-[#555] hover:text-red-400 text-xs px-0.5"
            title="Remove project"
          >
            ×
          </button>
        </div>
      </div>

      {!collapsed && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleSessionDragEnd}>
          <SortableContext items={sessions.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            {sessions.map((session) => (
              <SessionItem key={session.id} session={session} projectId={project.id} />
            ))}
          </SortableContext>
        </DndContext>
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
      className="flex-shrink-0 bg-[#1a1a1a] border-r border-[#3a3a3a] flex flex-col relative"
      style={{ width: effectiveWidth }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#3a3a3a]">
        {!collapsed && <span className="text-[#d4d4d4] text-sm font-semibold">Nexus</span>}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="text-[#555] hover:text-[#d4d4d4] text-xs"
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
      <div className="border-t border-[#3a3a3a] p-2">
        <button
          onClick={() => setShowAddProject(true)}
          className="w-full text-[#555] hover:text-[#d4d4d4] text-sm py-1 hover:bg-[#252525] rounded"
          title="Add project"
        >
          {collapsed ? '+' : '+ Add Project'}
        </button>
      </div>

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
