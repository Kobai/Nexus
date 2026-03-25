export interface Project {
  id: string;
  name: string;
  path: string;
  sort_order: number;
  created_at: string;
}

export interface Session {
  id: string;
  project_id: string;
  name: string;
  branch: string;
  is_worktree: boolean;
  worktree_path: string | null;
  sort_order: number;
  created_at: string;
}

export interface Tab {
  id: string;
  session_id: string;
  title: string;
  sort_order: number;
  created_at: string;
}

export interface AppData {
  projects: Project[];
  sessions: Session[];
  tabs: Tab[];
}

export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children: FileNode[];
}
