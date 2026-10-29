// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
/**
 * Scope / negative-control tests.
 *
 * In the subfolder model the SRS root is
 * one subdirectory inside a larger parent repository. MCP tools must
 * operate **only** on the SRS root subtree — they must not read files
 * outside it, and git commits they produce must not include changes to
 * the surrounding application code.
 *
 * These tests use ``fx.writeOutsideSpec()`` to populate the parent repo
 * with files that an MCP tool must never see. If a future change
 * inadvertently broadens a scan, relaxes a pathspec, or runs a
 * whole-repo ``git add -A``, one of these tests will go red.
 *
 * Coverage:
 *   - get_project_state must not surface elements defined outside the SRS root
 *   - submit_for_review writes to ``<specRoot>/reviews/``, NOT to
 *     ``<parentRoot>/.exsrs/reviews/``
 *   - set_element_status commits nothing outside the SRS root, even
 *     when the parent repo has staged/unstaged changes in ``src/``
 *   - get_change_log does not return commits that only touched parent repo files
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';

import { handleGetProjectState } from '../dist/tools/project.js';
import { handleSubmitForReview } from '../dist/tools/review.js';
import { handleSetElementStatus } from '../dist/tools/lifecycle.js';
import { handleGetChangeLog } from '../dist/tools/history.js';
import { createSRSFixture, sampleSRSFiles } from './fixture.js';

/**
 * A plausible "application code" file masquerading as markdown. Its
 * ``@srs`` block would be picked up by any scanner that walks the
 * whole parent repo instead of just the SRS root.
 */
const INTRUDER_MD = `# Application module doc

<!--@srs
functional-requirements:
  requirements:
    - req_id: "FR-INTRUDER"
      name: "This should never be seen by the MCP"
      status: "draft"
      priority: "must"
@srs-->

This file lives in the parent repo but outside the SRS root.
`;

test('scope: get_project_state ignores @srs blocks outside the SRS root', async () => {
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    // Plant a markdown file under the parent repo's ``src/`` tree that
    // contains an @srs block. A whole-repo scanner would surface it.
    await fx.writeOutsideSpec('src/app.md', INTRUDER_MD);
    fx.commitAll('intruder: add misplaced @srs block in src/');

    const result = await handleGetProjectState(fx.specRoot, {});
    assert.equal(result.success, true);

    const ids = result.elements.map((e) => e.element_id);
    assert.ok(
      !ids.includes('FR-INTRUDER'),
      `FR-INTRUDER must not be visible to MCP tools; got ${JSON.stringify(ids)}`,
    );

    // Positive control: the real SRS-root elements are still there.
    assert.ok(ids.includes('FR-001'));
    assert.ok(ids.includes('UC-001'));
  } finally {
    await fx.cleanup();
  }
});

test('scope: submit_for_review writes under <specRoot>/reviews/, not parent repo', async () => {
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    const result = await handleSubmitForReview(fx.specRoot, {
      element_id: 'FR-001',
      gate_type: 'content',
    });
    assert.equal(result.success, true);

    // Positive: the record is under the SRS root.
    const expected = path.join(fx.specRoot, 'reviews', 'FR-001', '0001.json');
    const stat = await fs.stat(expected);
    assert.ok(stat.isFile(), `expected review record at ${expected}`);

    // Negative: legacy locations must NOT exist.
    await assert.rejects(
      fs.stat(path.join(fx.root, '.exsrs', 'reviews', 'FR-001', '0001.json')),
      /ENOENT/,
      'review record must not leak into parent repo <root>/.exsrs/reviews/',
    );
    await assert.rejects(
      fs.stat(path.join(fx.root, 'reviews', 'FR-001', '0001.json')),
      /ENOENT/,
      'review record must not leak into parent repo <root>/reviews/',
    );
  } finally {
    await fx.cleanup();
  }
});

test('scope: set_element_status commit does not sweep in parent repo files', async () => {
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    // Populate an unrelated file inside ``src/`` in the parent repo.
    // This file is tracked (it was present at ``commitAll`` time) and
    // then modified — a naive ``git add -A`` inside set_element_status
    // would drag this change into the FR-001 commit.
    await fx.writeOutsideSpec('src/app.ts', 'export const a = 1;\n');
    fx.commitAll('seed app.ts');
    await fx.writeOutsideSpec('src/app.ts', 'export const a = 2;\n');

    // Now drive a status transition on FR-001.
    const result = await handleSetElementStatus(fx.specRoot, {
      element_id: 'FR-001',
      new_status: 'approved',
    });
    assert.equal(result.success, true);
    assert.ok(result.commit_sha, 'expected a commit sha');

    // The commit should touch exactly the SRS file, NOT src/app.ts.
    const changedPaths = fx
      .git(['show', '--name-only', '--pretty=format:', result.commit_sha])
      .trim()
      .split('\n')
      .filter(Boolean);

    assert.ok(
      changedPaths.some((p) => p.endsWith('functional-requirements.md')),
      `expected functional-requirements.md in commit; got ${JSON.stringify(changedPaths)}`,
    );
    assert.ok(
      !changedPaths.some((p) => p === 'src/app.ts'),
      `src/app.ts must not be in the lifecycle commit; got ${JSON.stringify(changedPaths)}`,
    );

    // And the unrelated modification is still unstaged in the work tree,
    // proving the MCP tool did not reach for it.
    const status = fx.git(['status', '--porcelain']).trim();
    assert.match(
      status,
      /src\/app\.ts/,
      'src/app.ts must remain modified (not swept into the commit)',
    );
  } finally {
    await fx.cleanup();
  }
});

test('scope: get_change_log does not return parent-repo-only commits', async () => {
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    // A commit that touches ONLY a parent repo file. get_change_log
    // for FR-001 must not return this commit.
    await fx.writeOutsideSpec('README.md', '# Parent repo readme update\n');
    fx.commitAll('docs: edit parent README');

    // And a commit that touches the SRS file (so the log is not empty).
    const tx = await handleSetElementStatus(fx.specRoot, {
      element_id: 'FR-001',
      new_status: 'approved',
    });
    assert.equal(tx.success, true);

    const result = await handleGetChangeLog(fx.specRoot, {
      element_id: 'FR-001',
    });
    assert.equal(result.success, true);

    // The README commit must NOT appear in the change log.
    const messages = result.changes.map((c) => c.message);
    assert.ok(
      !messages.some((m) => m.includes('edit parent README')),
      `parent-repo-only commit leaked into change log: ${JSON.stringify(messages)}`,
    );

    // Positive: the lifecycle commit IS in the log.
    assert.ok(
      messages.some((m) => m.includes('FR-001')),
      `expected the lifecycle commit in the change log; got ${JSON.stringify(messages)}`,
    );
  } finally {
    await fx.cleanup();
  }
});
