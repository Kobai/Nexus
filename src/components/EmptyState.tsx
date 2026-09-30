import type { ComponentType, ReactNode } from 'react';

interface Props {
  icon: ComponentType<{ size?: number; className?: string }>;
  title: string;
  hint?: string;
  action?: ReactNode;
}

export function EmptyState({ icon: Icon, title, hint, action }: Props) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-2 px-6 text-center animate-fade-in">
      <div className="w-12 h-12 rounded-full bg-cafe-hover flex items-center justify-center shadow-cafe-sm mb-1">
        <Icon size={20} className="text-cafe-primary/70" />
      </div>
      <p className="text-cafe-text text-sm font-semibold">{title}</p>
      {hint && <p className="text-cafe-muted text-xs max-w-[260px]">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
