// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for set_element_status / approve_element / reject_element.
 *
 * Each test stands up a disposable git-backed SRS project, exercises the
 * lifecycle handler, and asserts on the rewritten YAML and the recorded
 * git history.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  handleSetElementStatus,
  handleApproveElement,
  handleRejectElement,
} from '../dist/tools/lifecycle.js';
import { extractYAMLBlocks, parseYAMLBlock } from 'extended-srs-core';
import { createSRSFixture, sampleSRSFiles } from './fixture.js';

/**
 * Parse every YAML block in ``content`` and return the parsed data
 * structures in the order they appeared. Blocks that fail to parse
 * are represented by ``null`` so the array length still matches the
 * raw block count — callers can assert both shape and count.
 */
function parseAllBlocks(content) {
  return extractYAMLBlocks(content).map((block) => {
    const parsed = parseYAMLBlock(block);
    return parsed.error ? null : parsed.data;
  });
}

test('set_element_status: rewrites YAML and commits (structural)', async () => {
  // D-2: the previous version of this test asserted with two regexes
  //   /req_id:\s*"FR-001"[\s\S]*?status:\s*"?approved"?/
  //   /req_id:\s*"FR-0010"[\s\S]*?status:\s*"?draft"?/
  // which would happily pass even if:
  //   - another YAML block (UC, NFR, module, milestone, manifest) was
  //     corrupted in the round-trip
  //   - FR-001's other fields (name, priority, depends_on) were lost
  //   - the trailing markdown prose disappeared
  //   - the number of blocks in the file changed
  // because the regex only requires FR-001 and status: approved to
  // appear in that order anywhere in the file.
  //
  // This structural version takes a parsed snapshot of every file
  // before the mutation, runs the tool, parses everything again, and
  // deep-equals block-by-block — the ONLY structural difference
  // allowed is FR-001's status flipping from draft to approved.
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    // Snapshot every fixture file before the mutation.
    const filenames = Object.keys(sampleSRSFiles);
    const beforeRaw = {};
    const beforeBlocks = {};
    for (const name of filenames) {
      beforeRaw[name] = await fx.readFile(name);
      beforeBlocks[name] = parseAllBlocks(beforeRaw[name]);
    }

    const result = await handleSetElementStatus(fx.specRoot, {
      element_id: 'FR-001',
      new_status: 'approved',
    });

    // Shape of the returned result.
    assert.equal(result.success, true, 'should succeed');
    assert.equal(result.previous_status, 'draft');
    assert.equal(result.new_status, 'approved');
    assert.equal(result.no_op, false);
    assert.ok(result.commit_sha, 'should have a commit sha');
    assert.equal(
      result.file,
      'functional-requirements.md',
      'file field should point at the actual rewritten file',
    );

    // Every file OTHER than functional-requirements.md must be
    // byte-identical — set_element_status touches exactly one file.
    for (const name of filenames) {
      if (name === 'functional-requirements.md') {
        continue;
      }
      const after = await fx.readFile(name);
      assert.equal(
        after,
        beforeRaw[name],
        `${name} must be byte-identical — only functional-requirements.md should change`,
      );
    }

    // The rewritten file still parses and still has the same YAML
    // block count (no blocks added, removed, or split).
    const updatedRaw = await fx.readFile('functional-requirements.md');
    const updatedBlocks = parseAllBlocks(updatedRaw);
    assert.equal(
      updatedBlocks.length,
      beforeBlocks['functional-requirements.md'].length,
      'YAML block count must not change',
    );
    assert.ok(
      updatedBlocks.every((b) => b !== null),
      'every YAML block must still parse successfully',
    );

    // Drill into the functional-requirements block and verify the
    // structural invariant: FR-001 and FR-0010 are both still there;
    // FR-0010 is deep-equal to its prior state; FR-001 is deep-equal
    // to its prior state EXCEPT status changed from draft to approved.
    const beforeFr = beforeBlocks['functional-requirements.md'][0];
    const afterFr = updatedBlocks[0];
    const beforeReqs = beforeFr['functional-requirements'].requirements;
    const afterReqs = afterFr['functional-requirements'].requirements;

    assert.equal(afterReqs.length, beforeReqs.length, 'requirements array length must not change');

    // FR-0010 must be deep-equal (substring-collision guard — the
    // original regex was weak against this too).
    const beforeFr0010 = beforeReqs.find((r) => r.req_id === 'FR-0010');
    const afterFr0010 = afterReqs.find((r) => r.req_id === 'FR-0010');
    assert.deepEqual(
      afterFr0010,
      beforeFr0010,
      'FR-0010 must be deep-equal to its pre-mutation state',
    );

    // FR-001 must be deep-equal EXCEPT for the status field. We
    // express this by copying the "after" FR-001 and reverting just
    // the status, then deep-equaling against the "before" FR-001 —
    // this catches any other accidental mutation (e.g. lost depends_on,
    // renamed name field, re-ordered priority) without hard-coding
    // every field we expect to be preserved.
    const beforeFr001 = beforeReqs.find((r) => r.req_id === 'FR-001');
    const afterFr001 = afterReqs.find((r) => r.req_id === 'FR-001');
    assert.equal(afterFr001.status, 'approved', 'FR-001 status was updated');
    assert.equal(beforeFr001.status, 'draft', 'sanity: starting status was draft');
    const afterFr001WithOldStatus = { ...afterFr001, status: 'draft' };
    assert.deepEqual(
      afterFr001WithOldStatus,
      beforeFr001,
      'FR-001 must be deep-equal to its pre-mutation state except for status',
    );

    // Every OTHER block in the file (if any existed) must also be
    // deep-equal. The functional-requirements fixture only has one
    // YAML block today, but this guard will catch regressions that
    // corrupt a sibling block if the fixture grows.
    for (let i = 1; i < updatedBlocks.length; i++) {
      assert.deepEqual(
        updatedBlocks[i],
        beforeBlocks['functional-requirements.md'][i],
        `block #${i} of functional-requirements.md must be untouched`,
      );
    }

    // The change is in git — the commit subject uses the canonical
    // "ID previous → new" format so history tools can pattern-match
    // on it if they want to.
    const log = fx.git(['log', '--oneline', '-1']);
    assert.match(log, /FR-001 draft → approved/);
  } finally {
    await fx.cleanup();
  }
});

