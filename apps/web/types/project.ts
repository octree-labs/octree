import { Tables } from '@/database.types';

export type Project = Tables<'projects'>;

export type SelectedProject = {
  id: string;
  title: string;
};
