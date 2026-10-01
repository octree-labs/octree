'use server';

import { createClient } from '@/lib/supabase/server';
import { createProjectFromLatex } from '@/actions/create-project-from-latex';

export async function createResumeProject(
  title: string,
  latexContent: string,
  uploadPath: string
): Promise<{ projectId: string | null; error: string | null }> {
  const result = await createProjectFromLatex(title, latexContent);
  if (!result.projectId) return result;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Keep the original PDF alongside the LaTeX for reference; losing it is not
  // worth failing the whole flow over.
  if (user && uploadPath.startsWith(`temp-imports/${user.id}/`)) {
    const bucket = supabase.storage.from('octree');
    const { error: copyError } = await bucket.copy(
      uploadPath,
      `projects/${result.projectId}/original-resume.pdf`
    );
    if (copyError) {
      console.error('Failed to copy original resume into project:', copyError);
    }
    await bucket
      .remove([uploadPath])
      .catch((err) => console.error('Failed to clean up resume upload:', err));
  }

  return result;
}
