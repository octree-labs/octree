import { pdfjs } from 'react-pdf';
import { createClient } from '@/lib/supabase/client';
import { previewPath } from './project-preview-path';

const PREVIEW_WIDTH = 1200;

/** Renders the top 16:9 slice of page 1, matching the dashboard card crop. */
async function renderPreview(base64Pdf: string): Promise<Blob> {
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url
    ).toString();
  }

  const data = await (await fetch(`data:application/pdf;base64,${base64Pdf}`)).arrayBuffer();
  const pdf = await pdfjs.getDocument({ data }).promise;
  const page = await pdf.getPage(1);
  const scale = PREVIEW_WIDTH / page.getViewport({ scale: 1 }).width;
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = PREVIEW_WIDTH;
  canvas.height = Math.round((PREVIEW_WIDTH * 9) / 16);
  await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
  pdf.destroy();

  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Failed to render preview'))),
      'image/jpeg',
      0.9
    )
  );
}

/** Stores a compiled PDF's first page as the project's dashboard preview. */
export async function uploadProjectPreview(projectId: string, base64Pdf: string) {
  const blob = await renderPreview(base64Pdf);
  const { error } = await createClient()
    .storage.from('octree')
    .upload(previewPath(projectId), blob, {
      upsert: true,
      contentType: 'image/jpeg',
      cacheControl: '60',
    });
  if (error) throw error;
}
