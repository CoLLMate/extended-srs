// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { getProjectState, getUnblockedElements } from 'extended-srs-core';
import { handleSubmitForReview, handleApproveReview } from '../dist/tools/review.js';
import { handleSetElementStatus } from '../dist/tools/lifecycle.js';
import { createSRSFixture } from './fixture.js';
import { document, manifest, requirement, withMCP } from './mcpClient.js';

const srs = (requirements, config = {}) => ({
  manifest: manifest(),
  'functional-requirements': { requirements },
  workflow: { config },
});
const gate = {
  gate_id: 'content-approval',
  gate_type: 'content',
  required_for: ['tentative_to_approved'],
  approver_role: 'product_owner',
  automated_checks: ['type_check_pass'],
  on_approval_status_transition: 'approved',
};
const json = (value) => JSON.parse(JSON.stringify(value));

test('MCP uses the same project and dependency decisions as the public core API', async () => {
  const data = srs([
    requirement('FR-1', 'approved', ['FR-2']),
    requirement('FR-2', 'approved'),
    requirement('FR-3', 'implemented'),
    requirement('FR-4', 'draft', [{ ref_id: 'external', dependency_type: 'soft' }]),
  ]);
  const fx = await createSRSFixture({ files: { 'srs.md': document(data) } });
  try {
    await withMCP(fx, async (call) => {
      assert.deepEqual(
        await call('get_project_state'),
        json({ success: true, ...getProjectState(data) }),
      );
      for (const work_type of ['spec', 'impl', 'verify']) {
        assert.deepEqual(
          await call('get_unblocked_elements', { work_type }),
          json({ success: true, ...getUnblockedElements(data, work_type) }),
        );
      }
      const before = await fx.readFile('srs.md');
      const blocked = await call('set_element_status', {
        element_id: 'FR-1',
        new_status: 'in_progress',
      });
      assert.equal(blocked.success, false);
      assert.match(blocked.error, /Dependencies/);
      assert.equal(await fx.readFile('srs.md'), before);
      assert.equal((await call('get_unblocked_elements', { work_type: 'bad' })).success, false);
    });
  } finally {
    await fx.cleanup();
  }
});

test('MCP enforces configured gate role/checks and applies the configured approval transition', async () => {
  const fx = await createSRSFixture({
    files: {
      'srs.md': document(srs([requirement('FR-1', 'tentative')], { approval_gates: [gate] })),
    },
  });
  try {
    await withMCP(fx, async (call) => {
      const before = await fx.readFile('srs.md');
      const blocked = await call('approve_element', { element_id: 'FR-1' });
      assert.equal(blocked.success, false);
      assert.equal(blocked.required_gate, gate.gate_id);
      const submitted = await call('submit_for_review', {
        element_id: 'FR-1',
        gate_type: 'content',
      });
      assert.equal(submitted.success, true);
      assert.equal(submitted.gate_id, gate.gate_id);
      const args = { element_id: 'FR-1', review_id: submitted.review_id };
      for (const extra of [
        {},
        { approver_role: 'wrong', checks: { type_check_pass: true } },
        { approver_role: 'product_owner', checks: { type_check_pass: false } },
        {
          approver_role: 'product_owner',
          checks: { type_check_pass: true },
          reviewer_role: 'agent',
        },
      ]) {
        assert.equal((await call('approve_review', { ...args, ...extra })).success, false);
        assert.equal(
          (await call('get_review_history', { element_id: 'FR-1' })).reviews[0].status,
          'pending',
        );
        assert.equal(await fx.readFile('srs.md'), before);
      }
      const approved = await call('approve_review', {
        ...args,
        approver_role: 'product_owner',
        checks: { type_check_pass: true },
      });
      assert.equal(approved.success, true, JSON.stringify(approved));
      assert.equal(approved.transition.new_status, 'approved');
      assert.equal((await call('get_project_state')).elements[0].status, 'approved');
      const saved = JSON.parse(await fx.readFile('reviews/FR-1/0001.json'));
      assert.equal(saved.status, 'approved');
      assert.equal(saved.approver_role, 'product_owner');
      assert.equal(saved.checks.type_check_pass, true);
    });
  } finally {
    await fx.cleanup();
  }
});

