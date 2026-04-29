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

const inputClass = 'w-full bg-cafe-hover border border-cafe-border rounded-lg px-3 py-1.5 text-xs text-cafe-text outline-none focus:border-cafe-primary focus:ring-1 focus:ring-cafe-primary/20 transition-colors font-mono placeholder:text-cafe-muted';
const labelClass = 'block text-cafe-muted text-xs font-medium mb-1';

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-cafe-text/20 backdrop-blur-sm">
      <div className="bg-cafe-surface border border-cafe-border rounded-xl p-6 w-[420px] shadow-2xl">
        <h2 className="text-cafe-text font-semibold text-sm mb-4">Claude Usage Monitor</h2>

        {/* Current window stats */}
        <div className="mb-5 bg-cafe-hover rounded-lg p-3 space-y-1.5 border border-cafe-border">
          <div className="flex justify-between">
            <span className="text-cafe-muted text-xs">Tokens this window</span>
            <span className="text-cafe-primary text-xs font-mono font-medium">{formatTokens(tokensInWindow)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-cafe-muted text-xs">Window size</span>
            <span className="text-cafe-text text-xs font-mono">{settings.window_hours}h rolling</span>
          </div>
          {usage?.oldest_in_window_secs !== null && usage?.oldest_in_window_secs !== undefined && (
            <div className="flex justify-between">
              <span className="text-cafe-muted text-xs">Next reset</span>
              <span className="text-cafe-text text-xs font-mono">
                {new Date(
                  (usage.oldest_in_window_secs + settings.window_hours * 3600) * 1000
                ).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          )}
        </div>

        {/* Window hours config */}
        <label className={labelClass}>
          Window size (hours)
          <span className="text-cafe-border font-normal ml-1">— Claude Code uses a 5h rolling window</span>
        </label>
        <input
          type="number"
          value={windowHours}
          onChange={(e) => setWindowHours(e.target.value)}
          min={1}
          max={24}
          className={`${inputClass} mb-4`}
        />

        {/* Optional token limit */}
        <label className={labelClass}>
          Token limit per window
          <span className="text-cafe-border font-normal ml-1">— optional, for % bar</span>
        </label>
        <input
          type="number"
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          placeholder="Leave blank to show raw count only"
          className={`${inputClass} mb-1`}
        />
        <p className="text-cafe-border text-xs mb-4">
          Anthropic doesn't publish Claude Max token limits — set a number that matches your observed cutoff.
        </p>

        {error && <p className="text-cafe-danger text-xs mb-3">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-medium rounded-lg bg-cafe-hover text-cafe-text hover:bg-cafe-active transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 text-xs font-medium rounded-lg bg-cafe-primary hover:bg-cafe-primary/80 text-white transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
