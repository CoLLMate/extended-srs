// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
/**
 * EXTSRS_AUTO_COMMIT=false opt-out tests.
 *
 * In the default subfolder model the SRS root is one folder inside a
 * larger parent repository. MCP tools that mutate state (review.ts +
 * lifecycle.ts) normally commit their writes to the parent repo so the
 * history forms an audit trail. That is the correct behaviour when the
 * SRS root has its own worktree or branch for spec work.
 *
 * When the SRS root shares a worktree with unrelated application code,
 * the caller can set ``EXTSRS_AUTO_COMMIT=false`` at the MCP-server
 * level to skip *all* git operations — the files are still written to
 * disk, they just aren't staged or committed. This file exercises that
 * opt-out path for both tool families (review + lifecycle) and for
 * both affordances of the toggle (off and back on).
 *
 * All tests follow the same shape:
 *   1. remember the parent repo's HEAD sha before the call
 *   2. flip the env var for the duration of the tool call
 *   3. assert ``commit_sha`` is ``null`` and HEAD is unchanged
 *   4. assert the file change is still visible in the work tree via
 *      ``git status --porcelain``
 *
 * Cleanup uses try/finally to make sure the env var does not leak into
 * sibling tests, which expect the default-on behaviour.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';

import { handleSubmitForReview } from '../dist/tools/review.js';
import { handleSetElementStatus } from '../dist/tools/lifecycle.js';
import { createSRSFixture, sampleSRSFiles } from './fixture.js';

/**
 * Run ``fn`` with ``EXTSRS_AUTO_COMMIT`` forced to ``value`` and restore
 * whatever was there before (including the ``undefined`` case) once the
 * callback resolves. Using this wrapper keeps the env var flip local to
 * a single test and prevents cross-test contamination.
 */
async function withAutoCommit(value, fn) {
  const prev = process.env.EXTSRS_AUTO_COMMIT;
  if (value === undefined) {
    delete process.env.EXTSRS_AUTO_COMMIT;
  } else {
    process.env.EXTSRS_AUTO_COMMIT = value;
  }
  try {
    return await fn();
  } finally {
    if (prev === undefined) {
      delete process.env.EXTSRS_AUTO_COMMIT;
    } else {
      process.env.EXTSRS_AUTO_COMMIT = prev;
    }
  }
}

test('auto-commit off: submit_for_review writes JSON but does not commit', async () => {
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    const headBefore = fx.git(['rev-parse', 'HEAD']).trim();

    const result = await withAutoCommit('false', () =>
      handleSubmitForReview(fx.specRoot, {
        element_id: 'FR-001',
        gate_type: 'content',
      }),
    );

    assert.equal(result.success, true);
    assert.equal(result.commit_sha, null, 'commit_sha must be null when auto-commit is disabled');

    // The review record is on disk regardless of the commit opt-out.
    const recordPath = path.join(fx.specRoot, 'reviews', 'FR-001', '0001.json');
    const stat = await fs.stat(recordPath);
    assert.ok(stat.isFile(), `expected review record at ${recordPath}`);

    // HEAD must not have moved — the tool wrote the file but left it
    // outside the git history.
    const headAfter = fx.git(['rev-parse', 'HEAD']).trim();
    assert.equal(headAfter, headBefore, 'HEAD must not advance when auto-commit is disabled');

    // And the new file shows up as untracked, which is the whole point:
    // the caller can now commit it alongside whatever else they are
    // working on in the parent repo. ``git status --porcelain`` without
    // ``-u`` collapses untracked directories, so we pass ``-uall`` to
    // get the individual file entry and match on its full path.
    const status = fx.git(['status', '--porcelain', '-uall']).trim();
    assert.match(
      status,
      /spec\/reviews\/FR-001\/0001\.json/,
      `expected untracked review record in git status; got:\n${status}`,
    );
  } finally {
    await fx.cleanup();
  }
});

