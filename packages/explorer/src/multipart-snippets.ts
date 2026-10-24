import type { PreparedRequest } from './index.js';
import type { SnippetLanguage } from './snippets.js';
import { multipartPartHeader, validateMultipartParts } from './multipart.js';
import { fetchHeaderEntries } from './parameters.js';

const utf8 = (text: string) =>
  new TextDecoder().decode(new TextEncoder().encode(text));
const literal = (text: string) => JSON.stringify(utf8(text));
const shell = (text: string) => `'${utf8(text).replaceAll("'", "'\\''")}'`;
function java(text: string): string {
  return (
    '"' +
    Array.from(utf8(text), (char) => {
      if (char === '"' || char === '\\') return '\\' + char;
      if (char === '\n') return '\\n';
      if (char === '\r') return '\\r';
      if (char === '\t') return '\\t';
      const code = char.codePointAt(0)!;
      return code < 32 || code === 127
        ? '\\' + code.toString(8).padStart(3, '0')
        : char;
    }).join('') +
    '"'
  );
}
function shellText(text: string): string {
  if (
    Array.from(text).some(
      (char) => char.codePointAt(0)! < 32 && !['\n', '\r', '\t'].includes(char),
    )
  ) {
    const encoded = btoa(
      Array.from(new TextEncoder().encode(text), (byte) =>
        String.fromCharCode(byte),
      ).join(''),
    );
    return `printf '%s' ${shell(encoded)} | base64 -d`;
  }
  return `printf '%s' ${shell(text)}`;
}
/** File bytes and user-selected filenames never become source text. Replace the explicit file paths. */
export function generateMultipartSnippet(
  request: PreparedRequest,
  language: SnippetLanguage,
): string {
  if (request.body !== undefined)
    throw new Error('A request cannot have both a literal and multipart body.');
  validateMultipartParts(request.multipart!);
  const headers = Object.fromEntries(
    Object.entries(request.headers).filter(
      ([key]) => key.toLowerCase() !== 'content-type',
    ),
  );
  let fileIndex = 0;
  const parts = request.multipart!.map((part) => {
    const file = part.kind === 'file' ? ++fileIndex : undefined;
    const header = multipartPartHeader(
      part.kind === 'file'
        ? { ...part, file: { ...part.file, filename: `upload-${file}.bin` } }
        : part,
    );
    return {
      header,
      value: part.kind === 'text' ? part.value : '',
      file,
      path: `./YOUR_FILE_${file}`,
    };
  });
  if (language === 'cURL') {
    const writes = parts.flatMap((part) => [
      `  printf '%s\\r\\n' "--$boundary"`,
      `  printf '%s\\r\\n' ${part.header.slice(0, -2).split('\r\n').map(shell).join(' ')}`,
      '  ' + (part.file ? `cat ${shell(part.path)}` : shellText(part.value)),
      `  printf '\\r\\n'`,
    ]);
    return [
      '#!/bin/sh',
      'set -eu',
      'umask 077',
      'body_dir=$(mktemp -d)',
      `trap 'rm -rf "$body_dir"' 0`,
      "trap 'exit 1' 1 2 3 15",
      `nonce=$(od -An -N24 -tx1 /dev/urandom | tr -d ' \\n')`,
      '[ "${#nonce}" -eq 48 ] || exit 1',
      'boundary="doctopus-$nonce"',
      '{',
      ...writes,
      `  printf '%s\\r\\n' "--$boundary--"`,
      '} > "$body_dir/body"',
      '',
      [
        `curl --silent --show-error --fail-with-body --max-time 30 --request ${shell(request.method)}`,
        `  --url ${shell(request.url)}`,
        ...Object.entries(headers).map(
          ([name, value]) =>
            `  --header ${shell(/^[\t ]*$/.test(value) ? `${name};` : `${name}: ${value}`)}`,
        ),
        '  --header "Content-Type: multipart/form-data; boundary=$boundary"',
        '  --data-binary @"$body_dir/body"',
      ].join(' \\\n'),
    ].join('\n');
  }
  if (language === 'JavaScript' || language === 'TypeScript') {
    const imports = fileIndex
      ? "import { openAsBlob } from 'node:fs';\n\n"
      : '';
    const chunks = parts.flatMap((part) => [
      `  '--' + boundary + '\\r\\n',`,
      `  ${literal(part.header)},`,
      `  ${part.file ? `await openAsBlob(${literal(part.path)})` : literal(part.value)},`,
      "  '\\r\\n',",
    ]);
    return `${imports}const boundary = 'doctopus-' + crypto.randomUUID().replaceAll('-', '');
const body = new Blob([
${chunks.join('\n')}
  '--' + boundary + '--\\r\\n'
]);
const response = await fetch(${literal(request.url)}, {
  method: ${literal(request.method)},
  headers: [...${JSON.stringify(fetchHeaderEntries(headers), null, 2)}, ['Content-Type', 'multipart/form-data; boundary=' + boundary]],
  body,
  redirect: 'error',
  signal: AbortSignal.timeout(30_000)
});
if (!response.ok) throw new Error(\`HTTP \${response.status}\`);
const text = await response.text();
const data${language === 'TypeScript' ? ': unknown' : ''} = text && /(?:\\/|\\+)json(?:;|$)/i.test(response.headers.get('content-type') ?? '') ? JSON.parse(text) : (text || null);
console.log(data);`;
  }
  if (language === 'Python') {
    const chunks = parts.flatMap((part) => [
      `    ('--' + boundary + '\\r\\n').encode('utf-8'),`,
      `    ${literal(part.header)}.encode('utf-8'),`,
      `    ${part.file ? `Path(${literal(part.path)}).read_bytes()` : `${literal(part.value)}.encode('utf-8')`},`,
      "    b'\\r\\n',",
    ]);
    return `import json
import urllib.request
import uuid
${fileIndex ? 'from pathlib import Path\n' : ''}
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

boundary = 'doctopus-' + uuid.uuid4().hex
body = b''.join([
${chunks.join('\n')}
    ('--' + boundary + '--\\r\\n').encode('utf-8')
])
headers = json.loads(${literal(JSON.stringify(headers))})
headers['Content-Type'] = 'multipart/form-data; boundary=' + boundary
opener = urllib.request.build_opener(NoRedirect)
request = urllib.request.Request(
    ${literal(request.url)},
    headers=headers,
    method=${literal(request.method)},
    data=body,
)
with opener.open(request, timeout=30) as response:
    print(response.read().decode('utf-8'))`;
  }
  const publishers = parts.flatMap((part) => [
    `        HttpRequest.BodyPublishers.ofString("--" + boundary + "\\r\\n" + ${java(part.header)}),`,
    `        HttpRequest.BodyPublishers.${part.file ? `ofFile(Path.of(${java(part.path)}))` : `ofString(${java(part.value)})`},`,
    '        HttpRequest.BodyPublishers.ofString("\\r\\n"),',
  ]);
  return `import java.net.URI;
import java.net.http.*;
${fileIndex ? 'import java.nio.file.Path;\n' : ''}import java.time.Duration;
import java.util.UUID;

class Example {
  public static void main(String[] args) throws Exception {
    var boundary = "doctopus-" + UUID.randomUUID().toString().replace("-", "");
    var body = HttpRequest.BodyPublishers.concat(
${publishers.join('\n')}
        HttpRequest.BodyPublishers.ofString("--" + boundary + "--\\r\\n")
    );
    var client = HttpClient.newHttpClient();
    var request = HttpRequest.newBuilder(URI.create(${java(request.url)}))
        .timeout(Duration.ofSeconds(30))
${Object.entries(headers)
  .map(([name, value]) => `        .header(${java(name)}, ${java(value)})`)
  .join('\n')}
        .header("Content-Type", "multipart/form-data; boundary=" + boundary)
        .method(${java(request.method)}, body)
        .build();
    var response = client.send(request, HttpResponse.BodyHandlers.ofString());
    if (response.statusCode() < 200 || response.statusCode() >= 300) throw new java.io.IOException("HTTP " + response.statusCode());
    System.out.println(response.body());
  }
}`;
}
