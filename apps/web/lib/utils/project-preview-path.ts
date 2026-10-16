/** Storage location of a project's dashboard thumbnail. Safe to import from server and client. */
export const previewPath = (projectId: string) =>
  `projects/_previews/${projectId}.jpg`;

export const previewUrl = (projectId: string) =>
  `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/octree/${previewPath(projectId)}`;
