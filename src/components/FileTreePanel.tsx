import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ChevronRight, ChevronDown, Folder, FolderOpen, File } from 'lucide-react';
import { FileNode } from '../types';

interface Props {
  projectId: string;
}

interface TreeNodeProps {
  node: FileNode;
  depth: number;
}

function TreeNode({ node, depth }: TreeNodeProps) {
  const [open, setOpen] = useState(depth === 0);

  if (!node.is_dir) {
    return (
      <div
        className="flex items-center gap-1 px-2 py-0.5 hover:bg-[#2a2a2a] cursor-default rounded"
        style={{ paddingLeft: `${8 + depth * 12}px` }}
      >
        <File size={12} className="text-[#666] shrink-0" />
        <span className="text-xs text-[#b0b0b0] truncate">{node.name}</span>
      </div>
    );
  }

  return (
    <div>
      <div
        className="flex items-center gap-1 px-2 py-0.5 hover:bg-[#2a2a2a] cursor-pointer rounded"
        style={{ paddingLeft: `${8 + depth * 12}px` }}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? (
          <ChevronDown size={12} className="text-[#555] shrink-0" />
        ) : (
          <ChevronRight size={12} className="text-[#555] shrink-0" />
        )}
        {open ? (
          <FolderOpen size={12} className="text-[#e8c468] shrink-0" />
        ) : (
          <Folder size={12} className="text-[#e8c468] shrink-0" />
        )}
        <span className="text-xs text-[#ccc] truncate">{node.name}</span>
      </div>
      {open && node.children.map((child) => (
        <TreeNode key={child.path} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

export function FileTreePanel({ projectId }: Props) {
  const [tree, setTree] = useState<FileNode[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    invoke<FileNode[]>('get_file_tree', { projectId, maxDepth: 4 })
      .then(setTree)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [projectId]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-[#3a3a3a]">
        <span className="text-xs font-medium text-[#888]">File Tree</span>
      </div>
      <div className="flex-1 overflow-auto py-1">
        {loading && (
          <div className="px-3 py-4 text-xs text-[#555]">Loading...</div>
        )}
        {error && (
          <div className="px-3 py-4 text-xs text-[#f87171]">{error}</div>
        )}
        {!loading && !error && tree !== null && (
          tree.length === 0 ? (
            <div className="px-3 py-4 text-xs text-[#555]">Empty directory</div>
          ) : (
            tree.map((node) => <TreeNode key={node.path} node={node} depth={0} />)
          )
        )}
      </div>
    </div>
  );
}
