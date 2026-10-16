import { useDropzone } from 'react-dropzone';
import { Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { MAX_ATTACHMENTS, MAX_FILE_SIZE } from '@/types/attachment';

interface AttachmentUploadProps {
  onFilesSelected: (files: File[]) => void;
  disabled?: boolean;
  canAddMore: boolean;
  isProcessing?: boolean;
}

export function AttachmentUpload({
  onFilesSelected,
  disabled,
  canAddMore,
  isProcessing = false,
}: AttachmentUploadProps) {
  const onDrop = (acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0 && canAddMore) {
      onFilesSelected(acceptedFiles);
    }
  };

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    maxSize: MAX_FILE_SIZE,
    multiple: true,
    disabled: disabled || !canAddMore,
    noClick: true,
    noKeyboard: true,
  });

  return (
    <div
      {...getRootProps()}
      className={cn(
        'relative inline-flex items-center',
        isDragActive && 'opacity-50'
      )}
    >
      <input {...getInputProps()} />

      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={open}
        disabled={disabled || !canAddMore || isProcessing}
        className="size-6 rounded-full"
        title={
          !canAddMore
            ? `Maximum ${MAX_ATTACHMENTS} attachments`
            : isProcessing
              ? 'Processing attachments...'
              : `Attach files (max ${MAX_FILE_SIZE / 1024 / 1024}MB each)`
        }
      >
        <Paperclip className="h-4 w-4" />
      </Button>
    </div>
  );
}
