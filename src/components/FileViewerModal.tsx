import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Props {
  path: string;
  onClose: () => void;
}

export function FileViewerModal({ path, onClose }: Props) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filename = path.split('/').pop() ?? path;
  const isMarkdown = filename.endsWith('.md') || filename.endsWith('.mdx');

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
          ) : isMarkdown ? (
            <div className="p-6 max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h1: ({ children }) => <h1 className="text-2xl font-bold text-white border-b border-[#333] pb-2 mb-4 mt-6 first:mt-0">{children}</h1>,
                  h2: ({ children }) => <h2 className="text-xl font-bold text-white border-b border-[#2a2a2a] pb-1 mb-3 mt-5">{children}</h2>,
                  h3: ({ children }) => <h3 className="text-lg font-semibold text-[#e0e0e0] mb-2 mt-4">{children}</h3>,
                  h4: ({ children }) => <h4 className="text-base font-semibold text-[#d0d0d0] mb-2 mt-3">{children}</h4>,
                  p: ({ children }) => <p className="text-[#ccc] leading-relaxed mb-3 text-sm">{children}</p>,
                  a: ({ href, children }) => <a href={href} className="text-[#58a6ff] hover:underline">{children}</a>,
                  ul: ({ children }) => <ul className="list-disc list-inside text-[#ccc] mb-3 space-y-1 pl-4 text-sm">{children}</ul>,
                  ol: ({ children }) => <ol className="list-decimal list-inside text-[#ccc] mb-3 space-y-1 pl-4 text-sm">{children}</ol>,
                  li: ({ children }) => <li className="text-[#ccc] text-sm">{children}</li>,
                  blockquote: ({ children }) => <blockquote className="border-l-4 border-[#444] pl-4 text-[#999] italic my-3">{children}</blockquote>,
                  code: ({ className, children, ...props }) => {
                    const isBlock = !!className;
                    return isBlock
                      ? <code className="block bg-[#161616] text-[#e0e0e0] font-mono text-[12px] p-4 rounded overflow-auto">{children}</code>
                      : <code className="bg-[#2a2a2a] text-[#e0e0e0] font-mono text-[11px] px-1.5 py-0.5 rounded">{children}</code>;
                  },
                  pre: ({ children }) => <pre className="bg-[#161616] rounded mb-4 overflow-auto">{children}</pre>,
                  hr: () => <hr className="border-[#333] my-6" />,
                  table: ({ children }) => <table className="w-full text-sm border-collapse mb-4">{children}</table>,
                  th: ({ children }) => <th className="border border-[#444] bg-[#2a2a2a] text-[#e0e0e0] font-semibold px-3 py-2 text-left">{children}</th>,
                  td: ({ children }) => <td className="border border-[#333] text-[#ccc] px-3 py-2">{children}</td>,
                  tr: ({ children }) => <tr className="even:bg-[#242424]">{children}</tr>,
                  strong: ({ children }) => <strong className="font-semibold text-[#e0e0e0]">{children}</strong>,
                  em: ({ children }) => <em className="italic text-[#bbb]">{children}</em>,
                }}
              >
                {content}
              </ReactMarkdown>
            </div>
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
