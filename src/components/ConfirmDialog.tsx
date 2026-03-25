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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[#252525] border border-[#3a3a3a] rounded-lg p-6 w-[400px] shadow-xl">
        <h2 className="text-[#d4d4d4] font-semibold text-base mb-2">{title}</h2>
        <p className="text-[#888] text-sm mb-6">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 text-sm rounded bg-[#3a3a3a] text-[#d4d4d4] hover:bg-[#444] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-1.5 text-sm rounded transition-colors ${
              destructive
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : 'bg-blue-600 hover:bg-blue-700 text-white'
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
