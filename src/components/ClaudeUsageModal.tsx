import { createPortal } from 'react-dom';
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface UsageResult {
  tokens_in_window: number;
  oldest_in_window_secs: number | null;
  now_secs: number;
  window_hours: number;
}

interface UsageSettings {
  window_hours: number;
  limit: number;
}

interface Props {
  usage: UsageResult | null;
  settings: UsageSettings;
  onSave: (settings: UsageSettings) => void;
  onClose: () => void;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function ClaudeUsageModal({ usage, settings, onSave, onClose }: Props) {
  const [windowHours, setWindowHours] = useState(String(settings.window_hours));
  const [limit, setLimit] = useState(settings.limit > 0 ? String(settings.limit) : '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    const wh = parseInt(windowHours, 10);
    if (isNaN(wh) || wh < 1 || wh > 24) {
      setError('Window must be between 1 and 24 hours');
      return;
    }
    const lim = limit.trim() === '' ? 0 : parseInt(limit, 10);
    if (isNaN(lim) || lim < 0) {
      setError('Token limit must be a positive number, or leave blank');
      return;
    }
    setSaving(true);
    try {
      await invoke('set_usage_settings', { windowHours: wh, limit: lim });
      onSave({ window_hours: wh, limit: lim });
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  const tokensInWindow = usage?.tokens_in_window ?? 0;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[#161d2e] border border-[#1e2d45] rounded-lg p-6 w-[420px] shadow-xl">
        <h2 className="text-[#e2e8f0] font-semibold text-base mb-4">Claude Usage Monitor</h2>

        {/* Current window stats */}
        <div className="mb-5 bg-[#111827] rounded p-3 space-y-1">
          <div className="flex justify-between">
            <span className="text-[#8896ab] text-xs">Tokens this window</span>
            <span className="text-[#e2e8f0] text-xs font-mono">{formatTokens(tokensInWindow)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#8896ab] text-xs">Window size</span>
            <span className="text-[#e2e8f0] text-xs font-mono">{settings.window_hours}h rolling</span>
          </div>
          {usage?.oldest_in_window_secs !== null && usage?.oldest_in_window_secs !== undefined && (
            <div className="flex justify-between">
              <span className="text-[#8896ab] text-xs">Next reset</span>
              <span className="text-[#e2e8f0] text-xs font-mono">
                {new Date(
                  (usage.oldest_in_window_secs + settings.window_hours * 3600) * 1000
                ).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          )}
        </div>

        {/* Window hours config */}
        <label className="block text-[#8896ab] text-xs mb-1">
          Window size (hours)
          <span className="text-[#3d4e63] ml-1">— Claude Code uses a 5h rolling window</span>
        </label>
        <input
          type="number"
          value={windowHours}
          onChange={(e) => setWindowHours(e.target.value)}
          min={1}
          max={24}
          className="w-full bg-[#111827] border border-[#1e2d45] rounded px-3 py-1.5 text-sm text-[#e2e8f0] outline-none focus:border-blue-500 mb-4"
        />

        {/* Optional token limit */}
        <label className="block text-[#8896ab] text-xs mb-1">
          Token limit per window
          <span className="text-[#3d4e63] ml-1">— optional, for % bar</span>
        </label>
        <input
          type="number"
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          placeholder="Leave blank to show raw count only"
          className="w-full bg-[#111827] border border-[#1e2d45] rounded px-3 py-1.5 text-sm text-[#e2e8f0] outline-none focus:border-blue-500 mb-1"
        />
        <p className="text-[#3d4e63] text-xs mb-4">
          Anthropic doesn't publish Claude Max token limits — set a number that matches your observed cutoff.
        </p>

        {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm rounded bg-[#1e2d45] text-[#e2e8f0] hover:bg-[#253047] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
