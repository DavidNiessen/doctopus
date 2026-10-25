export type CodeToken = {
  text: string;
  kind?: 'string' | 'key' | 'number' | 'keyword' | 'comment' | 'flag';
};
const keywords = new Set(
  'true false null undefined const let var import from return new async await public static class def None True False GET POST PUT PATCH DELETE'.split(
    ' ',
  ),
);

/** A bounded linear scan. Render the tokens as text, never as HTML. */
export function codeTokens(code: string, language: string): CodeToken[] {
  if (code.length > 200_000) return [{ text: code }];
  const tokens: CodeToken[] = [];
  let cursor = 0,
    plain = 0;
  const emit = (end: number, kind: NonNullable<CodeToken['kind']>) => {
    if (plain < cursor) tokens.push({ text: code.slice(plain, cursor) });
    tokens.push({ text: code.slice(cursor, end), kind });
    cursor = end;
    plain = end;
  };
  while (cursor < code.length && tokens.length < 3000) {
    const char = code[cursor]!;
    if (char === '"' || char === "'") {
      let end = cursor + 1;
      while (end < code.length) {
        if (code[end] === '\\') {
          end = Math.min(end + 2, code.length);
          continue;
        }
        if (code[end++] === char) break;
      }
      let after = end;
      while (after < code.length && /\s/.test(code[after]!)) after++;
      emit(
        end,
        language.toLowerCase() === 'json' && code[after] === ':'
          ? 'key'
          : 'string',
      );
    } else if (char === '#' || (char === '/' && code[cursor + 1] === '/')) {
      const newline = code.indexOf('\n', cursor);
      emit(newline === -1 ? code.length : newline, 'comment');
    } else if (char === '-' && code[cursor + 1] === '-') {
      let end = cursor + 2;
      while (end < code.length && /[\w-]/.test(code[end]!)) end++;
      emit(end, 'flag');
    } else if (
      /\d/.test(char) ||
      (char === '-' && /\d/.test(code[cursor + 1] ?? ''))
    ) {
      let end = cursor + 1;
      while (end < code.length && /[\d.eE+-]/.test(code[end]!)) end++;
      emit(end, 'number');
    } else if (/[A-Za-z_$]/.test(char)) {
      let end = cursor + 1;
      while (end < code.length && /[\w$]/.test(code[end]!)) end++;
      if (keywords.has(code.slice(cursor, end))) emit(end, 'keyword');
      else cursor = end;
    } else cursor++;
  }
  if (plain < code.length) tokens.push({ text: code.slice(plain) });
  return tokens;
}
