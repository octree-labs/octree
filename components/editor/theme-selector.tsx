'use client';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Palette, Check, Sun, Moon } from 'lucide-react';
import { useEditorTheme, EDITOR_THEMES, type EditorTheme } from '@/stores/editor-theme';

export function ThemeSelector() {
  const { theme, setTheme } = useEditorTheme();

  const currentTheme = EDITOR_THEMES.find((t) => t.id === theme);
  const lightThemes = EDITOR_THEMES.filter((t) => !t.isDark);
  const darkThemes = EDITOR_THEMES.filter((t) => t.isDark);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          title="Editor Theme"
        >
          <Palette className="size-4" />
          <span className="hidden sm:inline">{currentTheme?.name || 'Theme'}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="flex items-center gap-2">
          <Sun className="size-3.5" />
          Light Themes
        </DropdownMenuLabel>
        {lightThemes.map((t) => (
          <DropdownMenuItem
            key={t.id}
            onClick={() => setTheme(t.id)}
            className="gap-2"
          >
            {theme === t.id && <Check className="size-4" />}
            {theme !== t.id && <span className="w-4" />}
            {t.name}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-2">
          <Moon className="size-3.5" />
          Dark Themes
        </DropdownMenuLabel>
        {darkThemes.map((t) => (
          <DropdownMenuItem
            key={t.id}
            onClick={() => setTheme(t.id)}
            className="gap-2"
          >
            {theme === t.id && <Check className="size-4" />}
            {theme !== t.id && <span className="w-4" />}
            {t.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

