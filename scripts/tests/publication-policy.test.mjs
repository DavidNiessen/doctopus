import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  npmPublicationOrder,
  publicationPlan,
  validateCandidateRun,
  validatePublicationEnvironment,
  validatePublicationRulesets,
} from '../lib/publication-policy.mjs';
import { readWorkspacePackages } from '../lib/workspaces.mjs';
import {
  createPublicationProtectionSnapshot,
  validatePublicationProtectionSnapshot,
  inspectPublicationProtections,
} from '../lib/publication-protection.mjs';

const repositoryPolicy = JSON.parse(
  await readFile(new URL('../../release-policy.json', import.meta.url)),
);
const policy = {
  ...structuredClone(repositoryPolicy),
  publicationEnabled: false,
  reviews: Object.fromEntries(
    Object.keys(repositoryPolicy.reviews).map((kind) => [kind, 'pending']),
  ),
  reviewDeferral: null,
};
const context = {
  repository: 'DavidNiessen/doctopus',
  commit: 'a'.repeat(40),
  version: '0.2.0',
  ref: 'refs/tags/v0.2.0',
  runId: '123',
  runAttempt: '1',
};
const source = {
  packages: ['@davidniessen/doctopus-contracts', '@davidniessen/doctopus-cli'],
  mavenGroup: 'dev.niessen',
};

const masterRules = {
  id: 12,
  target: 'branch',
  enforcement: 'active',
  bypass_actors: [],
  conditions: { ref_name: { include: ['refs/heads/master'], exclude: [] } },
  rules: [
    {
      type: 'pull_request',
      parameters: {
        required_review_thread_resolution: true,
        required_approving_review_count: 1,
        dismiss_stale_reviews_on_push: true,
      },
    },
    { type: 'non_fast_forward' },
    { type: 'deletion' },
    {
      type: 'required_status_checks',
      parameters: {
        strict_required_status_checks_policy: true,
        required_status_checks: [{ context: 'Quality', integration_id: 15368 }],
      },
    },
  ],
};
const tagRules = {
  id: 13,
  target: 'tag',
  enforcement: 'active',
  bypass_actors: [],
  conditions: { ref_name: { include: ['refs/tags/v*'], exclude: [] } },
  rules: [{ type: 'update' }, { type: 'deletion' }],
};

