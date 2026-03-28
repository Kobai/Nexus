import { useEffect, useRef, useState, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { X, Search } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

function getLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
    rs: 'rust', py: 'python', go: 'go', rb: 'ruby', java: 'java',
    c: 'c', cpp: 'cpp', cs: 'csharp', swift: 'swift', kt: 'kotlin',
    css: 'css', scss: 'scss', html: 'html', json: 'json',
    yaml: 'yaml', yml: 'yaml', toml: 'toml', sh: 'bash',
    sql: 'sql', graphql: 'graphql', xml: 'xml',
  };
  return map[ext] ?? 'text';
}

interface Props {
  path: string;
  onClose: () => void;
}

export function FileViewerModal({ path, onClose }: Props) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  const [searchVisible, setSearchVisible] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const filename = path.split('/').pop() ?? path;
  const isMarkdown = filename.endsWith('.md') || filename.endsWith('.mdx');

  useEffect(() => {
    invoke<string>('read_file', { path })
      .then(setContent)
      .catch((e) => setError(String(e)));
  }, [path]);

  // Keyboard handling
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        setSearchVisible(true);
        // defer focus so the input is mounted
        setTimeout(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        }, 0);
        return;
      }
      if (e.key === 'Escape') {
        if (query) {
          setQuery('');
          setSearchVisible(false);
        } else {
          onClose();
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [path, query]);

  // Matched lines (1-indexed) in order
  const matchedLines = useMemo(() => {
    if (!query || !content) return [];
    const lower = query.toLowerCase();
    return content.split('\n').reduce<number[]>((acc, line, i) => {
      if (line.toLowerCase().includes(lower)) acc.push(i + 1);
      return acc;
    }, []);
  }, [query, content]);

  // Total individual occurrences
  const totalMatches = useMemo(() => {
    if (!query || !content) return 0;
    const lower = query.toLowerCase();
    const src = content.toLowerCase();
    let count = 0, pos = 0;
    while ((pos = src.indexOf(lower, pos)) !== -1) { count++; pos += lower.length; }
    return count;
  }, [query, content]);

  const matchLineSet = useMemo(() => new Set(matchedLines), [matchedLines]);
  const clampedIndex = matchedLines.length > 0 ? matchIndex % matchedLines.length : 0;
  const currentLine = matchedLines[clampedIndex] ?? null;

  // Reset index when query changes
  useEffect(() => { setMatchIndex(0); }, [query]);

  // Scroll to current matched line
  useEffect(() => {
    if (!contentRef.current || !currentLine || !content) return;
    const totalLines = content.split('\n').length;
    const ratio = (currentLine - 1) / Math.max(totalLines - 1, 1);
    const el = contentRef.current;
    el.scrollTop = ratio * (el.scrollHeight - el.clientHeight);
  }, [clampedIndex, matchedLines]);

  function navigate(dir: 1 | -1) {
    if (matchedLines.length === 0) return;
    setMatchIndex((i) => (i + dir + matchedLines.length) % matchedLines.length);
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      navigate(e.shiftKey ? -1 : 1);
    }
    if (e.key === 'Escape') {
      setQuery('');
      setSearchVisible(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex flex-col bg-[#111827] border border-[#1a2640] rounded-lg shadow-2xl w-[70vw] h-[75vh] max-w-4xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#1a2235] shrink-0">
          <span className="text-sm font-mono text-[#c8d6e5] truncate">{filename}</span>
          <div className="flex items-center gap-2 ml-4 shrink-0">
            <button
              onClick={() => {
                setSearchVisible((v) => !v);
                if (!searchVisible) {
                  setTimeout(() => {
                    searchInputRef.current?.focus();
                    searchInputRef.current?.select();
                  }, 0);
                }
              }}
              className={`transition-colors ${searchVisible ? 'text-[#94a3b8]' : 'text-[#3d4e63] hover:text-[#94a3b8]'}`}
              title="Search (⌘F)"
            >
              <Search size={14} />
            </button>
            <button onClick={onClose} className="text-[#3d4e63] hover:text-[#94a3b8] transition-colors">
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Search bar */}
        {searchVisible && (
          <div className="flex items-center gap-2 px-4 py-2 border-b border-[#1a2235] bg-[#0d1117] shrink-0">
            <Search size={13} className="text-[#3d4e63] shrink-0" />
            <input
              ref={searchInputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search…"
              autoComplete="off"
              spellCheck={false}
              className="flex-1 bg-transparent text-sm text-[#e2e8f0] placeholder-[#253047] outline-none"
            />
            {query && (
              <span className="text-xs text-[#3d4e63] font-mono shrink-0">
                {totalMatches === 0
                  ? 'no matches'
                  : `${clampedIndex + 1} / ${totalMatches}`}
              </span>
            )}
            <div className="flex gap-1">
              <button
                onClick={() => navigate(-1)}
                disabled={matchedLines.length === 0}
                className="text-[#3d4e63] hover:text-[#94a3b8] disabled:opacity-30 px-1 text-xs"
                title="Previous (⇧↵)"
              >
                ↑
              </button>
              <button
                onClick={() => navigate(1)}
                disabled={matchedLines.length === 0}
                className="text-[#3d4e63] hover:text-[#94a3b8] disabled:opacity-30 px-1 text-xs"
                title="Next (↵)"
              >
                ↓
              </button>
            </div>
          </div>
        )}

        {/* Content */}
        <div ref={contentRef} className="flex-1 overflow-auto">
          {error ? (
            <div className="p-4 text-xs text-[#f87171]">{error}</div>
          ) : content === null ? (
            <div className="p-4 text-xs text-[#253047]">Loading...</div>
          ) : isMarkdown ? (
            <div className="p-6 max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h1: ({ children }) => <h1 className="text-2xl font-bold text-white border-b border-[#1a2640] pb-2 mb-4 mt-6 first:mt-0">{children}</h1>,
                  h2: ({ children }) => <h2 className="text-xl font-bold text-white border-b border-[#1a2235] pb-1 mb-3 mt-5">{children}</h2>,
                  h3: ({ children }) => <h3 className="text-lg font-semibold text-[#e8eef5] mb-2 mt-4">{children}</h3>,
                  h4: ({ children }) => <h4 className="text-base font-semibold text-[#d0d0d0] mb-2 mt-3">{children}</h4>,
                  p: ({ children }) => <p className="text-[#c8d6e5] leading-relaxed mb-3 text-sm">{children}</p>,
                  a: ({ href, children }) => <a href={href} className="text-[#58a6ff] hover:underline">{children}</a>,
                  ul: ({ children }) => <ul className="list-disc list-inside text-[#c8d6e5] mb-3 space-y-1 pl-4 text-sm">{children}</ul>,
                  ol: ({ children }) => <ol className="list-decimal list-inside text-[#c8d6e5] mb-3 space-y-1 pl-4 text-sm">{children}</ol>,
                  li: ({ children }) => <li className="text-[#c8d6e5] text-sm">{children}</li>,
                  blockquote: ({ children }) => <blockquote className="border-l-4 border-[#253047] pl-4 text-[#7889a0] italic my-3">{children}</blockquote>,
                  code: ({ className, children }) => {
                    const match = /language-(\w+)/.exec(className ?? '');
                    return match ? (
                      <SyntaxHighlighter
                        language={match[1]}
                        style={oneDark}
                        customStyle={{ margin: 0, fontSize: '12px' }}
                      >
                        {String(children).replace(/\n$/, '')}
                      </SyntaxHighlighter>
                    ) : (
                      <code className="bg-[#1a2235] text-[#e8eef5] font-mono text-[11px] px-1.5 py-0.5 rounded">
                        {children}
                      </code>
                    );
                  },
                  pre: ({ children }) => <pre className="bg-[#0a0f1a] rounded mb-4 overflow-auto">{children}</pre>,
                  hr: () => <hr className="border-[#1a2640] my-6" />,
                  table: ({ children }) => <table className="w-full text-sm border-collapse mb-4">{children}</table>,
                  th: ({ children }) => <th className="border border-[#253047] bg-[#1a2235] text-[#e8eef5] font-semibold px-3 py-2 text-left">{children}</th>,
                  td: ({ children }) => <td className="border border-[#1a2640] text-[#c8d6e5] px-3 py-2">{children}</td>,
                  tr: ({ children }) => <tr className="even:bg-[#141c2c]">{children}</tr>,
                  strong: ({ children }) => <strong className="font-semibold text-[#e8eef5]">{children}</strong>,
                  em: ({ children }) => <em className="italic text-[#94a3b8]">{children}</em>,
                }}
              >
                {content}
              </ReactMarkdown>
            </div>
          ) : (
            <SyntaxHighlighter
              language={getLanguage(filename)}
              style={oneDark}
              customStyle={{ margin: 0, fontSize: '12px', lineHeight: '1.6' }}
              showLineNumbers
              lineNumberStyle={{ color: '#1e2d45', minWidth: '2.5em' }}
              wrapLines
              lineProps={(lineNumber) => {
                if (!matchLineSet.has(lineNumber)) return {};
                return {
                  style: {
                    display: 'block',
                    backgroundColor: lineNumber === currentLine
                      ? 'rgba(250, 200, 50, 0.2)'
                      : 'rgba(250, 200, 50, 0.08)',
                  },
                };
              }}
            >
              {content}
            </SyntaxHighlighter>
          )}
        </div>
      </div>
    </div>
  );
}
