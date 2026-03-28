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
      className={`flex items-center gap-1 px-3 py-1.5 text-sm select-none cursor-pointer border-b-2 ${
        isActive
          ? 'border-blue-500 text-[#e2e8f0] bg-[#161d2e]'
          : 'border-transparent text-[#8896ab] hover:text-[#e2e8f0] hover:bg-[#111827]'
      }`}
    >
      {editing ? (
        <input
          className="bg-transparent outline-none text-[#e2e8f0] w-20"
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
        className="ml-1 text-[#3d4e63] hover:text-[#e2e8f0] leading-none"
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
    <div className="flex items-end bg-[#0d1117] border-b border-[#1e2d45] overflow-x-auto">
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
        className="px-3 py-1.5 text-[#3d4e63] hover:text-[#e2e8f0] text-lg leading-none"
        title="New tab"
      >
        +
      </button>
    </div>
  );
}
