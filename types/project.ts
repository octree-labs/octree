import { Tables } from '@/database.types';

export type Project = Tables<'projects'>;

/** A dashboard row: the project plus a signed URL for its thumbnail, or null when it has none. */
export type DashboardProject = Project & { preview_url: string | null };

export type SelectedProject = {
  id: string;
  title: string;
};
