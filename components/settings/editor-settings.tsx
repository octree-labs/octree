'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Palette } from 'lucide-react';
import { useEditorTheme, EDITOR_THEMES } from '@/stores/editor-theme';

export function EditorSettings() {
  const { theme, setTheme } = useEditorTheme();

  const lightThemes = EDITOR_THEMES.filter((t) => !t.isDark);
  const darkThemes = EDITOR_THEMES.filter((t) => t.isDark);
  const currentTheme = EDITOR_THEMES.find((t) => t.id === theme);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette className="h-5 w-5" />
          Editor Settings
        </CardTitle>
        <CardDescription>
          Customize your code editor appearance
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium text-neutral-700">
            Editor Theme
          </label>
          <Select value={theme} onValueChange={(value) => setTheme(value as typeof theme)}>
            <SelectTrigger className="w-full max-w-xs">
              <SelectValue placeholder="Select a theme">
                {currentTheme?.name || 'Select a theme'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Light Themes</SelectLabel>
                {lightThemes.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectGroup>
              <SelectGroup>
                <SelectLabel>Dark Themes</SelectLabel>
                {darkThemes.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <p className="text-xs text-neutral-500">
            Choose a color theme for the LaTeX editor. Your preference is saved automatically.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

