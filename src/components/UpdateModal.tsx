import { createPortal } from 'react-dom';
import { Loader2, CheckCircle2, Download, RotateCw, AlertTriangle } from 'lucide-react';

export type UpdatePhase =
  | { kind: 'checking' }
  | { kind: 'up-to-date' }
  | { kind: 'available'; version: string; currentVersion: string; notes?: string }
  | { kind: 'downloading'; progress: number }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

interface Props {
  phase: UpdatePhase;
  onUpdateNow: () => void;
  onRestartNow: () => void;
  onRetry: () => void;
  onClose: () => void;
}

export function UpdateModal({ phase, onUpdateNow, onRestartNow, onRetry, onClose }: Props) {
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-cafe-text/20 backdrop-blur-sm">
      <div className="bg-cafe-surface border border-cafe-border rounded-xl p-6 w-[420px] shadow-2xl">
        <h2 className="text-cafe-text font-semibold text-sm mb-4">Software Update</h2>

        {phase.kind === 'checking' && (
          <div className="flex items-center gap-2 text-cafe-muted text-xs mb-5">
            <Loader2 size={14} className="animate-spin" />
            Checking for updates…
          </div>
        )}

        {phase.kind === 'up-to-date' && (
          <div className="flex items-center gap-2 text-cafe-success text-xs mb-5">
            <CheckCircle2 size={14} />
            You're up to date.
          </div>
        )}

        {phase.kind === 'available' && (
          <div className="mb-5 bg-cafe-hover rounded-lg p-3 space-y-1.5 border border-cafe-border">
            <div className="flex justify-between">
              <span className="text-cafe-muted text-xs">Current version</span>
              <span className="text-cafe-text text-xs font-mono">{phase.currentVersion}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-cafe-muted text-xs">New version</span>
              <span className="text-cafe-primary text-xs font-mono font-medium">{phase.version}</span>
            </div>
            {phase.notes && (
              <p className="text-cafe-muted text-xs pt-1 border-t border-cafe-border whitespace-pre-line">
                {phase.notes}
              </p>
            )}
          </div>
        )}

        {phase.kind === 'downloading' && (
          <div className="mb-5">
            <div className="flex items-center gap-2 text-cafe-muted text-xs mb-2">
              <Download size={14} />
              Downloading update… {Math.round(phase.progress)}%
            </div>
            <div className="w-full h-2 rounded-full bg-cafe-hover border border-cafe-border overflow-hidden">
              <div
                className="h-full rounded-full bg-cafe-primary transition-all"
                style={{ width: `${phase.progress}%` }}
              />
            </div>
          </div>
        )}

        {phase.kind === 'ready' && (
          <div className="flex items-center gap-2 text-cafe-success text-xs mb-5">
            <RotateCw size={14} />
            Update downloaded. Restart to finish installing.
          </div>
        )}

        {phase.kind === 'error' && (
          <div className="flex items-center gap-2 text-cafe-danger text-xs mb-5">
            <AlertTriangle size={14} />
            {phase.message}
          </div>
        )}

        <div className="flex justify-end gap-2">
          {phase.kind === 'checking' && (
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-xs font-medium rounded-lg bg-cafe-hover text-cafe-text hover:bg-cafe-active transition-colors"
            >
              Cancel
            </button>
          )}

          {phase.kind === 'up-to-date' && (
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-xs font-medium rounded-lg bg-cafe-primary hover:bg-cafe-primary/80 text-white transition-colors"
            >
              OK
            </button>
          )}

          {phase.kind === 'available' && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-1.5 text-xs font-medium rounded-lg bg-cafe-hover text-cafe-text hover:bg-cafe-active transition-colors"
              >
                Later
              </button>
              <button
                onClick={onUpdateNow}
                className="px-4 py-1.5 text-xs font-medium rounded-lg bg-cafe-primary hover:bg-cafe-primary/80 text-white transition-colors"
              >
                Update Now
              </button>
            </>
          )}

          {phase.kind === 'downloading' && (
            <button
              disabled
              className="px-4 py-1.5 text-xs font-medium rounded-lg bg-cafe-primary text-white opacity-50 cursor-not-allowed"
            >
              Downloading…
            </button>
          )}

          {phase.kind === 'ready' && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-1.5 text-xs font-medium rounded-lg bg-cafe-hover text-cafe-text hover:bg-cafe-active transition-colors"
              >
                Later
              </button>
              <button
                onClick={onRestartNow}
                className="px-4 py-1.5 text-xs font-medium rounded-lg bg-cafe-primary hover:bg-cafe-primary/80 text-white transition-colors"
              >
                Restart Now
              </button>
            </>
          )}

          {phase.kind === 'error' && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-1.5 text-xs font-medium rounded-lg bg-cafe-hover text-cafe-text hover:bg-cafe-active transition-colors"
              >
                Close
              </button>
              <button
                onClick={onRetry}
                className="px-4 py-1.5 text-xs font-medium rounded-lg bg-cafe-primary hover:bg-cafe-primary/80 text-white transition-colors"
              >
                Retry
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
