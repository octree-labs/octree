'use client';

import useSWR from 'swr';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as Monaco from 'monaco-editor';
import { useEditorState } from '@/hooks/use-editor-state';
import { useDocumentSave } from '@/hooks/use-document-save';
import { useTextFormatting } from '@/hooks/use-text-formatting';
import { useEditorCompilation } from '@/hooks/use-editor-compilation';
import { useEditSuggestions } from '@/hooks/use-edit-suggestions';
import { useEditorInteractions } from '@/hooks/use-editor-interactions';
import { useEditorKeyboardShortcuts } from '@/hooks/use-editor-keyboard-shortcuts';
import { MonacoEditor } from '@/components/editor/monaco-editor';
import { EditorToolbar } from '@/components/editor/toolbar';
import { SelectionButton } from '@/components/editor/selection-button';
import { LoadingState } from '@/components/editor/loading-state';
import { ErrorState } from '@/components/editor/error-state';
import PDFViewer from '@/components/pdf-viewer';
import { Chat } from '@/components/chat';
import { CompilationError } from '@/components/latex/compilation-error';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import { cn, formatCompilationErrorForAI } from '@/lib/utils';
import { FileActions, useProjectFiles, useSelectedFile } from '@/stores/file';
import { getProject, getProjectFiles } from '@/lib/requests/project';
import type { ProjectFile } from '@/hooks/use-file-editor';
import { useParams } from 'next/navigation';
import type { Project } from '@/types/project';
import { ProjectActions } from '@/stores/project';
import type { EditSuggestion } from '@/types/edit';
import { isImageFile, isPDFFile, isTextFile } from '@/lib/constants/file-types';
import { ImageViewer } from '@/components/image-viewer';
import { SimplePDFViewer } from '@/components/simple-pdf-viewer';

const CHAT_WIDTH_DEFAULT = 340;
const CHAT_WIDTH_MIN = 280;
const CHAT_WIDTH_MAX = 600;
const CHAT_WIDTH_STORAGE_KEY = 'chat_sidebar_width';

