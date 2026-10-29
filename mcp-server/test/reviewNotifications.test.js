// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  handleSubmitForReview,
  handleApproveReview,
  handleRejectReview,
  handleGetReviewHistory,
} from '../dist/tools/review.js';
import { createSRSFixture, sampleSRSFiles } from './fixture.js';

test('review notifications carry event data and failed delivery preserves review decisions', async (t) => {
  const environment = {
    AGENT_COMMUNICATION_URL: 'https://notifications.example.invalid',
    TEAM_ID: 'test-team',
    PROJECT_ID: 'test-project',
    GIT_AUTH_TOKEN: 'fixture-token',
    AGENT_WORKSPACE_ID: 'test-workspace',
    EXTSRS_AUTO_COMMIT: 'false',
  };
  const original = Object.fromEntries(
    Object.keys(environment).map((key) => [key, process.env[key]]),
  );
  const calls = [];
  let deliveryFails = false;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options, payload: JSON.parse(options.body) });
    if (deliveryFails) {
      throw new Error('Simulated notification outage');
    }
    return new Response(null, { status: 204 });
  });
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    Object.assign(process.env, environment);
    const first = await handleSubmitForReview(fx.specRoot, {
      element_id: 'FR-001',
      gate_type: 'content',
    });
    assert.equal(first.success, true);
    const approval = await handleApproveReview(fx.specRoot, {
      element_id: 'FR-001',
      review_id: first.review_id,
    });
    assert.equal(approval.success, true);

    deliveryFails = true;
    const second = await handleSubmitForReview(fx.specRoot, {
      element_id: 'FR-001',
      gate_type: 'content',
    });
    assert.equal(second.success, true);
    const rejection = await handleRejectReview(fx.specRoot, {
      element_id: 'FR-001',
      review_id: second.review_id,
      reason: 'Needs acceptance criteria',
    });
    assert.equal(rejection.success, true);
    assert.deepEqual(
      calls.map(({ payload }) => payload.type),
      ['review_submitted', 'review_approved', 'review_submitted', 'review_rejected'],
    );
    for (const { url, options, payload } of calls) {
      assert.equal(
        url,
        `${environment.AGENT_COMMUNICATION_URL}/api/test-team/test-project/notifications`,
      );
      assert.equal(options.method, 'POST');
      assert.deepEqual(options.headers, {
        'Content-Type': 'application/json',
        'X-Project-Token': environment.GIT_AUTH_TOKEN,
      });
      assert.ok(options.signal instanceof AbortSignal);
      assert.equal(payload.agentWorkspaceId, 'test-workspace');
      assert.equal(payload.metadata.element_id, 'FR-001');
    }
    assert.deepEqual(calls[0].payload.metadata, {
      element_id: 'FR-001',
      review_id: first.review_id,
      gate_type: 'content',
    });
    assert.deepEqual(calls[3].payload.metadata, {
      element_id: 'FR-001',
      review_id: second.review_id,
      reason: 'Needs acceptance criteria',
    });
    const history = await handleGetReviewHistory(fx.specRoot, { element_id: 'FR-001' });
    assert.deepEqual(
      history.reviews.map((review) => review.status),
      ['approved', 'rejected'],
    );
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await fx.cleanup();
  }
});
