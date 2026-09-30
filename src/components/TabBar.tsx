import { useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
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
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { invoke } from '@tauri-apps/api/core';
import { useTabStore } from '../store/tabStore';
import { useTerminalStore } from '../store/terminalStore';
import { useAttentionStore } from '../store/attentionStore';
import { useActivityStore } from '../store/activityStore';
import { StatusDot, statusOf } from './StatusDot';
import { Tab } from '../types';

const EMPTY_TABS: Tab[] = [];

interface TabItemProps {
  tab: Tab;
  isActive: boolean;
  needsAttention: boolean;
  running: boolean;
  index: number;
  onActivate: () => void;
  onClose: () => void;
  onRename: (title: string) => void;
}

function TabItem({ tab, isActive, needsAttention, running, index, onActivate, onClose, onRename }: TabItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: tab.id });
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(tab.title);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  function commitRename() {
    setEditing(false);
    if (editValue.trim() && editValue !== tab.title) {
      onRename(editValue.trim());
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onActivate}
      title={index < 9 ? `${tab.title}  (⌘${index + 1})` : tab.title}
      className={`group relative flex items-center gap-2 px-4 py-2 mt-1.5 text-xs font-medium select-none cursor-pointer rounded-t-lg transition-all duration-150 whitespace-nowrap animate-tab-in ${
        isActive
          ? 'bg-cafe-surface text-cafe-primary font-semibold shadow-cafe-sm -mb-px z-10'
          : 'text-cafe-muted hover:text-cafe-text hover:bg-cafe-hover'
      }`}
    >
      <span
        className={`absolute left-2 right-2 top-0 h-[2px] rounded-full bg-cafe-primary origin-center transition-transform duration-200 ${
          isActive ? 'scale-x-100' : 'scale-x-0'
        }`}
      />
      <StatusDot status={statusOf(needsAttention, running)} />
      {editing ? (
        <input
          className="bg-transparent outline-none text-cafe-text w-20 font-sans text-xs"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditing(false); }}
          autoFocus
          autoCorrect="off"
          spellCheck={false}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); setEditValue(tab.title); }}>
          {tab.title}
        </span>
      )}
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className={`ml-0.5 p-0.5 rounded leading-none transition-all hover:bg-cafe-danger/10 hover:text-cafe-danger ${
          isActive ? 'text-cafe-muted' : 'text-transparent group-hover:text-cafe-muted'
        }`}
        title="Close tab (⌘W)"
      >
        <X size={12} />
      </button>
    </div>
  );
}

interface Props {
  sessionId: string;
}

export function TabBar({ sessionId }: Props) {
  const tabs = useTabStore((s) => s.tabs[sessionId] ?? EMPTY_TABS);
  const activeTabId = useTabStore((s) => s.activeTabId[sessionId] ?? '');
  const { setActiveTab, reorderTabs } = useTabStore();
  const { renameTab, removeTab } = useTabStore();
  const unregisterTerminal = useTerminalStore((s) => s.unregisterTerminal);
  const attentionTabs = useAttentionStore((s) => s.tabs);
  const runningTabs = useActivityStore((s) => s.running);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ left: false, right: false });

  function updateFade() {
    const el = scrollRef.current;
    if (!el) return;
    setFade({
      left: el.scrollLeft > 2,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2,
    });
  }
  useEffect(updateFade, [tabs.length]);
  useEffect(() => {
    window.addEventListener('resize', updateFade);
    return () => window.removeEventListener('resize', updateFade);
  }, []);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = tabs.findIndex((t) => t.id === active.id);
    const newIndex = tabs.findIndex((t) => t.id === over.id);
    const newOrder = arrayMove(tabs, oldIndex, newIndex);
    reorderTabs(sessionId, newOrder.map((t) => t.id));
  }

  function handleClose(tab: Tab) {
    unregisterTerminal(tab.id);
    invoke('close_tab', { tabId: tab.id }).catch(() => {});
    removeTab(tab.id);
  }

  async function handleRename(tabId: string, title: string) {
    await invoke('rename_tab', { tabId, title });
    renameTab(tabId, title);
  }

  async function handleAddTab() {
    try {
      const tab = await invoke<Tab>('create_tab', { sessionId });
      useTabStore.getState().addTab(tab);
    } catch (e) {
      console.error(e);
    }
  }

  return (
    <div
      ref={scrollRef}
      onScroll={updateFade}
      data-tauri-drag-region
      className="flex items-end gap-0.5 px-1 bg-cafe-secondary border-b border-cafe-border overflow-x-auto shrink-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{
        maskImage: `linear-gradient(to right, ${fade.left ? 'transparent, #000 24px' : '#000, #000'}, ${fade.right ? '#000 calc(100% - 24px), transparent' : '#000, #000'})`,
        WebkitMaskImage: `linear-gradient(to right, ${fade.left ? 'transparent, #000 24px' : '#000, #000'}, ${fade.right ? '#000 calc(100% - 24px), transparent' : '#000, #000'})`,
      }}
    >
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={tabs.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
          {tabs.map((tab, i) => (
            <TabItem
              key={tab.id}
              tab={tab}
              index={i}
              running={!!runningTabs[tab.id]}
              isActive={tab.id === activeTabId}
              needsAttention={!!attentionTabs[tab.id]}
              onActivate={() => setActiveTab(sessionId, tab.id)}
              onClose={() => handleClose(tab)}
              onRename={(title) => handleRename(tab.id, title)}
            />
          ))}
        </SortableContext>
      </DndContext>
      <button
        onClick={handleAddTab}
        className="p-2 mb-0.5 rounded-md text-cafe-muted hover:text-cafe-primary hover:bg-cafe-hover transition-colors"
        title="New tab (⌘T)"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
