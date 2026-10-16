import type * as Monaco from 'monaco-editor';

type MonacoThemeData = Monaco.editor.IStandaloneThemeData;

export const oneDarkProTheme: MonacoThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: '', foreground: 'abb2bf', background: '282c34' },
    { token: 'comment', foreground: '5c6370', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'c678dd' },
    { token: 'string', foreground: '98c379' },
    { token: 'number', foreground: 'd19a66' },
    { token: 'type', foreground: 'e5c07b' },
    { token: 'variable', foreground: 'e06c75' },
    { token: 'function', foreground: '61afef' },
    { token: 'operator', foreground: '56b6c2' },
    { token: 'delimiter', foreground: 'abb2bf' },
    { token: 'tag', foreground: 'e06c75' },
    { token: 'attribute.name', foreground: 'd19a66' },
    { token: 'attribute.value', foreground: '98c379' },
  ],
  colors: {
    'editor.background': '#282c34',
    'editor.foreground': '#abb2bf',
    'editor.lineHighlightBackground': '#2c313c',
    'editor.selectionBackground': '#3e4451',
    'editorCursor.foreground': '#528bff',
    'editorWhitespace.foreground': '#3b4048',
    'editorLineNumber.foreground': '#495162',
    'editorLineNumber.activeForeground': '#abb2bf',
  },
};

export const draculaTheme: MonacoThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: '', foreground: 'f8f8f2', background: '282a36' },
    { token: 'comment', foreground: '6272a4', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'ff79c6' },
    { token: 'string', foreground: 'f1fa8c' },
    { token: 'number', foreground: 'bd93f9' },
    { token: 'type', foreground: '8be9fd', fontStyle: 'italic' },
    { token: 'variable', foreground: 'f8f8f2' },
    { token: 'function', foreground: '50fa7b' },
    { token: 'operator', foreground: 'ff79c6' },
    { token: 'delimiter', foreground: 'f8f8f2' },
    { token: 'tag', foreground: 'ff79c6' },
    { token: 'attribute.name', foreground: '50fa7b' },
    { token: 'attribute.value', foreground: 'f1fa8c' },
  ],
  colors: {
    'editor.background': '#282a36',
    'editor.foreground': '#f8f8f2',
    'editor.lineHighlightBackground': '#44475a',
    'editor.selectionBackground': '#44475a',
    'editorCursor.foreground': '#f8f8f0',
    'editorWhitespace.foreground': '#3b3a32',
    'editorLineNumber.foreground': '#6272a4',
    'editorLineNumber.activeForeground': '#f8f8f2',
  },
};

export const githubDarkTheme: MonacoThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: '', foreground: 'c9d1d9', background: '0d1117' },
    { token: 'comment', foreground: '8b949e', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'ff7b72' },
    { token: 'string', foreground: 'a5d6ff' },
    { token: 'number', foreground: '79c0ff' },
    { token: 'type', foreground: 'ffa657' },
    { token: 'variable', foreground: 'ffa657' },
    { token: 'function', foreground: 'd2a8ff' },
    { token: 'operator', foreground: 'ff7b72' },
    { token: 'delimiter', foreground: 'c9d1d9' },
    { token: 'tag', foreground: '7ee787' },
    { token: 'attribute.name', foreground: '79c0ff' },
    { token: 'attribute.value', foreground: 'a5d6ff' },
  ],
  colors: {
    'editor.background': '#0d1117',
    'editor.foreground': '#c9d1d9',
    'editor.lineHighlightBackground': '#161b22',
    'editor.selectionBackground': '#264f78',
    'editorCursor.foreground': '#c9d1d9',
    'editorWhitespace.foreground': '#484f58',
    'editorLineNumber.foreground': '#6e7681',
    'editorLineNumber.activeForeground': '#c9d1d9',
  },
};

