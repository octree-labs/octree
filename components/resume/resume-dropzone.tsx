'use client';

import { useDropzone } from 'react-dropzone';
import { toast } from 'sonner';
import { FileUp } from 'lucide-react';
import { MAX_RESUME_BYTES } from '@/lib/requests/resume';
import { cn } from '@/lib/utils';

export function ResumeDropzone({ onFile }: { onFile: (file: File) => void }) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'application/pdf': ['.pdf'] },
    maxSize: MAX_RESUME_BYTES,
    multiple: false,
    onDropAccepted: ([file]) => onFile(file),
    onDropRejected: () => toast.error('Please upload a PDF up to 10 MB.'),
  });

  return (
    <div
      {...getRootProps()}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-16 text-center transition-colors',
        isDragActive
          ? 'border-primary bg-primary/5'
          : 'border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50'
      )}
    >
      <input {...getInputProps()} />
      <FileUp className="size-8 text-neutral-400" />
      <div>
        <p className="font-medium text-neutral-900">
          Drop your resume here, or click to browse
        </p>
        <p className="text-sm text-neutral-500">PDF, up to 10 MB</p>
      </div>
    </div>
  );
}
