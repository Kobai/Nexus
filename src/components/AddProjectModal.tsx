import { createPortal } from 'react-dom';
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { useProjectStore } from '../store/projectStore';
import { Project } from '../types';

interface Props {
  onClose: () => void;
}

export function AddProjectModal({ onClose }: Props) {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const addProject = useProjectStore((s) => s.addProject);

  async function handlePick() {
    console.log('Attempting to open file dialog...');
    let selected: string | string[] | null = null;
    try {
      selected = await open({ directory: true, multiple: false });
    } catch (e) {
      console.error('Error opening file dialog:', e);
      setError(String(e));
      return;
    }
    if (!selected || typeof selected !== 'string') return;

    const name = selected.split('/').filter(Boolean).pop() || 'Project';
    setLoading(true);
    setError('');

    try {
      const project = await invoke<Project>('add_project', { name, path: selected });
      addProject(project);
      onClose();
    } catch (e: any) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-cafe-text/20 backdrop-blur-sm">
      <div className="bg-cafe-surface border border-cafe-border rounded-xl p-6 w-[400px] shadow-2xl">
        <h2 className="text-cafe-text font-semibold text-sm mb-1">Add Project</h2>
        <p className="text-cafe-muted text-xs mb-5">Select a git repository folder.</p>
        {error && <p className="text-cafe-danger text-xs mb-3">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-medium rounded-lg bg-cafe-hover text-cafe-text hover:bg-cafe-active transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handlePick}
            disabled={loading}
            className="px-4 py-1.5 text-xs font-medium rounded-lg bg-cafe-primary hover:bg-cafe-primary/80 text-white transition-colors disabled:opacity-50"
          >
            {loading ? 'Adding…' : 'Browse…'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
