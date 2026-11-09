import type { SupabaseClient } from '@supabase/supabase-js';
import type { TablesInsert } from '@/database.types';
import { getContentTypeByFilename } from '@/lib/constants/file-types';
import type { DraftFile } from '@/lib/import/draft-files';

/**
 * Writes a draft's text files into a new project the way every project file
 * is created (storage object under `projects/<id>/<path>` + a `files` row),
 * as the single-file import and createProjectFromLatex do. Uploads run as
 * the signed-in user, so storage RLS applies.
 */

export interface ProjectFilesResult {
  /** Storage paths that were written (for cleanup). */
  storagePaths: string[];
  /** Files that failed to upload. */
  failed: string[];
  /** The upload error of the main (first) file, when it failed. */
  mainError: unknown | null;
  /** The `files` insert error, if any. */
  recordError: unknown | null;
}

export function projectStoragePath(projectId: string, path: string) {
  return `projects/${projectId}/${path}`;
}

export async function writeProjectFiles(
  supabase: SupabaseClient<any, any, any>,
  projectId: string,
  files: DraftFile[]
): Promise<ProjectFilesResult> {
  const uploads = await Promise.all(
    files.map(async (file) => {
      const mimeType = getContentTypeByFilename(file.path);
      const storagePath = projectStoragePath(projectId, file.path);
      const { error } = await supabase.storage
        .from('octree')
        .upload(storagePath, new Blob([file.content], { type: mimeType }), {
          cacheControl: '3600',
          upsert: false,
          contentType: mimeType,
        });
      return { file, mimeType, storagePath, error };
    })
  );

  const written = uploads.filter((u) => !u.error);
  const result: ProjectFilesResult = {
    storagePaths: written.map((u) => u.storagePath),
    failed: uploads.filter((u) => u.error).map((u) => u.file.path),
    mainError: uploads[0]?.error ?? null,
    recordError: null,
  };
  // No main file: the caller drops the project, so no rows are written.
  if (written.length === 0 || result.mainError) return result;

  const rows: TablesInsert<'files'>[] = written.map((u) => ({
    project_id: projectId,
    name: u.file.path,
    type: u.mimeType,
    size: u.file.content.length,
    url: supabase.storage.from('octree').getPublicUrl(u.storagePath).data.publicUrl,
  }));

  // One row stays a plain object (the long-standing single-file insert).
  const { error } = (await (supabase.from('files') as any).insert(rows.length === 1 ? rows[0] : rows)) as {
    error: unknown;
  };
  result.recordError = error ?? null;
  return result;
}
