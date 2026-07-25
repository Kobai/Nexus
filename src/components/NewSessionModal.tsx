import { createPortal } from 'react-dom';
import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { RefreshCw } from 'lucide-react';
import { useSessionStore } from '../store/sessionStore';
import { useTabStore } from '../store/tabStore';
import { Session, Tab } from '../types';

interface Props {
  projectId: string;
  onClose: () => void;
}

const inputClass = 'w-full bg-cafe-hover border border-cafe-border rounded-lg px-3 py-1.5 text-xs text-cafe-text outline-none focus:border-cafe-primary focus:ring-1 focus:ring-cafe-primary/20 transition-colors placeholder:text-cafe-muted font-sans';
const selectClass = 'w-full bg-cafe-hover border border-cafe-border rounded-lg px-3 py-1.5 text-xs text-cafe-text outline-none focus:border-cafe-primary transition-colors font-sans';
const labelClass = 'text-cafe-muted text-xs font-medium block mb-1';

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
  const [pulling, setPulling] = useState(false);
  const [pullStatus, setPullStatus] = useState<'success' | 'error' | null>(null);

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

  async function handlePull() {
    if (!baseBranch || pulling) return;
    setPulling(true);
    setPullStatus(null);
    try {
      await invoke('fetch_and_pull_branch', { projectId, branch: baseBranch });
      setPullStatus('success');
    } catch (e: any) {
      setError(String(e));
      setPullStatus('error');
    } finally {
      setPulling(false);
    }
  }

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-cafe-text/20 backdrop-blur-sm">
      <div className="bg-cafe-surface border border-cafe-border rounded-xl p-6 w-[480px] shadow-2xl">
        <h2 className="text-cafe-text font-semibold text-sm mb-4">New Session</h2>

        <div className="space-y-3">
          <div>
            <label className={labelClass}>Session name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              placeholder="my-feature"
              autoFocus
              autoCorrect="off"
              spellCheck={false}
            />
          </div>

          <div>
            <label className={labelClass}>Branch mode</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-1.5 text-xs text-cafe-text cursor-pointer">
                <input
                  type="radio"
                  checked={branchMode === 'new'}
                  onChange={() => setBranchMode('new')}
                  className="accent-cafe-primary"
                />
                New branch
              </label>
              <label className="flex items-center gap-1.5 text-xs text-cafe-text cursor-pointer">
                <input
                  type="radio"
                  checked={branchMode === 'existing'}
                  onChange={() => setBranchMode('existing')}
                  className="accent-cafe-primary"
                />
                Existing branch
              </label>
            </div>
          </div>

          {branchMode === 'new' && (
            <>
              <div>
                <label className={labelClass}>Base branch</label>
                <div className="flex items-center gap-2">
                  <select
                    value={baseBranch}
                    onChange={(e) => { setBaseBranch(e.target.value); setPullStatus(null); }}
                    className={selectClass}
                  >
                    {branches.map((b) => <option key={b}>{b}</option>)}
                  </select>
                  <button
                    type="button"
                    onClick={handlePull}
                    disabled={pulling || !baseBranch}
                    title={`Fetch & pull ${baseBranch}`}
                    className="flex-shrink-0 p-1.5 rounded-lg border border-cafe-border bg-cafe-hover text-cafe-muted hover:text-cafe-text hover:bg-cafe-active disabled:opacity-40 transition-colors"
                  >
                    <RefreshCw
                      size={13}
                      className={pulling ? 'animate-spin' : ''}
                      strokeWidth={pullStatus === 'success' ? 2.5 : 2}
                      color={pullStatus === 'success' ? 'var(--color-cafe-success, #16a34a)' : undefined}
                    />
                  </button>
                </div>
              </div>
              <div>
                <label className={labelClass}>New branch name</label>
                <input
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  className={inputClass}
                  placeholder="feature/my-change"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-cafe-text cursor-pointer">
                <input
                  type="checkbox"
                  checked={useWorktree}
                  onChange={(e) => setUseWorktree(e.target.checked)}
                  className="accent-cafe-primary"
                />
                Create as worktree
              </label>
            </>
          )}

          {branchMode === 'existing' && (
            <div>
              <label className={labelClass}>Select branch</label>
              <select
                value={existingBranch}
                onChange={(e) => setExistingBranch(e.target.value)}
                className={selectClass}
              >
                {branches.map((b) => <option key={b}>{b}</option>)}
              </select>
            </div>
          )}
        </div>

        {error && <p className="text-cafe-danger text-xs mt-3">{error}</p>}

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-medium rounded-lg bg-cafe-hover text-cafe-text hover:bg-cafe-active transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className="px-4 py-1.5 text-xs font-medium rounded-lg bg-cafe-primary hover:bg-cafe-primary/80 text-white transition-colors disabled:opacity-50"
          >
            {loading ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