export const githubLightTheme: MonacoThemeData = {
  base: 'vs',
  inherit: true,
  rules: [
    { token: '', foreground: '24292f', background: 'ffffff' },
    { token: 'comment', foreground: '6e7781', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'cf222e' },
    { token: 'string', foreground: '0a3069' },
    { token: 'number', foreground: '0550ae' },
    { token: 'type', foreground: '953800' },
    { token: 'variable', foreground: '953800' },
    { token: 'function', foreground: '8250df' },
    { token: 'operator', foreground: 'cf222e' },
    { token: 'delimiter', foreground: '24292f' },
    { token: 'tag', foreground: '116329' },
    { token: 'attribute.name', foreground: '0550ae' },
    { token: 'attribute.value', foreground: '0a3069' },
  ],
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#24292f',
    'editor.lineHighlightBackground': '#f6f8fa',
    'editor.selectionBackground': '#add6ff',
    'editorCursor.foreground': '#24292f',
    'editorWhitespace.foreground': '#d0d7de',
    'editorLineNumber.foreground': '#8c959f',
    'editorLineNumber.activeForeground': '#24292f',
  },
};

export const nordTheme: MonacoThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: '', foreground: 'd8dee9', background: '2e3440' },
    { token: 'comment', foreground: '616e88', fontStyle: 'italic' },
    { token: 'keyword', foreground: '81a1c1' },
    { token: 'string', foreground: 'a3be8c' },
    { token: 'number', foreground: 'b48ead' },
    { token: 'type', foreground: '8fbcbb' },
    { token: 'variable', foreground: 'd8dee9' },
    { token: 'function', foreground: '88c0d0' },
    { token: 'operator', foreground: '81a1c1' },
    { token: 'delimiter', foreground: 'eceff4' },
    { token: 'tag', foreground: '81a1c1' },
    { token: 'attribute.name', foreground: '8fbcbb' },
    { token: 'attribute.value', foreground: 'a3be8c' },
  ],
  colors: {
    'editor.background': '#2e3440',
    'editor.foreground': '#d8dee9',
    'editor.lineHighlightBackground': '#3b4252',
    'editor.selectionBackground': '#434c5e',
    'editorCursor.foreground': '#d8dee9',
    'editorWhitespace.foreground': '#4c566a',
    'editorLineNumber.foreground': '#4c566a',
    'editorLineNumber.activeForeground': '#d8dee9',
  },
};

export const monokaiTheme: MonacoThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: '', foreground: 'f8f8f2', background: '272822' },
    { token: 'comment', foreground: '75715e', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'f92672' },
    { token: 'string', foreground: 'e6db74' },
    { token: 'number', foreground: 'ae81ff' },
    { token: 'type', foreground: '66d9ef', fontStyle: 'italic' },
    { token: 'variable', foreground: 'f8f8f2' },
    { token: 'function', foreground: 'a6e22e' },
    { token: 'operator', foreground: 'f92672' },
    { token: 'delimiter', foreground: 'f8f8f2' },
    { token: 'tag', foreground: 'f92672' },
    { token: 'attribute.name', foreground: 'a6e22e' },
    { token: 'attribute.value', foreground: 'e6db74' },
  ],
  colors: {
    'editor.background': '#272822',
    'editor.foreground': '#f8f8f2',
    'editor.lineHighlightBackground': '#3e3d32',
    'editor.selectionBackground': '#49483e',
    'editorCursor.foreground': '#f8f8f0',
    'editorWhitespace.foreground': '#3b3a32',
    'editorLineNumber.foreground': '#90908a',
    'editorLineNumber.activeForeground': '#f8f8f2',
  },
};

