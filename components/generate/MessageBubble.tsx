
import { useRef, useEffect } from 'react';
import { FileText, Check, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/card';

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
}

export function MessageBubble({ message, isStreaming }: MessageBubbleProps) {
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
