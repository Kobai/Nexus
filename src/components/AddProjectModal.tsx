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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[#252525] border border-[#3a3a3a] rounded-lg p-6 w-[400px] shadow-xl">
        <h2 className="text-[#d4d4d4] font-semibold text-base mb-4">Add Project</h2>
        <p className="text-[#888] text-sm mb-4">Select a git repository folder.</p>
        {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm rounded bg-[#3a3a3a] text-[#d4d4d4] hover:bg-[#444] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handlePick}
            disabled={loading}
            className="px-4 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50"
          >
            {loading ? 'Adding…' : 'Browse…'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
