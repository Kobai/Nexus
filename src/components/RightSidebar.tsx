import { useMemo, useRef, useState } from 'react';
import { GitBranch, FolderTree } from 'lucide-react';
import { useSessionStore } from '../store/sessionStore';
import { GitDiffPanel } from './GitDiffPanel';
import { FileTreePanel } from './FileTreePanel';

type Panel = 'git' | 'filetree';

const MIN_WIDTH = 200;
const MAX_WIDTH = 600;
const DEFAULT_WIDTH = MAX_WIDTH;

interface IconButtonProps {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  active: boolean;
  onClick: () => void;
  title: string;
}

function IconButton({ icon: Icon, active, onClick, title }: IconButtonProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${
        active
          ? 'text-[#ddd] bg-[#2a2a2a]'
          : 'text-[#555] hover:text-[#999]'
      }`}
    >
      <Icon size={16} />
    </button>
  );
}

export function RightSidebar() {
  const [activePanel, setActivePanel] = useState<Panel | null>(null);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_WIDTH);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragStartX = useRef<number | null>(null);
  const dragStartWidth = useRef(DEFAULT_WIDTH);

  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);

  const activeProjectId = useMemo(() => {
    if (!activeSessionId) return null;
    for (const [projectId, list] of Object.entries(sessions)) {
      if (list.some((s) => s.id === activeSessionId)) return projectId;
    }
    return null;
  }, [activeSessionId, sessions]);

  function toggle(panel: Panel) {
    setActivePanel((prev) => (prev === panel ? null : panel));
  }

  function onDragMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    dragStartX.current = e.clientX;
    dragStartWidth.current = panelWidth;
    if (panelRef.current) panelRef.current.style.transition = 'none';

    function onMouseMove(e: MouseEvent) {
      if (dragStartX.current === null || !panelRef.current) return;
      const delta = dragStartX.current - e.clientX;
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragStartWidth.current + delta));
      panelRef.current.style.width = `${next}px`;
    }

    function onMouseUp(e: MouseEvent) {
      if (dragStartX.current !== null) {
        const delta = dragStartX.current - e.clientX;
        const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragStartWidth.current + delta));
        setPanelWidth(next);
      }
      dragStartX.current = null;
      if (panelRef.current) panelRef.current.style.transition = '';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  const expanded = activePanel !== null && activeProjectId !== null;

  return (
    <div className="flex h-full border-l border-[#2a2a2a] shrink-0">
      {/* Content panel */}
      <div
        ref={panelRef}
        className="overflow-hidden transition-[width] duration-200 relative flex"
        style={{ width: expanded ? panelWidth : 0 }}
      >
        {/* Drag handle */}
        {expanded && (
          <div
            onMouseDown={onDragMouseDown}
            className="absolute left-0 top-0 w-1 h-full cursor-col-resize z-10 hover:bg-[#4a4a4a] transition-colors"
          />
        )}
        <div className="flex-1 overflow-hidden">
          {activeProjectId && activePanel === 'git' && (
            <GitDiffPanel projectId={activeProjectId} />
          )}
          {activeProjectId && activePanel === 'filetree' && (
            <FileTreePanel projectId={activeProjectId} />
          )}
        </div>
      </div>

      {/* Icon rail */}
      <div className="w-12 flex flex-col items-center pt-3 gap-2 border-l border-[#2a2a2a] shrink-0">
        <IconButton
          icon={GitBranch}
          active={activePanel === 'git'}
          onClick={() => toggle('git')}
          title="Git Diff"
        />
        <IconButton
          icon={FolderTree}
          active={activePanel === 'filetree'}
          onClick={() => toggle('filetree')}
          title="File Tree"
        />
      </div>
    </div>
  );
}
