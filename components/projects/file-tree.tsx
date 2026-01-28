'use client';

import { useState } from 'react';
import {
  FileText,
  MoreVertical,
  Pencil,
  Trash2,
  Image,
  DonutIcon as DocumentIcon,
  Plus,
  FolderPlus,
} from 'lucide-react';
import { File, Folder, Tree } from '@/components/ui/file-tree';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { ProjectFile } from '@/hooks/use-file-editor';
import { useFileTreeStore, FileTreeActions } from '@/stores/file-tree';
import {
  DndContext,
  DragEndEvent,
  useDraggable,
  useDroppable,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { renameFile, renameFolder } from '@/lib/requests/project';
import { useProjectFilesRevalidation } from '@/hooks/use-file-editor';
import { useFileUpload } from '@/hooks/use-file-upload';
import { toast } from 'sonner';

interface FileNode {
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

const getFileIcon = (fileName: string) => {
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
};

function buildFileTree(files: ProjectFile[]): FileNode[] {
  const root: FileNode[] = [];
  const folderMap = new Map<string, FileNode>();

  files.forEach((projectFile) => {
    const parts = projectFile.file.name.split('/');
    let currentPath = '';
    let currentLevel = root;

    parts.forEach((part, index) => {
      const isLast = index === parts.length - 1;
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      if (isLast) {
        if (part !== '.gitkeep') {
          currentLevel.push({
            name: part,
            path: currentPath,
            type: 'file',
            file: projectFile.file,
          });
        }
      } else {
        let folder = folderMap.get(currentPath);
        if (!folder) {
          folder = {
            name: part,
            path: currentPath,
            type: 'folder',
            children: [],
          };
          folderMap.set(currentPath, folder);
          currentLevel.push(folder);
        }
        currentLevel = folder.children!;
      }
    });
  });

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

  return sortTree(root);
}

interface FileTreeNodeProps {
  node: FileNode;
  selectedFileId: string | null;
  onFileSelect: (file: ProjectFile['file']) => void;
  projectId: string;
  onExternalDrop?: (files: File[], targetFolder: string) => Promise<void>;
}

function FileTreeNode({
  node,
  selectedFileId,
  onFileSelect,
  projectId,
  onExternalDrop,
}: FileTreeNodeProps) {
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: node.path,
    data: { type: node.type, path: node.path },
  });

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: node.path,
    disabled: node.type !== 'folder',
    data: { type: node.type, path: node.path },
  });

  const [isExternalDragOver, setIsExternalDragOver] = useState(false);
  const [isDropping, setIsDropping] = useState(false);

  const handleExternalDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const handleExternalDragEnter = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.stopPropagation();
      setIsExternalDragOver(true);
    }
  };

  const handleExternalDragLeave = () => {
    setIsExternalDragOver(false);
  };

  const handleExternalDrop = async (e: React.DragEvent) => {
    if (e.dataTransfer.files.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      setIsExternalDragOver(false);

      if (!onExternalDrop || isDropping) return;

      setIsDropping(true);
      try {
        const files = Array.from(e.dataTransfer.files);
        await onExternalDrop(files, node.path);
      } catch (error) {
        toast.error('Failed to upload files');
      } finally {
        setIsDropping(false);
      }
    }
  };
  if (node.type === 'folder') {
    return (
      <div
        ref={setDropRef}
        className={cn(
          (isOver || isExternalDragOver) && "ring-2 ring-primary/50 rounded-md",
          isDropping && "opacity-60 pointer-events-none"
        )}
        onDragOver={handleExternalDragOver}
        onDragEnter={handleExternalDragEnter}
        onDragLeave={handleExternalDragLeave}
        onDrop={handleExternalDrop}
      >
        <div ref={setDragRef} {...attributes} {...listeners} className={cn(isDragging && "opacity-50")}>
          <Folder
            element={node.name}
            value={node.path}
            action={
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    aria-label={`Open options for ${node.name}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreVertical className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    className="cursor-pointer gap-2 px-1.5 py-1 text-xs"
                    onSelect={() => FileTreeActions.openAddFileDialog(node.path)}
                  >
                    <Plus className="size-3.5" />
                    Add File
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="cursor-pointer gap-2 px-1.5 py-1 text-xs"
                    onSelect={() => FileTreeActions.openAddFolderDialog(node.path)}
                  >
                    <FolderPlus className="size-3.5" />
                    Add Folder
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="cursor-pointer gap-2 px-1.5 py-1 text-xs"
                    onSelect={() =>
                      FileTreeActions.openRenameFolderDialog(node.path)
                    }
                  >
                    <Pencil className="size-3.5" />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="cursor-pointer gap-2 px-1.5 py-1 text-xs"
                    variant="destructive"
                    onSelect={() =>
                      FileTreeActions.openDeleteFolderDialog(node.path)
                    }
                  >
                    <Trash2 className="size-3.5 text-destructive" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            }
          >
            {node.children?.map((child) => (
              <FileTreeNode
                key={child.path}
                node={child}
                selectedFileId={selectedFileId}
                onFileSelect={onFileSelect}
                projectId={projectId}
                onExternalDrop={onExternalDrop}
              />
            ))}
          </Folder>
        </div>
      </div>
    );
  }

  const isSelected = selectedFileId === node.file?.id;

  return (
    <div className="flex items-center gap-1">
      <div ref={setDragRef} {...attributes} {...listeners} className={cn("flex-1", isDragging && "opacity-50")}>
        <File
          value={node.path}
          fileIcon={getFileIcon(node.name)}
          isSelect={isSelected}
          handleSelect={() => node.file && onFileSelect(node.file)}
          className="w-full"
        >
          <span className={cn('truncate', isSelected && 'font-medium')}>
            {node.name}
          </span>
        </File>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            aria-label={`Open options for ${node.name}`}
          >
            <MoreVertical className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            className="cursor-pointer gap-2 px-1.5 py-1 text-xs"
            onSelect={() =>
              node.file &&
              FileTreeActions.openRenameFileDialog(node.file.id, node.file.name)
            }
          >
            <Pencil className="size-3.5" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer gap-2 px-1.5 py-1 text-xs"
            variant="destructive"
            onSelect={() =>
              node.file &&
              FileTreeActions.openDeleteFileDialog(node.file.id, node.file.name)
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
  const tree = buildFileTree(files);
  const isLoading = useFileTreeStore((state) => state.isLoading);
  const { revalidate } = useProjectFilesRevalidation(projectId);
  const { uploadFile } = useFileUpload({ projectId });

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const dragData = active.data.current as { type: string; path: string };
    const dropData = over.data.current as { type: string; path: string };

    if (dropData.path.startsWith(dragData.path + '/')) return;

    const fileName = dragData.path.split('/').pop()!;
    const newPath = dropData.path ? `${dropData.path}/${fileName}` : fileName;

    if (dragData.path === newPath) return;

    try {
      if (dragData.type === 'folder') {
        await renameFolder(projectId, dragData.path, newPath);
      } else {
        await renameFile(projectId, dragData.path, newPath);
      }
      toast.success('Moved successfully');
      revalidate();
    } catch (error) {
      toast.error('Failed to move');
    }
  };

  const { setNodeRef: setRootDropRef, isOver: isRootOver } = useDroppable({
    id: projectId,
    data: { type: 'folder', path: '' },
  });

  const [isRootExternalDragOver, setIsRootExternalDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const handleExternalDropToFolder = async (files: File[], targetFolder: string) => {
    if (isUploading) return;

    setIsUploading(true);
    try {
      for (const file of files) {
        await uploadFile(file, targetFolder || null);
      }
      toast.success(`Uploaded ${files.length} file${files.length > 1 ? 's' : ''}`);
    } catch (error) {
      toast.error('Failed to upload files');
    } finally {
      setIsUploading(false);
    }
  };

  const handleRootExternalDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const handleRootExternalDragEnter = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      setIsRootExternalDragOver(true);
    }
  };

  const handleRootExternalDragLeave = () => {
    setIsRootExternalDragOver(false);
  };

  const handleRootExternalDrop = async (e: React.DragEvent) => {
    if (e.dataTransfer.files.length > 0 && !isUploading) {
      e.preventDefault();
      e.stopPropagation();
      setIsRootExternalDragOver(false);
      const files = Array.from(e.dataTransfer.files);
      await handleExternalDropToFolder(files, '');
    }
  };

  // Get all folder paths to expand them by default
  const getAllFolderPaths = (nodes: FileNode[]): string[] => {
    const paths: string[] = [];
    nodes.forEach((node) => {
      if (node.type === 'folder') {
        paths.push(node.path);
        if (node.children) {
          paths.push(...getAllFolderPaths(node.children));
        }
      }
    });
    return paths;
  };

  // Always include the root project and all folder paths
  const initialExpandedItems = [projectId, ...getAllFolderPaths(tree)];

  const rootAction = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          aria-label={`Open options for ${rootFolderName}`}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreVertical className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          className="cursor-pointer gap-2 px-1.5 py-1 text-xs"
          onSelect={() => FileTreeActions.openAddFileDialog()}
        >
          <Plus className="size-3.5" />
          Add File
        </DropdownMenuItem>
        <DropdownMenuItem
          className="cursor-pointer gap-2 px-1.5 py-1 text-xs"
          onSelect={() => FileTreeActions.openAddFolderDialog()}
        >
          <FolderPlus className="size-3.5" />
          Add Folder
        </DropdownMenuItem>
        <DropdownMenuItem
          className="cursor-pointer gap-2 px-1.5 py-1 text-xs"
          onSelect={() =>
            FileTreeActions.openRenameProjectDialog(projectId, rootFolderName)
          }
        >
          <Pencil className="size-3.5" />
          Rename
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className={cn('w-full', (isLoading || isUploading) && 'pointer-events-none opacity-50')}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <Tree
          key={`${projectId}-${files.length}`}
          className="w-full overflow-visible"
          initialExpandedItems={initialExpandedItems}
        >
          <div
            ref={setRootDropRef}
            className={cn(
              (isRootOver || isRootExternalDragOver) && "ring-2 ring-primary/50 rounded-md",
              isUploading && "opacity-60"
            )}
            onDragOver={handleRootExternalDragOver}
            onDragEnter={handleRootExternalDragEnter}
            onDragLeave={handleRootExternalDragLeave}
            onDrop={handleRootExternalDrop}
          >
            <Folder element={rootFolderName} value={projectId} action={rootAction}>
              {tree.map((node) => (
                <FileTreeNode
                  key={node.path}
                  node={node}
                  selectedFileId={selectedFileId}
                  onFileSelect={onFileSelect}
                  projectId={projectId}
                  onExternalDrop={handleExternalDropToFolder}
                />
              ))}
            </Folder>
          </div>
        </Tree>
      </DndContext>
    </div>
  );
}