test('MCP records multiple gate approvals before the final gate performs the transition', async () => {
  const gates = [
    { ...gate, gate_id: 'first', approver_role: undefined, automated_checks: [] },
    { ...gate, gate_id: 'second', approver_role: undefined, automated_checks: [] },
  ];
  const fx = await createSRSFixture({
    files: {
      'srs.md': document(srs([requirement('FR-1', 'tentative')], { approval_gates: gates })),
    },
  });
  try {
    await withMCP(fx, async (call) => {
      assert.equal(
        (await call('submit_for_review', { element_id: 'FR-1', gate_type: 'content' })).success,
        false,
      );
      const first = await call('submit_for_review', {
        element_id: 'FR-1',
        gate_type: 'content',
        gate_id: 'first',
      });
      const second = await call('submit_for_review', {
        element_id: 'FR-1',
        gate_type: 'content',
        gate_id: 'second',
      });
      const initial = await call('approve_review', {
        element_id: 'FR-1',
        review_id: first.review_id,
      });
      assert.equal(initial.success, true, JSON.stringify(initial));
      assert.equal(initial.transition_pending.required_gate, 'second');
      assert.equal((await call('get_project_state')).elements[0].status, 'tentative');
      const final = await call('approve_review', {
        element_id: 'FR-1',
        review_id: second.review_id,
      });
      assert.equal(final.success, true, JSON.stringify(final));
      assert.equal(final.transition.new_status, 'approved');
      assert.deepEqual(
        (await call('get_review_history', { element_id: 'FR-1' })).reviews.map((r) => r.status),
        ['approved', 'approved'],
      );
    });
  } finally {
    await fx.cleanup();
  }
});

test('MCP cannot bypass human gates by skipping tentative or by reusing a stale review', async () => {
  const data = srs([requirement('FR-1')], {
    autonomy_policy: { operations: { status_tentative_to_approved: { gate: true } } },
  });
  const fx = await createSRSFixture({ files: { 'srs.md': document(data) } });
  try {
    await withMCP(fx, async (call) => {
      assert.equal((await call('approve_element', { element_id: 'FR-1' })).success, false);
      const first = await call('submit_for_review', { element_id: 'FR-1', gate_type: 'content' });
      assert.equal(
        (
          await call('approve_review', {
            element_id: 'FR-1',
            review_id: first.review_id,
            reviewer_role: 'agent',
          })
        ).success,
        true,
      );
      assert.equal((await call('approve_element', { element_id: 'FR-1' })).success, false);
      const human = await call('submit_for_review', { element_id: 'FR-1', gate_type: 'content' });
      data['functional-requirements'].requirements[0].name = 'Changed after submission';
      await fx.writeFile('srs.md', document(data));
      const stale = await call('approve_review', {
        element_id: 'FR-1',
        review_id: human.review_id,
      });
      assert.equal(stale.success, false);
      assert.match(stale.error, /stale/);
      const current = await call('submit_for_review', { element_id: 'FR-1', gate_type: 'content' });
      assert.equal(
        (await call('approve_review', { element_id: 'FR-1', review_id: current.review_id }))
          .success,
        true,
      );
      assert.equal((await call('approve_element', { element_id: 'FR-1' })).new_status, 'approved');
    });
  } finally {
    await fx.cleanup();
  }
});

test('MCP work selection respects human approval and caller-supplied dependency evidence', async () => {
  const data = srs(
    [requirement('FR-1', 'approved', [{ ref_id: 'EXT', ref_type: 'external-service' }])],
    { autonomy_policy: { operations: { status_approved_to_in_progress: { gate: true } } } },
  );
  const fx = await createSRSFixture({ files: { 'srs.md': document(data) } });
  try {
    await withMCP(fx, async (call) => {
      const args = { work_type: 'impl', dependency_evidence: { completed: ['EXT'] } };
      assert.deepEqual((await call('get_unblocked_elements', args)).elements, []);
      const review = await call('submit_for_review', { element_id: 'FR-1', gate_type: 'content' });
      await call('approve_review', { element_id: 'FR-1', review_id: review.review_id });
      assert.deepEqual((await call('get_unblocked_elements', { work_type: 'impl' })).elements, []);
      assert.equal((await call('get_unblocked_elements', args)).elements[0].element_id, 'FR-1');
      const started = await call('set_element_status', {
        element_id: 'FR-1',
        new_status: 'in_progress',
        dependency_evidence: args.dependency_evidence,
      });
      assert.equal(started.success, true, JSON.stringify(started));
    });
  } finally {
    await fx.cleanup();
  }
});

