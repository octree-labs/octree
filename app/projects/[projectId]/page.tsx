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
import { useZoteroSync } from '@/hooks/use-zotero-sync';
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
import { useIsMobile } from '@/hooks/use-mobile';
import { Code, Eye, MessageSquare, Play, Loader2, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FileTree } from '@/components/projects/file-tree';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { CitationEntry } from '@/types/citation';

const CHAT_WIDTH_DEFAULT = 340;
const CHAT_WIDTH_MIN = 280;
const CHAT_WIDTH_MAX = 600;
const CHAT_WIDTH_STORAGE_KEY = 'chat_sidebar_width';

function insertCitationAtCursor(
  editor: Monaco.editor.IStandaloneCodeEditor | null,
  key: string
) {
  if (!editor) return;

  const model = editor.getModel();
  const selection = editor.getSelection();
  if (!model || !selection) return;

  const content = model.getValue();
  const offset = model.getOffsetAt(selection.getPosition());
  const before = content.slice(0, offset);
  const citeStart = before.lastIndexOf('\\cite{');
  const lastClose = before.lastIndexOf('}');
  const insideCite = citeStart !== -1 && lastClose < citeStart;

  let insertText = `\\cite{${key}}`;
  if (insideCite) {
    const braceStart = citeStart + '\\cite{'.length;
    const textInCiteSoFar = content.slice(braceStart, offset).trim();
    const needsComma = textInCiteSoFar.length > 0 && !textInCiteSoFar.endsWith(',');
    insertText = `${needsComma ? ', ' : ''}${key}`;
  }

  editor.executeEdits('insert-citation', [
    {
      range: selection,
      text: insertText,
      forceMoveMarkers: true,
    },
  ]);
  editor.focus();
}

