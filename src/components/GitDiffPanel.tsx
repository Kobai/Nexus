import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { RefreshCw, ChevronDown, ChevronRight, X } from 'lucide-react';

interface Props {
  projectId: string;
}

interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
  lineNo: number; // new line no for add/context, old line no for remove
}

interface DiffHunk {
  header: string; // function/method context from @@ line
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
    const header = lines[0]; // "a/foo b/bar"
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
      // skip metadata lines
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
        // context line (starts with space or is empty within hunk)
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
    <div className="border border-[#1a2740] rounded-md overflow-hidden mb-3">
      {/* File header */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-[#0d1117] hover:bg-[#131924] transition-colors text-left"
      >
        {open ? (
          <ChevronDown size={11} className="text-[#3d4e63] shrink-0" />
        ) : (
          <ChevronRight size={11} className="text-[#3d4e63] shrink-0" />
        )}
        <span className="text-[11px] font-mono text-[#c8d6e5] truncate flex-1 min-w-0">{file.filename}</span>
        <span className="text-[10px] text-[#4ec994] shrink-0">+{file.additions}</span>
        <span className="text-[10px] text-[#f87171] shrink-0 ml-1">-{file.deletions}</span>
      </button>

      {open && file.hunks.map((hunk, hi) => (
        <div key={hi}>
          {/* Hunk header */}
          <div className="px-3 py-1 bg-[#1e2433] border-t border-[#1a2740]">
            <span className="text-[10px] text-[#5b7ab8] font-mono">
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
                    isAdd ? 'bg-[#0d2b1a]' : isRemove ? 'bg-[#2b0d0d]' : ''
                  }`}
                >
                  <span className={`select-none w-8 shrink-0 text-right pr-2 border-r ${
                    isAdd ? 'text-[#2d6e47] border-[#1a4028]' :
                    isRemove ? 'text-[#7a2e2e] border-[#4a1a1a]' :
                    'text-[#1e2d45] border-[#1a2235]'
                  }`}>
                    {line.lineNo}
                  </span>
                  <span className={`pl-2 pr-3 whitespace-pre-wrap break-all ${
                    isAdd ? 'text-[#4ec994]' : isRemove ? 'text-[#f87171]' : 'text-[#7889a0]'
                  }`}>
                    <span className={`mr-1 ${isAdd ? 'text-[#2d6e47]' : isRemove ? 'text-[#7a2e2e]' : 'opacity-0'}`}>
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
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#1a2235] shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-[#8896ab]">Changes</span>
          {files && files.length > 0 && (
            <span className="text-[10px] text-[#3d4e63]">
              {(visibleFiles ?? []).length}{query ? `/${files.length}` : ''} file{files.length !== 1 ? 's' : ''}
              <span className="text-[#2d6e47] ml-1.5">+{totalAdd}</span>
              <span className="text-[#7a2e2e] ml-1">-{totalDel}</span>
            </span>
          )}
        </div>
        <button
          onClick={fetchDiff}
          className="text-[#3d4e63] hover:text-[#7889a0] transition-colors"
          title="Refresh"
        >
          <RefreshCw size={11} />
        </button>
      </div>

      <div className="px-2 py-1.5 border-b border-[#1a2235] shrink-0">
        <div className="relative flex items-center">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter files..."
            autoCorrect="off"
            spellCheck={false}
            className="w-full bg-[#0d1117] border border-[#1e2d45] rounded px-2 py-1 text-xs text-[#c8d6e5] placeholder-[#3d4e63] outline-none focus:border-[#3d4e63]"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-1.5 text-[#3d4e63] hover:text-[#7889a0]"
            >
              <X size={10} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-3">
        {loading && <div className="text-xs text-[#253047] py-2">Loading...</div>}
        {error && <div className="text-xs text-[#f87171] py-2">{error}</div>}
        {!loading && !error && visibleFiles !== null && (
          visibleFiles!.length === 0
            ? <div className="text-xs text-[#253047] py-2">{query ? 'No files match' : 'No changes'}</div>
            : visibleFiles!.map((f, i) => <FileSection key={i} file={f} />)
        )}
      </div>
    </div>
  );
}
