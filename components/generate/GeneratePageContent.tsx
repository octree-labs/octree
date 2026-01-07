'use client';

import { useState, useRef, useEffect, FormEvent } from 'react';
import { Send, Loader2, FileText, Download, FileCode, BookOpen, PanelLeftClose, PanelLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

interface StreamEvent {
    type: string;
    stream?: string;
    timestamp?: string;
    raw?: string;
    plain?: string;
    run_id?: string;
}

interface PaperArtifacts {
    pdf_url?: string;
    latex_url?: string;
    references_url?: string;
}

interface GeneratedPaper {
    id: string;
    user_id: string;
    run_id: string;
    title: string;
    artifacts: PaperArtifacts;
    created_at: string;
}

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
}

const API_URL = process.env.NEXT_PUBLIC_RESEARCHER_API_URL || 'http://localhost:8000';

async function getAuthHeaders(): Promise<HeadersInit> {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`
        };
    }
    return { 'Content-Type': 'application/json' };
}

async function fetchPapers(): Promise<GeneratedPaper[]> {
    try {
        const headers = await getAuthHeaders();
        const res = await fetch(`${API_URL}/api/papers`, { headers });
        if (!res.ok) return [];
        return await res.json();
    } catch {
        return [];
    }
}

const SUGGESTIONS = [
    {
        title: 'Explore quantum computing',
        description: 'applications in machine learning',
        prompt: 'Write a research paper exploring quantum computing applications in machine learning'
    },
    {
        title: 'Analyze transformer architectures',
        description: 'for natural language processing',
        prompt: 'Write a research paper analyzing transformer architectures for natural language processing'
    },
    {
        title: 'Investigate renewable energy',
        description: 'storage solutions',
        prompt: 'Write a research paper investigating renewable energy storage solutions'
    },
    {
        title: 'Study climate change effects',
        description: 'on global ecosystems',
        prompt: 'Write a research paper studying climate change effects on global ecosystems'
    }
];

function WelcomeState({ onSelectSuggestion }: { onSelectSuggestion: (prompt: string) => void }) {
    return (
        <div className="flex h-full flex-col items-center justify-center px-4">
            <div className="mb-8 text-center">
                <h1 className="text-2xl font-semibold text-foreground">
                    AI Research Generator
                </h1>
                <p className="mt-2 text-muted-foreground">
                    Enter a research topic and let AI generate a complete paper
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
                <div
                    ref={scrollRef}
                    className="max-h-[400px] overflow-y-auto p-4"
                >
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

function ArtifactsPanel({ artifacts }: { artifacts: PaperArtifacts }) {
    return (
        <Card className="bg-muted/30 p-4">
            <h3 className="mb-3 text-sm font-medium text-foreground">Generated Artifacts</h3>
            <div className="flex flex-wrap gap-2">
                {artifacts.pdf_url && (
                    <>
                        <Button variant="outline" size="sm" asChild>
                            <a href={artifacts.pdf_url} target="_blank" rel="noopener noreferrer">
                                <FileText className="mr-1.5 h-4 w-4" />
                                View PDF
                            </a>
                        </Button>
                        <Button variant="outline" size="sm" asChild>
                            <a href={artifacts.pdf_url} download target="_blank" rel="noopener noreferrer">
                                <Download className="mr-1.5 h-4 w-4" />
                                Download PDF
                            </a>
                        </Button>
                    </>
                )}
                {artifacts.latex_url && (
                    <Button variant="outline" size="sm" asChild>
                        <a href={artifacts.latex_url} target="_blank" rel="noopener noreferrer">
                            <FileCode className="mr-1.5 h-4 w-4" />
                            Download LaTeX
                        </a>
                    </Button>
                )}
                {artifacts.references_url && (
                    <Button variant="outline" size="sm" asChild>
                        <a href={artifacts.references_url} target="_blank" rel="noopener noreferrer">
                            <BookOpen className="mr-1.5 h-4 w-4" />
                            Download BibTeX
                        </a>
                    </Button>
                )}
            </div>
        </Card>
    );
}

export function GeneratePageContent() {
    const [prompt, setPrompt] = useState('');
    const [messages, setMessages] = useState<Message[]>([]);
    const [isGenerating, setIsGenerating] = useState(false);
    const [isFetchingArtifacts, setIsFetchingArtifacts] = useState(false);
    const [artifacts, setArtifacts] = useState<PaperArtifacts | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [papers, setPapers] = useState<GeneratedPaper[]>([]);
    const [sidebarOpen, setSidebarOpen] = useState(true);

    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const isPollingRef = useRef(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    useEffect(() => {
        fetchPapers().then(setPapers);
    }, []);

    const pollForArtifacts = async (runId: string) => {
        if (isPollingRef.current) return;

        isPollingRef.current = true;
        setIsFetchingArtifacts(true);

        let attempts = 0;
        const maxAttempts = 30;

        try {
            while (attempts < maxAttempts) {
                try {
                    const response = await fetch(`${API_URL}/api/artifacts/${runId}`);
                    if (response.ok) {
                        const data = await response.json();
                        if (data.artifacts && (data.artifacts.pdf_url || data.artifacts.latex_url)) {
                            setArtifacts(data.artifacts);
                            fetchPapers().then(setPapers);
                            return;
                        }
                    }
                } catch {
                }
                attempts++;
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        } finally {
            isPollingRef.current = false;
            setIsFetchingArtifacts(false);
        }
    };

    const handleSubmit = async (e?: FormEvent) => {
        e?.preventDefault();
        if (!prompt.trim() || isGenerating) return;

        const userMessage: Message = {
            id: `user-${Date.now()}`,
            role: 'user',
            content: prompt.trim()
        };

        const assistantMessage: Message = {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: ''
        };

        setMessages(prev => [...prev, userMessage, assistantMessage]);
        setPrompt('');
        setIsGenerating(true);
        setArtifacts(null);
        setError(null);

        let generatedRunId: string | null = null;

        try {
            const headers = await getAuthHeaders();
            const response = await fetch(`${API_URL}/api/generate`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    prompt: userMessage.content,
                    test_mode: true,
                }),
            });

            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            const reader = response.body?.getReader();
            const decoder = new TextDecoder();

            if (!reader) {
                throw new Error('No response body');
            }

            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const event: StreamEvent = JSON.parse(line);

                        if (event.run_id) {
                            generatedRunId = event.run_id;
                        }

                        const logContent = event.plain || event.raw;
                        if (logContent) {
                            setMessages(prev => {
                                const updated = [...prev];
                                const lastMsg = updated[updated.length - 1];
                                if (lastMsg && lastMsg.role === 'assistant') {
                                    lastMsg.content = lastMsg.content
                                        ? lastMsg.content + '\n' + logContent
                                        : logContent;
                                }
                                return updated;
                            });
                        }
                    } catch {
                        setMessages(prev => {
                            const updated = [...prev];
                            const lastMsg = updated[updated.length - 1];
                            if (lastMsg && lastMsg.role === 'assistant') {
                                lastMsg.content = lastMsg.content
                                    ? lastMsg.content + '\n' + line
                                    : line;
                            }
                            return updated;
                        });
                    }
                }
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            setIsGenerating(false);
            fetchPapers().then(setPapers);
            if (generatedRunId) {
                pollForArtifacts(generatedRunId);
            }
        }
    };

    const handleSelectSuggestion = (suggestionPrompt: string) => {
        setPrompt(suggestionPrompt);
        textareaRef.current?.focus();
    };

    const handleSelectPaper = (paper: GeneratedPaper) => {
        setArtifacts(paper.artifacts);
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
                <div className={cn(
                    'flex h-12 shrink-0 items-center border-b',
                    sidebarOpen ? 'px-3' : 'justify-center'
                )}>
                    {sidebarOpen && (
                        <span className="mr-auto text-sm font-medium">History</span>
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
                            {papers.length === 0 ? (
                                <p className="p-4 text-center text-sm text-muted-foreground">
                                    No papers yet
                                </p>
                            ) : (
                                papers.map((paper) => (
                                    <Button
                                        key={paper.id}
                                        variant="ghost"
                                        onClick={() => handleSelectPaper(paper)}
                                        className="mb-1 h-auto w-full flex-col items-start gap-0.5 p-3 text-left"
                                    >
                                        <span className="line-clamp-2 text-sm font-medium">
                                            {paper.title || 'Untitled'}
                                        </span>
                                        <span className="text-xs text-muted-foreground">
                                            {new Date(paper.created_at).toLocaleDateString()}
                                        </span>
                                    </Button>
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
                    <div
                        ref={messagesContainerRef}
                        className="min-h-0 flex-1 overflow-y-auto"
                    >
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

                            {isFetchingArtifacts && !artifacts && (
                                <div className="flex items-center gap-2 text-muted-foreground">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    <span className="text-sm">Fetching artifacts...</span>
                                </div>
                            )}

                            {artifacts && <ArtifactsPanel artifacts={artifacts} />}

                            {error && (
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
                        <Card className="flex gap-2 p-2">
                            <Textarea
                                ref={textareaRef}
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="Enter your research topic..."
                                className="min-h-[60px] flex-1 resize-none border-0 bg-transparent p-2 shadow-none focus-visible:ring-0"
                                disabled={isGenerating}
                            />
                            <Button
                                type="submit"
                                size="icon"
                                disabled={!prompt.trim() || isGenerating}
                                className="h-8 w-8 shrink-0 self-end rounded-full"
                            >
                                {isGenerating ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <Send className="h-4 w-4" />
                                )}
                            </Button>
                        </Card>
                    </form>
                </div>
            </main>
        </div>
    );
}
