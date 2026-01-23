'use client';

import { useState, useRef, useEffect, useCallback, FormEvent, ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  Send,
  Loader2,
  FileText,
  ExternalLink,
  Code,
  Eye,
  Copy,
  Check,
  Download,
  Paperclip,
  X,
  Image as ImageIcon,
  File,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { SidebarInset, SidebarTrigger } from '@/components/ui/sidebar';
import { BackButton } from '@/components/projects/back-button';
import { cn } from '@/lib/utils';
import { createProjectFromLatex } from '@/actions/create-project-from-latex';
import { createClient } from '@/lib/supabase/client';
import PDFViewer from '@/components/pdf-viewer';
import { GenerateHistorySidebar } from '@/components/generate/GenerateHistorySidebar';

interface GeneratedDocument {
  id: string;
  title: string;
  prompt: string;
  latex: string | null;
  status: 'pending' | 'generating' | 'complete' | 'error';
  error: string | null;
  created_at: string;
}

interface MessageAttachment {
  id: string;
  name: string;
  type: 'image' | 'document';
  preview: string | null;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: MessageAttachment[];
}

const SUGGESTIONS = [
  {
    title: 'Research paper on ML',
    description: 'machine learning fundamentals',
    prompt: 'Write a research paper on the fundamentals of machine learning, covering supervised learning, unsupervised learning, and neural networks.',
  },
  {
    title: 'Technical report',
    description: 'system architecture overview',
    prompt: 'Write a technical report documenting a microservices architecture, including system design, API specifications, and deployment considerations.',
  },
  {
    title: 'Literature review',
    description: 'climate change impacts',
    prompt: 'Write a literature review examining recent research on climate change impacts on global biodiversity and ecosystem services.',
  },
  {
    title: 'Conference paper',
    description: 'distributed systems',
    prompt: 'Write a conference paper on consensus algorithms in distributed systems, comparing Raft, Paxos, and Byzantine fault-tolerant approaches.',
  },
];

function WelcomeState({ onSelectSuggestion }: { onSelectSuggestion: (prompt: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-4">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold text-foreground">Generate Document</h1>
        <p className="mt-2 text-muted-foreground">
          Describe what you want to create and get a complete LaTeX document
        </p>
      </div>
      <div className="grid w-full max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((suggestion) => (
          <Button
            key={suggestion.prompt}
            variant="outline"
            onClick={() => onSelectSuggestion(suggestion.prompt)}
            className="h-auto flex-col items-start gap-1 p-4 text-left"
          >
            <span className="font-medium">{suggestion.title}</span>
            <span className="text-sm text-muted-foreground">{suggestion.description}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ message, isStreaming }: { message: Message; isStreaming?: boolean }) {
  const isUser = message.role === 'user';
  const scrollRef = useRef<HTMLDivElement>(null);

  const isCompletionMessage = message.content === 'Document generated successfully. Preview it below or open it in Octree.';

  useEffect(() => {
    if (isStreaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [message.content, isStreaming]);

  if (isUser) {
    return (
      <div className="flex w-full flex-col items-end gap-2">
        {message.attachments && message.attachments.length > 0 && (
          <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
            {message.attachments.map((att, index) => (
              <div
                key={att.id}
                className="flex items-center gap-2 rounded-md border border-border/50 bg-muted px-2 py-1.5"
              >
                {att.type === 'image' && att.preview ? (
                  <img
                    src={att.preview}
                    alt=""
                    className="h-8 w-8 rounded object-cover"
                  />
                ) : (
                  <FileText className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="max-w-[120px] truncate text-xs text-foreground">
                  {att.name}
                </span>
              </div>
            ))}
          </div>
        )}
        <Card className="max-w-[85%] bg-primary px-4 py-3 text-primary-foreground">
          <p className="whitespace-pre-wrap text-sm">{message.content}</p>
        </Card>
      </div>
    );
  }

  if (isCompletionMessage) {
    return (
      <div className="flex w-full justify-start">
        <div className="flex items-center gap-2 rounded-md bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          <Check className="h-4 w-4 text-green-600" />
          <span>{message.content}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full justify-start">
      <Card className="w-full bg-muted/50 p-0">
        <div
          ref={scrollRef}
          className="max-h-80 overflow-y-auto p-4"
        >
          <div className="space-y-0.5 font-mono text-sm">
            {message.content.split('\n').map((line, i) => (
              <p key={i} className="whitespace-pre-wrap text-foreground">
                {line}
              </p>
            ))}
          </div>
        </div>
        {isStreaming && (
          <div className="flex items-center gap-2 border-t px-4 py-2 text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span className="text-xs">Generating...</span>
          </div>
        )}
      </Card>
    </div>
  );
}

interface DocumentPreviewProps {
  latex: string;
  title: string;
  onOpenInOctree: () => void;
  isCreatingProject: boolean;
}

function DocumentPreview({ latex, title, onOpenInOctree, isCreatingProject }: DocumentPreviewProps) {
  const [viewMode, setViewMode] = useState<'code' | 'pdf'>('code');
  const [copied, setCopied] = useState(false);
  const [pdfData, setPdfData] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [isCompiling, setIsCompiling] = useState(false);

  useEffect(() => {
    setPdfData(null);
    setPdfError(null);
    setIsCompiling(false);
  }, [latex]);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(latex);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [latex]);

  const handleDownload = useCallback(async () => {
    let pdfToDownload = pdfData;

    if (!pdfToDownload && !isCompiling) {
      setIsCompiling(true);
      setPdfError(null);

      try {
        const response = await fetch('/api/compile-pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: latex }),
        });

        const data = await response.json();

        if (!response.ok || !data.pdf) {
          setPdfError(data.error || 'Compilation failed');
          return;
        }

        setPdfData(data.pdf);
        pdfToDownload = data.pdf;
      } catch (err) {
        setPdfError(err instanceof Error ? err.message : 'Failed to compile');
        return;
      } finally {
        setIsCompiling(false);
      }
    }

    if (!pdfToDownload) return;

    const byteCharacters = atob(pdfToDownload);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: 'application/pdf' });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${title.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [pdfData, isCompiling, latex, title]);

  const compilePdf = useCallback(async () => {
    if (pdfData || isCompiling) return;

    setIsCompiling(true);
    setPdfError(null);

    try {
      const response = await fetch('/api/compile-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: latex }),
      });

      const data = await response.json();

      if (!response.ok || !data.pdf) {
        setPdfError(data.error || 'Compilation failed');
        return;
      }

      setPdfData(data.pdf);
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : 'Failed to compile');
    } finally {
      setIsCompiling(false);
    }
  }, [latex, pdfData, isCompiling]);

  useEffect(() => {
    if (viewMode === 'pdf' && !pdfData && !isCompiling) {
      compilePdf();
    }
  }, [viewMode, pdfData, isCompiling, compilePdf]);

  return (
    <Card className="flex flex-col overflow-hidden border bg-background">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Generated Document</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border">
            <Button
              variant={viewMode === 'code' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('code')}
              className="rounded-r-none"
            >
              <Code className="mr-1.5 h-3.5 w-3.5" />
              LaTeX
            </Button>
            <Button
              variant={viewMode === 'pdf' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('pdf')}
              className="rounded-l-none"
            >
              <Eye className="mr-1.5 h-3.5 w-3.5" />
              Preview
            </Button>
          </div>
          <Button variant="outline" size="sm" onClick={handleCopy}>
            {copied ? (
              <Check className="mr-1.5 h-3.5 w-3.5" />
            ) : (
              <Copy className="mr-1.5 h-3.5 w-3.5" />
            )}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </div>

      <div className="h-[600px] overflow-hidden">
        {viewMode === 'code' ? (
          <div className="h-full overflow-auto bg-muted/30 p-4">
            <pre className="text-xs leading-relaxed text-foreground">
              <code>{latex}</code>
            </pre>
          </div>
        ) : (
          <PDFViewer
            pdfData={pdfData}
            isLoading={isCompiling}
            compilationError={pdfError ? { message: pdfError } : null}
            onRetryCompile={compilePdf}
            onDismissError={() => setPdfError(null)}
          />
        )}
      </div>

      <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
        <Button
          variant="outline"
          onClick={handleDownload}
          disabled={isCompiling}
        >
          {isCompiling ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          {isCompiling ? 'Compiling...' : 'Download PDF'}
        </Button>
        <Button
          variant="gradient"
          onClick={onOpenInOctree}
          disabled={isCreatingProject}
        >
          {isCreatingProject ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <ExternalLink className="mr-2 h-4 w-4" />
          )}
          Open in Octree
        </Button>
      </div>
    </Card>
  );
}

interface AttachedFile {
  id: string;
  file: File;
  preview: string | null;
  type: 'image' | 'document';
}

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const DOCUMENT_TYPES = ['application/pdf'];

export function GeneratePageContent() {
  const router = useRouter();
  const supabase = createClient();

  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentLatex, setCurrentLatex] = useState<string | null>(null);
  const [currentTitle, setCurrentTitle] = useState<string>('Untitled Document');
  const [error, setError] = useState<string | null>(null);
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);

  useEffect(() => {
    const fetchUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUserId(user.id);
      }
    };
    fetchUser();
  }, [supabase]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    return () => {
      attachedFiles.forEach((f) => {
        if (f.preview) URL.revokeObjectURL(f.preview);
      });
    };
  }, [attachedFiles]);

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newFiles: AttachedFile[] = [];

    Array.from(files).forEach((file) => {
      if (file.size > MAX_FILE_SIZE) return;

      const isImage = IMAGE_TYPES.includes(file.type);
      const isDocument = DOCUMENT_TYPES.includes(file.type);

      if (!isImage && !isDocument) return;

      newFiles.push({
        id: crypto.randomUUID(),
        file,
        preview: isImage ? URL.createObjectURL(file) : null,
        type: isImage ? 'image' : 'document',
      });
    });

    setAttachedFiles((prev) => [...prev, ...newFiles]);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRemoveFile = (fileId: string) => {
    setAttachedFiles((prev) => {
      const file = prev.find((f) => f.id === fileId);
      if (file?.preview) URL.revokeObjectURL(file.preview);
      return prev.filter((f) => f.id !== fileId);
    });
  };

  const convertFilesToBase64 = async (
    files: AttachedFile[]
  ): Promise<{ mimeType: string; data: string; name: string }[]> => {
    return Promise.all(
      files.map(
        (f) =>
          new Promise<{ mimeType: string; data: string; name: string }>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const result = reader.result as string;
              const base64Data = result.split(',')[1];
              resolve({
                mimeType: f.file.type,
                data: base64Data,
                name: f.file.name,
              });
            };
            reader.readAsDataURL(f.file);
          })
      )
    );
  };

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!prompt.trim() || isGenerating) return;

    // Auto-start new chat if a document already exists in current view
    if (currentLatex) {
      setActiveDocumentId(null);
      setMessages([]);
      setCurrentLatex(null);
      setCurrentTitle('Untitled Document');
      setError(null);
    }

    const userPrompt = prompt.trim();
    const documentId = crypto.randomUUID();

    const filesToSend = [...attachedFiles];
    const messageAttachments: MessageAttachment[] = filesToSend.map((f) => ({
      id: f.id,
      name: f.file.name,
      type: f.type,
      preview: f.preview,
    }));

    const userMessage: Message = {
      id: `user-${documentId}`,
      role: 'user',
      content: userPrompt,
      attachments: messageAttachments.length > 0 ? messageAttachments : undefined,
    };

    const assistantMessage: Message = {
      id: `assistant-${documentId}`,
      role: 'assistant',
      content: '',
    };

    setMessages([userMessage, assistantMessage]);
    setPrompt('');
    setIsGenerating(true);
    setCurrentLatex(null);
    setError(null);
    setActiveDocumentId(null);
    setAttachedFiles([]);

    abortControllerRef.current = new AbortController();

    try {
      const files = filesToSend.length > 0
        ? await convertFilesToBase64(filesToSend)
        : undefined;

      filesToSend.forEach((f) => {
        if (f.preview) URL.revokeObjectURL(f.preview);
      });

      const response = await fetch('/api/generate-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: userPrompt, files }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Request failed: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response stream');

      const decoder = new TextDecoder();
      let buffer = '';
      let streamedContent = '';
      let finalLatex: string | null = null;
      let documentTitle = 'Untitled Document';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const chunk of lines) {
          const eventMatch = chunk.match(/^event:\s*(\S+)/);
          const dataMatch = chunk.match(/data:\s*([\s\S]+)$/m);

          if (!eventMatch || !dataMatch) continue;

          const eventType = eventMatch[1];
          let eventData: Record<string, unknown>;

          try {
            eventData = JSON.parse(dataMatch[1]);
          } catch {
            continue;
          }

          if (eventType === 'status') {
            const statusMessage = eventData.message as string;
            if (statusMessage) {
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === 'assistant') {
                  last.content = statusMessage;
                }
                return updated;
              });
            }
          } else if (eventType === 'content') {
            const text = eventData.text as string;
            if (text) {
              streamedContent += text;
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === 'assistant') {
                  last.content = streamedContent;
                }
                return updated;
              });
            }
          } else if (eventType === 'complete') {
            finalLatex = eventData.latex as string;
            documentTitle = (eventData.title as string) || 'Untitled Document';
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last?.role === 'assistant') {
                last.content = 'Document generated successfully. Preview it below or open it in Octree.';
              }
              return updated;
            });
          } else if (eventType === 'error') {
            throw new Error(eventData.message as string);
          }
        }
      }

      if (finalLatex) {
        setCurrentLatex(finalLatex);
        setCurrentTitle(documentTitle);

        if (userId) {
          const { data: inserted, error: insertError } = await supabase
            .from('generated_documents')
            .insert({
              user_id: userId,
              title: documentTitle,
              prompt: userPrompt,
              latex: finalLatex,
              status: 'complete',
            } as never)
            .select()
            .single();

          if (insertError) {
            console.error('Failed to save document:', insertError);
          } else if (inserted) {
            const doc = inserted as unknown as GeneratedDocument;
            setActiveDocumentId(doc.id);
            window.dispatchEvent(new CustomEvent('generate:documentCreated', { detail: doc }));
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;

      const errorMessage = err instanceof Error ? err.message : 'Generation failed';
      setError(errorMessage);
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === 'assistant') {
          last.content = `Error: ${errorMessage}`;
        }
        return updated;
      });
    } finally {
      setIsGenerating(false);
      abortControllerRef.current = null;
    }
  };


  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleOpenInOctree = async () => {
    if (!currentLatex || isCreatingProject) return;

    setIsCreatingProject(true);
    try {
      const result = await createProjectFromLatex(currentTitle, currentLatex);

      if (result.error) {
        setError(result.error);
        return;
      }

      const projectId = result.projectId!;
      router.push(`/projects/${projectId}`);
    } catch {
      setError('Failed to create project');
      setIsCreatingProject(false);
    }
  };

  return (
    <>
      <GenerateHistorySidebar
        key={activeDocumentId}
        activeDocumentId={activeDocumentId}
        onNewChat={() => {
          setActiveDocumentId(null);
          setMessages([]);
          setCurrentLatex(null);
          setCurrentTitle('Untitled Document');
          setError(null);
        }}
        onSelectDocument={(doc) => {
          if (!doc.latex) return;
          setActiveDocumentId(doc.id);
          setCurrentLatex(doc.latex);
          setCurrentTitle(doc.title);
          setError(null);
          setMessages([
            {
              id: `user-${doc.id}`,
              role: 'user',
              content: doc.prompt,
            },
            {
              id: `assistant-${doc.id}`,
              role: 'assistant',
              content: 'Document generated successfully. Preview it below or open it in Octree.',
            },
          ]);
        }}
      />
      <SidebarInset className="flex h-screen flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b px-4 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2">
            <SidebarTrigger className="-ml-1" />
            <BackButton />
          </div>
          <div className="text-sm font-medium text-muted-foreground">
            {currentTitle}
          </div>
          <div className="w-8" /> {/* Spacer for centering */}
        </header>

        <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-muted/30">
          {!messages.length ? (
            <WelcomeState onSelectSuggestion={(suggestion) => setPrompt(suggestion)} />
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="mx-auto max-w-3xl space-y-4">
                {messages.map((message) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    isStreaming={message.role === 'assistant' && isGenerating && message.content !== 'Document generated successfully. Preview it below or open it in Octree.' && !error}
                  />
                ))}

                {currentLatex && !isGenerating && (
                  <DocumentPreview
                    latex={currentLatex}
                    title={currentTitle}
                    onOpenInOctree={handleOpenInOctree}
                    isCreatingProject={isCreatingProject}
                  />
                )}

                {error && !isGenerating && (
                  <Card className="border-destructive bg-destructive/10 p-3">
                    <p className="text-sm text-destructive">{error}</p>
                  </Card>
                )}

                <div ref={messagesEndRef} />
              </div>
            </div>
          )}

          <div className="shrink-0 border-t bg-background p-4">
            <form onSubmit={handleSubmit} className="mx-auto max-w-3xl">
              <Card className="flex flex-col gap-2 p-2">
                {attachedFiles.length > 0 && (
                  <div className="flex flex-wrap gap-2 px-2 pt-1">
                    {attachedFiles.map((f) => (
                      <div
                        key={f.id}
                        className="group relative flex h-14 items-center gap-2 rounded-md border bg-muted/50 px-2"
                      >
                        {f.type === 'image' && f.preview ? (
                          <img
                            src={f.preview}
                            alt=""
                            className="h-10 w-10 rounded object-cover"
                          />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded bg-muted">
                            <FileText className="h-5 w-5 text-muted-foreground" />
                          </div>
                        )}
                        <span className="max-w-[120px] truncate text-xs text-muted-foreground">
                          {f.file.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveFile(f.id)}
                          className="ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-background/80 opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <Textarea
                  ref={textareaRef}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Describe the document you want to create..."
                  className="min-h-[60px] flex-1 resize-none border-0 bg-transparent p-2 shadow-none focus-visible:ring-0"
                  disabled={isGenerating}
                />
                <div className="flex items-center justify-between">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        disabled={isGenerating}
                      >
                        <Paperclip className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem onClick={() => {
                        if (fileInputRef.current) {
                          fileInputRef.current.accept = 'image/png,image/jpeg,image/gif,image/webp';
                          fileInputRef.current.click();
                        }
                      }}>
                        <ImageIcon className="mr-2 h-4 w-4" />
                        Image
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => {
                        if (fileInputRef.current) {
                          fileInputRef.current.accept = 'application/pdf';
                          fileInputRef.current.click();
                        }
                      }}>
                        <File className="mr-2 h-4 w-4" />
                        PDF Document
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    type="submit"
                    size="icon"
                    disabled={!prompt.trim() || isGenerating}
                    className="h-8 w-8 shrink-0 rounded-full"
                  >
                    {isGenerating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </Card>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileSelect}
                className="hidden"
              />
            </form>
          </div>
        </main>
      </SidebarInset>
    </>
  );
}