export default function ProjectPage() {
  const params = useParams();
  const projectId = params.projectId as string;

  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  // State to trigger re-render when editor mounts
  const [editorReady, setEditorReady] = useState(false);

  const { content, setContent } = useEditorState();

  const projectFiles = useProjectFiles();
  const selectedFile = useSelectedFile();

  const {
    data: projectData,
    isLoading: isProjectLoading,
    error: projectError,
  } = useSWR<Project>(projectId ? ['project', projectId] : null, () =>
    getProject(projectId)
  );

  const {
    data: filesData,
    isLoading: isFilesLoading,
    error: filesError,
  } = useSWR<ProjectFile[]>(projectId ? ['files', projectId] : null, () =>
    getProjectFiles(projectId)
  );

  const { isSaving, lastSaved, handleSaveDocument, debouncedSave } =
    useDocumentSave();

  const { handleTextFormat } = useTextFormatting({ editorRef });

  const {
    compiling,
    pdfData,
    compilationError,
    exporting,
    handleCompile,
    handleExportPDF,
    handleExportZIP,
    setCompilationError,
  } = useEditorCompilation({
    content,
    editorRef,
  });

  // Callback to switch to a file by path (for cross-file edit suggestions)
  const handleSwitchFile = useCallback(
    (filePath: string) => {
      if (!projectFiles) return;
      
      const targetProjectFile = projectFiles.find(
        (pf) => pf.file.name === filePath
      );
      
      if (targetProjectFile) {
        FileActions.setSelectedFile(targetProjectFile.file);
      }
    },
    [projectFiles]
  );

  const {
    editSuggestions,
    totalPendingCount,
    handleEditSuggestion,
    handleAcceptEdit,
    handleAcceptAllEdits,
    handleRejectEdit,
  } = useEditSuggestions({
    editor: editorRef.current,
    monacoInstance: monacoRef.current,
    currentFilePath: selectedFile?.name ?? null,
    onSwitchFile: handleSwitchFile,
  });

  const {
    showButton,
    buttonPos,
    selectedText,
    textFromEditor,
    selectionRange,
    chatOpen,
    setChatOpen,
    setTextFromEditor,
    handleCopy,
    setupEditorListeners,
  } = useEditorInteractions();

  const [autoSendMessage, setAutoSendMessage] = useState<string | null>(null);
  const [hasCompiledOnMount, setHasCompiledOnMount] = useState(false);

  const [chatWidth, setChatWidth] = useState(CHAT_WIDTH_DEFAULT);
  const [isChatResizing, setIsChatResizing] = useState(false);
  const chatStartXRef = useRef(0);
  const chatStartWidthRef = useRef(0);

  useEffect(() => {
    const stored = localStorage.getItem(CHAT_WIDTH_STORAGE_KEY);
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (!isNaN(parsed) && parsed >= CHAT_WIDTH_MIN && parsed <= CHAT_WIDTH_MAX) {
        setChatWidth(parsed);
      }
    }
  }, []);

  const startChatResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    chatStartXRef.current = e.clientX;
    chatStartWidthRef.current = chatWidth;
    setIsChatResizing(true);
  }, [chatWidth]);

  useEffect(() => {
    if (!isChatResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = chatStartXRef.current - e.clientX;
      const newWidth = Math.min(
        CHAT_WIDTH_MAX,
        Math.max(CHAT_WIDTH_MIN, chatStartWidthRef.current + delta)
      );
      setChatWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsChatResizing(false);
      localStorage.setItem(CHAT_WIDTH_STORAGE_KEY, chatWidth.toString());
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isChatResizing, chatWidth]);

  const projectFileContext = useMemo(
    () =>
      projectFiles
        ? projectFiles
            .filter((projectFile) => isTextFile(projectFile.file.name)) // Filter out binary files (PDFs, images, etc.)
            .map((projectFile) => ({
              path: projectFile.file.name,
              content: projectFile.document?.content ?? '',
            }))
        : [],
    [projectFiles]
  );

  useEffect(() => {
    FileActions.reset();
    setHasCompiledOnMount(false);
  }, [projectId]);

  useEffect(() => {
    if (filesData) {
      FileActions.init(filesData);
    }
  }, [filesData]);

  useEffect(() => {
    if (projectData) {
      ProjectActions.init(projectData);
    }
  }, [projectData]);

  useEffect(() => {
    const filesMatchProject =
      projectFiles &&
      projectFiles.length > 0 &&
      projectFiles[0].file.project_id === projectId;

    if (content && filesMatchProject && !hasCompiledOnMount) {
      setHasCompiledOnMount(true);
      handleCompile();
    }
  }, [content, projectFiles, projectId, hasCompiledOnMount]);

  const handleEditorChange = (value: string) => {
    setContent(value);
    debouncedSave(value);
  };

  const handleEditorMount = (
    editor: Monaco.editor.IStandaloneCodeEditor,
    monaco: typeof Monaco
  ) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    setupEditorListeners(editor);
    // Trigger re-render so hooks get the editor/monaco instances
    setEditorReady(true);
  };

  // Reset editor refs when switching to non-text file (Monaco unmounts)
  const isCurrentFileText = selectedFile ? isTextFile(selectedFile.name) : false;
  useEffect(() => {
    if (!isCurrentFileText) {
      editorRef.current = null;
      monacoRef.current = null;
      setEditorReady(false);
    }
  }, [isCurrentFileText]);

  const handleSuggestionFromChat = useCallback(
    (suggestions: EditSuggestion | EditSuggestion[]) => {
      handleEditSuggestion(suggestions);
    },
    [handleEditSuggestion]
  );

  useEditorKeyboardShortcuts({
    editor: editorRef.current,
    monacoInstance: monacoRef.current,
    onSave: async (currentContent: string) => {
      const compiled = await handleCompile();
      if (compiled) {
        await handleSaveDocument(currentContent);
      }
    },
    onCopy: () => {
      if (selectedText.trim()) {
        setTextFromEditor(selectedText);
        setChatOpen(true);
      }
    },
    onTextFormat: handleTextFormat,
  });

  if (isProjectLoading || isFilesLoading) return <LoadingState />;
  if (projectError || filesError)
    return <ErrorState error="Error fetching project" />;
  if (!filesData) return <ErrorState error="No files found" />;

  const isImage = selectedFile ? isImageFile(selectedFile.name) : false;
  const isPDF = selectedFile ? isPDFFile(selectedFile.name) : false;
  const isText = selectedFile ? isTextFile(selectedFile.name) : false;

  return (
    <div
      className={cn(
        'flex h-[calc(100vh-45px)] flex-col bg-slate-100',
        !isChatResizing && 'transition-[margin] duration-300 ease-in-out'
      )}
      style={{ marginRight: chatOpen ? `${chatWidth}px` : 0 }}
    >
      <EditorToolbar
        onTextFormat={handleTextFormat}
        onCompile={handleCompile}
        onExportPDF={handleExportPDF}
        onExportZIP={handleExportZIP}
        onOpenChat={() => {
          if (selectedText.trim()) {
            setTextFromEditor(selectedText);
          }
          setChatOpen(true);
        }}
        onToggleChat={() => setChatOpen(prev => !prev)}
        chatOpen={chatOpen}
        compiling={compiling}
        exporting={exporting}
        isSaving={isSaving}
        lastSaved={lastSaved}
        hasPdfData={!!pdfData}
      />

      <div className="flex min-h-0 flex-1">
        <ResizablePanelGroup
          direction="horizontal"
          className="flex min-h-0 flex-1 transition-all duration-300 ease-in-out"
        >
          <ResizablePanel defaultSize={50} minSize={25}>
            <div className="relative h-full">
              <div className="h-full overflow-hidden">
                {isImage && selectedFile ? (
                  <ImageViewer
                    projectId={projectId}
                    fileName={selectedFile.name}
                  />
                ) : isPDF && selectedFile ? (
                  <SimplePDFViewer
                    projectId={projectId}
                    fileName={selectedFile.name}
                  />
                ) : isText && selectedFile ? (
                  <>
                    <MonacoEditor
                      content={content}
                      onChange={handleEditorChange}
                      onMount={handleEditorMount}
                      className="h-full"
                    />
                    <SelectionButton
                      show={showButton}
                      position={buttonPos}
                      onCopy={() => handleCopy()}
                    />
                  </>
                ) : selectedFile ? (
                  <div className="flex h-full items-center justify-center bg-slate-50">
                    <div className="text-center">
                      <div className="mb-2 text-4xl">📄</div>
                      <h3 className="mb-1 text-lg font-medium text-slate-900">
                        Unsupported File Type
                      </h3>
                      <p className="text-sm text-slate-600">
                        Cannot preview or edit {selectedFile.name}
                      </p>
                      <p className="mt-2 text-xs text-slate-500">
                        Supported: .tex, .bib, .md, .txt, .json, images, and PDFs
                      </p>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={50} minSize={30}>
            <div className="h-full overflow-hidden border-l border-slate-200">
              {compilationError && !pdfData ? (
                <div className="flex h-full items-start justify-center overflow-auto p-4">
                  <CompilationError
                    error={compilationError}
                    variant="overlay"
                    onRetry={handleCompile}
                    onDismiss={() => setCompilationError(null)}
                    onFixWithAI={() => {
                      if (!compilationError) return;
                      const errorContext =
                        formatCompilationErrorForAI(compilationError);
                      setTextFromEditor(errorContext);
                      setChatOpen(true);
                      setAutoSendMessage('Fix this error');
                      setCompilationError(null);
                    }}
                    className="w-full max-w-4xl"
                  />
                </div>
              ) : (
                <PDFViewer
                  pdfData={pdfData}
                  isLoading={compiling}
                  compilationError={compilationError}
                  onRetryCompile={handleCompile}
                  onDismissError={() => setCompilationError(null)}
                  onFixWithAI={
                    compilationError
                      ? () => {
                        const errorContext =
                          formatCompilationErrorForAI(compilationError);
                        setTextFromEditor(errorContext);
                        setChatOpen(true);
                        setAutoSendMessage('Fix this error');
                        setCompilationError(null);
                      }
                      : undefined
                  }
                />
              )}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <div
        className={cn(
          'fixed inset-y-0 right-0 z-20 border-l border-slate-200 bg-white',
          !isChatResizing && 'transition-transform duration-300 ease-in-out',
          chatOpen ? 'translate-x-0' : 'translate-x-full'
        )}
        style={{ width: `${chatWidth}px` }}
      >
        {chatOpen && (
          <div
            onMouseDown={startChatResize}
            className={cn(
              'absolute top-0 left-0 bottom-0 z-50 w-1 cursor-ew-resize',
              'hover:bg-slate-300',
              isChatResizing && 'bg-primary'
            )}
          />
        )}
        <Chat
          isOpen={chatOpen}
          setIsOpen={setChatOpen}
          onEditSuggestion={handleSuggestionFromChat}
          onAcceptEdit={handleAcceptEdit}
          onRejectEdit={handleRejectEdit}
          onAcceptAllEdits={handleAcceptAllEdits}
          editSuggestions={editSuggestions}
          pendingEditCount={totalPendingCount}
          fileContent={selectedFile && isTextFile(selectedFile.name) ? content : ''}
          textFromEditor={textFromEditor}
          setTextFromEditor={setTextFromEditor}
          selectionRange={selectionRange}
          projectFiles={projectFileContext}
          currentFilePath={selectedFile?.name ?? null}
          autoSendMessage={autoSendMessage}
          setAutoSendMessage={setAutoSendMessage}
        />
      </div>
    </div>
  );
}
