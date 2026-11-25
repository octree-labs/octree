/** Storage location of a project's dashboard thumbnail. Safe to import from server and client. */
export const previewPath = (projectId: string) =>
  `projects/_previews/${projectId}.jpg`;
