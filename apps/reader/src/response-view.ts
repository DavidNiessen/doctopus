import {
  isJsonMediaType,
  parseJsonValue,
  serializeJsonValue,
} from '@davidniessen/doctopus-contracts';

export function responseLanguage(
  contentType: string,
): 'json' | 'xml' | 'html' | 'plaintext' {
  const type = contentType.split(';')[0]!.trim().toLowerCase();
  if (isJsonMediaType(type)) return 'json';
  if (type === 'text/html') return 'html';
  if (
    type === 'application/xml' ||
    type === 'text/xml' ||
    type.endsWith('+xml')
  )
    return 'xml';
  return 'plaintext';
}
export function responseDisplay(body: string, language: string): string {
  if (language === 'json') {
    try {
      return serializeJsonValue(parseJsonValue(body), true);
    } catch {
      /* Keep malformed, duplicate-key or oversized JSON exactly as received. */
    }
  }
  return body;
}
