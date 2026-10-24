import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSpec, parseSource } from '@davidniessen/doctopus-spec';

describe('JSON-compatible source values', () => {
  it.each([
    '.nan',
    '.inf',
    '-.inf',
    '1e1000',
    '!!set {a: null}',
    '!unknown value',
  ])('rejects unsupported value %s', (value) => {
    expect(() => parseSource(`value: ${value}`, 'input.yaml')).toThrow(
      /non-JSON|unsupported YAML/,
    );
  });
  it('accepts JSON values and finite numeric response keys without changing payloads', () => {
    expect(
      parseSource(
        '200: {a: null, b: false, c: 0, d: "", e: "2026-01-01", f: .5}',
        'input.yaml',
      ),
    ).toEqual({
      200: { a: null, b: false, c: 0, d: '', e: '2026-01-01', f: 0.5 },
    });
  });
  it.each([
    '? [a, b]\n: value',
    'true: value',
    'null: value',
    '.inf: value',
    '1: first\n"1": second',
  ])('rejects non-JSON keys and coercion collisions', (source) => {
    expect(() => parseSource(source, 'keys.yaml')).toThrow(/mapping keys/);
  });
  it('keeps prototype-named fields as ordinary own properties', () => {
    const value = parseSource(
      '__proto__: {polluted: true}\nconstructor: literal',
      'keys.yaml',
    ) as Record<string, unknown>;
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(Object.hasOwn(value, '__proto__')).toBe(true);
    expect(value.__proto__).toEqual({ polluted: true });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(JSON.parse(JSON.stringify(value))).toEqual(value);
  });
  it('expands shared aliases but rejects cycles with an actionable error', () => {
    const value = parseSource(
      'a: &base {value: 1}\nb: *base',
      'aliases.yaml',
    ) as Record<string, unknown>;
    expect(value.a).toEqual(value.b);
    expect(value.a).not.toBe(value.b);
    expect(() => parseSource('a: &loop {self: *loop}', 'aliases.yaml')).toThrow(
      /cyclic YAML aliases.*\$ref/,
    );
  });
  it('bounds nesting, expanded nodes and expanded byte size', () => {
    expect(() =>
      parseSource('['.repeat(130) + '0' + ']'.repeat(130), 'deep.json'),
    ).toThrow(/128 levels/);
    expect(() =>
      parseSource('[' + '0,'.repeat(1_000_000) + '0]', 'wide.json'),
    ).toThrow(/1000000 nodes/);
    const scalar = 'x'.repeat(2 * 1024 * 1024);
    expect(() =>
      parseSource(
        `a: &large "${scalar}"\nb: [${Array(35).fill('*large').join(',')}]`,
        'expanded.yaml',
      ),
    ).toThrow(/expanded JSON exceeds 64 MiB/);
  }, 30_000);
  it('rejects invalid external reference values before JSON serialization can erase them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doctopus-source-values-'));
    try {
      await writeFile(
        join(root, 'openapi.yaml'),
        'openapi: 3.1.0\ninfo: {title: Test, version: v1}\npaths: {}\ncomponents:\n  schemas:\n    Value:\n      $ref: ./value.yaml\n',
      );
      await writeFile(join(root, 'value.yaml'), 'type: number\nexample: .nan');
      await expect(
        loadSpec(root, { id: 'test', path: 'openapi.yaml' }),
      ).rejects.toThrow(/non-JSON/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
