import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { RefreshCw, ChevronDown, ChevronRight, X } from 'lucide-react';

interface Props {
  projectId: string;
}

interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
  lineNo: number;
}

interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

interface DiffFile {
  filename: string;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

function parseDiff(raw: string): DiffFile[] {
  const files: DiffFile[] = [];
  const sections = raw.split(/^diff --git /m).filter(Boolean);

  for (const section of sections) {
    const lines = section.split('\n');
    const header = lines[0];
    const m = header.match(/ b\/(.+)$/);
    const parts = header.split(' ');
    const filename = m ? m[1] : (parts[parts.length - 1] ?? 'unknown');

    let additions = 0;
    let deletions = 0;
    const hunks: DiffHunk[] = [];
    let hunk: DiffHunk | null = null;
    let oldNo = 0;
    let newNo = 0;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('@@')) {
        const hm = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/);
        oldNo = hm ? parseInt(hm[1]) : 1;
        newNo = hm ? parseInt(hm[2]) : 1;
        const ctx = hm?.[3]?.trim() ?? '';
        hunk = { header: ctx, lines: [] };
        hunks.push(hunk);
        continue;
      }
      if (
        !hunk ||
        line.startsWith('index ') ||
        line.startsWith('--- ') ||
        line.startsWith('+++ ') ||
        line.startsWith('new file') ||
        line.startsWith('deleted file') ||
        line.startsWith('Binary') ||
        line.startsWith('old mode') ||
        line.startsWith('new mode')
      ) continue;

      if (line.startsWith('+')) {
        additions++;
        hunk.lines.push({ type: 'add', content: line.slice(1), lineNo: newNo++ });
      } else if (line.startsWith('-')) {
        deletions++;
        hunk.lines.push({ type: 'remove', content: line.slice(1), lineNo: oldNo++ });
      } else {
        hunk.lines.push({ type: 'context', content: line.startsWith(' ') ? line.slice(1) : line, lineNo: newNo });
        oldNo++;
        newNo++;
      }
    }

    if (hunks.length > 0 || additions > 0 || deletions > 0) {
      files.push({ filename, additions, deletions, hunks });
    }
  }

  return files;
}

function FileSection({ file }: { file: DiffFile }) {
  const [open, setOpen] = useState(true);

  return (
    <div className="border border-cafe-border rounded-lg overflow-hidden mb-2">
      {/* File header */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-cafe-hover hover:bg-cafe-active transition-colors text-left"
      >
        {open ? (
          <ChevronDown size={11} className="text-cafe-muted shrink-0" />
        ) : (
          <ChevronRight size={11} className="text-cafe-muted shrink-0" />
        )}
        <span className="text-[11px] font-mono text-cafe-text truncate flex-1 min-w-0">{file.filename}</span>
        <span className="text-[10px] text-cafe-success shrink-0 font-medium">+{file.additions}</span>
        <span className="text-[10px] text-cafe-danger shrink-0 ml-1 font-medium">-{file.deletions}</span>
      </button>

      {open && file.hunks.map((hunk, hi) => (
        <div key={hi}>
          {/* Hunk header */}
          <div className="px-3 py-1 bg-cafe-secondary border-t border-cafe-border">
            <span className="text-[10px] text-cafe-muted font-mono">
              {hunk.header ? `… ${hunk.header}` : '…'}
            </span>
          </div>
          {/* Lines */}
          <div className="font-mono text-[11px] leading-5">
            {hunk.lines.map((line, li) => {
              const isAdd = line.type === 'add';
              const isRemove = line.type === 'remove';
              return (
                <div
                  key={li}
                  className={`flex ${
                    isAdd ? 'bg-green-50' : isRemove ? 'bg-red-50' : 'bg-white'
                  }`}
                >
                  <span className={`select-none w-8 shrink-0 text-right pr-2 border-r text-[10px] ${
                    isAdd ? 'text-green-400 border-green-100' :
                    isRemove ? 'text-red-300 border-red-100' :
                    'text-cafe-border border-cafe-border'
                  }`}>
                    {line.lineNo}
                  </span>
                  <span className={`pl-2 pr-3 whitespace-pre-wrap break-all ${
                    isAdd ? 'text-green-800' : isRemove ? 'text-red-700' : 'text-cafe-muted'
                  }`}>
                    <span className={`mr-1 ${isAdd ? 'text-green-400' : isRemove ? 'text-red-300' : 'opacity-0'}`}>
                      {isAdd ? '+' : isRemove ? '−' : '+'}
                    </span>
                    {line.content}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export function GitDiffPanel({ projectId }: Props) {
  const [files, setFiles] = useState<DiffFile[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  async function fetchDiff() {
    setLoading(true);
    setError(null);
    try {
      const raw = await invoke<string>('get_git_diff', { projectId });
      setFiles(parseDiff(raw));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchDiff(); }, [projectId]);

  const totalAdd = files?.reduce((s, f) => s + f.additions, 0) ?? 0;
  const totalDel = files?.reduce((s, f) => s + f.deletions, 0) ?? 0;

  const visibleFiles = files && query
    ? files.filter(f => f.filename.toLowerCase().includes(query.toLowerCase()))
    : files;

  return (
    <div className="flex flex-col h-full bg-cafe-surface">
      <div className="flex items-center justify-between px-3 py-2 border-b border-cafe-border shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-cafe-primary tracking-wide">Changes</span>
          {files && files.length > 0 && (
            <span className="text-[10px] text-cafe-muted">
              {(visibleFiles ?? []).length}{query ? `/${files.length}` : ''} file{files.length !== 1 ? 's' : ''}
              <span className="text-cafe-success ml-1.5 font-medium">+{totalAdd}</span>
              <span className="text-cafe-danger ml-1 font-medium">-{totalDel}</span>
            </span>
          )}
        </div>
        <button
          onClick={fetchDiff}
          className="text-cafe-border hover:text-cafe-muted transition-colors"
          title="Refresh"
        >
          <RefreshCw size={11} />
        </button>
      </div>

      <div className="px-2 py-1.5 border-b border-cafe-border shrink-0">
        <div className="relative flex items-center">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter files..."
            autoCorrect="off"
            spellCheck={false}
            className="w-full bg-cafe-hover border border-cafe-border rounded-lg px-2 py-1 text-xs text-cafe-text placeholder:text-cafe-border outline-none focus:border-cafe-primary transition-colors font-sans"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-1.5 text-cafe-border hover:text-cafe-muted transition-colors"
            >
              <X size={10} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-3">
        {loading && <div className="text-xs text-cafe-border py-2">Loading...</div>}
        {error && <div className="text-xs text-cafe-danger py-2">{error}</div>}
        {!loading && !error && visibleFiles !== null && (
          visibleFiles!.length === 0
            ? <div className="text-xs text-cafe-border py-2 italic">{query ? 'No files match' : 'No changes'}</div>
            : visibleFiles!.map((f, i) => <FileSection key={i} file={f} />)
        )}
      </div>
    </div>
  );
}
