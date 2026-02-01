import { create } from 'zustand';
import type { ProjectFile, FileData } from '@/hooks/use-file-editor';

type FileStoreState = {
  selectedFile: FileData | null;
  projectFiles: ProjectFile[] | null;
};

const DEFAULT_STATE: FileStoreState = {
  selectedFile: null,
  projectFiles: null,
};

export const useFileStore = create<FileStoreState>(() => DEFAULT_STATE);

export const useProjectFiles = () => {
  return useFileStore((state) => state.projectFiles);
};

export const useSelectedFile = () => {
  return useFileStore((state) => state.selectedFile);
};

export const useFileContent = () => {
  return useFileStore((state) => {
    const { selectedFile, projectFiles } = state;
    if (!selectedFile || !projectFiles) return null;
    const projectFile = projectFiles.find((f) => f.file.id === selectedFile.id);
    return projectFile?.document?.content ?? null;
  });
};

const getState = useFileStore.getState;
const setState = useFileStore.setState;

export const FileActions = {
  setSelectedFile: (file: FileData | null) => {
    setState({ selectedFile: file });
  },

  setContent: (content: string) => {
    const { selectedFile, projectFiles } = getState();

    if (!selectedFile || !projectFiles) {
      return;
    }

    const updatedFiles = projectFiles.map((projectFile) => {
      if (projectFile.file.id === selectedFile.id && projectFile.document) {
        return {
          ...projectFile,
          document: { ...projectFile.document, content },
        };
      }
      return projectFile;
    });

    setState({ projectFiles: updatedFiles });
  },

  /** Update content for a file by its path (file name) */
  setContentByPath: (filePath: string, content: string) => {
    const { projectFiles } = getState();

    if (!projectFiles) {
      return;
    }

    const updatedFiles = projectFiles.map((projectFile) => {
      if (projectFile.file.name === filePath && projectFile.document) {
        return {
          ...projectFile,
          document: { ...projectFile.document, content },
        };
      }
      return projectFile;
    });

    setState({ projectFiles: updatedFiles });
  },

  /** Get file content by path */
  getContentByPath: (filePath: string): string | null => {
    const { projectFiles } = getState();
    if (!projectFiles) return null;
    const file = projectFiles.find((f) => f.file.name === filePath);
    return file?.document?.content ?? null;
  },

  reset: () => {
    setState(DEFAULT_STATE);
  },

  init: (files: ProjectFile[]) => {
    const selectedFile = selectInitialFile(files);
    setState({ projectFiles: files, selectedFile });
  },

  setFiles: (files: ProjectFile[]) => {
    const { selectedFile } = getState();
    let newSelectedFile = selectedFile;

    if (selectedFile) {
      const exists = files.find((f) => f.file.id === selectedFile.id);
      if (!exists) {
        newSelectedFile = selectInitialFile(files);
      } else {
        // Update selected file data with new data (in case name changed back etc)
        newSelectedFile = exists.file;
      }
    } else {
      newSelectedFile = selectInitialFile(files);
    }

    setState({ projectFiles: files, selectedFile: newSelectedFile });
  },

  optimisticMove: (
    sourcePath: string,
    destFolderPath: string | null,
    type: 'file' | 'folder'
  ) => {
    const { projectFiles, selectedFile } = getState();
    if (!projectFiles) return;

    const name = sourcePath.split('/').pop();
    if (!name) return;

    const destPath = destFolderPath ? `${destFolderPath}/${name}` : name;
    if (sourcePath === destPath) return;

    // Remove any existing file at the destination path (optimistic overwrite)
    const filteredFiles = projectFiles.filter((pf) => {
      if (type === 'file' && pf.file.name === destPath && pf.file.name !== sourcePath) {
        return false;
      }
      return true;
    });

    const updatedFiles = filteredFiles.map((pf) => {
      let newPath = pf.file.name;

      if (type === 'file' && pf.file.name === sourcePath) {
        newPath = destPath;
      } else if (type === 'folder') {
        if (pf.file.name === sourcePath) {
          newPath = destPath;
        } else if (pf.file.name.startsWith(sourcePath + '/')) {
          newPath = pf.file.name.replace(sourcePath, destPath);
        }
      }

      if (newPath === pf.file.name) return pf;

      return {
        ...pf,
        file: { ...pf.file, name: newPath },
        document: pf.document
          ? { ...pf.document, filename: newPath, title: newPath }
          : null,
      };
    });

    setState({ projectFiles: updatedFiles });

    if (selectedFile) {
      if (type === 'file' && selectedFile.name === sourcePath) {
        setState({ selectedFile: { ...selectedFile, name: destPath } });
      } else if (
        type === 'folder' &&
        (selectedFile.name === sourcePath ||
          selectedFile.name.startsWith(sourcePath + '/'))
      ) {
        setState({
          selectedFile: {
            ...selectedFile,
            name: selectedFile.name.replace(sourcePath, destPath),
          },
        });
      }
    }
  },
};

const selectInitialFile = (files: ProjectFile[]): FileData | null => {
  const mainTexFile = files.find((f) => f.file.name === 'main.tex');
  return mainTexFile
    ? mainTexFile.file
    : files.length > 0
      ? files[0].file
      : null;
};
