'use client';

import { useState, useCallback, useEffect } from 'react';
import type * as Monaco from 'monaco-editor';
import JSZip from 'jszip';
import { createClient } from '@/lib/supabase/client';
import { useProject } from '@/stores/project';
import { useSelectedFile, useProjectFiles } from '@/stores/file';
import type { CompilationError } from '@/types/compilation';
import { isBinaryFile } from '@/lib/constants/file-types';
import {
  normalizePath,
  createCompilationError,
  processFileContent,
  makeCompilationRequest,
} from '@/lib/utils/compilation';

export interface CompilationState {
  compiling: boolean;
  pdfData: string | null;
  compilationError: CompilationError | null;
  exporting: boolean;
  handleCompile: () => Promise<boolean>;
  handleExportPDF: () => Promise<void>;
  handleExportZIP: () => Promise<void>;
  debouncedAutoCompile: (content: string) => void;
  setCompilationError: (error: CompilationError | null) => void;
  setPdfData: (data: string | null) => void;
}

interface UseEditorCompilationProps {
  content: string;
  editorRef: React.MutableRefObject<Monaco.editor.IStandaloneCodeEditor | null>;
}

export function useEditorCompilation({
  content,
  editorRef,
}: UseEditorCompilationProps): CompilationState {
  const project = useProject();
  const selectedFile = useSelectedFile();
  const projectFilesState = useProjectFiles();
  const projectId = project?.id;
  const fileName = selectedFile?.name;
  const [compiling, setCompiling] = useState(false);
  const [pdfData, setPdfData] = useState<string | null>(null);
  const [compilationError, setCompilationError] =
    useState<CompilationError | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setPdfData(null);
    setCompilationError(null);
  }, [projectId]);

  const fetchProjectFiles = useCallback(async () => {
    if (!project?.id) return null;

    try {
      const supabase = createClient();

      // Recursively list all files in the project, including subfolders
      const listAllFiles = async (path: string = ''): Promise<{ name: string; id: string }[]> => {
        const listPath = path
          ? `projects/${project.id}/${path}`
          : `projects/${project.id}`;

        const { data: items, error } = await supabase.storage
          .from('octree')
          .list(listPath);

        if (error || !items) return [];

        const allFiles: { name: string; id: string }[] = [];

        for (const item of items) {
          if (item.id) {
            // It's a file
            const fullPath = path ? `${path}/${item.name}` : item.name;
            allFiles.push({ name: fullPath, id: item.id });
          } else if (item.name !== '.emptyFolderPlaceholder') {
            // It's a folder - recurse
            const subPath = path ? `${path}/${item.name}` : item.name;
            const subFiles = await listAllFiles(subPath);
            allFiles.push(...subFiles);
          }
        }

        return allFiles;
      };

      const storageFiles = await listAllFiles();

      if (!storageFiles || storageFiles.length === 0) {
        return null;
      }

      const filesWithContent = await Promise.all(
        storageFiles.map(async (file) => {
          try {
            const { data: fileBlob, error: downloadError } =
              await supabase.storage
                .from('octree')
                .download(`projects/${project.id}/${file.name}`);

            if (downloadError || !fileBlob) {
              console.warn(
                `No content found for file: ${file.name}`,
                downloadError
              );
              return null;
            }

            return await processFileContent(fileBlob, file.name);
          } catch (error) {
            console.warn(`Error processing file: ${file.name}`, error);
            return null;
          }
        })
      );

      const validFiles = filesWithContent.filter(
        (f): f is { path: string; content: string; encoding?: string } =>
          f !== null
      );

      return validFiles;
    } catch (error) {
      console.error('Error fetching project files:', error);
      return null;
    }
  }, [project?.id]);

  const buildFilesPayload = useCallback(
    async (
      activePath: string,
      activeContent: string
    ): Promise<Array<{ path: string; content: string; encoding?: string }>> => {
      // Use the in-memory files first to get up-to-date project content
      if (projectFilesState && projectFilesState.length > 0) {
        const payload = projectFilesState.map((projectFile) => {
          const path = projectFile.file.name;

          if (
            projectFile.document &&
            typeof projectFile.document.content === 'string'
          ) {
            const content =
              path === activePath
                ? activeContent
                : projectFile.document.content;

            const fileEntry: {
              path: string;
              content: string;
              encoding?: string;
            } = {
              path,
              content,
            };

            // Mark binary files with base64 encoding
            if (isBinaryFile(path)) {
              fileEntry.encoding = 'base64';
            }

            return fileEntry;
          }

          return null;
        });

        const validPayload = payload.filter(
          (
            entry
          ): entry is { path: string; content: string; encoding?: string } =>
            entry !== null
        );
        if (validPayload.length > 0) {
          return validPayload;
        }
      }

      const fetched = await fetchProjectFiles();
      if (fetched && fetched.length > 0) {
        return fetched.map((file) =>
          file.path === activePath ? { ...file, content: activeContent } : file
        );
      }

      return [{ path: activePath, content: activeContent }];
    },
    [fetchProjectFiles, projectFilesState]
  );

  const handleCompile = useCallback(async (): Promise<boolean> => {
    if (compiling) return false;

    setCompiling(true);
    setCompilationError(null);

    let handled = false;
    try {
      const currentContent = editorRef.current?.getValue() || content;
      const normalizedFileName = normalizePath(fileName || 'document');

      const filesPayload = projectId
        ? await buildFilesPayload(normalizedFileName, currentContent)
        : [{ path: normalizedFileName, content: currentContent }];

      // Debug: Log files being sent for compilation
      console.log('[Compile] Files being sent:', filesPayload.map(f => ({ path: f.path, encoding: f.encoding, size: f.content.length })));

      const { response, data } = await makeCompilationRequest(
        filesPayload,
        normalizedFileName,
        projectId
      );

      if (!response.ok) {
        const errorMessage =
          data?.error || `Compilation failed with status ${response.status}`;
        const structuredError = createCompilationError(data, errorMessage);
        setCompilationError(structuredError);

        // If a partial PDF is available despite the error, display it
        if (data?.pdf) {
          setPdfData(data.pdf);
        }

        handled = true;
        throw new Error(errorMessage);
      }

      if (data.pdf) {
        setPdfData(data.pdf);
        setCompilationError(null);
        return true;
      }

      throw new Error('No PDF data received');
    } catch (error) {
      if (!handled) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown compilation error';
        setCompilationError({
          message: errorMessage,
          details: error instanceof Error ? error.stack : undefined,
        });
      }

      return false;
    } finally {
      setCompiling(false);
    }
  }, [compiling, content, editorRef, projectId, fileName, buildFilesPayload]);

  const handleExportPDF = useCallback(async () => {
    setExporting(true);

    try {
      // Use the already-compiled PDF if available, otherwise compile first
      let pdfBase64 = pdfData;

      if (!pdfBase64) {
        const currentContent = editorRef.current?.getValue() || content;
        const normalizedFileName = normalizePath(fileName || 'document');

        const filesPayload = projectId
          ? await buildFilesPayload(normalizedFileName, currentContent)
          : [{ path: normalizedFileName, content: currentContent }];

        const { response, data } = await makeCompilationRequest(
          filesPayload,
          normalizedFileName,
          projectId
        );

        if (!response.ok) {
          const errorMessage = data?.error || 'PDF compilation failed';
          throw new Error(errorMessage);
        }

        if (!data.pdf) {
          throw new Error('No PDF data received from server');
        }

        pdfBase64 = data.pdf;
      }

      // Download the PDF (pdfBase64 is guaranteed to be non-null at this point)
      const binaryString = atob(pdfBase64 as string);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `${project?.title || 'document'}.pdf`;
      document.body.appendChild(a);
      a.click();

      URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('PDF export error:', error);
    } finally {
      setExporting(false);
    }
  }, [pdfData, content, editorRef, fileName, projectId, buildFilesPayload, project?.title]);

  const handleExportZIP = useCallback(async () => {
    setExporting(true);

    try {
      const currentContent = editorRef.current?.getValue() || content;
      const normalizedFileName = normalizePath(fileName || 'document');

      const filesPayload = projectId
        ? await buildFilesPayload(normalizedFileName, currentContent)
        : [{ path: normalizedFileName, content: currentContent }];

      const zip = new JSZip();

      // Add all project files to the ZIP
      for (const file of filesPayload) {
        if (file.encoding === 'base64') {
          // Binary file - decode base64
          zip.file(file.path, file.content, { base64: true });
        } else {
          // Text file
          zip.file(file.path, file.content);
        }
      }

      // Generate the ZIP file
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `${project?.title || 'project'}.zip`;
      document.body.appendChild(a);
      a.click();

      URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('ZIP export error:', error);
    } finally {
      setExporting(false);
    }
  }, [content, editorRef, fileName, projectId, buildFilesPayload, project?.title]);

  // Auto-compile on content changes (debounced)
  const debouncedAutoCompile = useCallback(() => {}, []);

  return {
    compiling,
    pdfData,
    compilationError,
    exporting,
    handleCompile,
    handleExportPDF,
    handleExportZIP,
    debouncedAutoCompile,
    setCompilationError,
    setPdfData,
  };
}
