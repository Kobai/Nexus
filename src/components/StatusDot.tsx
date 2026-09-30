export type Status = 'running' | 'waiting' | 'idle';

const styles: Record<Status, string> = {
  running: 'bg-cafe-success animate-status-pulse',
  waiting: 'bg-cafe-warning animate-blink',
  idle: 'bg-cafe-border',
};

const labels: Record<Status, string> = {
  running: 'Running',
  waiting: 'Waiting for input',
  idle: 'Idle',
};

export function StatusDot({ status, className = '' }: { status: Status; className?: string }) {
  return (
    <span
      title={labels[status]}
      className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 transition-colors ${styles[status]} ${className}`}
    />
  );
}

export function statusOf(waiting: boolean, running: boolean): Status {
  return waiting ? 'waiting' : running ? 'running' : 'idle';
}
