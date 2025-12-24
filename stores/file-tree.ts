import { create } from 'zustand';

interface DialogFile {
  id: string;
  name: string;
}

interface DialogProject {
  id: string;
  title: string;
}

type FileTreeStoreState = {
  isLoading: boolean;
  renameDialogFile: DialogFile | null;
  deleteDialogFile: DialogFile | null;
  addFileDialogOpen: boolean;
  addFolderDialogOpen: boolean;
  renameFolderPath: string | null;
  deleteFolderPath: string | null;
  targetFolder: string | null;
  renameProjectDialog: DialogProject | null;
};

const DEFAULT_STATE: FileTreeStoreState = {
  isLoading: false,
  renameDialogFile: null,
  deleteDialogFile: null,
  addFileDialogOpen: false,
  addFolderDialogOpen: false,
  renameFolderPath: null,
  deleteFolderPath: null,
  targetFolder: null,
  renameProjectDialog: null,
};

export const useFileTreeStore = create<FileTreeStoreState>(() => DEFAULT_STATE);

const setState = useFileTreeStore.setState;

export const FileTreeActions = {
  setLoading: (isLoading: boolean) => {
    setState({ isLoading });
  },
  openRenameFileDialog: (fileId: string, fileName: string) => {
    setState({ renameDialogFile: { id: fileId, name: fileName } });
  },
  closeRenameFileDialog: () => {
    setState({ renameDialogFile: null });
  },
  openDeleteFileDialog: (fileId: string, fileName: string) => {
    setState({ deleteDialogFile: { id: fileId, name: fileName } });
  },
  closeDeleteFileDialog: () => {
    setState({ deleteDialogFile: null });
  },
  openAddFileDialog: (folderPath?: string) => {
    setState({ addFileDialogOpen: true, targetFolder: folderPath || null });
  },
  closeAddFileDialog: () => {
    setState({ addFileDialogOpen: false, targetFolder: null });
  },
  openAddFolderDialog: (folderPath?: string) => {
    setState({ addFolderDialogOpen: true, targetFolder: folderPath || null });
  },
  closeAddFolderDialog: () => {
    setState({ addFolderDialogOpen: false, targetFolder: null });
  },
  openRenameFolderDialog: (folderPath: string) => {
    setState({ renameFolderPath: folderPath });
  },
  closeRenameFolderDialog: () => {
    setState({ renameFolderPath: null });
  },
  openDeleteFolderDialog: (folderPath: string) => {
    setState({ deleteFolderPath: folderPath });
  },
  closeDeleteFolderDialog: () => {
    setState({ deleteFolderPath: null });
  },
  openRenameProjectDialog: (projectId: string, projectTitle: string) => {
    setState({ renameProjectDialog: { id: projectId, title: projectTitle } });
  },
  closeRenameProjectDialog: () => {
    setState({ renameProjectDialog: null });
  },
};

export const useRenameDialogFile = () =>
  useFileTreeStore((state) => state.renameDialogFile);

export const useDeleteDialogFile = () =>
  useFileTreeStore((state) => state.deleteDialogFile);

export const useAddFileDialogOpen = () =>
  useFileTreeStore((state) => state.addFileDialogOpen);

export const useAddFolderDialogOpen = () =>
  useFileTreeStore((state) => state.addFolderDialogOpen);

export const useRenameFolderPath = () =>
  useFileTreeStore((state) => state.renameFolderPath);

export const useDeleteFolderPath = () =>
  useFileTreeStore((state) => state.deleteFolderPath);

export const useTargetFolder = () =>
  useFileTreeStore((state) => state.targetFolder);

export const useRenameProjectDialog = () =>
  useFileTreeStore((state) => state.renameProjectDialog);
