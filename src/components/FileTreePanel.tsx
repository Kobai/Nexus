import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ChevronRight, ChevronDown, Folder, FolderOpen, File, X } from 'lucide-react';
import { FileNode } from '../types';
import { FileViewerModal } from './FileViewerModal';

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

function TreeNode({ node, depth, onOpenFile }: TreeNodeProps) {
  const [open, setOpen] = useState(false);

  if (!node.is_dir) {
    return (
      <div
        className="flex items-center gap-1 py-0.5 hover:bg-[#1a2235] cursor-pointer rounded"
        style={{ paddingLeft: `${8 + depth * 12}px`, paddingRight: '8px' }}
        onClick={() => onOpenFile(node.path)}
      >
        <File size={12} className="text-[#3d4e63] shrink-0" />
        <span className="text-xs text-[#94a3b8] truncate">{node.name}</span>
      </div>
    );
  }

  return (
    <div>
      <div
        className="flex items-center gap-1 px-2 py-0.5 hover:bg-[#1a2235] cursor-pointer rounded"
        style={{ paddingLeft: `${8 + depth * 12}px` }}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? (
          <ChevronDown size={12} className="text-[#3d4e63] shrink-0" />
        ) : (
          <ChevronRight size={12} className="text-[#3d4e63] shrink-0" />
        )}
        {open ? (
          <FolderOpen size={12} className="text-[#e8c468] shrink-0" />
        ) : (
          <Folder size={12} className="text-[#e8c468] shrink-0" />
        )}
        <span className="text-xs text-[#c8d6e5] truncate">{node.name}</span>
      </div>
      {open && node.children.map((child) => (
        <TreeNode key={child.path} node={child} depth={depth + 1} onOpenFile={onOpenFile} />
      ))}
    </div>
  );
}

export function FileTreePanel({ projectId }: Props) {
  const [tree, setTree] = useState<FileNode[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openFilePath, setOpenFilePath] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    setLoading(true);
    setError(null);
    invoke<FileNode[]>('get_file_tree', { projectId, maxDepth: 4 })
      .then(setTree)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [projectId]);

  return (
    <>
      <div className="flex flex-col h-full">
        <div className="px-3 py-2 border-b border-[#1e2d45]">
          <span className="text-xs font-medium text-[#8896ab]">File Tree</span>
        </div>
        <div className="px-2 py-1.5 border-b border-[#1e2d45]">
          <div className="relative flex items-center">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search files..."
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
        <div className="flex-1 overflow-auto py-1">
          {loading && (
            <div className="px-3 py-4 text-xs text-[#3d4e63]">Loading...</div>
          )}
          {error && (
            <div className="px-3 py-4 text-xs text-[#f87171]">{error}</div>
          )}
          {!loading && !error && tree !== null && (
            tree.length === 0 ? (
              <div className="px-3 py-4 text-xs text-[#3d4e63]">Empty directory</div>
            ) : query ? (
              (() => {
                const filtered = flattenTree(tree).filter(n =>
                  n.path.toLowerCase().includes(query.toLowerCase())
                );
                return filtered.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-[#3d4e63]">No files match</div>
                ) : (
                  filtered.map((node) => (
                    <div
                      key={node.path}
                      className="flex items-center gap-1 px-2 py-0.5 hover:bg-[#1a2235] cursor-pointer rounded"
                      onClick={() => setOpenFilePath(node.path)}
                    >
                      <File size={12} className="text-[#3d4e63] shrink-0" />
                      <div className="min-w-0">
                        <div className="text-xs text-[#94a3b8] truncate">{node.name}</div>
                        <div className="text-[10px] text-[#3d4e63] truncate">{node.path}</div>
                      </div>
                    </div>
                  ))
                );
              })()
            ) : (
              tree.map((node) => (
                <TreeNode key={node.path} node={node} depth={0} onOpenFile={setOpenFilePath} />
              ))
            )
          )}
        </div>
      </div>

      {openFilePath && (
        <FileViewerModal path={openFilePath} onClose={() => setOpenFilePath(null)} />
      )}
    </>
  );
}