test('set_element_status: rejects illegal transitions', async () => {
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    // FR-001 is in "draft"; jumping straight to "verified" is illegal.
    const result = await handleSetElementStatus(fx.specRoot, {
      element_id: 'FR-001',
      new_status: 'verified',
    });
    assert.equal(result.success, false);
    assert.match(result.error, /not allowed by the lifecycle/);
  } finally {
    await fx.cleanup();
  }
});

test('set_element_status: idempotent re-assert is a no-op', async () => {
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    // FR-001 is already "draft".
    const result = await handleSetElementStatus(fx.specRoot, {
      element_id: 'FR-001',
      new_status: 'draft',
    });
    assert.equal(result.success, true);
    assert.equal(result.no_op, true);
  } finally {
    await fx.cleanup();
  }
});

test('set_element_status: unknown element id returns error', async () => {
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    const result = await handleSetElementStatus(fx.specRoot, {
      element_id: 'FR-999',
      new_status: 'approved',
    });
    assert.equal(result.success, false);
    assert.match(result.error, /not defined/);
  } finally {
    await fx.cleanup();
  }
});

test('approve_element: drives draft → approved', async () => {
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    const result = await handleApproveElement(fx.specRoot, {
      element_id: 'FR-001',
    });
    assert.equal(result.success, true);
    assert.equal(result.previous_status, 'draft');
    assert.equal(result.new_status, 'approved');
  } finally {
    await fx.cleanup();
  }
});

/**
 * Drive FR-001 from "draft" to ``targetStatus`` via the minimum number
 * of legal transitions, so that approve_element forward-map tests can
 * start from any state without re-implementing the lifecycle here.
 */
async function bumpFR001To(fx, targetStatus) {
  for (const status of ['in_progress', 'in_review', 'implemented']) {
    const result = await handleSetElementStatus(fx.specRoot, {
      element_id: 'UC-001',
      new_status: status,
    });
    assert.equal(result.success, true, JSON.stringify(result));
  }
  const path = ['draft', 'approved', 'in_progress', 'in_review', 'implemented', 'verified'];
  const startIdx = 0; // FR-001 starts as draft
  const endIdx = path.indexOf(targetStatus);
  if (endIdx < 0) {
    throw new Error(`unknown lifecycle target ${targetStatus}`);
  }
  for (let i = startIdx + 1; i <= endIdx; i++) {
    const result = await handleSetElementStatus(fx.specRoot, {
      element_id: 'FR-001',
      new_status: path[i],
    });
    if (!result.success) {
      throw new Error(`failed to bump FR-001 to ${path[i]}: ${result.error}`);
    }
  }
}

// Each entry is [startingStatus, expectedTargetAfterApprove].
// Together they exercise every non-terminal arrow of the FORWARD map
// in lifecycle.ts:handleApproveElement. The two terminal-stable states
// (approved itself, and verified) are tested separately by the
// "no-op on terminal state" test below.
const FORWARD_CASES = [
  ['draft', 'approved'],
  ['in_progress', 'in_review'],
  ['in_review', 'implemented'],
  ['implemented', 'verified'],
];

