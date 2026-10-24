import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  validatePublicationEnvironment,
  validatePublicationRulesets,
} from './publication-policy.mjs';
import { readRegularFile } from './read-regular-file.mjs';

const visibleFields = [
  'id',
  'name',
  'source',
  'source_type',
  'updated_at',
  'target',
  'enforcement',
  'conditions',
  'rules',
];
function exactFields(value, fields) {
  assert(value && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...fields].sort());
}
function visibleRule(rule, repository) {
  assert(
    Number.isSafeInteger(rule.id) && rule.id > 0,
    'Invalid ruleset identity.',
  );
  assert.equal(
    rule.source,
    repository,
    'Ruleset belongs to another repository.',
  );
  assert.equal(rule.source_type, 'Repository');
  assert(
    typeof rule.updated_at === 'string' &&
      Number.isFinite(Date.parse(rule.updated_at)),
    'Ruleset revision is unavailable.',
  );
  assert.equal(new Date(rule.updated_at).toISOString(), rule.updated_at);
  for (const key of visibleFields)
    assert(Object.hasOwn(rule, key), `Missing live ruleset field: ${key}.`);
  return Object.fromEntries(visibleFields.map((key) => [key, rule[key]]));
}

/** Generate only from administrator-visible metadata, never from a redacted list. */
export function createPublicationProtectionSnapshot(repository, branch, tags) {
  validatePublicationRulesets(branch, tags);
  assert.equal(branch.name, 'Protect master');
  assert.equal(tags.name, 'Protect release tags');
  return structuredClone({
    schemaVersion: 1,
    repository,
    branch: {
      ...visibleRule(branch, repository),
      bypass_actors: branch.bypass_actors,
    },
    tags: {
      ...visibleRule(tags, repository),
      bypass_actors: tags.bypass_actors,
    },
  });
}

/** GitHub redacts bypass actors for read-only tokens; bind reviewed source to live revisions. */
export function validatePublicationProtectionSnapshot(
  repository,
  branch,
  tags,
  snapshot,
) {
  exactFields(snapshot, ['schemaVersion', 'repository', 'branch', 'tags']);
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.repository, repository);
  for (const [live, reviewed] of [
    [branch, snapshot.branch],
    [tags, snapshot.tags],
  ]) {
    exactFields(reviewed, [...visibleFields, 'bypass_actors']);
    assert.deepEqual(
      visibleRule(live, repository),
      visibleRule(reviewed, repository),
      'Repository protection changed. Regenerate the administrator-read snapshot and test a new candidate.',
    );
    assert(
      live.bypass_actors === undefined ||
        live.bypass_actors === null ||
        Array.isArray(live.bypass_actors),
      'Malformed live bypass metadata.',
    );
    if (Array.isArray(live.bypass_actors))
      assert.deepEqual(
        live.bypass_actors,
        reviewed.bypass_actors,
        'Live bypass actors differ from the source snapshot.',
      );
  }
  const summary = validatePublicationRulesets(snapshot.branch, snapshot.tags);
  return {
    ...summary,
    bypassEvidence: {
      kind: 'source-snapshot-bound-to-live-ruleset-revisions',
      branchUpdatedAt: branch.updated_at,
      tagsUpdatedAt: tags.updated_at,
      branchActorsVisible: Array.isArray(branch.bypass_actors),
      tagActorsVisible: Array.isArray(tags.bypass_actors),
    },
  };
}

export async function readPublicationProtectionMetadata(api) {
  const [repository, environment, policies, rulesets] = await Promise.all([
    api(''),
    api('environments/release'),
    api('environments/release/deployment-branch-policies'),
    api('rulesets?includes_parents=true'),
  ]);
  assert.equal(
    repository.default_branch,
    'master',
    'Protect the default master branch.',
  );
  const select = (name, target) => {
    const matches = rulesets.filter(
      (rule) => rule.name === name && rule.target === target,
    );
    assert.equal(matches.length, 1, `Configure exactly one ${name} ruleset.`);
    assert(Number.isSafeInteger(matches[0].id) && matches[0].id > 0);
    return matches[0].id;
  };
  const [branch, tags] = await Promise.all([
    api(`rulesets/${select('Protect master', 'branch')}`),
    api(`rulesets/${select('Protect release tags', 'tag')}`),
  ]);
  return { environment, policies, branch, tags };
}

export async function inspectPublicationProtections(root, repository, api) {
  const metadata = await readPublicationProtectionMetadata(api);
  const bytes = await readRegularFile(
    join(root, 'publication-protections.json'),
    128 * 1024,
  );
  const snapshotSha256 = createHash('sha256').update(bytes).digest('hex');
  const directory = join(root, '.doctopus/publication');
  await mkdir(directory, { recursive: true });
  // Retain actual API observations even if a later validation rejects them.
  await writeFile(
    join(directory, 'protection-observation.json'),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        repository,
        snapshotSha256,
        ...metadata,
      },
      null,
      2,
    ) + '\n',
  );
  return {
    environmentProtection: validatePublicationEnvironment(
      metadata.environment,
      metadata.policies,
    ),
    repositoryProtection: {
      ...validatePublicationProtectionSnapshot(
        repository,
        metadata.branch,
        metadata.tags,
        JSON.parse(bytes),
      ),
      snapshotSha256,
    },
  };
}
