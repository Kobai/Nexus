import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { RefreshCw } from 'lucide-react';
import { ClaudeUsageModal } from './ClaudeUsageModal';

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
  collapsed: boolean;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

function formatCountdown(resetAt: number, nowSecs: number): string {
  const remaining = Math.max(0, resetAt - nowSecs);
  const h = Math.floor(remaining / 3600);
  const m = Math.ceil((remaining % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return 'now';
}

export function ClaudeUsageBar({ collapsed }: Props) {
  const [usage, setUsage] = useState<UsageResult | null>(null);
  const [settings, setSettings] = useState<UsageSettings>({ window_hours: 5, limit: 0 });
  const [showModal, setShowModal] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [tickSecs, setTickSecs] = useState(() => Math.floor(Date.now() / 1000));
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function loadData() {
    try {
      const [u, s] = await Promise.all([
        invoke<UsageResult>('get_claude_usage'),
        invoke<UsageSettings>('get_usage_settings'),
      ]);
      setUsage(u);
      setSettings(s);
      setTickSecs(Math.floor(Date.now() / 1000));
    } catch {
      // silently ignore
    }
  }

  useEffect(() => {
    loadData();
    const dataTimer = setInterval(loadData, 60_000);
    intervalRef.current = setInterval(() => {
      setTickSecs(Math.floor(Date.now() / 1000));
    }, 30_000);
    return () => {
      clearInterval(dataTimer);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await invoke('invalidate_usage_cache');
      await loadData();
    } finally {
      setRefreshing(false);
    }
  }

  function onSettingsSaved(s: UsageSettings) {
    setSettings(s);
    setShowModal(false);
    loadData();
  }

  const { tokens_in_window, oldest_in_window_secs, window_hours } = usage ?? {
    tokens_in_window: 0,
    oldest_in_window_secs: null,
    window_hours: settings.window_hours,
  };

  const pct =
    settings.limit > 0
      ? Math.min((tokens_in_window / settings.limit) * 100, 100)
      : null;

  const barColor =
    pct === null ? 'bg-cafe-primary'
    : pct >= 90 ? 'bg-cafe-danger'
    : pct >= 70 ? 'bg-cafe-warning'
    : 'bg-cafe-success';

  const resetAt =
    oldest_in_window_secs !== null
      ? oldest_in_window_secs + window_hours * 3600
      : null;

  const countdownLabel = resetAt ? formatCountdown(resetAt, tickSecs) : null;

  if (collapsed) {
    return (
      <div className="px-2 py-2">
        <div
          className="w-full h-1 rounded-full bg-cafe-border cursor-pointer overflow-hidden"
          title={
            tokens_in_window > 0
              ? `${formatTokens(tokens_in_window)} tokens · last ${window_hours}h${countdownLabel ? ` · resets in ${countdownLabel}` : ''}`
              : `No Claude usage in last ${window_hours}h`
          }
          onClick={() => setShowModal(true)}
        >
          {tokens_in_window > 0 && (
            <div
              className={`h-full rounded-full transition-all ${barColor}`}
              style={{ width: pct !== null ? `${pct}%` : '100%', opacity: pct === null ? 0.4 : 1 }}
            />
          )}
        </div>
        {showModal && (
          <ClaudeUsageModal
            usage={usage}
            settings={settings}
            onSave={onSettingsSaved}
            onClose={() => setShowModal(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="px-3 py-2 border-t border-cafe-border">
      <div
        className="cursor-pointer"
        onClick={() => setShowModal(true)}
        title="Click to configure"
      >
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-cafe-muted text-xs">
            Claude · {window_hours}h
          </span>
          <div className="flex items-center gap-1.5">
            <span className="text-cafe-primary text-xs font-mono">
              {formatTokens(tokens_in_window)}
              {settings.limit > 0 && ` / ${formatTokens(settings.limit)}`}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); handleRefresh(); }}
              disabled={refreshing}
              className="text-cafe-border hover:text-cafe-muted transition-colors disabled:opacity-40"
              title="Refresh usage"
            >
              <RefreshCw size={10} className={refreshing ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
        <div className="w-full h-1 rounded-full bg-cafe-border overflow-hidden">
          {tokens_in_window > 0 && (
            <div
              className={`h-full rounded-full transition-all ${barColor}`}
              style={{ width: pct !== null ? `${pct}%` : '30%', opacity: pct === null ? 0.4 : 1 }}
            />
          )}
        </div>
        {countdownLabel && (
          <p className="text-cafe-border text-xs mt-1">
            Resets in {countdownLabel}
          </p>
        )}
      </div>
      {showModal && (
        <ClaudeUsageModal
          usage={usage}
          settings={settings}
          onSave={onSettingsSaved}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