export default function ProjectPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const isMobile = useIsMobile();
  const [mobileView, setMobileView] = useState<'files' | 'code' | 'preview'>('code');
  const [isMobileChatOpen, setIsMobileChatOpen] = useState(false);

  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);

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
        if (isMobile) {
            setMobileView('code');
        }
      }
    },
    [projectFiles, isMobile]
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
  const [citationPickerOpen, setCitationPickerOpen] = useState(false);
  const [citationQuery, setCitationQuery] = useState('');
  const { state: zoteroState, searchEntries } = useZoteroSync(projectId);

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

  const filteredCitations = useMemo(
    () => searchEntries(citationQuery),
    [citationQuery, searchEntries]
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
  };

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

  const renderContent = () => {
    if (isImage && selectedFile) {
        return <ImageViewer projectId={projectId} fileName={selectedFile.name} />;
    }
    if (isPDF && selectedFile) {
        return <SimplePDFViewer projectId={projectId} fileName={selectedFile.name} />;
    }
    if (isText && selectedFile) {
        return (
            <>
                <MonacoEditor
                    content={content}
                    onChange={handleEditorChange}
                    onMount={handleEditorMount}
                    citationEntries={zoteroState.entries}
                    className="h-full"
                />
                <SelectionButton
                    show={showButton}
                    position={buttonPos}
                    onCopy={() => handleCopy()}
                />
            </>
        );
    }
    if (selectedFile) {
        return (
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
        );
    }
    return null;
  };

  const renderPreview = () => (
      <div className="h-full overflow-hidden border-l border-slate-200" data-onboarding-target="pdf">
          {compilationError && !pdfData ? (
              <div className="flex h-full overflow-auto">
                  <CompilationError
                      error={compilationError}
                      variant="overlay"
                      onRetry={handleCompile}
                      onDismiss={() => setCompilationError(null)}
                      onFixWithAI={() => {
                          if (!compilationError) return;
                          const errorContext = formatCompilationErrorForAI(compilationError);
                          setTextFromEditor(errorContext);
                          setChatOpen(true);
                          if (isMobile) {
                            setMobileView('code'); // Switch to code view to show chat
                            setIsMobileChatOpen(true);
                          }
                          setAutoSendMessage('Fix this error');
                          setCompilationError(null);
                      }}
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
                              const errorContext = formatCompilationErrorForAI(compilationError);
                              setTextFromEditor(errorContext);
                              setChatOpen(true);
                              if (isMobile) {
                                setMobileView('code'); // Switch to code view to show chat
                                setIsMobileChatOpen(true);
                              }
                              setAutoSendMessage('Fix this error');
                              setCompilationError(null);
                          }
                          : undefined
                  }
              />
          )}
      </div>
  );

  const renderFiles = () => (
    <div className="flex h-full flex-col bg-slate-50 p-4">
      {projectData && projectFiles ? (
        <FileTree
          files={projectFiles}
          selectedFileId={selectedFile?.id || null}
          onFileSelect={(file) => {
            FileActions.setSelectedFile(file);
            setMobileView('code');
          }}
          rootFolderName={projectData.title}
          projectId={projectData.id}
        />
      ) : (
        <LoadingState />
      )}
    </div>
  );

  if (isMobile) {
      return (
          <div className="flex h-[calc(100vh-theme(spacing.14))] flex-col bg-slate-100">
              <div className="flex-1 overflow-hidden relative">
                  {mobileView === 'files' && renderFiles()}
                  {mobileView === 'code' && (
                      <div className="flex h-full flex-col relative">
                          <div className="flex items-center justify-between border-b bg-white px-2 py-1.5">
                              <span className="text-xs font-medium text-muted-foreground truncate max-w-[200px]">
                                  {selectedFile?.name}
                              </span>
                              <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                      handleCompile();
                                      setMobileView('preview');
                                  }}
                                  disabled={compiling}
                                  className="h-8 gap-1.5 text-primary hover:text-primary/90"
                              >
                                  {compiling ? (
                                      <Loader2 className="size-4 animate-spin" />
                                  ) : (
                                      <Play className="size-4 fill-current" />
                                  )}
                                  <span className="text-xs font-medium">{compiling ? 'Running...' : 'Run'}</span>
                              </Button>
                          </div>
                          <div className="flex-1 overflow-hidden">
                              {renderContent()}
                          </div>

                          {/* Floating Chat Button */}
                          <Button
                              variant="gradient"
                              className={cn(
                                "absolute bottom-4 right-4 z-40 h-12 w-12 rounded-full p-0 shadow-xl transition-all duration-200 active:scale-95",
                                isMobileChatOpen ? "scale-0 opacity-0" : "scale-100 opacity-100"
                              )}
                              onClick={() => setIsMobileChatOpen(true)}
                          >
                              <MessageSquare className="size-6 fill-current/10" />
                          </Button>
                      </div>
                  )}
                  {mobileView === 'preview' && renderPreview()}

                  {/* Chat Overlay - Only in Code View */}
                  {mobileView === 'code' && (
                    <div
                        className={cn(
                            "absolute inset-x-0 bottom-0 z-50 flex h-[60vh] flex-col overflow-hidden rounded-t-2xl border-t bg-white shadow-2xl transition-transform duration-300 ease-in-out",
                            isMobileChatOpen ? "translate-y-0" : "translate-y-full"
                        )}
                    >
                        <Chat
                            isOpen={isMobileChatOpen}
                            setIsOpen={() => setIsMobileChatOpen(false)}
                            autoFocus={false}
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
                            projectId={projectId}
                        />
                    </div>
                  )}
              </div>

              {/* Bottom Navigation */}
              <div className="flex shrink-0 items-center justify-around border-t bg-white p-2 safe-area-bottom relative z-50">
                  <Button
                      variant={mobileView === 'files' ? 'secondary' : 'ghost'}
                      size="sm"
                      className="flex-1 flex-col gap-1 h-auto py-2 rounded-lg"
                      onClick={() => {
                        setMobileView('files');
                        setIsMobileChatOpen(false);
                      }}
                  >
                      <FileText className="size-5" />
                      <span className="text-[10px] font-medium">Files</span>
                  </Button>
                  <Button
                      variant={mobileView === 'code' ? 'secondary' : 'ghost'}
                      size="sm"
                      className="flex-1 flex-col gap-1 h-auto py-2 rounded-lg"
                      onClick={() => {
                        setMobileView('code');
                        setIsMobileChatOpen(false);
                      }}
                  >
                      <Code className="size-5" />
                      <span className="text-[10px] font-medium">Code</span>
                  </Button>
                  <Button
                      variant={mobileView === 'preview' ? 'secondary' : 'ghost'}
                      size="sm"
                      className="flex-1 flex-col gap-1 h-auto py-2 rounded-lg"
                      onClick={() => {
                        setMobileView('preview');
                        setIsMobileChatOpen(false);
                      }}
                  >
                      <Eye className="size-5" />
                      <span className="text-[10px] font-medium">Preview</span>
                  </Button>
              </div>
          </div>
      );
  }

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
        onOpenCitationPicker={() => setCitationPickerOpen(true)}
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

      <Dialog open={citationPickerOpen} onOpenChange={setCitationPickerOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Insert Citation</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <Input
              value={citationQuery}
              onChange={(e) => setCitationQuery(e.target.value)}
              placeholder="Search by key, title, author, or year"
            />
            <div className="max-h-80 overflow-auto rounded-md border border-neutral-200">
              {filteredCitations.length === 0 ? (
                <div className="p-4 text-sm text-neutral-500">
                  {zoteroState.entries.length === 0
                    ? 'No Zotero references imported yet.'
                    : 'No references match your search.'}
                </div>
              ) : (
                <ul className="divide-y divide-neutral-100">
                  {filteredCitations.map((entry: CitationEntry) => (
                    <li
                      key={entry.key}
                      className="flex items-start justify-between gap-3 p-3"
                    >
                      <div className="min-w-0">
                        <p className="font-mono text-xs text-primary">{entry.key}</p>
                        <p className="truncate text-sm font-medium text-neutral-900">
                          {entry.title}
                        </p>
                        <p className="text-xs text-neutral-500">
                          {entry.author} ({entry.year})
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="gradient"
                        onClick={() => {
                          insertCitationAtCursor(editorRef.current, entry.key);
                          setCitationPickerOpen(false);
                        }}
                      >
                        Insert
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <div className="flex min-h-0 flex-1">
        <ResizablePanelGroup
          direction="horizontal"
          className="flex min-h-0 flex-1 transition-all duration-300 ease-in-out"
        >
          <ResizablePanel defaultSize={50} minSize={25}>
            <div
              className="relative h-full"
              data-onboarding-target="editor"
            >
              <div className="h-full overflow-hidden">
                {renderContent()}
              </div>
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={50} minSize={30}>
            {renderPreview()}
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
          projectId={projectId}
        />
      </div>
    </div>
  );
}
