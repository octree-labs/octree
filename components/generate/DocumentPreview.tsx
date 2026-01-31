import { useState, useCallback, useEffect } from 'react';
import { Eye, Code, FileText, Download, Loader2, ExternalLink, Lock } from 'lucide-react';
import { MonacoEditor } from '@/components/editor/monaco-editor';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { FeatureList } from '@/app/onboarding/components/feature-list';
import { createCheckoutSession } from '@/lib/requests/subscription';
import PDFViewer from '@/components/pdf-viewer';
import { toast } from 'sonner';
import { CompilationError } from '@/types/compilation';

interface SubscriptionData {
    hasSubscription: boolean;
    usage: {
        editCount: number;
        remainingEdits: number | null;
        isPro: boolean;
        hasUnlimitedEdits: boolean;
    };
}

interface DocumentPreviewProps {
    latex: string;
    title: string;
    onOpenInOctree: () => void;
    isCreatingProject: boolean;
}

export function DocumentPreview({ latex, title, onOpenInOctree, isCreatingProject }: DocumentPreviewProps) {
    const [viewMode, setViewMode] = useState<'code' | 'pdf'>('code');
    const [pdfData, setPdfData] = useState<string | null>(null);
    const [pdfError, setPdfError] = useState<CompilationError | null>(null);
    const [isCompiling, setIsCompiling] = useState(false);
    const [hasCompilationWarnings, setHasCompilationWarnings] = useState(false);
    const [subscriptionData, setSubscriptionData] = useState<SubscriptionData | null>(null);
    const [showUpgradeDialog, setShowUpgradeDialog] = useState(false);
    const [isMonthly, setIsMonthly] = useState(true);
    const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);

    useEffect(() => {
        setPdfData(null);
        setPdfError(null);
        setIsCompiling(false);
        setHasCompilationWarnings(false);
    }, [latex]);

    useEffect(() => {
        fetch('/api/subscription-status')
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => setSubscriptionData(data))
            .catch(() => {});
    }, []);

    const isPro = Boolean(
        subscriptionData?.hasSubscription ||
        subscriptionData?.usage?.isPro ||
        subscriptionData?.usage?.hasUnlimitedEdits
    );

    const canExport = subscriptionData !== null && isPro;

    const handleSubscribe = async () => {
        setIsCheckoutLoading(true);
        try {
            const checkoutUrl = await createCheckoutSession({
                annual: isMonthly,
                withTrial: false,
            });
            window.location.href = checkoutUrl;
        } catch (error) {
            console.error('Failed to create checkout session:', error);
            toast.error('Failed to start checkout. Please try again.');
            setIsCheckoutLoading(false);
        }
    };

    const handleDownload = useCallback(async () => {
        if (!canExport) {
            setShowUpgradeDialog(true);
            return;
        }

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
                    const compilationError: CompilationError = data.error || {
                        message: 'Compilation failed',
                        details: 'Open in Octree to fix LaTeX errors'
                    };
                    setPdfError(compilationError);
                    return;
                }
            } catch (err) {
                setPdfError({
                    message: 'Failed to compile',
                    details: err instanceof Error ? err.message : String(err)
                });
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
    }, [pdfData, isCompiling, latex, title, canExport]);

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
                const compilationError: CompilationError = data.error || {
                    message: 'Compilation failed',
                    details: 'Open in Octree to fix LaTeX errors'
                };
                setPdfError(compilationError);
            }
        } catch (err) {
            setPdfError({
                message: 'Failed to compile',
                details: err instanceof Error ? err.message : String(err)
            });
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
        <>
            <Dialog open={showUpgradeDialog} onOpenChange={setShowUpgradeDialog}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Upgrade to Export</DialogTitle>
                        <DialogDescription>
                            Export features are available for Pro subscribers.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-6">
                        <div className="flex items-center gap-2">
                            <Switch
                                id="monthly-switch-preview"
                                checked={isMonthly}
                                onCheckedChange={setIsMonthly}
                            />
                            <Label
                                htmlFor="monthly-switch-preview"
                                className="cursor-pointer text-sm font-normal"
                            >
                                Save 50% with monthly billing
                            </Label>
                        </div>

                        <div className="space-y-1">
                            <div className="flex items-baseline gap-2">
                                <p className="text-3xl font-bold">{isMonthly ? '$2.49' : '$4.99'}</p>
                                <p className="text-sm text-muted-foreground">per week</p>
                            </div>
                            {isMonthly && (
                                <p className="text-xs text-muted-foreground">Billed monthly at $9.99/month</p>
                            )}
                            {!isMonthly && (
                                <p className="text-xs text-muted-foreground">Billed weekly</p>
                            )}
                        </div>

                        <div>
                            <p className="mb-4 text-sm font-semibold">Octree Pro includes</p>
                            <FeatureList />
                        </div>

                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                className="flex-1"
                                onClick={() => setShowUpgradeDialog(false)}
                            >
                                Cancel
                            </Button>
                            <Button
                                className="flex-1"
                                variant="gradient"
                                onClick={handleSubscribe}
                                disabled={isCheckoutLoading}
                            >
                                {isCheckoutLoading ? 'Loading...' : 'Subscribe Now'}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

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
                    </div>
                </div>

            <div className="h-[600px] overflow-hidden">
                {viewMode === 'code' ? (
                    <div className="h-full w-full bg-muted/30">
                        <MonacoEditor
                            content={latex}
                            className="h-full"
                            options={{
                                readOnly: true,
                                minimap: { enabled: false },
                                scrollBeyondLastLine: false,
                                wordWrap: 'on',
                                lineNumbers: 'on',
                                renderLineHighlight: 'all',
                                folding: true,
                                scrollbar: {
                                    vertical: 'visible',
                                    verticalScrollbarSize: 10
                                }
                            }}
                        />
                    </div>
                ) : (
                    <PDFViewer
                        pdfData={pdfData}
                        isLoading={isCompiling}
                        compilationError={pdfError}
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
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        <Download className="h-4 w-4" />
                    )}
                    {isCompiling ? 'Compiling...' : 'Download PDF'}
                    {!canExport && <Lock className="ml-1.5 h-3 w-3 text-amber-500" />}
                </Button>
                <Button
                    variant="gradient"
                    onClick={onOpenInOctree}
                    disabled={isCreatingProject}
                >
                    {isCreatingProject ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        <ExternalLink className="h-4 w-4" />
                    )}
                    Open in Octree
                </Button>
            </div>
        </Card>
        </>
    );
}
