import { useRef, useEffect, useState } from 'react';
import { FileText, Check, Copy, AlertCircle } from 'lucide-react';
import { MonacoEditor } from '@/components/editor/monaco-editor';
import { Card } from '@/components/ui/card';
import {
  GenerationProgressTracker,
  type GenerationMilestone,
} from '@/components/generate/GenerationProgressTracker';
import type monaco from 'monaco-editor';

const SUCCESS_MESSAGE_PREFIX = 'Document generated successfully.';
const CANCELLED_MESSAGE_PREFIX = 'Generation cancelled.';

export interface MessageAttachment {
    id: string;
    name: string;
    type: 'image' | 'document';
    preview: string | null;
}

export interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    attachments?: MessageAttachment[];
}

interface MessageBubbleProps {
    message: Message;
    isStreaming?: boolean;
    generationMilestone?: GenerationMilestone;
}

export function MessageBubble({ message, isStreaming, generationMilestone }: MessageBubbleProps) {
    const isUser = message.role === 'user';
    const isCompletionMessage = message.content.startsWith(SUCCESS_MESSAGE_PREFIX);
    const isCancelledMessage = message.content.startsWith(CANCELLED_MESSAGE_PREFIX);
    const [isCopied, setIsCopied] = useState(false);

    const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

    const handleEditorDidMount = (editor: monaco.editor.IStandaloneCodeEditor) => {
        editorRef.current = editor;
    };

    const handleCopy = async () => {
        await navigator.clipboard.writeText(message.content);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
    };

    useEffect(() => {
        if (isStreaming && editorRef.current) {
            const editor = editorRef.current;
            const scrollHeight = editor.getScrollHeight();
            editor.setScrollTop(scrollHeight);
        }
    }, [message.content, isStreaming]);

    if (isUser) {
        return (
            <div className="flex w-full flex-col items-end gap-2">
                {message.attachments && message.attachments.length > 0 && (
                    <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
                        {message.attachments.map((att) => (
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
                <Card className="max-w-[85%] bg-gradient-to-t from-primary to-primary/85 text-primary-foreground border border-zinc-950/25 shadow-md shadow-zinc-950/20 ring-1 ring-inset ring-white/20 dark:border-white/20 dark:ring-transparent px-4 py-3">
                    <p className="whitespace-pre-wrap text-sm">{message.content}</p>
                </Card>
                <button
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 px-1 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="Copy text"
                >
                    {isCopied ? (
                        <>
                            <Check className="h-3 w-3" />
                            <span>Copied</span>
                        </>
                    ) : (
                        <>
                            <Copy className="h-3 w-3" />
                            <span>Copy</span>
                        </>
                    )}
                </button>
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

    if (isCancelledMessage) {
        return (
            <div className="flex w-full justify-start">
                <div className="flex items-center gap-2 rounded-md bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
                    <AlertCircle className="h-4 w-4 text-orange-600" />
                    <span>{message.content}</span>
                </div>
            </div>
        );
    }

    const showTracker = isStreaming && generationMilestone;
    const hasContent = message.content.length > 0;

    const monacoEditor = hasContent ? (
        <Card className="w-full overflow-hidden bg-muted/50 p-0">
            <div className="h-64 w-full md:h-80">
                <MonacoEditor
                    content={message.content}
                    className="h-full"
                    onMount={handleEditorDidMount}
                    options={{
                        readOnly: true,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        wordWrap: 'on',
                        lineNumbers: 'off',
                        renderLineHighlight: 'none',
                        folding: false,
                        scrollbar: {
                            vertical: 'visible',
                            verticalScrollbarSize: 10
                        }
                    }}
                />
            </div>
        </Card>
    ) : null;

    if (showTracker) {
        return (
            <div className="flex w-full justify-start">
                <GenerationProgressTracker milestone={generationMilestone}>
                    {monacoEditor}
                </GenerationProgressTracker>
            </div>
        );
    }

    // Non-streaming assistant message with content (e.g. restored from history)
    if (hasContent) {
        return (
            <div className="flex w-full justify-start">
                {monacoEditor}
            </div>
        );
    }

    return null;
}
