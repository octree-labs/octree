'use client';

import { useParams } from 'next/navigation';
import useSWR, { mutate } from 'swr';
import { getProject, getProjectFiles } from '@/lib/requests/project';
import type { Project } from '@/types/project';
import { useFileStore } from '@/stores/file';
import { FileTreeActions } from '@/stores/file-tree';

export interface FileData {
  id: string;
  name: string;
  project_id: string;
  size: number | null;
  type: string | null;
  uploaded_at: string | null;
}

export interface DocumentData {
  id: string;
  title: string;
  content: string;
  owner_id: string;
  project_id: string;
  filename: string;
  document_type: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface ProjectFile {
  file: FileData;
  document: DocumentData | null;
}

export interface FileEditorState {
  project: Project | null;
  file: FileData | null;
  documentData: DocumentData | null;
  isLoading: boolean;
  error: string | null;
}

export function useFileEditor(): FileEditorState {
  const params = useParams();
  const projectId = params.projectId as string;

  const { selectedFile } = useFileStore();

  const {
    data: projectData,
    isLoading: isProjectLoading,
    error: projectError,
  } = useSWR<Project>(projectId ? ['project', projectId] : null, () =>
    getProject(projectId)
  );

  const {
    data: filesData,
    isLoading: isFileLoading,
    error: fileError,
  } = useSWR<ProjectFile[]>(
    projectId ? ['project-files', projectId] : null,
    () => getProjectFiles(projectId)
  );

  const selectedFileResponse = filesData?.find(
    (fileResponse) => fileResponse.file.id === selectedFile?.id
  );

  const file = selectedFile ?? null;
  const documentData = selectedFileResponse?.document ?? null;
  const isLoading = isProjectLoading || isFileLoading;
  const error = projectError?.message || fileError?.message || null;

  return {
    project: projectData ?? null,
    file,
    documentData,
    isLoading,
    error,
  };
}

export function useProjectFilesRevalidation(projectId: string) {
  const revalidate = async (shouldBlock: boolean = true) => {
    if (shouldBlock) {
      FileTreeActions.setLoading(true);
    }

    try {
      const [unusedProjectFiles, files] = await Promise.all([
        mutate(['project-files', projectId]),
        mutate(['files', projectId]),
      ]);
      return (files || unusedProjectFiles) as ProjectFile[] | undefined;
    } finally {
      if (shouldBlock) {
        FileTreeActions.setLoading(false);
      }
    }
  };

  return { revalidate };
}
