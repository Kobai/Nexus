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
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { invoke } from '@tauri-apps/api/core';
import { useTabStore } from '../store/tabStore';
import { useTerminalStore } from '../store/terminalStore';
import { Tab } from '../types';

const EMPTY_TABS: Tab[] = [];

interface TabItemProps {
  tab: Tab;
  isActive: boolean;
  onActivate: () => void;
  onClose: () => void;
  onRename: (title: string) => void;
}

function TabItem({ tab, isActive, onActivate, onClose, onRename }: TabItemProps) {
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
      className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium select-none cursor-pointer border-b-2 transition-colors whitespace-nowrap ${
        isActive
          ? 'border-b-cafe-primary text-cafe-primary bg-cafe-surface'
          : 'border-b-transparent text-cafe-muted hover:text-cafe-text hover:bg-cafe-hover'
      }`}
    >
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
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className={`ml-0.5 leading-none transition-colors ${
          isActive ? 'text-cafe-muted hover:text-cafe-danger' : 'text-cafe-border hover:text-cafe-danger'
        }`}
      >
        ×
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

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = tabs.findIndex((t) => t.id === active.id);
    const newIndex = tabs.findIndex((t) => t.id === over.id);
    const newOrder = arrayMove(tabs, oldIndex, newIndex);
    reorderTabs(sessionId, newOrder.map((t) => t.id));
  }

  async function handleClose(tab: Tab) {
    unregisterTerminal(tab.id);
    await invoke('close_tab', { tabId: tab.id });
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
    <div className="flex items-end bg-cafe-secondary border-b border-cafe-border overflow-x-auto shrink-0">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={tabs.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
          {tabs.map((tab) => (
            <TabItem
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTabId}
              onActivate={() => setActiveTab(sessionId, tab.id)}
              onClose={() => handleClose(tab)}
              onRename={(title) => handleRename(tab.id, title)}
            />
          ))}
        </SortableContext>
      </DndContext>
      <button
        onClick={handleAddTab}
        className="px-3 py-2 text-cafe-border hover:text-cafe-primary text-lg leading-none transition-colors"
        title="New tab"
      >
        +
      </button>
    </div>
  );
}