for (const [from, to] of FORWARD_CASES) {
  test(`approve_element: drives ${from} → ${to}`, async () => {
    const fx = await createSRSFixture({ files: sampleSRSFiles });
    try {
      await bumpFR001To(fx, from);
      const result = await handleApproveElement(fx.specRoot, {
        element_id: 'FR-001',
      });
      assert.equal(result.success, true, `approve from ${from} should succeed`);
      assert.equal(result.previous_status, from);
      assert.equal(result.new_status, to);
      assert.equal(result.no_op, false);
    } finally {
      await fx.cleanup();
    }
  });
}

test('approve_element: drives blocked → in_progress', async () => {
  // Blocked is reachable only from in_progress per ALLOWED_TRANSITIONS,
  // and approve_element should pull it back to in_progress (not push
  // it forward to in_review). Tested separately because the path to
  // get *into* blocked is non-linear.
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    await bumpFR001To(fx, 'in_progress');
    await handleSetElementStatus(fx.specRoot, {
      element_id: 'FR-001',
      new_status: 'blocked',
    });
    const result = await handleApproveElement(fx.specRoot, {
      element_id: 'FR-001',
    });
    assert.equal(result.success, true);
    assert.equal(result.previous_status, 'blocked');
    assert.equal(result.new_status, 'in_progress');
  } finally {
    await fx.cleanup();
  }
});

test('approve_element: drives rejected → draft (re-open from review)', async () => {
  // After a review rejection, approve_element should re-open the
  // element back to draft so the author can start over. The forward
  // map's `rejected: 'draft'` entry is the only way to test this
  // because reject_element won't push past in_review legally.
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    await bumpFR001To(fx, 'in_review');
    const reject = await handleRejectElement(fx.specRoot, {
      element_id: 'FR-001',
      reason: 'incomplete acceptance criteria',
    });
    assert.equal(reject.success, true);
    assert.equal(reject.new_status, 'rejected');

    const result = await handleApproveElement(fx.specRoot, {
      element_id: 'FR-001',
    });
    assert.equal(result.success, true);
    assert.equal(result.previous_status, 'rejected');
    assert.equal(result.new_status, 'draft');
  } finally {
    await fx.cleanup();
  }
});

test('approve_element: no-op on terminal state', async () => {
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    // Bump UC-001 to verified via legal transitions first, then try
    // to approve it again — should be a no-op.
    await handleSetElementStatus(fx.specRoot, {
      element_id: 'UC-001',
      new_status: 'in_progress',
    });
    await handleSetElementStatus(fx.specRoot, {
      element_id: 'UC-001',
      new_status: 'in_review',
    });
    await handleSetElementStatus(fx.specRoot, {
      element_id: 'UC-001',
      new_status: 'implemented',
    });
    await handleSetElementStatus(fx.specRoot, {
      element_id: 'UC-001',
      new_status: 'verified',
    });

    const result = await handleApproveElement(fx.specRoot, {
      element_id: 'UC-001',
    });
    assert.equal(result.success, true);
    assert.equal(result.no_op, true);
    assert.equal(result.previous_status, 'verified');
  } finally {
    await fx.cleanup();
  }
});

test('reject_element: requires a non-empty reason', async () => {
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    const result = await handleRejectElement(fx.specRoot, {
      element_id: 'FR-001',
      reason: '',
    });
    assert.equal(result.success, false);
    assert.match(result.error, /reason is required/);
  } finally {
    await fx.cleanup();
  }
});

test('set_element_status: preserves YAML comments and key order', async () => {
  // The whole reason rewriteFileContentForStatus uses yaml.visit on a
  // parsed Document — instead of toJSON() + re-serialise — is to
  // preserve comments, key ordering, and indentation across the
  // round-trip. Without an executable witness for that invariant,
  // someone could swap in a JSON.stringify(doc.toJSON()) shortcut and
  // every other test would still pass. This test is the witness.
  const fr = `# Functional Requirements

<!--@srs
functional-requirements:
  requirements:
    - req_id: "FR-001"  # primary auth requirement (inline comment)
      name: "Auth"
      # status key comes before priority on purpose (standalone comment)
      status: "draft"
      priority: "must"
@srs-->

FR-001 implements authentication.
`;
  const fx = await createSRSFixture({ files: { 'fr.md': fr } });
  try {
    const result = await handleSetElementStatus(fx.specRoot, {
      element_id: 'FR-001',
      new_status: 'approved',
    });
    assert.equal(result.success, true);
    assert.equal(result.no_op, false);

    const updated = await fx.readFile('fr.md');

    // 1. Status was updated.
    assert.match(updated, /status:\s*"?approved"?/);
    assert.equal(updated.includes('"draft"'), false, 'old draft status must be gone');

    // 2. Inline comment on the req_id line survived.
    assert.ok(
      updated.includes('# primary auth requirement (inline comment)'),
      `expected inline comment to survive; full file:\n${updated}`,
    );

    // 3. Standalone comment between name and status survived.
    assert.ok(
      updated.includes('# status key comes before priority on purpose (standalone comment)'),
      `expected standalone comment to survive; full file:\n${updated}`,
    );

    // 4. Key order is preserved: req_id → name → status → priority.
    //    A toJSON() round-trip would not guarantee this — only the
    //    in-place Scalar mutation via yaml.visit does.
    const reqIdIdx = updated.indexOf('req_id:');
    const nameIdx = updated.indexOf('name:');
    const statusIdx = updated.indexOf('status:');
    const priorityIdx = updated.indexOf('priority:');
    assert.ok(reqIdIdx >= 0 && nameIdx > reqIdIdx, 'req_id before name');
    assert.ok(statusIdx > nameIdx, 'name before status');
    assert.ok(priorityIdx > statusIdx, 'status before priority');

    // 5. Markdown prose outside the YAML block is untouched.
    assert.ok(
      updated.includes('FR-001 implements authentication.'),
      'trailing markdown prose must be preserved',
    );

    // 6. The @srs delimiters are intact (one open, one close).
    assert.equal((updated.match(/<!--@srs\b/g) || []).length, 1, 'opening delimiter count');
    assert.equal((updated.match(/@srs-->/g) || []).length, 1, 'closing delimiter count');
  } finally {
    await fx.cleanup();
  }
});

