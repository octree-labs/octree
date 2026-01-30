'use client';

import { useRef, useCallback, useState, useEffect } from 'react';
import { Tree, NodeRendererProps } from 'react-arborist';
import {
  FileText,
  MoreVertical,
  Pencil,
  Trash2,
  Image,
  DonutIcon as DocumentIcon,
  Plus,
  FolderPlus,
  FolderIcon,
  FolderOpenIcon,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { ProjectFile } from '@/hooks/use-file-editor';
import { useFileTreeStore, FileTreeActions } from '@/stores/file-tree';
import { moveFile, moveFolder } from '@/lib/requests/project';
import { useProjectFilesRevalidation } from '@/hooks/use-file-editor';
import { toast } from 'sonner';

interface FileNode {
  id: string;
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: FileNode[];
  file?: ProjectFile['file'];
}

interface FileTreeProps {
  files: ProjectFile[];
  selectedFileId: string | null;
  onFileSelect: (file: ProjectFile['file']) => void;
  rootFolderName: string;
  projectId: string;
}

function getFileIcon(fileName: string) {
  const extension = fileName.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
    case 'bmp':
    case 'ico':
    case 'pdf':
      return <Image className="h-4 w-4 flex-shrink-0 text-gray-600" />;
    case 'doc':
    case 'docx':
    case 'txt':
      return <DocumentIcon className="h-4 w-4 flex-shrink-0 text-gray-600" />;
    default:
      return <FileText className="h-4 w-4 flex-shrink-0 text-gray-600" />;
  }
}

function buildFileTree(
  files: ProjectFile[],
  projectId: string,
  rootFolderName: string
): FileNode[] {
  const rootNode: FileNode = {
    id: projectId,
    name: rootFolderName,
    path: '',
    type: 'folder',
    children: [],
  };

  const folderMap = new Map<string, FileNode>();
  folderMap.set('', rootNode);

  for (const projectFile of files) {
    const parts = projectFile.file.name.split('/');
    let currentPath = '';

    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      const isLast = index === parts.length - 1;
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      if (isLast) {
        if (part !== '.gitkeep') {
          const parentPath = parts.slice(0, -1).join('/');
          const parent = folderMap.get(parentPath) || rootNode;

          parent.children!.push({
            id: projectFile.file.id,
            name: part,
            path: currentPath,
            type: 'file',
            file: projectFile.file,
          });
        }
      } else if (!folderMap.has(currentPath)) {
        const parentPath = parts.slice(0, index).join('/');
        const parent = folderMap.get(parentPath) || rootNode;

        const folder: FileNode = {
          id: `folder-${currentPath}`,
          name: part,
          path: currentPath,
          type: 'folder',
          children: [],
        };

        folderMap.set(currentPath, folder);
        parent.children!.push(folder);
      }
    }
  }

  const sortTree = (nodes: FileNode[]): FileNode[] => {
    return nodes
      .sort((a, b) => {
        if (a.type === b.type) return a.name.localeCompare(b.name);
        return a.type === 'folder' ? -1 : 1;
      })
      .map((node) => {
        if (node.type === 'folder' && node.children) {
          return { ...node, children: sortTree(node.children) };
        }
        return node;
      });
  };

  rootNode.children = sortTree(rootNode.children!);
  return [rootNode];
}

