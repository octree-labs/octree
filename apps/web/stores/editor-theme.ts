import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type EditorTheme = 
  | 'vs-light'
  | 'vs-dark'
  | 'one-dark-pro'
  | 'dracula'
  | 'github-dark'
  | 'github-light'
  | 'nord'
  | 'monokai'
  | 'solarized-light'
  | 'quiet-light'
  | 'tomorrow-light';

export interface EditorThemeInfo {
  id: EditorTheme;
  name: string;
  isDark: boolean;
}

export const EDITOR_THEMES: EditorThemeInfo[] = [
  { id: 'vs-light', name: 'Light', isDark: false },
  { id: 'github-light', name: 'GitHub Light', isDark: false },
  { id: 'solarized-light', name: 'Solarized Light', isDark: false },
  { id: 'quiet-light', name: 'Quiet Light', isDark: false },
  { id: 'tomorrow-light', name: 'Tomorrow', isDark: false },
  { id: 'vs-dark', name: 'Dark', isDark: true },
  { id: 'one-dark-pro', name: 'One Dark Pro', isDark: true },
  { id: 'dracula', name: 'Dracula', isDark: true },
  { id: 'github-dark', name: 'GitHub Dark', isDark: true },
  { id: 'nord', name: 'Nord', isDark: true },
  { id: 'monokai', name: 'Monokai', isDark: true },
];

interface EditorThemeState {
  theme: EditorTheme;
  setTheme: (theme: EditorTheme) => void;
}

export const useEditorTheme = create<EditorThemeState>()(
  persist(
    (set) => ({
      theme: 'vs-light',
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'editor-theme',
    }
  )
);