function protectionSnapshotFixture() {
  const metadata = {
    source: context.repository,
    source_type: 'Repository',
    updated_at: '2026-10-24T00:00:00.000Z',
  };
  const branch = {
    ...structuredClone(masterRules),
    ...metadata,
    name: 'Protect master',
  };
  const tags = {
    ...structuredClone(tagRules),
    ...metadata,
    name: 'Protect release tags',
  };
  branch.bypass_actors = [
    { actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' },
  ];
  const snapshot = createPublicationProtectionSnapshot(
    context.repository,
    branch,
    tags,
  );
  return { branch, tags, snapshot };
}

test('redacted bypass actors require a source snapshot bound to the exact live ruleset revisions', () => {
  const { branch, tags, snapshot } = protectionSnapshotFixture();
  const full = validatePublicationProtectionSnapshot(
    context.repository,
    branch,
    tags,
    snapshot,
  );
  assert.equal(full.administratorBypasses.branch, 1);
  assert.equal(full.bypassEvidence.branchActorsVisible, true);
  const redacted = structuredClone(branch);
  delete redacted.bypass_actors;
  redacted.current_user_can_bypass = 'never';
  const verified = validatePublicationProtectionSnapshot(
    context.repository,
    redacted,
    { ...tags, bypass_actors: null },
    snapshot,
  );
  assert.equal(verified.bypassEvidence.branchActorsVisible, false);
  assert.equal(verified.bypassEvidence.tagActorsVisible, false);
  assert.equal(verified.administratorBypasses.branch, 1);
  assert.throws(() =>
    createPublicationProtectionSnapshot(context.repository, redacted, tags),
  );
  assert.throws(() => validatePublicationRulesets(redacted, tags));
});

test('ruleset revision drift, forged snapshots and inconsistent visible bypass lists fail closed', () => {
  for (const change of [
    (b) => {
      b.updated_at = '2026-10-24T00:00:00.001Z';
    },
    (b, t) => {
      t.updated_at = '2026-10-24T00:00:00.001Z';
    },
    (b) => {
      delete b.updated_at;
    },
    (b) => {
      b.updated_at = 'not-a-revision';
    },
    (b) => {
      b.id = 999;
    },
    (b) => {
      b.source = 'another/repository';
    },
    (b) => {
      b.source_type = 'Organization';
    },
    (b) => {
      b.conditions.ref_name.exclude = ['refs/heads/master'];
    },
    (b) => {
      b.rules[0].parameters.required_approving_review_count = 0;
    },
    (b) => {
      b.bypass_actors = [];
    },
    (b) => {
      b.bypass_actors = 'hidden';
    },
    (b, t, s) => {
      s.repository = 'another/repository';
    },
    (b, t, s) => {
      s.schemaVersion = 999;
    },
    (b, t, s) => {
      s.unknown = true;
    },
    (b, t, s) => {
      delete s.branch.bypass_actors;
    },
    (b, t, s) => {
      s.branch.bypass_actors[0].actor_id = 4;
    },
    (b, t, s) => {
      s.branch.rules[0].parameters.required_approving_review_count = 0;
      b.rules[0].parameters.required_approving_review_count = 0;
    },
  ]) {
    const { branch, tags, snapshot } = protectionSnapshotFixture();
    change(branch, tags, snapshot);
    assert.throws(() =>
      validatePublicationProtectionSnapshot(
        context.repository,
        branch,
        tags,
        snapshot,
      ),
    );
  }
});

test('read-only inspection verifies environment protections and retains actual observations on drift', async (t) => {
  const { branch, tags, snapshot } = protectionSnapshotFixture();
  const root = await mkdtemp(join(tmpdir(), 'ad-protections-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, 'publication-protections.json'),
    JSON.stringify(snapshot),
  );
  const liveBranch = { ...branch };
  delete liveBranch.bypass_actors;
  const environment = {
    name: 'release',
    deployment_branch_policy: {
      custom_branch_policies: true,
      protected_branches: false,
    },
    protection_rules: [
      {
        type: 'required_reviewers',
        reviewers: [{ type: 'User', reviewer: { id: 42 } }],
      },
    ],
  };
  const api = async (path) =>
    ({
      '': { default_branch: 'master' },
      'environments/release': environment,
      'environments/release/deployment-branch-policies': {
        branch_policies: [{ name: 'v*', type: 'tag' }],
      },
      'rulesets?includes_parents=true': [branch, tags],
      'rulesets/12': liveBranch,
      'rulesets/13': tags,
    })[path];
  const result = await inspectPublicationProtections(
    root,
    context.repository,
    api,
  );
  assert.equal(result.environmentProtection.reviewers, 1);
  assert.equal(
    result.repositoryProtection.bypassEvidence.branchActorsVisible,
    false,
  );
  assert.match(result.repositoryProtection.snapshotSha256, /^[a-f0-9]{64}$/);
  liveBranch.updated_at = '2026-10-24T00:00:01.000Z';
  await assert.rejects(
    inspectPublicationProtections(root, context.repository, api),
  );
  const observed = JSON.parse(
    await readFile(
      join(root, '.doctopus/publication/protection-observation.json'),
    ),
  );
  assert.equal(observed.branch.updated_at, liveBranch.updated_at);
  assert.equal(Object.hasOwn(observed.branch, 'bypass_actors'), false);
  environment.deployment_branch_policy.protected_branches = true;
  await assert.rejects(
    inspectPublicationProtections(root, context.repository, api),
  );
});

test('actual repository rulesets must protect reviewed master and immutable version tags', () => {
  assert.deepEqual(validatePublicationRulesets(masterRules, tagRules), {
    branchRulesetId: 12,
    tagRulesetId: 13,
    requiredCheck: 'Quality',
    checksAppId: 15368,
    requiredApprovals: 1,
    dismissStaleReviews: true,
    administratorBypasses: { branch: 0, tags: 0 },
  });
  const branch = structuredClone(masterRules);
  branch.conditions.ref_name.include = ['~DEFAULT_BRANCH'];
  validatePublicationRulesets(branch, tagRules);
  branch.bypass_actors = [
    { actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' },
  ];
  assert.equal(
    validatePublicationRulesets(branch, tagRules).administratorBypasses.branch,
    1,
  );
});

test('inactive, bypassed, excluded, mutable or unchecked release rulesets fail approval', () => {
  for (const mutate of [
    (branch) => {
      branch.enforcement = 'disabled';
    },
    (branch) => {
      branch.bypass_actors = [{ actor_id: 1, bypass_mode: 'always' }];
    },
    (branch) => {
      branch.conditions.ref_name.exclude = ['refs/heads/master'];
    },
    (branch) => {
      branch.rules[0].parameters.required_review_thread_resolution = false;
    },
    (branch) => {
      branch.rules = branch.rules.filter(
        (rule) => rule.type !== 'pull_request',
      );
    },
    (branch) => {
      branch.rules.at(-1).parameters.required_status_checks[0].context =
        'unrelated check';
    },
    (branch) => {
      branch.rules.at(-1).parameters.required_status_checks[0].integration_id =
        999;
    },
    (branch) => {
      branch.rules.at(-1).parameters.strict_required_status_checks_policy =
        false;
    },
    (_branch, tags) => {
      tags.rules = [{ type: 'deletion' }];
    },
    (_branch, tags) => {
      tags.conditions.ref_name.include = ['refs/tags/unrelated*'];
    },
  ]) {
    const branch = structuredClone(masterRules),
      tags = structuredClone(tagRules);
    mutate(branch, tags);
    assert.throws(() => validatePublicationRulesets(branch, tags));
  }
});

test('release approval requires genuine approving reviews that expire on source changes', () => {
  for (const count of [undefined, null, 0, -1, 0.5, '1', true]) {
    const branch = structuredClone(masterRules);
    branch.rules[0].parameters.required_approving_review_count = count;
    assert.throws(
      () => validatePublicationRulesets(branch, tagRules),
      /at least one approving PR review/,
    );
  }
  for (const dismiss of [undefined, null, false, 'true', 1]) {
    const branch = structuredClone(masterRules);
    branch.rules[0].parameters.dismiss_stale_reviews_on_push = dismiss;
    assert.throws(
      () => validatePublicationRulesets(branch, tagRules),
      /Dismiss stale PR approvals/,
    );
  }
  const branch = structuredClone(masterRules);
  branch.rules[0].parameters.required_approving_review_count = 2;
  assert.equal(
    validatePublicationRulesets(branch, tagRules).requiredApprovals,
    2,
  );
});

test('the GitHub policy lists pending launch decisions without approving publication', () => {
  const plan = publicationPlan(policy, context, source);
  assert.equal(plan.policyApproved, false);
  assert.equal(plan.blockers.length, 6);
  assert.equal(plan.npm.registry, 'https://npm.pkg.github.com');
  assert.equal(
    plan.maven.registry,
    'https://maven.pkg.github.com/davidniessen/doctopus',
  );
  assert.equal(plan.npm.tag, 'latest');
  assert.deepEqual(plan.npm.packages, [
    '@davidniessen/doctopus-cli',
    '@davidniessen/doctopus-contracts',
  ]);
  assert.equal(
    publicationPlan(
      policy,
      { ...context, version: '0.2.0-rc.1', ref: 'refs/tags/v0.2.0-rc.1' },
      source,
    ).npm.tag,
    'next',
  );
});

test('all source policy decisions are necessary even with repository-owned GitHub destinations', () => {
  const ready = structuredClone(policy);
  ready.publicationEnabled = true;
  for (const kind of ['npm', 'maven', 'container'])
    ready[kind].ownershipVerified = true;
  for (const kind of Object.keys(ready.reviews))
    ready.reviews[kind] = 'approved';
  assert.equal(publicationPlan(ready, context, source).policyApproved, true);
  ready.reviews.licenses = 'pending';
  assert.deepEqual(publicationPlan(ready, context, source).blockers, [
    'licenses launch review is pending.',
  ]);
});

test('owner-authorized review deferrals permit prereleases while preserving pending and stable gates', () => {
  const deferred = structuredClone(policy);
  deferred.publicationEnabled = true;
  for (const kind of Object.keys(deferred.reviews))
    deferred.reviews[kind] = 'deferred';
  deferred.reviewDeferral = {
    authorizedBy: 'DavidNiessen',
    reason: 'Owner requested postponement for the prerelease.',
    scope: 'prerelease',
  };
  const pre = {
    ...context,
    version: '0.2.0-candidate.3',
    ref: 'refs/tags/v0.2.0-candidate.3',
  };
  const plan = publicationPlan(deferred, pre, source);
  assert.equal(plan.policyApproved, true);
  assert.equal(plan.publicationApproved, false);
  assert.equal(plan.deferredReviews.length, 5);
  assert.deepEqual(plan.reviews, deferred.reviews);
  assert.deepEqual(plan.reviewDeferral, deferred.reviewDeferral);
  const stable = publicationPlan(deferred, context, source);
  assert.equal(stable.policyApproved, false);
  assert.equal(stable.blockers.length, 5);
  assert(
    stable.blockers.every((message) =>
      message.includes('stable publication requires approval'),
    ),
  );
  deferred.reviews.security = 'pending';
  assert.deepEqual(publicationPlan(deferred, pre, source).blockers, [
    'security launch review is pending.',
  ]);
  deferred.publicationEnabled = false;
  assert.equal(publicationPlan(deferred, pre, source).blockers.length, 2);
  for (const change of [
    (p) => {
      p.reviewDeferral = null;
    },
    (p) => {
      p.reviewDeferral.authorizedBy = 'another-owner';
    },
    (p) => {
      p.reviewDeferral.scope = 'stable';
    },
    (p) => {
      p.reviewDeferral.reason = ' ';
    },
    (p) => {
      p.reviewDeferral.reason = 'a'.repeat(513);
    },
    (p) => {
      p.reviewDeferral.reason = 'reason\nwith control';
    },
    (p) => {
      p.reviewDeferral.unknown = true;
    },
    (p) => {
      p.reviews.security = true;
    },
    (p) => {
      p.reviews.security = 'waived';
    },
  ]) {
    const invalid = structuredClone(deferred);
    change(invalid);
    assert.throws(() => publicationPlan(invalid, pre, source));
  }
  const stale = structuredClone(policy);
  stale.reviewDeferral = { ...deferred.reviewDeferral };
  assert.throws(() => publicationPlan(stale, pre, source));
});

test('the current source policy exposes deferrals without claiming completed reviews', () => {
  const plan = publicationPlan(
    repositoryPolicy,
    {
      ...context,
      version: '0.2.0-candidate.3',
      ref: 'refs/tags/v0.2.0-candidate.3',
    },
    source,
  );
  assert.equal(plan.policyApproved, true);
  assert.equal(plan.publicationApproved, false);
  assert.deepEqual(plan.deferredReviews.sort(), [
    'accessibility',
    'isolation',
    'licenses',
    'pilot',
    'security',
  ]);
  assert(Object.values(plan.reviews).every((status) => status === 'deferred'));
  assert.equal(
    publicationPlan(repositoryPolicy, context, source).policyApproved,
    false,
  );
});

test('policy typos, embedded credentials, mismatched namespaces and truthy strings fail closed', () => {
  for (const change of [
    (p) => {
      p.publicationEnabled = 'true';
    },
    (p) => {
      p.npm.token = 'not-a-real-token';
    },
    (p) => {
      p.npm.scope = '@another-owner';
    },
    (p) => {
      p.maven.groupId = 'other.owner';
    },
    (p) => {
      p.maven.signingKeyFingerprint = 'unverified';
    },
    (p) => {
      p.npm.registry = 'https://registry.npmjs.org';
    },
    (p) => {
      p.maven.registry = 'https://maven.pkg.github.com/another/repository';
    },
    (p) => {
      p.container.repository = 'https://user:password@ghcr.io/owner/image';
    },
    (p) => {
      p.reviews.security = 'false';
    },
    (p) => {
      delete p.reviews.isolation;
    },
    (p) => {
      p.environment = 'unprotected';
    },
  ]) {
    const changed = structuredClone(policy);
    change(changed);
    assert.throws(() => publicationPlan(changed, context, source));
  }
});

test('promotion requires the exact successful upstream candidate workflow and attempt', () => {
  const run = {
    id: 123,
    run_attempt: 1,
    workflow_id: 456,
    path: '.github/workflows/release-candidate.yml',
    event: 'workflow_dispatch',
    status: 'completed',
    conclusion: 'success',
    head_sha: context.commit,
    repository: { full_name: context.repository },
    head_repository: { full_name: context.repository },
  };
  validateCandidateRun(run, context, 456);
  for (const fields of [
    { id: 999 },
    { run_attempt: 2 },
    { workflow_id: 789 },
    { path: '.github/workflows/quality.yml' },
    { event: 'pull_request' },
    { status: 'in_progress' },
    { conclusion: 'failure' },
    { conclusion: 'cancelled' },
    { head_sha: 'b'.repeat(40) },
    { head_repository: { full_name: 'untrusted/fork' } },
  ])
    assert.throws(() =>
      validateCandidateRun({ ...run, ...fields }, context, 456),
    );
});

test('a real reviewer gate and tag-only environment policy are required before publishing', () => {
  const environment = {
    name: 'release',
    deployment_branch_policy: {
      custom_branch_policies: true,
      protected_branches: false,
    },
    protection_rules: [
      {
        type: 'required_reviewers',
        prevent_self_review: true,
        reviewers: [{ type: 'User', reviewer: { id: 42 } }],
      },
    ],
  };
  const branches = { branch_policies: [{ name: 'v*', type: 'tag' }] };
  assert.deepEqual(validatePublicationEnvironment(environment, branches), {
    reviewers: 1,
    preventSelfReview: true,
    tagPolicy: 'v*',
  });
  for (const fields of [
    { name: 'unprotected' },
    { protection_rules: [] },
    { deployment_branch_policy: null },
    { protection_rules: [{ type: 'required_reviewers', reviewers: [] }] },
  ])
    assert.throws(() =>
      validatePublicationEnvironment({ ...environment, ...fields }, branches),
    );
  for (const branch_policies of [
    [],
    [{ name: 'v*', type: 'branch' }],
    [{ name: '*', type: 'tag' }],
    [...branches.branch_policies, { name: 'master', type: 'branch' }],
  ])
    assert.throws(() =>
      validatePublicationEnvironment(environment, { branch_policies }),
    );
});

test('the actual public workspace is publishable in dependency order and matches the disabled policy', async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const packages = (await readWorkspacePackages(root))
    .filter((pkg) => pkg.path && pkg.metadata.private !== true)
    .map((pkg) => pkg.metadata);
  const order = npmPublicationOrder(packages);
  assert.equal(order.length, packages.length);
  assert.equal(
    publicationPlan(policy, context, { ...source, packages: order })
      .policyApproved,
    false,
  );
  for (const pkg of packages)
    for (const dependency of Object.keys({
      ...pkg.dependencies,
      ...pkg.optionalDependencies,
      ...pkg.peerDependencies,
    }))
      if (order.includes(dependency))
        assert(order.indexOf(dependency) < order.indexOf(pkg.name));
  assert.throws(
    () =>
      npmPublicationOrder([
        { name: 'a', dependencies: { b: '1' } },
        { name: 'b', dependencies: { a: '1' } },
      ]),
    /Cyclic/,
  );
  assert.throws(() => npmPublicationOrder([{ name: 'a' }, { name: 'a' }]));
});