export const solarizedLightTheme: MonacoThemeData = {
  base: 'vs',
  inherit: true,
  rules: [
    { token: '', foreground: '657b83', background: 'fdf6e3' },
    { token: 'comment', foreground: '93a1a1', fontStyle: 'italic' },
    { token: 'keyword', foreground: '859900' },
    { token: 'string', foreground: '2aa198' },
    { token: 'number', foreground: 'd33682' },
    { token: 'type', foreground: 'b58900' },
    { token: 'variable', foreground: '268bd2' },
    { token: 'function', foreground: '268bd2' },
    { token: 'operator', foreground: '859900' },
    { token: 'delimiter', foreground: '657b83' },
    { token: 'tag', foreground: '268bd2' },
    { token: 'attribute.name', foreground: '93a1a1' },
    { token: 'attribute.value', foreground: '2aa198' },
  ],
  colors: {
    'editor.background': '#fdf6e3',
    'editor.foreground': '#657b83',
    'editor.lineHighlightBackground': '#eee8d5',
    'editor.selectionBackground': '#eee8d5',
    'editorCursor.foreground': '#657b83',
    'editorWhitespace.foreground': '#eee8d5',
    'editorLineNumber.foreground': '#93a1a1',
    'editorLineNumber.activeForeground': '#657b83',
  },
};

export const quietLightTheme: MonacoThemeData = {
  base: 'vs',
  inherit: true,
  rules: [
    { token: '', foreground: '333333', background: 'f5f5f5' },
    { token: 'comment', foreground: 'aaaaaa', fontStyle: 'italic' },
    { token: 'keyword', foreground: '4b69c6' },
    { token: 'string', foreground: '448c27' },
    { token: 'number', foreground: 'ab6526' },
    { token: 'type', foreground: '7a3e9d' },
    { token: 'variable', foreground: '7a3e9d' },
    { token: 'function', foreground: 'aa3731' },
    { token: 'operator', foreground: '777777' },
    { token: 'delimiter', foreground: '333333' },
    { token: 'tag', foreground: '4b69c6' },
    { token: 'attribute.name', foreground: 'ab6526' },
    { token: 'attribute.value', foreground: '448c27' },
  ],
  colors: {
    'editor.background': '#f5f5f5',
    'editor.foreground': '#333333',
    'editor.lineHighlightBackground': '#e4f6d4',
    'editor.selectionBackground': '#c9d0d9',
    'editorCursor.foreground': '#54494b',
    'editorWhitespace.foreground': '#d1d1d1',
    'editorLineNumber.foreground': '#aaaaaa',
    'editorLineNumber.activeForeground': '#333333',
  },
};

export const tomorrowLightTheme: MonacoThemeData = {
  base: 'vs',
  inherit: true,
  rules: [
    { token: '', foreground: '4d4d4c', background: 'ffffff' },
    { token: 'comment', foreground: '8e908c', fontStyle: 'italic' },
    { token: 'keyword', foreground: '8959a8' },
    { token: 'string', foreground: '718c00' },
    { token: 'number', foreground: 'f5871f' },
    { token: 'type', foreground: 'eab700' },
    { token: 'variable', foreground: 'c82829' },
    { token: 'function', foreground: '4271ae' },
    { token: 'operator', foreground: '3e999f' },
    { token: 'delimiter', foreground: '4d4d4c' },
    { token: 'tag', foreground: 'c82829' },
    { token: 'attribute.name', foreground: 'f5871f' },
    { token: 'attribute.value', foreground: '718c00' },
  ],
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#4d4d4c',
    'editor.lineHighlightBackground': '#efefef',
    'editor.selectionBackground': '#d6d6d6',
    'editorCursor.foreground': '#4d4d4c',
    'editorWhitespace.foreground': '#d1d1d1',
    'editorLineNumber.foreground': '#8e908c',
    'editorLineNumber.activeForeground': '#4d4d4c',
  },
};

export function registerMonacoThemes(monaco: typeof import('monaco-editor')) {
  monaco.editor.defineTheme('one-dark-pro', oneDarkProTheme);
  monaco.editor.defineTheme('dracula', draculaTheme);
  monaco.editor.defineTheme('github-dark', githubDarkTheme);
  monaco.editor.defineTheme('github-light', githubLightTheme);
  monaco.editor.defineTheme('nord', nordTheme);
  monaco.editor.defineTheme('monokai', monokaiTheme);
  monaco.editor.defineTheme('solarized-light', solarizedLightTheme);
  monaco.editor.defineTheme('quiet-light', quietLightTheme);
  monaco.editor.defineTheme('tomorrow-light', tomorrowLightTheme);
}

