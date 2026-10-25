import { expect, it } from 'vitest';
import { codeTokens } from '../apps/reader/src/code-tokens.js';

it('keeps code, exact numeric text, escapes and HTML-looking strings unchanged', () => {
  const source = String.raw`{"name":"<script>alert(1)</script>","precise":900719925474099312345,"nested":{"a":"\"quoted\""}}`;
  const tokens = codeTokens(source, 'json');
  expect(tokens.map((token) => token.text).join('')).toBe(source);
  expect(
    tokens.some((token) => token.kind === 'key' && token.text === '"precise"'),
  ).toBe(true);
  expect(
    tokens.some(
      (token) =>
        token.kind === 'number' && token.text === '900719925474099312345',
    ),
  ).toBe(true);
});
it('highlights shell flags and comments without changing whitespace', () => {
  const source =
    "curl --request POST \\\n  --url 'https://example.test/path'\n# a comment\n";
  const tokens = codeTokens(source, 'cURL');
  expect(tokens.map((token) => token.text).join('')).toBe(source);
  expect(
    tokens.some((token) => token.kind === 'flag' && token.text === '--request'),
  ).toBe(true);
  expect(tokens.some((token) => token.kind === 'comment')).toBe(true);
});
it('bounds highlighting for large examples and unfinished quoted input', () => {
  const source = '"' + '\\"'.repeat(40_000);
  expect(
    codeTokens(source, 'json')
      .map((token) => token.text)
      .join(''),
  ).toBe(source);
  const large = 'x'.repeat(200_001);
  expect(codeTokens(large, 'text')).toEqual([{ text: large }]);
  const many = 'true '.repeat(20_000);
  const tokens = codeTokens(many, 'json');
  expect(tokens.length).toBeLessThanOrEqual(3002);
  expect(tokens.map((token) => token.text).join('')).toBe(many);
});
