// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for get_status_history.
 *
 * The handler scans the file's git log, loads each commit's snapshot,
 * parses the YAML, and reports a history entry only when the element's
 * status differs from the parent commit's snapshot.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { handleGetStatusHistory, handleGetChangeLog } from '../dist/tools/history.js';
import { createSRSFixture } from './fixture.js';

const FIRST = `# FR

<!--@srs
functional-requirements:
  requirements:
    - req_id: "FR-001"
      name: "Auth"
      status: "draft"
@srs-->
`;

const APPROVED = FIRST.replace('"draft"', '"approved"');
const IN_PROGRESS = FIRST.replace('"draft"', '"in_progress"');

test('history reads old filenames, literal names and the last block, preserving Git field delimiters', async (t) => {
  const filename = 'draft [1]\told.md';
  const fx = await createSRSFixture({
    files: { [filename]: FIRST + APPROVED, 'notes.txt': IN_PROGRESS },
  });
  t.after(() => fx.cleanup());
  await fs.mkdir(path.join(fx.specRoot, 'node_modules'));
  await fx.writeFile('node_modules/ignored.md', IN_PROGRESS);
  await fs.symlink('notes.txt', path.join(fx.specRoot, 'linked.md'));
  fx.commitAll('non-document and symlink changes');
  await fs.rename(path.join(fx.specRoot, filename), path.join(fx.specRoot, 'renamed.md'));
  await fx.writeFile('renamed.md', FIRST + IN_PROGRESS);
  // commitAll supplies a fixed test identity; invoke Git with -c-equivalent env explicitly via --author.
  fx.git(['add', '-A']);
  fx.git(['commit', '--author=Name | Included <test@example.com>', '-m', 'rename | and start']);
  await fs.unlink(path.join(fx.specRoot, 'renamed.md'));
  fx.commitAll('delete document');
  const history = await handleGetStatusHistory(fx.specRoot, { element_id: 'FR-001' });
  assert.deepEqual(
    history.history.map((entry) => entry.status),
    ['approved', 'in_progress'],
  );
  assert.equal(history.history[1].changed_by, 'Name | Included');
  assert.equal(history.history[1].reason, 'rename | and start');
  const changes = await handleGetChangeLog(fx.specRoot, { element_id: 'FR-001' });
  assert.deepEqual(
    changes.changes.map((entry) => entry.message),
    ['delete document', 'rename | and start', 'initial fixture'],
  );
});

test('history of an unversioned SRS directory is empty', async (t) => {
  const fx = await createSRSFixture({ files: { 'draft.md': FIRST } });
  t.after(() => fx.cleanup());
  // Temporarily move only this disposable fixture's Git metadata.
  await fs.rename(path.join(fx.root, '.git'), path.join(fx.root, 'saved-git'));
  assert.deepEqual(
    (await handleGetStatusHistory(fx.specRoot, { element_id: 'FR-001' })).history,
    [],
  );
  assert.deepEqual((await handleGetChangeLog(fx.specRoot, { element_id: 'FR-001' })).changes, []);
});

test('get_change_log: handles unknown elements and date filters without inventing a version', async () => {
  const fx = await createSRSFixture({
    files: { 'srs/fr.md': FIRST },
    initialCommitMessage: 'initial | FR-001',
  });
  try {
    await fx.writeFile('srs/fr.md', APPROVED);
    const latestSha = fx.commitAll('approve FR-001').trim();
    const result = await handleGetChangeLog(fx.specRoot, {
      element_id: 'FR-001',
      since: '2000-01-01T00:00:00Z',
    });
    assert.equal(result.success, true);
    assert.equal(result.current_version, latestSha);
    assert.deepEqual(
      result.changes.map((entry) => entry.message),
      ['approve FR-001', 'initial | FR-001'],
    );
    assert.match(result.changes[0].diff_summary, /1 file changed/);
    assert.equal(result.changes[1].diff_summary, '(initial commit)');

    for (const args of [
      { element_id: 'FR-999' },
      { element_id: 'FR-001', since: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() },
    ]) {
      const empty = await handleGetChangeLog(fx.specRoot, args);
      assert.equal(empty.success, true);
      assert.deepEqual(empty.changes, []);
      assert.equal(empty.current_version, null);
      assert.equal(empty.last_modified_by, null);
      assert.equal(empty.last_modified_at, null);
    }
  } finally {
    await fx.cleanup();
  }
});

test('get_status_history: tracks transitions across commits', async () => {
  const fx = await createSRSFixture({ files: { 'srs/fr.md': FIRST } });
  try {
    // Commit a draft → approved transition.
    await fx.writeFile('srs/fr.md', APPROVED);
    fx.commitAll('approve FR-001');

    // Commit an approved → in_progress transition.
    await fx.writeFile('srs/fr.md', IN_PROGRESS);
    fx.commitAll('start FR-001');

    const result = await handleGetStatusHistory(fx.specRoot, {
      element_id: 'FR-001',
    });
    assert.equal(result.success, true);
    const statuses = result.history.map((h) => h.status);
    // Initial commit creates FR-001 (draft), then approved, then in_progress.
    assert.deepEqual(statuses, ['draft', 'approved', 'in_progress']);

    // The first entry has no previous_status (creation).
    assert.equal(result.history[0].previous_status, undefined);
    // Subsequent entries do.
    assert.equal(result.history[1].previous_status, 'draft');
    assert.equal(result.history[2].previous_status, 'approved');
  } finally {
    await fx.cleanup();
  }
});