test('MCP uses schema transitions and rejects invalid workflow settings before mutation', async () => {
  const data = srs([requirement('FR-1', 'deferred'), requirement('FR-2', 'verified')]);
  const fx = await createSRSFixture({ files: { 'srs.md': document(data) } });
  try {
    await withMCP(fx, async (call) => {
      assert.equal(
        (await call('set_element_status', { element_id: 'FR-1', new_status: 'approved' })).success,
        true,
      );
      assert.equal(
        (await call('set_element_status', { element_id: 'FR-2', new_status: 'dropped' })).success,
        false,
      );
      data.workflow.config = { approval_gates: [{ gate_id: 'bad', gate_type: 'invalid' }] };
      await fx.writeFile('srs.md', document(data));
      const before = await fx.readFile('srs.md');
      assert.equal(
        (await call('set_element_status', { element_id: 'FR-1', new_status: 'approved' })).success,
        false,
      );
      assert.equal(await fx.readFile('srs.md'), before);
      assert.equal(
        (await call('submit_for_review', { element_id: 'FR-1', gate_type: 'content' })).success,
        false,
      );
    });
  } finally {
    await fx.cleanup();
  }
});

test('MCP keeps verification work visible while its completion gate awaits approval', async () => {
  const data = srs([requirement('FR-1', 'implemented')], {
    approval_gates: [
      {
        gate_id: 'verification',
        gate_type: 'verification',
        required_for: ['implemented_to_verified'],
      },
    ],
  });
  const fx = await createSRSFixture({ files: { 'srs.md': document(data) } });
  try {
    await withMCP(fx, async (call) => {
      assert.equal(
        (await call('get_unblocked_elements', { work_type: 'verify' })).elements[0].element_id,
        'FR-1',
      );
      assert.equal((await call('approve_element', { element_id: 'FR-1' })).success, false);
    });
  } finally {
    await fx.cleanup();
  }
});

test('approval reports a concurrent document write as partial completion and allows a safe retry', async (t) => {
  const data = srs([requirement('FR-1', 'tentative')], {
    approval_gates: [{ ...gate, automated_checks: [] }],
  });
  const fx = await createSRSFixture({ files: { 'srs.md': document(data) } });
  try {
    const submitted = await handleSubmitForReview(fx.specRoot, {
      element_id: 'FR-1',
      gate_type: 'content',
    });
    const worker = fileURLToPath(new URL('../dist/io/documentStorageWorker.js', import.meta.url));
    const original = childProcess.execFileSync;
    let replaced = false;
    t.mock.method(childProcess, 'execFileSync', (command, args, options) => {
      if (!replaced && args[0] === worker && JSON.parse(options.input).operation === 'replace') {
        fs.appendFileSync(`${fx.specRoot}/srs.md`, '\nConcurrent prose edit.\n');
        replaced = true;
      }
      return original(command, args, options);
    });
    syncBuiltinESMExports();
    const result = await handleApproveReview(fx.specRoot, {
      element_id: 'FR-1',
      review_id: submitted.review_id,
      approver_role: 'product_owner',
    });
    assert.equal(result.success, false);
    assert.equal(result.review_saved, true);
    assert.match(result.error, /changed concurrently/);
    assert.equal(JSON.parse(await fx.readFile('reviews/FR-1/0001.json')).status, 'approved');
    assert.match(await fx.readFile('srs.md'), /Concurrent prose edit/);
    const retry = await handleSetElementStatus(fx.specRoot, {
      element_id: 'FR-1',
      new_status: 'approved',
    });
    assert.equal(retry.success, true, JSON.stringify(retry));
    assert.match(await fx.readFile('srs.md'), /Concurrent prose edit/);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    await fx.cleanup();
  }
});
