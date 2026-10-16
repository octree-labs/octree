'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Loader2, ImageOff } from 'lucide-react';

interface ImageViewerProps {
  projectId: string;
  fileName: string;
}

export function ImageViewer({ projectId, fileName }: ImageViewerProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadImage = async () => {
      setLoading(true);
      setError(null);

      try {
        const supabase = createClient();
        const { data: imageBlob, error: downloadError } = await supabase.storage
          .from('octree')
          .download(`projects/${projectId}/${fileName}`);

        if (downloadError || !imageBlob) {
          throw new Error('Failed to load image');
        }

        const url = URL.createObjectURL(imageBlob);
        setImageUrl(url);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load image');
      } finally {
        setLoading(false);
      }
    };

    loadImage();

    return () => {
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
    };
  }, [projectId, fileName]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
          <p className="text-sm text-slate-500">Loading image...</p>
        </div>
      </div>
    );
  }

  if (error || !imageUrl) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <ImageOff className="h-12 w-12 text-slate-300" />
          <p className="text-sm text-slate-500">
            {error || 'Failed to load image'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center overflow-auto bg-slate-50 p-8">
      <img
        src={imageUrl}
        alt={fileName}
        className="max-h-full max-w-full rounded-lg shadow-lg"
        style={{ objectFit: 'contain' }}
      />
    </div>
  );
}

