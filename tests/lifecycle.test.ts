import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { parse } from 'yaml';
import {
  lifecycleReport,
  isCalendarDate,
  parseOperationLifecycle,
} from '@davidniessen/doctopus-contracts';
import {
  compileProject,
  auditDocumentation,
} from '@davidniessen/doctopus-compiler';
import { loadSpec, diffApi } from '@davidniessen/doctopus-spec';
import { validatePluginSite } from '../packages/plugin-sdk/src/validation.js';

const project = resolve('examples/lifecycle');
describe('lifecycle metadata and inventory', () => {
  it.each(['2000-02-29', '2028-02-29', '0001-01-01', '9999-12-31'])(
    'accepts calendar date %s',
    (date) => expect(isCalendarDate(date)).toBe(true),
  );
  it.each([
    '2027-02-29',
    '2026-02-30',
    '2026-13-01',
    '2026-01-01T00:00:00Z',
    '2026-1-1',
    '0000-01-01',
  ])('rejects invalid date %s', (date) =>
    expect(isCalendarDate(date)).toBe(false),
  );
  it.each([
    {},
    { sunsetOn: '2026-02-30' },
    { deprecatedOn: '2027-01-02', sunsetOn: '2027-01-01' },
    { migrationUrl: 'javascript:alert(1)' },
    { migrationUrl: '//other.example/guide' },
    { migrationUrl: 'https://user:password@example.test/guide' },
    { migrationUrl: '/\\other.example/guide' },
    { message: 'bad\r\nmessage' },
    { replacement: {} },
    { replacement: { operationId: 'next', kind: 'other' } },
    { replacement: { operationId: 'next', ignored: true } },
    { sunsetOn: '2027-01-01', ignored: true },
  ])('rejects malformed or unsafe lifecycle metadata %#', (value) =>
    expect(() => parseOperationLifecycle(value)).toThrow(/lifecycle/i),
  );
  it('produces a deterministic cross-version report with exact day windows', async () => {
    const site = await compileProject(project);
    const report = lifecycleReport(site, { asOf: '2027-05-15' });
    expect(report.total).toBe(4);
    expect(report.counts).toEqual({
      'sunset-reached': 1,
      'sunset-soon': 1,
      deprecated: 1,
      planned: 1,
    });
    const widgets = report.entries.find(
      (entry) => entry.operationId === 'listWidgets',
    )!;
    expect(widgets).toMatchObject({
      apiId: 'catalog',
      version: 'v1',
      daysUntilSunset: 17,
      status: 'sunset-soon',
      replacementHref: '/api/catalog/v2/listwidgets/',
    });
    expect(widgets.lifecycle.migrationUrl).toBe(
      '/guides/migration/#heading-update-your-client',
    );
    expect(
      lifecycleReport(site, { asOf: '2027-06-01' }).entries.find(
        (entry) => entry.operationId === 'listWidgets',
      )!.status,
    ).toBe('sunset-reached');
    expect(
      lifecycleReport(site, {
        asOf: '2027-05-15',
        windowDays: 16,
      }).entries.find((entry) => entry.operationId === 'listWidgets')!.status,
    ).toBe('deprecated');
    expect(
      lifecycleReport(site, {
        asOf: '2027-05-15',
        apiId: 'catalog',
        apiVersion: 'v2',
      }).total,
    ).toBe(1);
    expect(() =>
      lifecycleReport(site, { asOf: '2027-05-15', apiId: 'missing' }),
    ).toThrow(/No API matches/);
    expect(() => lifecycleReport(site, { asOf: 'bad' })).toThrow(
      /calendar date/,
    );
    expect(() =>
      lifecycleReport(site, { asOf: '2027-05-15', windowDays: -1 }),
    ).toThrow(/window/);
  });
  it('keeps YAML/JSON source parity and fails invalid extensions with a source pointer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doctopus-lifecycle-'));
    try {
      const source = parse(await readFile(join(project, 'v1.yaml'), 'utf8'));
      await writeFile(join(root, 'api.json'), JSON.stringify(source));
      const json = await loadSpec(root, {
        id: 'catalog',
        path: 'api.json',
        version: 'v1',
      });
      const yaml = await loadSpec(project, {
        id: 'catalog',
        path: 'v1.yaml',
        version: 'v1',
      });
      expect(json.operations.map((operation) => operation.lifecycle)).toEqual(
        yaml.operations.map((operation) => operation.lifecycle),
      );
      source.paths['/widgets'].get['x-doctopus-lifecycle'].sunsetOn =
        'bad-date';
      await writeFile(join(root, 'api.json'), JSON.stringify(source));
      await expect(
        loadSpec(root, { id: 'catalog', path: 'api.json' }),
      ).rejects.toThrow(/paths.*get\/x-doctopus-lifecycle.*sunsetOn/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('handles absent, self and ambiguous replacements without inventing links', async () => {
    const site = await compileProject(project);
    const old = site.apis[0]!.operations[0]!;
    old.lifecycle = { replacement: { operationId: old.id } };
    expect(
      lifecycleReport(site, { asOf: '2027-05-15' }).entries.find(
        (entry) => entry.operationId === old.id,
      ),
    ).toHaveProperty('replacementIssue', 'self');
    old.lifecycle.replacement = { operationId: 'not-published' };
    expect(
      lifecycleReport(site, { asOf: '2027-05-15' }).entries.find(
        (entry) => entry.operationId === old.id,
      ),
    ).toHaveProperty('replacementIssue', 'missing');
    site.apis[1]!.operations.push({
      ...site.apis[1]!.operations[0]!,
      slug: 'other-widget',
    });
    old.lifecycle.replacement = { version: 'v2', operationId: old.id };
    expect(
      lifecycleReport(site, { asOf: '2027-05-15' }).entries.find(
        (entry) => entry.operationId === old.id,
      ),
    ).toHaveProperty('replacementIssue', 'ambiguous');
  });
  it('validates lifecycle data at the plugin boundary without changing it', async () => {
    const site = await compileProject(project);
    expect(validatePluginSite(site).apis[0]!.operations[0]!.lifecycle).toEqual(
      site.apis[0]!.operations[0]!.lifecycle,
    );
    site.apis[0]!.operations[0]!.lifecycle!.sunsetOn = '2027-02-30';
    expect(() => validatePluginSite(site)).toThrow(/Invalid plugin/);
  });
  it('checks migration anchors under a base path and diagnoses unresolved replacements offline', async () => {
    const site = await compileProject(project);
    expect(await auditDocumentation(site)).toEqual([]);
    site.apis[0]!.operations[0]!.lifecycle!.migrationUrl =
      '/guides/migration/#missing';
    site.apis[0]!.operations[0]!.lifecycle!.replacement = {
      operationId: 'not-published',
    };
    const diagnostics = await auditDocumentation(site);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'broken-anchor',
        source: expect.stringContaining('x-doctopus-lifecycle/migrationUrl'),
      }),
    );
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: 'lifecycle-replacement' }),
    );
    site.apis[0]!.operations[0]!.lifecycle!.migrationUrl = '/missing-guide/';
    expect(await auditDocumentation(site)).toContainEqual(
      expect.objectContaining({ code: 'broken-link' }),
    );
  });
  it('requests contract review when a sunset is introduced or brought forward', async () => {
    const before = await loadSpec(project, { id: 'catalog', path: 'v1.yaml' });
    const after = structuredClone(before);
    after.operations[0]!.lifecycle!.sunsetOn = '2027-05-01';
    expect(diffApi(before, after)).toContainEqual(
      expect.objectContaining({
        code: 'operation-lifecycle',
        severity: 'review',
      }),
    );
    after.operations[0]!.lifecycle!.sunsetOn = '2027-07-01';
    expect(diffApi(before, after)).toContainEqual(
      expect.objectContaining({
        code: 'operation-lifecycle',
        severity: 'info',
      }),
    );
  });
  it('runs deterministic CLI filters and returns a failing deadline gate without making API requests', () => {
    const cli = resolve('packages/cli/dist/main.js');
    const args = [cli, 'lifecycle', project, '--as-of', '2027-05-15', '--json'];
    const report = JSON.parse(
      execFileSync(process.execPath, args, { encoding: 'utf8' }),
    );
    expect(report.total).toBe(4);
    expect(report.asOf).toBe('2027-05-15');
    expect(
      spawnSync(process.execPath, [...args, '--fail-within', '30'], {
        encoding: 'utf8',
      }).status,
    ).toBe(1);
    const filtered = spawnSync(
      process.execPath,
      [...args, '--api-version', 'v2', '--fail-within', '30'],
      { encoding: 'utf8' },
    );
    expect(filtered.status).toBe(0);
    expect(JSON.parse(filtered.stdout).total).toBe(1);
    expect(
      spawnSync(process.execPath, [...args, '--fail-within', 'NaN'], {
        encoding: 'utf8',
      }).status,
    ).toBe(1);
    expect(
      spawnSync(process.execPath, [...args, '--api', 'not-found'], {
        encoding: 'utf8',
      }).status,
    ).toBe(1);
    expect(
      spawnSync(process.execPath, [...args, '--check-replacements'], {
        encoding: 'utf8',
      }).status,
    ).toBe(0);
    expect(
      spawnSync(process.execPath, [...args, '--require-migration'], {
        encoding: 'utf8',
      }).status,
    ).toBe(1);
    expect(
      spawnSync(
        process.execPath,
        [...args, '--api-version', 'v2', '--require-migration'],
        { encoding: 'utf8' },
      ).status,
    ).toBe(0);
    expect(
      spawnSync(process.execPath, [...args, '--as-of', '2027-02-30'], {
        encoding: 'utf8',
      }).status,
    ).toBe(1);
  });
  it('fails the CLI replacement gate for an unresolved declared target', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doctopus-lifecycle-cli-'));
    try {
      const source = parse(await readFile(join(project, 'v1.yaml'), 'utf8'));
      await writeFile(join(root, 'api.json'), JSON.stringify(source));
      await writeFile(
        join(root, 'docs.config.yaml'),
        JSON.stringify({
          name: 'Replacement gate',
          specs: [{ id: 'catalog', path: 'api.json', version: 'v1' }],
        }),
      );
      const result = spawnSync(
        process.execPath,
        [
          resolve('packages/cli/dist/main.js'),
          'lifecycle',
          root,
          '--as-of',
          '2027-05-15',
          '--check-replacements',
          '--json',
        ],
        { encoding: 'utf8' },
      );
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout).entries).toContainEqual(
        expect.objectContaining({
          operationId: 'listWidgets',
          replacementIssue: 'missing',
        }),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
