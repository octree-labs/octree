/**
 * String-matching edit types for the frontend
 * Matches the backend StringEdit interface
 */

export interface StringEdit {
  file_path: string;
  old_string: string;
  new_string: string;
  explanation?: string;
}
