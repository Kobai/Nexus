import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { X } from 'lucide-react';

interface Props {
  path: string;
  onClose: () => void;
}

export function FileViewerModal({ path, onClose }: Props) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filename = path.split('/').pop() ?? path;

  useEffect(() => {
    invoke<string>('read_file', { path })
      .then(setContent)
      .catch((e) => setError(String(e)));

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [path]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex flex-col bg-[#1e1e1e] border border-[#333] rounded-lg shadow-2xl w-[70vw] h-[75vh] max-w-4xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2a2a] shrink-0">
          <span className="text-sm font-mono text-[#ccc] truncate">{filename}</span>
          <button
            onClick={onClose}
            className="text-[#555] hover:text-[#aaa] transition-colors ml-4 shrink-0"
          >
            <X size={15} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {error ? (
            <div className="p-4 text-xs text-[#f87171]">{error}</div>
          ) : content === null ? (
            <div className="p-4 text-xs text-[#444]">Loading...</div>
          ) : (
            <pre className="p-4 text-[12px] leading-relaxed font-mono text-[#ccc] whitespace-pre">
              {content}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
