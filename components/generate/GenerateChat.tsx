'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, FileText, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface StreamEvent {
    type: string;
    stream?: string;
    timestamp?: string;
    raw?: string;
    plain?: string;
    run_id?: string;
}

interface Artifacts {
    latex_url?: string;
    pdf_url?: string;
    references_url?: string;
}

export function GenerateChat() {
    const [prompt, setPrompt] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [isFetchingArtifacts, setIsFetchingArtifacts] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);
    const [runId, setRunId] = useState<string | null>(null);
    const [artifacts, setArtifacts] = useState<Artifacts | null>(null);
    const [error, setError] = useState<string | null>(null);
    const logsEndRef = useRef<HTMLDivElement>(null);
    const isPollingRef = useRef(false);

    const scrollToBottom = () => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [logs]);



    const pollForArtifacts = async (id: string) => {
        if (isPollingRef.current) {
            return;
        }

        isPollingRef.current = true;
        setIsFetchingArtifacts(true);
        const apiUrl = process.env.NEXT_PUBLIC_RESEARCHER_API_URL || 'http://localhost:8000';
        let attempts = 0;
        const maxAttempts = 20;

        try {
            while (attempts < maxAttempts) {
                try {
                    const response = await fetch(`${apiUrl}/api/artifacts/${id}`);

                    if (response.ok) {
                        const data = await response.json();

                        if (data.artifacts && (data.artifacts.pdf_url || data.artifacts.latex_url)) {
                            console.log('Found artifacts:', data.artifacts);
                            setArtifacts(data.artifacts);
                            return;
                        }
                    }
                } catch (e) {
                    console.error('Error polling artifacts:', e);
                }

                attempts++;
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        } finally {
            isPollingRef.current = false;
            setIsFetchingArtifacts(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!prompt.trim() || isGenerating) return;

        setIsGenerating(true);
        setLogs([]);
        setRunId(null);
        setArtifacts(null);
        setError(null);

        let generatedRunId: string | null = null;

        try {
            const apiUrl = process.env.NEXT_PUBLIC_RESEARCHER_API_URL || 'http://localhost:8000';
            const response = await fetch(`${apiUrl}/api/generate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    prompt: prompt.trim(),
                    test_mode: false,
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

                        // Capture run_id
                        if (event.run_id) {
                            setRunId(event.run_id);
                            generatedRunId = event.run_id;
                        }

                        // Add log line
                        if (event.plain) {
                            setLogs((prev) => [...prev, event.plain!]);
                        } else if (event.raw) {
                            setLogs((prev) => [...prev, event.raw!]);
                        }
                    } catch {
                        setLogs((prev) => [...prev, line]);
                    }
                }
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            setIsGenerating(false);
            if (generatedRunId) {
                pollForArtifacts(generatedRunId);
            }
        }
    };

    return (
        <div className="flex h-full flex-col">
            {/* Logs area */}
            <div className="flex-1 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-4 font-mono text-sm">
                {logs.length === 0 && !isGenerating && (
                    <div className="flex h-full items-center justify-center text-gray-400">
                        Enter a research prompt to get started
                    </div>
                )}
                {logs.map((log, index) => (
                    <div key={index} className="whitespace-pre-wrap text-gray-700">
                        {log}
                    </div>
                ))}
                {isGenerating && (
                    <div className="flex items-center gap-2 text-blue-600">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Generating...
                    </div>
                )}
                <div ref={logsEndRef} />
            </div>

            {/* Error message */}
            {error && (
                <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    {error}
                </div>
            )}

            {/* Artifacts */}
            {(artifacts || runId) && !isGenerating && (
                <div className="mt-4 flex flex-wrap gap-2">
                    {artifacts?.pdf_url && (
                        <a
                            href={artifacts.pdf_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                            <FileText className="h-4 w-4" />
                            View PDF
                        </a>
                    )}
                    {artifacts?.pdf_url && (
                        <a
                            href={artifacts.pdf_url}
                            download
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                            <Download className="h-4 w-4" />
                            Download PDF
                        </a>
                    )}
                    {artifacts?.latex_url && (
                        <a
                            href={artifacts.latex_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                            <Download className="h-4 w-4" />
                            Download LaTeX
                        </a>
                    )}
                    {artifacts?.references_url && (
                        <a
                            href={artifacts.references_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                            <Download className="h-4 w-4" />
                            Download BibTeX
                        </a>
                    )}
                    {runId && !artifacts && isFetchingArtifacts && (
                        <div className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-500">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Fetching artifacts...
                        </div>
                    )}
                </div>
            )}

            {/* Input form */}
            <form onSubmit={handleSubmit} className="mt-4">
                <div className="flex gap-2">
                    <Textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="Enter your research question or topic..."
                        className="min-h-[80px] flex-1 resize-none"
                        disabled={isGenerating}
                    />
                    <Button
                        type="submit"
                        disabled={!prompt.trim() || isGenerating}
                        className="self-end"
                    >
                        {isGenerating ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <Send className="h-4 w-4" />
                        )}
                    </Button>
                </div>
            </form>
        </div>
    );
}
