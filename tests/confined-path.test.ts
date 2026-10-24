import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { confinedPath } from '@davidniessen/doctopus-spec';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'doctopus-path-boundary-'));
  roots.push(root);
  const project = join(root, 'project'),
    outside = join(root, 'project-other');
  await mkdir(project);
  await mkdir(outside);
  await writeFile(join(project, 'inside.json'), '{}');
  await writeFile(join(outside, 'outside.json'), '{}');
  return { root, project, outside };
}

it('confines relative and absolute paths while allowing explicitly chosen project roots', async () => {
  const { project } = await fixture();
  expect(await confinedPath(project, 'inside.json')).toBe(
    join(project, 'inside.json'),
  );
  expect(await confinedPath(project, join(project, 'inside.json'))).toBe(
    join(project, 'inside.json'),
  );
  expect(await confinedPath(project, '')).toBe(project);
  expect(await confinedPath(project, '.')).toBe(project);
  expect(
    await confinedPath(parse(project).root, join(project, 'inside.json')),
  ).toBe(join(project, 'inside.json'));
});

it('rejects traversal before resolving outside entries, including nonexistent targets', async () => {
  const { project, outside } = await fixture();
  for (const path of [
    '../project-other/outside.json',
    '../missing.json',
    join(outside, 'outside.json'),
  ])
    await expect(confinedPath(project, path)).rejects.toThrow(
      'Path escapes the project',
    );
});

it('checks canonical paths after lexical confinement to reject an escaping symlink', async () => {
  const { project, outside } = await fixture();
  await symlink(outside, join(project, 'linked'));
  await expect(confinedPath(project, 'linked/outside.json')).rejects.toThrow(
    'Path escapes the project',
  );
  await symlink(
    join(project, 'inside.json'),
    join(project, 'inside-link.json'),
  );
  expect(await confinedPath(project, 'inside-link.json')).toBe(
    join(project, 'inside.json'),
  );
});

it('retains a deliberately selected symlink project root and its canonical descendants', async () => {
  const { root, project, outside } = await fixture();
  const alias = join(root, 'project-alias');
  await symlink(project, alias);
  const expected = join(project, 'inside.json');
  for (const path of ['inside.json', expected, join(alias, 'inside.json')])
    expect(await confinedPath(alias, path)).toBe(expected);
  await expect(
    confinedPath(alias, join(outside, 'outside.json')),
  ).rejects.toThrow('Path escapes the project');
});
