import { useEffect, useMemo, useState, memo, lazy, Suspense } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ChevronRight, ChevronDown, Folder, FolderOpen, File, X, RefreshCw, FolderX, SearchX } from 'lucide-react';
import { FileNode } from '../types';
import { toast } from '../store/toastStore';

// react-markdown, remark-gfm, react-syntax-highlighter (full Prism), and mermaid
// only matter once a file preview is actually opened — lazy-load so their ~1MB+
// of JS isn't parsed on every app cold start.
const FileViewerModal = lazy(() => import('./FileViewerModal').then((m) => ({ default: m.FileViewerModal })));

const treeCache = new Map<string, { data: FileNode[] }>();
const SEARCH_DEBOUNCE = 150;

function flattenTree(nodes: FileNode[]): FileNode[] {
  const result: FileNode[] = [];
  for (const node of nodes) {
    if (!node.is_dir) {
      result.push(node);
    }
    if (node.children.length > 0) {
      result.push(...flattenTree(node.children));
    }
  }
  return result;
}

interface Props {
  projectId: string;
}

interface TreeNodeProps {
  node: FileNode;
  depth: number;
  onOpenFile: (path: string) => void;
}

const TreeNode = memo(function TreeNode({ node, depth, onOpenFile }: TreeNodeProps) {
  const [open, setOpen] = useState(false);

  if (!node.is_dir) {
    return (
      <div
        className="flex items-center gap-1.5 py-0.5 hover:bg-cafe-hover cursor-pointer rounded transition-colors"
        style={{ paddingLeft: `${8 + depth * 12}px`, paddingRight: '8px' }}
        onClick={() => onOpenFile(node.path)}
      >
        <File size={12} className="text-cafe-border shrink-0" />
        <span className="text-xs text-cafe-muted truncate">{node.name}</span>
      </div>
    );
  }

  return (
    <div>
      <div
        className="flex items-center gap-1 py-0.5 hover:bg-cafe-hover cursor-pointer rounded transition-colors"
        style={{ paddingLeft: `${8 + depth * 12}px`, paddingRight: '8px' }}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? (
          <ChevronDown size={11} className="text-cafe-border shrink-0" />
        ) : (
          <ChevronRight size={11} className="text-cafe-border shrink-0" />
        )}
        {open ? (
          <FolderOpen size={12} className="text-cafe-warning shrink-0" />
        ) : (
          <Folder size={12} className="text-cafe-warning/70 shrink-0" />
        )}
        <span className="text-xs text-cafe-text font-medium truncate">{node.name}</span>
      </div>
      {open && node.children.map((child) => (
        <TreeNode key={child.path} node={child} depth={depth + 1} onOpenFile={onOpenFile} />
      ))}
    </div>
  );
});

export function FileTreePanel({ projectId }: Props) {
  const [tree, setTree] = useState<FileNode[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openFilePath, setOpenFilePath] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  const fetchTree = (force: boolean) => {
    if (!force) {
      const cached = treeCache.get(projectId);
      if (cached) {
        setTree(cached.data);
        setLoading(false);
        setError(null);
        return;
      }
    }
    setLoading(true);
    setError(null);
    invoke<FileNode[]>('get_file_tree', { projectId, maxDepth: 4 })
      .then((data) => {
        treeCache.set(projectId, { data });
        setTree(data);
      })
      .catch((e) => { setError(String(e)); toast('Failed to load files', 'error'); })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchTree(false);
  }, [projectId]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE);
    return () => clearTimeout(timer);
  }, [query]);

  const filteredFiles = useMemo(() => {
    if (!debouncedQuery || !tree) return null;
    return flattenTree(tree).filter(n =>
      n.path.toLowerCase().includes(debouncedQuery.toLowerCase())
    );
  }, [debouncedQuery, tree]);

  const showSearchResults = filteredFiles !== null;

  return (
    <>
      <div className="flex flex-col h-full bg-cafe-surface">
        <div className="px-3 py-2 border-b border-cafe-border shrink-0 flex items-center justify-between">
          <span className="text-xs font-semibold text-cafe-primary tracking-wide">Files</span>
          <button
            onClick={() => fetchTree(true)}
            disabled={loading}
            title="Refresh file tree"
            className="text-cafe-border hover:text-cafe-primary transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
        <div className="px-2 py-1.5 border-b border-cafe-border shrink-0">
          <div className="relative flex items-center">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search files..."
              autoCorrect="off"
              spellCheck={false}
              disabled={tree === null}
              className="w-full bg-cafe-hover border border-cafe-border rounded-lg px-2 py-1 text-xs text-cafe-text placeholder:text-cafe-border outline-none focus:border-cafe-primary transition-colors font-sans disabled:opacity-50"
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
        <div className="flex-1 overflow-auto py-1">
          {loading && (
            <div className="px-3 py-3 space-y-2 animate-fade-in">
              {[60, 40, 75, 50, 65, 45, 55].map((w, i) => (
                <div key={i} className="skeleton h-3.5 rounded" style={{ width: `${w}%`, marginLeft: i % 3 === 1 ? 12 : 0 }} />
              ))}
            </div>
          )}
          {error && (
            <div className="px-3 py-4 text-xs text-cafe-danger">{error}</div>
          )}
          {!loading && !error && tree !== null && (
            tree.length === 0 ? (
              <div className="flex flex-col items-center justify-center text-center py-10 animate-fade-in">
                <div className="w-12 h-12 rounded-full bg-cafe-hover flex items-center justify-center mb-3">
                  <FolderX size={20} className="text-cafe-muted" />
                </div>
                <p className="text-xs font-semibold text-cafe-text">No files</p>
                <p className="text-[11px] text-cafe-muted mt-1">This directory is empty</p>
              </div>
            ) : showSearchResults && filteredFiles!.length === 0 ? (
              <div className="flex flex-col items-center justify-center text-center py-10 animate-fade-in">
                <div className="w-12 h-12 rounded-full bg-cafe-hover flex items-center justify-center mb-3">
                  <SearchX size={20} className="text-cafe-muted" />
                </div>
                <p className="text-xs font-semibold text-cafe-text">No files match</p>
                <p className="text-[11px] text-cafe-muted mt-1">Try a different search</p>
              </div>
            ) : showSearchResults ? (
              filteredFiles!.map((node) => (
                <div
                  key={node.path}
                  className="flex items-center gap-1.5 px-2 py-0.5 hover:bg-cafe-hover cursor-pointer rounded transition-colors"
                  onClick={() => setOpenFilePath(node.path)}
                >
                  <File size={12} className="text-cafe-border shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs text-cafe-text truncate">{node.name}</div>
                    <div className="text-[10px] text-cafe-muted truncate">{node.path}</div>
                  </div>
                </div>
              ))
            ) : (
              tree.map((node) => (
                <TreeNode key={node.path} node={node} depth={0} onOpenFile={setOpenFilePath} />
              ))
            )
          )}
        </div>
      </div>

      {openFilePath && (
        <Suspense fallback={null}>
          <FileViewerModal path={openFilePath} onClose={() => setOpenFilePath(null)} />
        </Suspense>
      )}
    </>
  );
}
