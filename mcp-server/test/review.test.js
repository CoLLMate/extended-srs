// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for submit_for_review / approve_review / reject_review.
 *
 * Focus areas:
 *   - D2: submit refuses unknown element ids
 *   - P1: review records land under the SRS root (``<specRoot>/reviews/``)
 *         — never in the parent repository's ``.exsrs/reviews/``
 *   - D3: reviewer_role is recorded on resolution
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';

import {
  handleSubmitForReview,
  handleApproveReview,
  handleRejectReview,
  handleGetReviewHistory,
} from '../dist/tools/review.js';
import { createSRSFixture, sampleSRSFiles } from './fixture.js';

test('submit_for_review: writes <specRoot>/reviews/<id>/0001.json and commits', async () => {
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    const result = await handleSubmitForReview(fx.specRoot, {
      element_id: 'FR-001',
      gate_type: 'content',
      summary: 'initial draft ready',
    });
    assert.equal(result.success, true);
    assert.equal(result.review_id, 1);
    assert.ok(result.commit_sha);

    // Reviews live inside the SRS root, not at the parent repo root.
    const recordPath = path.join(fx.specRoot, 'reviews', 'FR-001', '0001.json');
    const stat = await fs.stat(recordPath);
    assert.ok(stat.isFile());

    // Negative control: the legacy location must be empty.
    await assert.rejects(
      fs.stat(path.join(fx.root, '.exsrs', 'reviews', 'FR-001', '0001.json')),
      /ENOENT/,
      'review record must not land at parent-repo .exsrs/reviews/',
    );

    const content = JSON.parse(await fs.readFile(recordPath, 'utf-8'));
    assert.equal(content.status, 'pending');
    assert.equal(content.gate_type, 'content');
  } finally {
    await fx.cleanup();
  }
});

test('submit_for_review: rejects unknown element id', async () => {
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    const result = await handleSubmitForReview(fx.specRoot, {
      element_id: 'FR-999',
      gate_type: 'content',
    });
    assert.equal(result.success, false);
    assert.match(result.error, /not found/);
  } finally {
    await fx.cleanup();
  }
});

test('approve_review: records reviewer_role', async () => {
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    const submit = await handleSubmitForReview(fx.specRoot, {
      element_id: 'FR-001',
      gate_type: 'content',
    });
    assert.equal(submit.success, true);

    const approve = await handleApproveReview(fx.specRoot, {
      review_id: submit.review_id,
      element_id: 'FR-001',
      comment: 'looks good',
      reviewer_role: 'agent',
    });
    assert.equal(approve.success, true);

    // The history reflects the role.
    const hist = await handleGetReviewHistory(fx.specRoot, { element_id: 'FR-001' });
    assert.equal(hist.success, true);
    assert.equal(hist.reviews.length, 1);
    assert.equal(hist.reviews[0].status, 'approved');
    assert.equal(hist.reviews[0].reviewer_role, 'agent');
  } finally {
    await fx.cleanup();
  }
});

test('reject_review: records reviewer_role and defaults to human', async () => {
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    const submit = await handleSubmitForReview(fx.specRoot, {
      element_id: 'FR-001',
      gate_type: 'content',
    });
    const reject = await handleRejectReview(fx.specRoot, {
      review_id: submit.review_id,
      element_id: 'FR-001',
      reason: 'incomplete',
      // no reviewer_role → should default to human
    });
    assert.equal(reject.success, true);

    const hist = await handleGetReviewHistory(fx.specRoot, { element_id: 'FR-001' });
    assert.equal(hist.reviews[0].status, 'rejected');
    assert.equal(hist.reviews[0].reviewer_role, 'human');
  } finally {
    await fx.cleanup();
  }
});

test('reject_review: requires a non-empty reason', async () => {
  // Symmetric with reject_element's contract — dismissing a review must
  // always leave a recorded justification so the audit trail is
  // meaningful.
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    const submit = await handleSubmitForReview(fx.specRoot, {
      element_id: 'FR-001',
      gate_type: 'content',
    });
    assert.equal(submit.success, true);

    // Empty string reason — must fail.
    const emptyReject = await handleRejectReview(fx.specRoot, {
      review_id: submit.review_id,
      element_id: 'FR-001',
      reason: '',
    });
    assert.equal(emptyReject.success, false);
    assert.match(emptyReject.error, /reason is required/);

    // Whitespace-only reason — must also fail.
    const whitespaceReject = await handleRejectReview(fx.specRoot, {
      review_id: submit.review_id,
      element_id: 'FR-001',
      reason: '   \n\t  ',
    });
    assert.equal(whitespaceReject.success, false);
    assert.match(whitespaceReject.error, /reason is required/);

    // The underlying review must still be pending after failed rejects.
    const hist = await handleGetReviewHistory(fx.specRoot, { element_id: 'FR-001' });
    assert.equal(hist.reviews[0].status, 'pending');
  } finally {
    await fx.cleanup();
  }
});

test('approve_review: cannot resolve an already-resolved review', async () => {
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    const submit = await handleSubmitForReview(fx.specRoot, {
      element_id: 'FR-001',
      gate_type: 'content',
    });
    await handleApproveReview(fx.specRoot, {
      review_id: submit.review_id,
      element_id: 'FR-001',
    });

    const second = await handleApproveReview(fx.specRoot, {
      review_id: submit.review_id,
      element_id: 'FR-001',
    });
    assert.equal(second.success, false);
    assert.match(second.error, /already approved/);
  } finally {
    await fx.cleanup();
  }
});