test('auto-commit off: set_element_status writes YAML but does not commit', async () => {
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    const headBefore = fx.git(['rev-parse', 'HEAD']).trim();

    const result = await withAutoCommit('false', () =>
      handleSetElementStatus(fx.specRoot, {
        element_id: 'FR-001',
        new_status: 'approved',
      }),
    );

    assert.equal(result.success, true);
    assert.equal(result.previous_status, 'draft');
    assert.equal(result.new_status, 'approved');
    assert.equal(result.no_op, false);
    assert.equal(result.commit_sha, null, 'commit_sha must be null when auto-commit is disabled');

    // HEAD is untouched.
    const headAfter = fx.git(['rev-parse', 'HEAD']).trim();
    assert.equal(headAfter, headBefore, 'HEAD must not advance when auto-commit is disabled');

    // The file on disk carries the new status — the YAML rewrite path
    // still ran, only the git step was skipped. The YAML serializer
    // preserves the original scalar quoting style, so "draft" → "approved"
    // keeps the surrounding double quotes.
    const onDisk = await fx.readFile('functional-requirements.md');
    assert.match(
      onDisk,
      /req_id:\s*"FR-001"[\s\S]*?status:\s*['"]?approved['"]?/,
      'expected functional-requirements.md to show FR-001 as approved',
    );

    // And git status reports it as modified — no staging either,
    // because the opt-out skips ``git add`` as well. ``git status
    // --porcelain`` uses a 2-column XY format where X is the index
    // status and Y is the worktree status; for an *unstaged*
    // modification X is a space and Y is "M" (so the raw line is
    // `` M spec/...``). We strip the leading columns with a loose
    // regex so the assertion only cares that the file shows up in the
    // modified-but-not-staged bucket.
    const status = fx.git(['status', '--porcelain']);
    assert.match(
      status,
      /^ M spec\/functional-requirements\.md/m,
      `expected unstaged modification in git status; got:\n${status}`,
    );
  } finally {
    await fx.cleanup();
  }
});

test('auto-commit off: values "0", "no", "off" also disable the commit', async () => {
  // The helper accepts several spellings of "off" so operators aren't
  // surprised when a common boolean representation happens to disable
  // the feature. This test locks in the accepted set so a future
  // regression that narrows it down would be caught here.
  for (const value of ['false', '0', 'no', 'off', 'FALSE', 'Off']) {
    const fx = await createSRSFixture({ files: sampleSRSFiles });
    try {
      const headBefore = fx.git(['rev-parse', 'HEAD']).trim();

      const result = await withAutoCommit(value, () =>
        handleSetElementStatus(fx.specRoot, {
          element_id: 'FR-001',
          new_status: 'approved',
        }),
      );

      assert.equal(result.success, true, `value=${value}`);
      assert.equal(result.commit_sha, null, `value=${value}`);

      const headAfter = fx.git(['rev-parse', 'HEAD']).trim();
      assert.equal(headAfter, headBefore, `HEAD must not advance for value=${value}`);
    } finally {
      await fx.cleanup();
    }
  }
});

test('auto-commit on (default / explicit "true"): set_element_status commits as usual', async () => {
  // Positive control: when the env var is absent or explicitly "true",
  // the commit still happens. This keeps the OFF tests honest — if
  // the feature flag were accidentally inverted, this test would fail.
  for (const value of [undefined, 'true', '1', 'TRUE']) {
    const fx = await createSRSFixture({ files: sampleSRSFiles });
    try {
      const headBefore = fx.git(['rev-parse', 'HEAD']).trim();

      const result = await withAutoCommit(value, () =>
        handleSetElementStatus(fx.specRoot, {
          element_id: 'FR-001',
          new_status: 'approved',
        }),
      );

      assert.equal(result.success, true, `value=${String(value)}`);
      assert.ok(
        typeof result.commit_sha === 'string' && result.commit_sha.length > 0,
        `expected commit_sha to be a sha for value=${String(value)}; got ${result.commit_sha}`,
      );

      const headAfter = fx.git(['rev-parse', 'HEAD']).trim();
      assert.notEqual(headAfter, headBefore, `HEAD must advance for value=${String(value)}`);
      assert.equal(headAfter, result.commit_sha, 'returned commit_sha must match new HEAD');
    } finally {
      await fx.cleanup();
    }
  }
});