test('get_status_history: cosmetic-only commits are ignored', async () => {
  const fx = await createSRSFixture({ files: { 'srs/fr.md': FIRST } });
  try {
    // Commit purely cosmetic whitespace change — no status diff.
    await fx.writeFile('srs/fr.md', FIRST.replace('"draft"', '"draft"   '));
    fx.commitAll('cosmetic whitespace');

    const result = await handleGetStatusHistory(fx.specRoot, {
      element_id: 'FR-001',
    });
    // Only the creation entry; the whitespace commit doesn't change
    // the parsed status value, so the snapshot-and-parse approach
    // correctly skips it.
    assert.equal(result.history.length, 1);
    assert.equal(result.history[0].status, 'draft');
  } finally {
    await fx.cleanup();
  }
});

test('get_status_history: returns empty for unknown element', async () => {
  const fx = await createSRSFixture({ files: { 'srs/fr.md': FIRST } });
  try {
    const result = await handleGetStatusHistory(fx.specRoot, {
      element_id: 'FR-999',
    });
    assert.equal(result.success, true);
    assert.equal(result.history.length, 0);
  } finally {
    await fx.cleanup();
  }
});

test('get_status_history: delete commit is skipped, re-creation resets previous_status', async () => {
  // Deletion is omitted from status history. Re-creation must not inherit
  // the previous lifetime's status, even when the file remains present.
  const WITHOUT_FR001 = `# FR

<!--@srs
functional-requirements:
  requirements:
    - req_id: "FR-002"
      name: "Other requirement that keeps the file non-empty"
      status: "draft"
@srs-->
`;

  const fx = await createSRSFixture({ files: { 'srs/fr.md': FIRST } });
  try {
    // Commit 2: draft → approved
    await fx.writeFile('srs/fr.md', APPROVED);
    fx.commitAll('approve FR-001');

    // Commit 3: FR-001 is deleted (file still exists, but the element
    // block is gone — this is the branch we want to hit).
    await fx.writeFile('srs/fr.md', WITHOUT_FR001);
    fx.commitAll('remove FR-001 entirely');

    // Commit 4: FR-001 re-added as draft.
    await fx.writeFile('srs/fr.md', FIRST);
    fx.commitAll('re-add FR-001 as draft');

    // Commit 5: draft → approved again.
    await fx.writeFile('srs/fr.md', APPROVED);
    fx.commitAll('re-approve FR-001');

    const result = await handleGetStatusHistory(fx.specRoot, {
      element_id: 'FR-001',
    });
    assert.equal(result.success, true);

    const statuses = result.history.map((h) => h.status);
    // Exactly 4 entries — the delete commit (commit 3) must NOT be in
    // the history. Any 5-entry result would mean the skip branch
    // regressed to actually reporting `(absent)` as a status.
    assert.deepEqual(
      statuses,
      ['draft', 'approved', 'draft', 'approved'],
      `expected the delete commit to be skipped; got ${JSON.stringify(result.history, null, 2)}`,
    );

    // No entry may expose the synthetic ABSENT_STATUS sentinel.
    for (const entry of result.history) {
      assert.notEqual(entry.status, '(absent)', 'ABSENT_STATUS must not leak');
      assert.notEqual(
        entry.previous_status,
        '(absent)',
        'ABSENT_STATUS must not leak as previous_status',
      );
    }

    // Creation (entry 0) and re-creation (entry 2) must both have
    // undefined previous_status. Specifically, the re-creation's
    // previous_status would be "approved" (the pre-delete status)
    // if the skip branch forgot to reset prevStatus — so this is the
    // load-bearing assertion for the `prevStatus = currentStatus`
    // line inside the skip branch.
    assert.equal(
      result.history[0].previous_status,
      undefined,
      'first creation has no previous_status',
    );
    assert.equal(
      result.history[2].previous_status,
      undefined,
      're-creation after delete must reset previous_status to undefined',
    );

    // And the in-lifetime transitions still have their previous_status
    // populated — so we're not just deleting every previous_status.
    assert.equal(result.history[1].previous_status, 'draft');
    assert.equal(result.history[3].previous_status, 'draft');

    // Commit messages should not include the delete commit either —
    // double-check that the `remove FR-001 entirely` message is absent
    // from the history's reason field.
    const reasons = result.history.map((h) => h.reason);
    assert.ok(
      !reasons.some((r) => /remove FR-001 entirely/.test(r)),
      `delete commit leaked into history.reason: ${JSON.stringify(reasons)}`,
    );
  } finally {
    await fx.cleanup();
  }
});
