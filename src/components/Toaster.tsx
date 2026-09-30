import { CheckCircle2, Info, XCircle } from 'lucide-react';
import { useToastStore } from '../store/toastStore';

const icons = {
  success: <CheckCircle2 size={14} className="text-cafe-success" />,
  error: <XCircle size={14} className="text-cafe-danger" />,
  info: <Info size={14} className="text-cafe-primary" />,
};

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="animate-slide-up flex items-center gap-2 px-3.5 py-2 rounded-lg bg-cafe-surface border border-cafe-border shadow-cafe-lg text-xs text-cafe-text"
        >
          {icons[t.kind]}
          {t.message}
        </div>
      ))}
    </div>
  );
}
