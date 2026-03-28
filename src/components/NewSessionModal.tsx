import { createPortal } from 'react-dom';
import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useSessionStore } from '../store/sessionStore';
import { useTabStore } from '../store/tabStore';
import { Session, Tab } from '../types';

interface Props {
  projectId: string;
  onClose: () => void;
}

export function NewSessionModal({ projectId, onClose }: Props) {
  const [name, setName] = useState('');
  const [branchMode, setBranchMode] = useState<'new' | 'existing'>('new');
  const [baseBranch, setBaseBranch] = useState('');
  const [newBranchName, setNewBranchName] = useState('');
  const [useWorktree, setUseWorktree] = useState(false);
  const [existingBranch, setExistingBranch] = useState('');
  const [branches, setBranches] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const addSession = useSessionStore((s) => s.addSession);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const addTab = useTabStore((s) => s.addTab);

  useEffect(() => {
    invoke<string[]>('list_branches', { projectId }).then((b) => {
      setBranches(b);
      if (b.length > 0) {
        const defaultBranch = b.includes('main') ? 'main' : b[0];
        setBaseBranch(defaultBranch);
        setExistingBranch(defaultBranch);
      }
    });
  }, [projectId]);

  async function handleConfirm() {
    if (!name.trim()) { setError('Session name is required'); return; }
    const branch = branchMode === 'new' ? newBranchName.trim() : existingBranch;
    if (!branch) { setError('Branch is required'); return; }

    setLoading(true);
    setError('');
    try {
      const [session, tab] = await invoke<[Session, Tab]>('create_session', {
        args: {
          project_id: projectId,
          name: name.trim(),
          branch,
          branch_mode: branchMode,
          base_branch: branchMode === 'new' ? baseBranch : null,
          use_worktree: branchMode === 'new' ? useWorktree : false,
        },
      });
      addSession(session);
      addTab(tab);
      setActiveSession(session.id);
      onClose();
    } catch (e: any) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[#161d2e] border border-[#1e2d45] rounded-lg p-6 w-[480px] shadow-xl">
        <h2 className="text-[#e2e8f0] font-semibold text-base mb-4">New Session</h2>

        <div className="space-y-3">
          <div>
            <label className="text-[#8896ab] text-xs block mb-1">Session name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-[#0d1117] border border-[#1e2d45] rounded px-3 py-1.5 text-sm text-[#e2e8f0] outline-none focus:border-blue-500"
              placeholder="my-feature"
              autoFocus
              autoCorrect="off"
              spellCheck={false}
            />
          </div>

          <div>
            <label className="text-[#8896ab] text-xs block mb-1">Branch mode</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-1.5 text-sm text-[#e2e8f0] cursor-pointer">
                <input type="radio" checked={branchMode === 'new'} onChange={() => setBranchMode('new')} />
                New branch
              </label>
              <label className="flex items-center gap-1.5 text-sm text-[#e2e8f0] cursor-pointer">
                <input type="radio" checked={branchMode === 'existing'} onChange={() => setBranchMode('existing')} />
                Existing branch
              </label>
            </div>
          </div>

          {branchMode === 'new' && (
            <>
              <div>
                <label className="text-[#8896ab] text-xs block mb-1">Base branch</label>
                <select
                  value={baseBranch}
                  onChange={(e) => setBaseBranch(e.target.value)}
                  className="w-full bg-[#0d1117] border border-[#1e2d45] rounded px-3 py-1.5 text-sm text-[#e2e8f0] outline-none"
                >
                  {branches.map((b) => <option key={b}>{b}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[#8896ab] text-xs block mb-1">New branch name</label>
                <input
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  className="w-full bg-[#0d1117] border border-[#1e2d45] rounded px-3 py-1.5 text-sm text-[#e2e8f0] outline-none focus:border-blue-500"
                  placeholder="feature/my-change"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-[#e2e8f0] cursor-pointer">
                <input
                  type="checkbox"
                  checked={useWorktree}
                  onChange={(e) => setUseWorktree(e.target.checked)}
                />
                Create as worktree
              </label>
            </>
          )}

          {branchMode === 'existing' && (
            <div>
              <label className="text-[#8896ab] text-xs block mb-1">Select branch</label>
              <select
                value={existingBranch}
                onChange={(e) => setExistingBranch(e.target.value)}
                className="w-full bg-[#0d1117] border border-[#1e2d45] rounded px-3 py-1.5 text-sm text-[#e2e8f0] outline-none"
              >
                {branches.map((b) => <option key={b}>{b}</option>)}
              </select>
            </div>
          )}
        </div>

        {error && <p className="text-red-400 text-sm mt-3">{error}</p>}

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm rounded bg-[#1e2d45] text-[#e2e8f0] hover:bg-[#253047] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className="px-4 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50"
          >
            {loading ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
