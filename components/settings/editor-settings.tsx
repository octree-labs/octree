'use client';

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useEditorTheme, EDITOR_THEMES, EditorTheme } from '@/stores/editor-theme';

const THEME_COLORS: Record<EditorTheme, { bg: string; accent: string }> = {
  'vs-light': { bg: '#ffffff', accent: '#4078f2' },
  'github-light': { bg: '#ffffff', accent: '#005cc5' },
  'solarized-light': { bg: '#fdf6e3', accent: '#268bd2' },
  'quiet-light': { bg: '#f5f5f5', accent: '#7a3e9d' },
  'tomorrow-light': { bg: '#ffffff', accent: '#4271ae' },
  'vs-dark': { bg: '#1e1e1e', accent: '#569cd6' },
  'one-dark-pro': { bg: '#282c34', accent: '#61afef' },
  'dracula': { bg: '#282a36', accent: '#bd93f9' },
  'github-dark': { bg: '#24292e', accent: '#79b8ff' },
  'nord': { bg: '#2e3440', accent: '#88c0d0' },
  'monokai': { bg: '#272822', accent: '#a6e22e' },
};

function ThemePreview({ themeId }: { themeId: EditorTheme }) {
  const colors = THEME_COLORS[themeId];
  return (
    <span
      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-neutral-200"
      style={{ backgroundColor: colors.bg }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: colors.accent }}
      />
    </span>
  );
}

export function EditorSettings() {
  const { theme, setTheme } = useEditorTheme();

  const lightThemes = EDITOR_THEMES.filter((t) => !t.isDark);
  const darkThemes = EDITOR_THEMES.filter((t) => t.isDark);
  const currentTheme = EDITOR_THEMES.find((t) => t.id === theme);

  return (
    <Select value={theme} onValueChange={(value) => setTheme(value as typeof theme)}>
      <SelectTrigger className="w-full sm:w-72">
        <SelectValue placeholder="Select a theme">
          <span className="flex items-center gap-2">
            <ThemePreview themeId={theme} />
            {currentTheme?.name || 'Select a theme'}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Light Themes</SelectLabel>
          {lightThemes.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              <span className="flex items-center gap-2">
                <ThemePreview themeId={t.id} />
                {t.name}
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>Dark Themes</SelectLabel>
          {darkThemes.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              <span className="flex items-center gap-2">
                <ThemePreview themeId={t.id} />
                {t.name}
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
