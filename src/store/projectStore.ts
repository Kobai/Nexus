import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { Project } from '../types';

interface ProjectStore {
  projects: Project[];
  setProjects: (projects: Project[]) => void;
  addProject: (project: Project) => void;
  removeProject: (id: string) => void;
  reorderProjects: (ids: string[]) => void;
}

function reorder(items: Project[], ids: string[]): Project[] {
  return ids
    .map((id, i) => {
      const item = items.find((p) => p.id === id);
      return item ? { ...item, sort_order: i } : null;
    })
    .filter(Boolean) as Project[];
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  setProjects: (projects) => set({ projects }),
  addProject: (project) => set((s) => ({ projects: [...s.projects, project] })),
  removeProject: (id) =>
    set((s) => ({ projects: s.projects.filter((p) => p.id !== id) })),
  reorderProjects: (ids) => {
    const prev = get().projects;
    set({ projects: reorder(prev, ids) });
    invoke('reorder_projects', { ids }).catch(() => set({ projects: prev }));
  },
}));
