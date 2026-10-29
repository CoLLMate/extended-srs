// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
/**
 * element_id is used as a path segment under <SRS root>/reviews/. Values
 * that could escape that directory must be rejected by every review handler,
 * before anything is read or written.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';

import {
  handleGetReviewHistory,
  handleApproveReview,
  handleRejectReview,
  handleSubmitForReview,
} from '../dist/tools/review.js';
import { createSRSFixture, sampleSRSFiles } from './fixture.js';

test('review handlers reject element_id values that escape reviews/', async () => {
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    // A JSON file outside reviews/ that a traversal would otherwise read or rewrite.
    const outside = path.join(fx.root, 'outside');
    await fs.mkdir(outside, { recursive: true });
    const record = path.join(outside, '0001.json');
    await fs.writeFile(
      record,
      JSON.stringify({ review_id: 1, element_id: 'x', status: 'pending' }),
      'utf-8',
    );

    for (const escaping of [
      '../../outside',
      '..',
      '.',
      'FR-001/../../outside',
      '/outside',
      'a\\b',
      'a\0b',
      '',
      null,
      undefined,
      0,
      {},
      [],
    ]) {
      const history = await handleGetReviewHistory(fx.specRoot, { element_id: escaping });
      assert.equal(
        history.success,
        false,
        `get_review_history accepted ${JSON.stringify(escaping)}`,
      );
      assert.match(history.error, /element_id/);

      const approve = await handleApproveReview(fx.specRoot, {
        element_id: escaping,
        review_id: 1,
      });
      assert.equal(approve.success, false, `approve_review accepted ${JSON.stringify(escaping)}`);
      assert.match(approve.error, /element_id/);

      const reject = await handleRejectReview(fx.specRoot, {
        element_id: escaping,
        review_id: 1,
        reason: 'no',
      });
      assert.equal(reject.success, false, `reject_review accepted ${JSON.stringify(escaping)}`);
      assert.match(reject.error, /element_id/);

      const submit = await handleSubmitForReview(fx.specRoot, {
        element_id: escaping,
        gate_type: 'content',
      });
      assert.equal(submit.success, false, `submit_for_review accepted ${JSON.stringify(escaping)}`);
      assert.match(submit.error, /element_id/);
    }

    // The file outside reviews/ was neither treated as a review nor modified.
    assert.equal(JSON.parse(await fs.readFile(record, 'utf-8')).status, 'pending');

    // Ordinary ids keep working.
    const ok = await handleGetReviewHistory(fx.specRoot, { element_id: 'FR-001' });
    assert.equal(ok.success, true);
  } finally {
    await fx.cleanup();
  }
});

for (const kind of ['reviews directory', 'element directory', 'record file']) {
  for (const dangling of [false, true]) {
    test(`review handlers reject a ${dangling ? 'dangling ' : ''}symlink at the ${kind}`, async () => {
      const fx = await createSRSFixture({ files: sampleSRSFiles });
      try {
        const outside = path.join(fx.root, 'outside');
        const record = JSON.stringify({
          review_id: 1,
          element_id: 'FR-001',
          status: 'pending',
          summary: 'outside the SRS root',
        });
        await fs.mkdir(path.join(outside, 'FR-001'), { recursive: true });
        const outsideFile = path.join(outside, 'FR-001', '0001.json');
        await fs.writeFile(outsideFile, record);

        let link = path.join(fx.specRoot, 'reviews');
        let target = outside;
        if (kind === 'element directory') {
          link = path.join(link, 'FR-001');
          target = path.join(outside, 'FR-001');
        } else if (kind === 'record file') {
          link = path.join(link, 'FR-001', '0001.json');
          target = outsideFile;
        }
        if (dangling) {
          target = path.join(outside, 'missing');
        }
        await fs.mkdir(path.dirname(link), { recursive: true });
        await fs.symlink(
          path.relative(path.dirname(link), target),
          link,
          kind === 'record file' ? 'file' : 'dir',
        );

        const head = fx.git(['rev-parse', 'HEAD']).trim();
        const calls = [
          () => handleGetReviewHistory(fx.specRoot, { element_id: 'FR-001' }),
          () => handleApproveReview(fx.specRoot, { element_id: 'FR-001', review_id: 1 }),
          () =>
            handleRejectReview(fx.specRoot, { element_id: 'FR-001', review_id: 1, reason: 'no' }),
          () => handleSubmitForReview(fx.specRoot, { element_id: 'FR-001', gate_type: 'content' }),
        ];
        for (const call of calls) {
          await assert.rejects(call, /Unsafe review path.*symbolic link/);
          assert.equal(await fs.readFile(outsideFile, 'utf-8'), record);
          assert.deepEqual(await fs.readdir(path.dirname(outsideFile)), ['0001.json']);
          assert.equal(fx.git(['rev-parse', 'HEAD']).trim(), head);
        }
        if (dangling) {
          await assert.rejects(fs.lstat(target), { code: 'ENOENT' });
        }
      } finally {
        await fx.cleanup();
      }
    });
  }
}

test('review handlers accept a symlink used to select the SRS root', async () => {
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    const rootAlias = path.join(fx.root, 'spec-alias');
    await fs.symlink(fx.specRoot, rootAlias, 'dir');
    const submitted = await handleSubmitForReview(rootAlias, {
      element_id: 'FR-001',
      gate_type: 'content',
    });
    assert.equal(submitted.success, true);
    const approved = await handleApproveReview(rootAlias, {
      element_id: 'FR-001',
      review_id: submitted.review_id,
    });
    assert.equal(approved.success, true);
    const history = await handleGetReviewHistory(rootAlias, { element_id: 'FR-001' });
    assert.equal(history.success, true);
    assert.equal(history.reviews[0].status, 'approved');
    assert.equal(JSON.parse(await fx.readFile('reviews/FR-001/0001.json')).status, 'approved');
  } finally {
    await fx.cleanup();
  }
});
