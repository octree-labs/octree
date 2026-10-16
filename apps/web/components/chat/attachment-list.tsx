import { FileAttachment } from '@/types/attachment';
import { Button } from '@/components/ui/button';
import {
  X,
  File,
  FileText,
  Image as ImageIcon,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface AttachmentListProps {
  attachments: FileAttachment[];
  onRemove: (id: string) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(attachment: FileAttachment) {
  if (attachment.type.startsWith('image/')) {
    return <ImageIcon className="h-4 w-4" />;
  }
  if (
    attachment.type.startsWith('text/') ||
    attachment.type === 'application/json' ||
    attachment.name.endsWith('.tex') ||
    attachment.name.endsWith('.md')
  ) {
    return <FileText className="h-4 w-4" />;
  }
  return <File className="h-4 w-4" />;
}

export function AttachmentList({ attachments, onRemove }: AttachmentListProps) {
  const readyAttachments = attachments.filter(
    (attachment) => attachment.status === 'ready'
  );

  if (readyAttachments.length === 0) return null;

  return (
    <div className="max-h-14 w-full overflow-y-auto overflow-x-hidden border-b border-slate-200 pb-2 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-neutral-300">
      <div className="flex flex-wrap gap-1">
        {readyAttachments.map((attachment) => (
          <div
            key={attachment.id}
            className={cn(
              'flex max-w-[140px] items-center gap-1 rounded border px-1 py-0.5 text-xs',
              attachment.status === 'error'
                ? 'border-rose-200 bg-rose-50'
                : attachment.status === 'uploading'
                  ? 'border-blue-200 bg-blue-50'
                  : 'border-slate-200 bg-white'
            )}
          >
            {attachment.status === 'uploading' && (
              <Loader2 className="h-2.5 w-2.5 flex-shrink-0 animate-spin text-blue-600" />
            )}
            {attachment.status === 'error' && (
              <AlertCircle className="h-2.5 w-2.5 flex-shrink-0 text-rose-600" />
            )}
            {attachment.status === 'ready' && !attachment.preview && (
              <div className="flex-shrink-0 scale-75">
                {getFileIcon(attachment)}
              </div>
            )}

            <div className="flex min-w-0 flex-1 flex-col">
              <span
                className={cn(
                  'truncate text-[0.625rem] font-medium leading-tight',
                  attachment.status === 'error'
                    ? 'text-rose-700'
                    : 'text-slate-700'
                )}
                title={attachment.name}
              >
                {attachment.name}
              </span>
              {attachment.error ? (
                <span className="truncate text-[0.5rem] leading-tight text-rose-600">
                  {attachment.error}
                </span>
              ) : (
                <span className="text-[0.5rem] leading-tight text-slate-500">
                  {formatFileSize(attachment.size)}
                </span>
              )}
            </div>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onRemove(attachment.id)}
              className="size-3 flex-shrink-0 p-0"
            >
              <X className="size-3" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
