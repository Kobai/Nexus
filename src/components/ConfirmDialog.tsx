import { createPortal } from 'react-dom';

interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  destructive = false,
  onConfirm,
  onCancel,
}: Props) {
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-cafe-text/30 backdrop-blur-sm animate-fade-in">
      <div className="bg-cafe-surface border border-cafe-border rounded-xl p-6 w-[400px] shadow-cafe-lg animate-scale-in">
        <h2 className="text-cafe-text font-semibold text-sm mb-2">{title}</h2>
        <p className="text-cafe-muted text-xs leading-relaxed mb-6">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 text-xs font-medium rounded-lg bg-cafe-hover text-cafe-text hover:bg-cafe-active transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              destructive
                ? 'bg-cafe-danger hover:bg-cafe-danger/85 text-white'
                : 'bg-cafe-primary hover:bg-cafe-primary/80 text-white'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
