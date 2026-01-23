
import { useState, useCallback, useEffect } from 'react';
import { Eye, Code, FileText, Check, Copy, Download, Loader2, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import PDFViewer from '@/components/pdf-viewer';

interface DocumentPreviewProps {
    latex: string;
    title: string;
    onOpenInOctree: () => void;
    isCreatingProject: boolean;
}

export function DocumentPreview({ latex, title, onOpenInOctree, isCreatingProject }: DocumentPreviewProps) {
    const [viewMode, setViewMode] = useState<'code' | 'pdf'>('code');
    const [copied, setCopied] = useState(false);
    const [pdfData, setPdfData] = useState<string | null>(null);
    const [pdfError, setPdfError] = useState<string | null>(null);
    const [isCompiling, setIsCompiling] = useState(false);
    const [hasCompilationWarnings, setHasCompilationWarnings] = useState(false);

    useEffect(() => {
        setPdfData(null);
        setPdfError(null);
        setIsCompiling(false);
        setHasCompilationWarnings(false);
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
                const pdf = data.pdf || data.error?.pdf;

                if (pdf) {
                    setPdfData(pdf);
                    pdfToDownload = pdf;
                    if (!response.ok) {
                        setHasCompilationWarnings(true);
                    }
                } else {
                    setPdfError('Open in Octree to fix LaTeX errors');
                    return;
                }
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
            const pdf = data.pdf || data.error?.pdf;

            if (pdf) {
                setPdfData(pdf);
                if (!response.ok) {
                    setHasCompilationWarnings(true);
                }
            } else {
                setPdfError('Open in Octree to fix LaTeX errors');
            }
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
