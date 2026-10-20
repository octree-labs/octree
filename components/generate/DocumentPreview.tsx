import { useState, useCallback, useEffect } from 'react';
import { Eye, Code, FileText, Download, Loader2, ExternalLink, Lock } from 'lucide-react';
import { MonacoEditor } from '@/components/editor/monaco-editor';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { FeatureList } from '@/app/onboarding/components/feature-list';
import { PlanPicker, type PickerPlan } from '@/components/subscription/plan-picker';
import { createCheckoutSession } from '@/lib/requests/subscription';
import { entitlementFromStatusResponse } from '@/lib/subscription/entitlement';
import type { GenerateEntry } from '@/lib/analytics/events';
import PDFViewer from '@/components/pdf-viewer';
import { toast } from 'sonner';
import { CompilationError } from '@/types/compilation';
import { makeCompilationRequest } from '@/lib/utils/compilation';

interface SubscriptionData {
    hasSubscription: boolean;
    subscription?: { effective_status?: string } | null;
    usage: {
        editCount: number;
        remainingEdits: number | null;
        isPro: boolean;
        hasUnlimitedEdits: boolean;
        subscriptionStatus?: string | null;
        currentPeriodEnd?: string | null;
        hasStripeSubscription?: boolean;
        stripeStatus?: string | null;
    };
}

const VIEW_TABS = [
    { mode: 'code', label: 'LaTeX', icon: Code },
    { mode: 'pdf', label: 'Preview', icon: Eye },
] as const;

interface DocumentPreviewProps {
    latex: string;
    title: string;
    onOpenInOctree: () => void;
    isCreatingProject: boolean;
    /** How the visitor reached /generate; attributed to a checkout started here. */
    entry?: GenerateEntry;
}

export function DocumentPreview({ latex, title, onOpenInOctree, isCreatingProject, entry }: DocumentPreviewProps) {
    const [viewMode, setViewMode] = useState<'code' | 'pdf'>('code');
    const [pdfData, setPdfData] = useState<string | null>(null);
    const [pdfError, setPdfError] = useState<CompilationError | null>(null);
    const [isCompiling, setIsCompiling] = useState(false);
    const [hasCompilationWarnings, setHasCompilationWarnings] = useState(false);
    const [subscriptionData, setSubscriptionData] = useState<SubscriptionData | null>(null);
    const [showUpgradeDialog, setShowUpgradeDialog] = useState(false);
    const [plan, setPlan] = useState<PickerPlan>('monthly');
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

    // Same rule as the server and lib/subscription/features.ts: a bare
    // `is_pro` flag does not grant Pro; the allowlist is part of the rule.
    const isPro = entitlementFromStatusResponse(subscriptionData).isPro;

    const canExport = subscriptionData !== null && isPro;

    const handleSubscribe = async () => {
        setIsCheckoutLoading(true);
        try {
            const checkoutUrl = await createCheckoutSession({
                plan,
                withTrial: false,
                source: 'generate-preview',
                entry,
            });
            window.location.href = checkoutUrl;
        } catch (error) {
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
                const { response, data } = await makeCompilationRequest(
                    [{ path: 'main.tex', content: latex }],
                    'main.tex'
                );

                const pdf = data.pdf || data.error?.pdf;

                if (pdf) {
                    setPdfData(pdf);
                    pdfToDownload = pdf;
                    if (!response.ok) {
                        setHasCompilationWarnings(true);
                    }
                } else {
                    setPdfError(data.error || {
                        message: 'Compilation failed',
                        details: 'Open in Octree to fix LaTeX errors'
                    } as CompilationError);
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
            const { response, data } = await makeCompilationRequest(
                [{ path: 'main.tex', content: latex }],
                'main.tex'
            );

            const pdf = data.pdf || data.error?.pdf;

            if (pdf) {
                setPdfData(pdf);
                if (!response.ok) {
                    setHasCompilationWarnings(true);
                }
            } else {
                setPdfError(data.error || {
                    message: 'Compilation failed',
                    details: 'Open in Octree to fix LaTeX errors'
                } as CompilationError);
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
                        <PlanPicker
                            plan={plan}
                            onPlanChange={setPlan}
                            source="generate-preview"
                            hideCredits
                            disabled={isCheckoutLoading}
                        />

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

            {/* One compact toolbar; the card's default padding and gaps are off. */}
            <Card className="gap-0 overflow-hidden bg-background py-0">
                <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate text-sm font-medium" title={title || undefined}>
                            {title || 'Generated document'}
                        </span>
                    </div>

                    {/* Same segmented style as the editor's Edit with AI / Code switch. */}
                    <div role="tablist" className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5">
                        {VIEW_TABS.map(({ mode, label, icon: Icon }) => (
                            <button
                                key={mode}
                                type="button"
                                role="tab"
                                aria-selected={viewMode === mode}
                                onClick={() => setViewMode(mode)}
                                className={cn(
                                    'flex h-6 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors',
                                    viewMode === mode
                                        ? 'bg-white text-slate-900 shadow-sm'
                                        : 'text-slate-500 hover:text-slate-700'
                                )}
                            >
                                <Icon className="size-3.5" />
                                {label}
                            </button>
                        ))}
                    </div>

                    <div className="flex items-center gap-1">
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="xs"
                                    onClick={handleDownload}
                                    disabled={isCompiling}
                                    aria-label="Download PDF"
                                >
                                    {isCompiling ? <Loader2 className="animate-spin" /> : <Download />}
                                    {!canExport && <Lock className="size-3 text-amber-500" />}
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent className="bg-neutral-900 text-white [&_svg]:bg-neutral-900 [&_svg]:fill-neutral-900">
                                {isCompiling ? 'Compiling...' : canExport ? 'Download PDF' : 'Download PDF (Pro)'}
                            </TooltipContent>
                        </Tooltip>
                        <Button
                            variant="gradient"
                            size="xs"
                            onClick={onOpenInOctree}
                            disabled={isCreatingProject}
                        >
                            {isCreatingProject ? <Loader2 className="animate-spin" /> : <ExternalLink />}
                            Open in Octree
                        </Button>
                    </div>
                </div>

            <div className="h-[400px] md:h-[600px] overflow-hidden">
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
        </Card>
        </>
    );
}