function Node({
  node,
  style,
  dragHandle,
  selectedFileId,
  onFileSelect,
  projectId,
}: NodeRendererProps<FileNode> & {
  selectedFileId: string | null;
  onFileSelect: (file: ProjectFile['file']) => void;
  projectId: string;
}) {
  const isRoot = node.data.path === '';
  const isSelected = node.data.file?.id === selectedFileId;

  if (node.data.type === 'folder') {
    return (
      <div
        ref={dragHandle}
        style={style}
        className="flex items-center justify-between gap-1 px-2"
        onClick={() => node.toggle()}
      >
        <div className="flex flex-1 items-center gap-1 cursor-pointer">
          {node.isOpen ? (
            <FolderOpenIcon className="size-4" />
          ) : (
            <FolderIcon className="size-4" />
          )}
          <span>{node.data.name}</span>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              aria-label={`Open options for ${node.data.name}`}
              onClick={(e) => e.stopPropagation()}
            >
              <MoreVertical className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="cursor-pointer gap-2 px-1.5 py-1 text-xs"
              onSelect={() =>
                FileTreeActions.openAddFileDialog(
                  isRoot ? undefined : node.data.path
                )
              }
            >
              <Plus className="size-3.5" />
              Add File
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer gap-2 px-1.5 py-1 text-xs"
              onSelect={() =>
                FileTreeActions.openAddFolderDialog(
                  isRoot ? undefined : node.data.path
                )
              }
            >
              <FolderPlus className="size-3.5" />
              Add Folder
            </DropdownMenuItem>
            {!isRoot && (
              <>
                <DropdownMenuItem
                  className="cursor-pointer gap-2 px-1.5 py-1 text-xs"
                  onSelect={() =>
                    FileTreeActions.openRenameFolderDialog(node.data.path)
                  }
                >
                  <Pencil className="size-3.5" />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer gap-2 px-1.5 py-1 text-xs"
                  variant="destructive"
                  onSelect={() =>
                    FileTreeActions.openDeleteFolderDialog(node.data.path)
                  }
                >
                  <Trash2 className="size-3.5 text-destructive" />
                  Delete
                </DropdownMenuItem>
              </>
            )}
            {isRoot && (
              <DropdownMenuItem
                className="cursor-pointer gap-2 px-1.5 py-1 text-xs"
                onSelect={() =>
                  FileTreeActions.openRenameProjectDialog(
                    projectId,
                    node.data.name
                  )
                }
              >
                <Pencil className="size-3.5" />
                Rename
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }

  return (
    <div ref={dragHandle} style={style} className="flex items-center gap-1 px-2">
      <button
        type="button"
        className={cn(
          'flex flex-1 items-center gap-1 rounded-md pr-1 text-sm duration-200 ease-in-out',
          isSelected && 'bg-muted'
        )}
        onClick={() => node.data.file && onFileSelect(node.data.file)}
      >
        {getFileIcon(node.data.name)}
        <span className={cn('truncate', isSelected && 'font-medium')}>
          {node.data.name}
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            aria-label={`Open options for ${node.data.name}`}
          >
            <MoreVertical className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            className="cursor-pointer gap-2 px-1.5 py-1 text-xs"
            onSelect={() =>
              node.data.file &&
              FileTreeActions.openRenameFileDialog(
                node.data.file.id,
                node.data.file.name
              )
            }
          >
            <Pencil className="size-3.5" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer gap-2 px-1.5 py-1 text-xs"
            variant="destructive"
            onSelect={() =>
              node.data.file &&
              FileTreeActions.openDeleteFileDialog(
                node.data.file.id,
                node.data.file.name
              )
            }
          >
            <Trash2 className="size-3.5 text-destructive" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function FileTree({
  files,
  selectedFileId,
  onFileSelect,
  rootFolderName,
  projectId,
}: FileTreeProps) {
  const treeRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isLoading = useFileTreeStore((state) => state.isLoading);
  const { revalidate } = useProjectFilesRevalidation(projectId);
  const [size, setSize] = useState({ width: 300, height: 600 });

  const data = buildFileTree(files, projectId, rootFolderName);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = () => {
      const { width, height } = container.getBoundingClientRect();
      setSize({ width, height });
    };

    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(container);
    updateSize();

    return () => resizeObserver.disconnect();
  }, []);

  const handleMove = useCallback(
    async (args: { dragIds: string[]; parentId: string | null; index: number }) => {
      const { dragIds, parentId } = args;
      const dragId = dragIds[0];

      if (!dragId) return;

      const tree = treeRef.current;
      if (!tree) return;

      const sourceNode = tree.get(dragId);
      if (!sourceNode) return;

      const destFolderPath =
        parentId === projectId
          ? null
          : parentId?.startsWith('folder-')
            ? parentId.replace('folder-', '')
            : parentId;

      try {
        if (sourceNode.data.type === 'file') {
          await moveFile(projectId, sourceNode.data.path, destFolderPath);
        } else {
          await moveFolder(projectId, sourceNode.data.path, destFolderPath);
        }

        await revalidate();
        toast.success(
          `${sourceNode.data.type === 'file' ? 'File' : 'Folder'} moved successfully`
        );
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : `Failed to move ${sourceNode.data.type}`
        );
      }
    },
    [projectId, revalidate]
  );

  return (
    <div
      ref={containerRef}
      className={cn('w-full h-full', isLoading && 'pointer-events-none opacity-50')}
    >
      <Tree<FileNode>
        ref={treeRef}
        data={data}
        openByDefault={true}
        width={size.width}
        height={size.height}
        indent={20}
        rowHeight={32}
        onMove={handleMove}
        disableDrag={(data: FileNode) => !data || data.path === ''}
        disableDrop={(args: any) => {
          const { parentNode, dragNodes } = args;

          if (!dragNodes || dragNodes.length === 0) return true;

          const dragNode = dragNodes[0];
          if (!dragNode?.data || !parentNode?.data) return true;
          if (parentNode.data.type !== 'folder') return true;

          if (
            parentNode.data.path !== '' &&
            dragNode.data.path.startsWith(parentNode.data.path + '/')
          ) {
            return true;
          }

          return false;
        }}
      >
        {(props) => (
          <Node
            {...props}
            selectedFileId={selectedFileId}
            onFileSelect={onFileSelect}
            projectId={projectId}
          />
        )}
      </Tree>
    </div>
  );
}
