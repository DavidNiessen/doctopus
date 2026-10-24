import { readableAccent } from '@davidniessen/doctopus-contracts';
import type { Palette } from '@davidniessen/doctopus-contracts';
import type { editor } from 'monaco-editor/editor/editor.api.js';

/** The response view uses the same resolved palette as the surrounding reader. */
export function responseEditorTheme(
  palette: Palette,
  accent: string,
  mode: 'light' | 'dark',
): editor.IStandaloneThemeData {
  const key = readableAccent(accent, mode, palette);
  const string = readableAccent('#16805d', mode, palette);
  const number = readableAccent('#b65a14', mode, palette);
  const keyword = readableAccent('#8854c4', mode, palette);
  return {
    base: mode === 'dark' ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [
      { token: 'string.key.json', foreground: key.slice(1) },
      { token: 'string.value.json', foreground: string.slice(1) },
      { token: 'number.json', foreground: number.slice(1) },
      { token: 'keyword.json', foreground: keyword.slice(1) },
      { token: 'tag', foreground: key.slice(1) },
      { token: 'attribute.name', foreground: key.slice(1) },
      { token: 'attribute.value', foreground: string.slice(1) },
    ],
    colors: {
      'editor.background': palette.background,
      'editor.foreground': palette.text,
      'editorLineNumber.foreground': palette.muted,
      'editorLineNumber.activeForeground': palette.heading,
      'editorGutter.background': palette.background,
      'editorGutter.foldingControlForeground': palette.muted,
      'editor.selectionBackground': key + '33',
      'editor.inactiveSelectionBackground': key + '22',
      'editorCursor.foreground': key,
      'editorWidget.background': palette.surface,
      'editorWidget.foreground': palette.text,
      'editorWidget.border': palette.border,
      focusBorder: key,
      'scrollbarSlider.background': palette.muted + '44',
      'scrollbarSlider.hoverBackground': palette.muted + '66',
      'scrollbarSlider.activeBackground': palette.muted + '88',
    },
  };
}
