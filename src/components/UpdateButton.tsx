import { useEffect, useState } from 'react';
import { check, Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { getVersion } from '@tauri-apps/api/app';
import { Download } from 'lucide-react';
import { UpdateModal, UpdatePhase } from './UpdateModal';

interface Props {
  collapsed: boolean;
}

const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function UpdateButton({ collapsed }: Props) {
  const [available, setAvailable] = useState<Update | null>(null);
  const [currentVersion, setCurrentVersion] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [phase, setPhase] = useState<UpdatePhase>({ kind: 'checking' });

  async function silentCheck() {
    try {
      const v = await getVersion();
      setCurrentVersion(v);
      const update = await check();
      if (update?.available) setAvailable(update);
    } catch {
      // silently ignore background check failures
    }
  }

  useEffect(() => {
    silentCheck();
    const timer = setInterval(silentCheck, RECHECK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  async function openAndCheck() {
    setShowModal(true);
    setPhase({ kind: 'checking' });
    try {
      const v = currentVersion || (await getVersion());
      setCurrentVersion(v);
      const update = await check();
      if (update?.available) {
        setAvailable(update);
        setPhase({
          kind: 'available',
          version: update.version,
          currentVersion: v,
          notes: update.body,
        });
      } else {
        setAvailable(null);
        setPhase({ kind: 'up-to-date' });
      }
    } catch (e) {
      setPhase({ kind: 'error', message: String(e) });
    }
  }

  async function handleUpdateNow() {
    if (!available) return;
    let total = 0;
    let downloaded = 0;
    setPhase({ kind: 'downloading', progress: 0 });
    try {
      await available.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            total = event.data.contentLength ?? 0;
            break;
          case 'Progress':
            downloaded += event.data.chunkLength;
            setPhase({
              kind: 'downloading',
              progress: total > 0 ? Math.min((downloaded / total) * 100, 100) : 0,
            });
            break;
          case 'Finished':
            setPhase({ kind: 'ready' });
            break;
        }
      });
    } catch (e) {
      setPhase({ kind: 'error', message: String(e) });
    }
  }

  async function handleRestartNow() {
    await relaunch();
  }

  function handleRetry() {
    openAndCheck();
  }

  const badge = available !== null;

  if (collapsed) {
    return (
      <div className="px-2 py-1.5">
        <button
          onClick={openAndCheck}
          title={badge ? `Update ${available?.version} available` : 'Check for updates'}
          className="relative w-full flex items-center justify-center text-cafe-muted hover:text-cafe-primary hover:bg-cafe-hover rounded-md py-1 transition-colors"
        >
          <Download size={12} />
          {badge && (
            <span className="absolute top-0.5 right-1.5 w-1.5 h-1.5 rounded-full bg-cafe-primary" />
          )}
        </button>
        {showModal && (
          <UpdateModal
            phase={phase}
            onUpdateNow={handleUpdateNow}
            onRestartNow={handleRestartNow}
            onRetry={handleRetry}
            onClose={() => setShowModal(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="px-3 py-2 border-t border-cafe-border">
      <button
        onClick={openAndCheck}
        className="w-full flex items-center justify-between text-cafe-muted hover:text-cafe-primary hover:bg-cafe-hover rounded-md px-1 py-1 transition-colors"
        title="Check for updates"
      >
        <span className="text-xs flex items-center gap-1.5">
          <Download size={12} />
          {badge ? `Update available: ${available?.version}` : 'Check for updates'}
        </span>
        {badge && <span className="w-1.5 h-1.5 rounded-full bg-cafe-primary" />}
      </button>
      {showModal && (
        <UpdateModal
          phase={phase}
          onUpdateNow={handleUpdateNow}
          onRestartNow={handleRestartNow}
          onRetry={handleRetry}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
