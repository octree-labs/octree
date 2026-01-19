'use client';

import { useState, useRef, useEffect, useCallback, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  Send,
  Loader2,
  FileText,
  PanelLeftClose,
  PanelLeft,
  Plus,
  ExternalLink,
  Code,
  Eye,
  Copy,
  Check,
  Trash2,
  Download,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { createProjectFromLatex } from '@/actions/create-project-from-latex';
import { createClient } from '@/lib/supabase/client';
import PDFViewer from '@/components/pdf-viewer';

interface GeneratedDocument {
  id: string;
  title: string;
  prompt: string;
  latex: string | null;
  status: 'pending' | 'generating' | 'complete' | 'error';
  error: string | null;
  created_at: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
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

  useEffect(() => {
    if (isStreaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [message.content, isStreaming]);

  if (isUser) {
    return (
      <div className="flex w-full justify-end">
        <Card className="max-w-[85%] bg-primary px-4 py-3 text-primary-foreground">
          <p className="whitespace-pre-wrap text-sm">{message.content}</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex w-full justify-start">
      <Card className="max-w-[85%] bg-muted/50 p-0">
        <div ref={scrollRef} className="max-h-[400px] overflow-y-auto p-4">
          <div className="space-y-1 font-mono text-sm">
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
        <Button onClick={onOpenInOctree} disabled={isCreatingProject}>
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

export function GeneratePageContent() {
  const router = useRouter();
  const supabase = createClient();
  
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentLatex, setCurrentLatex] = useState<string | null>(null);
  const [currentTitle, setCurrentTitle] = useState<string>('Untitled Document');
  const [error, setError] = useState<string | null>(null);
  const [documents, setDocuments] = useState<GeneratedDocument[]>([]);
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchDocuments = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      setUserId(user.id);
    }

    const { data, error: fetchError } = await supabase
      .from('generated_documents')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (fetchError) {
      console.error('Failed to fetch documents:', fetchError);
      return;
    }

    setDocuments(data || []);
  }, [supabase]);

  useEffect(() => {
    fetchDocuments().finally(() => setIsLoadingDocuments(false));
  }, [fetchDocuments]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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

    const userMessage: Message = {
      id: `user-${documentId}`,
      role: 'user',
      content: userPrompt,
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

    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch('/api/generate-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: userPrompt }),
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
                  const preview = streamedContent.length > 500
                    ? `Generating document...\n\n${streamedContent.slice(-500)}`
                    : `Generating document...\n\n${streamedContent}`;
                  last.content = preview;
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
            setDocuments((prev) => [doc, ...prev]);
            setActiveDocumentId(doc.id);
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

  const handleSelectSuggestion = (suggestionPrompt: string) => {
    setPrompt(suggestionPrompt);
    textareaRef.current?.focus();
  };

  const handleSelectDocument = (doc: GeneratedDocument) => {
    setActiveDocumentId(doc.id);
    setMessages([
      { id: `user-${doc.id}`, role: 'user', content: doc.prompt },
      {
        id: `assistant-${doc.id}`,
        role: 'assistant',
        content: doc.status === 'complete'
          ? 'Document generated successfully. Preview it below or open it in Octree.'
          : doc.error || 'Generation incomplete',
      },
    ]);
    setCurrentLatex(doc.latex);
    setCurrentTitle(doc.title);
    setError(doc.error);
  };

  const handleNewChat = () => {
    if (isGenerating) {
      abortControllerRef.current?.abort();
    }
    setActiveDocumentId(null);
    setMessages([]);
    setCurrentLatex(null);
    setCurrentTitle('Untitled Document');
    setError(null);
    setPrompt('');
    textareaRef.current?.focus();
  };

  const handleDeleteDocument = async (documentId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    const { error: deleteError } = await supabase
      .from('generated_documents')
      .delete()
      .eq('id', documentId);

    if (deleteError) {
      console.error('Failed to delete document:', deleteError);
      return;
    }

    setDocuments((prev) => prev.filter((d) => d.id !== documentId));

    if (activeDocumentId === documentId) {
      handleNewChat();
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

      if (result.projectId) {
        router.push(`/projects/${result.projectId}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
    } finally {
      setIsCreatingProject(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const hasStarted = messages.length > 0;

  return (
    <div className="flex h-full w-full overflow-hidden">
      <aside
        className={cn(
          'flex h-full shrink-0 flex-col border-r bg-background transition-all duration-200',
          sidebarOpen ? 'w-64' : 'w-12'
        )}
      >
        <div
          className={cn(
            'flex h-12 shrink-0 items-center border-b',
            sidebarOpen ? 'px-3' : 'justify-center'
          )}
        >
          {sidebarOpen && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleNewChat}
              className="mr-auto gap-1.5"
            >
              <Plus className="h-4 w-4" />
              New
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="h-8 w-8"
          >
            {sidebarOpen ? (
              <PanelLeftClose className="h-4 w-4" />
            ) : (
              <PanelLeft className="h-4 w-4" />
            )}
          </Button>
        </div>
        {sidebarOpen && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="p-2">
              {isLoadingDocuments ? (
                <div className="flex items-center justify-center p-4">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : documents.length === 0 ? (
                <p className="p-4 text-center text-sm text-muted-foreground">
                  No documents yet
                </p>
              ) : (
                documents.map((doc) => (
                  <div key={doc.id} className="group relative mb-1">
                    <Button
                      variant={activeDocumentId === doc.id ? 'secondary' : 'ghost'}
                      onClick={() => handleSelectDocument(doc)}
                      className="h-auto w-full justify-start gap-2 p-3 pr-8 text-left"
                    >
                      <div className="min-w-0 flex-1">
                        <span className="line-clamp-2 block text-sm font-medium">
                          {doc.title}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(doc.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => handleDeleteDocument(doc.id, e)}
                      className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </aside>

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {!hasStarted ? (
          <WelcomeState onSelectSuggestion={handleSelectSuggestion} />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-3xl space-y-4 p-4">
              {messages.map((message, index) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  isStreaming={
                    isGenerating &&
                    message.role === 'assistant' &&
                    index === messages.length - 1
                  }
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
              <Textarea
                ref={textareaRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Describe the document you want to create..."
                className="min-h-[60px] flex-1 resize-none border-0 bg-transparent p-2 shadow-none focus-visible:ring-0"
                disabled={isGenerating}
              />
              <div className="flex items-center justify-end">
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
          </form>
        </div>
      </main>
    </div>
  );
}