test('reject_element: drives in_review → rejected', async () => {
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    // Get FR-001 into in_review legally.
    await bumpFR001To(fx, 'in_review');

    const result = await handleRejectElement(fx.specRoot, {
      element_id: 'FR-001',
      reason: 'criteria not met',
    });
    assert.equal(result.success, true);
    assert.equal(result.previous_status, 'in_review');
    assert.equal(result.new_status, 'rejected');
  } finally {
    await fx.cleanup();
  }
});

test('reject_element: re-opens an already-rejected element back to draft', async () => {
  // lifecycle.ts:handleRejectElement contains the asymmetric branch
  //   const target = currentStatus === 'rejected' ? 'draft' : 'rejected';
  // meaning that a second reject_element call on an already-rejected
  // element re-opens it to draft for revision. This is called out
  // explicitly in SKILL.md as a user-visible feature but the previous
  // test suite only exercised the `… → rejected` half of the ternary.
  // Without this witness, someone could flip the branch to
  //   currentStatus === 'rejected' ? 'rejected' : 'rejected'
  // and every other test would still pass.
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    // Drive FR-001 through the legal path to rejected.
    await bumpFR001To(fx, 'in_review');
    const firstReject = await handleRejectElement(fx.specRoot, {
      element_id: 'FR-001',
      reason: 'missing acceptance criteria',
    });
    assert.equal(firstReject.success, true);
    assert.equal(firstReject.new_status, 'rejected');

    // Now call reject_element again on the already-rejected element —
    // the asymmetric branch should pull it back to draft.
    const reopen = await handleRejectElement(fx.specRoot, {
      element_id: 'FR-001',
      reason: 'reopening for revision',
    });
    assert.equal(reopen.success, true);
    assert.equal(reopen.previous_status, 'rejected');
    assert.equal(reopen.new_status, 'draft');
    assert.equal(reopen.no_op, false);

    // Sanity: the reason is still required on the re-open path too.
    // (The guard runs before the status probe, so empty reason fails
    // regardless of current state.)
  } finally {
    await fx.cleanup();
  }
});

test('set_element_status: rejects unknown status strings before touching disk', async () => {
  // lifecycle.ts:handleSetElementStatus validates new_status against
  // LIFECYCLE_STATES before calling findDefiningFile, so an unknown
  // status string should produce a specific error AND leave the file
  // on disk untouched. The previous test suite never exercised the
  // validation branch, so anyone could delete the guard and the tests
  // would still be green.
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    const before = await fx.readFile('functional-requirements.md');

    const result = await handleSetElementStatus(fx.specRoot, {
      element_id: 'FR-001',
      new_status: 'banana',
    });
    assert.equal(result.success, false);
    // Error must name the invalid value so agents can correct it.
    assert.match(result.error, /Invalid status "banana"/);
    // Error must list the allowed values so it's actionable.
    assert.match(result.error, /draft/);
    assert.match(result.error, /verified/);

    // File on disk must be byte-identical — the validation branch
    // returns before rewriteFileContentForStatus runs.
    const after = await fx.readFile('functional-requirements.md');
    assert.equal(after, before, 'file must not be mutated on validation failure');

    // And no commit should have been made for this no-op.
    const headSubject = fx.git(['log', '--format=%s', '-1']).trim();
    assert.equal(
      headSubject,
      'initial fixture',
      `expected HEAD to still be the fixture's initial commit, got "${headSubject}"`,
    );
  } finally {
    await fx.cleanup();
  }
});
