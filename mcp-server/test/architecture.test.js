// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSRSFixture, sampleSRSFiles } from './fixture.js';
import { withMCP, withMCPClient, document, manifest, requirement } from './mcpClient.js';

const requirementDocument = (id, status) =>
  document({
    'functional-requirements': { requirements: [requirement(id, status)] },
  });

for (const separateServers of [false, true]) {
  test(`a review can be resolved only once with ${separateServers ? 'two servers' : 'one server'}`, async (t) => {
    const fx = await createSRSFixture({ files: sampleSRSFiles });
    t.after(() => fx.cleanup());
    await withMCPClient(fx, async (first) => {
      const exercise = async (second) => {
        const submitted = await first.callTool({
          name: 'submit_for_review',
          arguments: { element_id: 'FR-001', gate_type: 'content' },
        });
        const { review_id } = JSON.parse(submitted.content[0].text);
        const args = { element_id: 'FR-001', review_id };
        const replies = await Promise.all([
          first.callTool({ name: 'approve_review', arguments: args }),
          second.callTool({
            name: 'reject_review',
            arguments: { ...args, reason: 'Needs revision' },
          }),
        ]);
        const results = replies.map((reply) => JSON.parse(reply.content[0].text));
        assert.equal(results.filter((result) => result.success).length, 1, JSON.stringify(results));
        const winner = results.find((result) => result.success);
        const loser = replies.find((reply) => !JSON.parse(reply.content[0].text).success);
        assert.equal(loser.isError, true);
        assert.match(JSON.parse(loser.content[0].text).error, /already|concurrent|conflict/i);
        const history = await first.callTool({ name: 'get_review_history', arguments: args });
        const saved = JSON.parse(history.content[0].text).reviews;
        assert.equal(saved.length, 1);
        assert.equal(saved[0].status, winner.status);
      };
      if (separateServers) {
        await withMCPClient(fx, exercise);
      } else {
        await exercise(first);
      }
    });
  });
}

test('status history follows manifest order and effective definitions, just like current state', async (t) => {
  const fx = await createSRSFixture({
    files: {
      'srs.md': document({ manifest: manifest(['a.md', 'b.md']) }),
      'a.md': requirementDocument('FR-001', 'draft'),
      'b.md': requirementDocument('FR-001', 'approved'),
      'ignored.md': requirementDocument('FR-001', 'verified'),
    },
  });
  t.after(() => fx.cleanup());
  await withMCP(fx, async (call) => {
    const changed = await call('set_element_status', {
      element_id: 'FR-001',
      new_status: 'dropped',
    });
    assert.equal(changed.success, true);
    assert.equal(changed.file, 'b.md');
    fx.commitAll('drop effective definition');
    const current = await call('get_project_state');
    const history = await call('get_status_history', { element_id: 'FR-001' });
    assert.deepEqual(
      history.history.map((entry) => entry.status),
      ['approved', 'dropped'],
    );
    assert.equal(history.history.at(-1).status, current.elements[0].status);
    await fx.writeFile('srs.md', document({ manifest: manifest(['b.md', 'a.md']) }));
    fx.commitAll('change manifest precedence');
    const reordered = await call('get_status_history', { element_id: 'FR-001' });
    assert.deepEqual(
      reordered.history.map((entry) => entry.status),
      ['approved', 'dropped', 'draft'],
    );
  });
});

test('status history retains past definitions after the element disappears from current files', async (t) => {
  const fx = await createSRSFixture({
    files: {
      'srs.md': document({ manifest: manifest(['fr.md']) }),
      'fr.md': requirementDocument('FR-001', 'draft'),
    },
  });
  t.after(() => fx.cleanup());
  await fx.writeFile('fr.md', requirementDocument('FR-001', 'approved'));
  fx.commitAll('approve requirement');
  await fx.writeFile('fr.md', '# No remaining definition\n');
  fx.commitAll('remove requirement');
  await withMCP(fx, async (call) => {
    const history = await call('get_status_history', { element_id: 'FR-001' });
    assert.deepEqual(
      history.history.map((entry) => entry.status),
      ['draft', 'approved'],
    );
  });
});

test('consistency keeps adjacent YAML blocks paired with their own following prose', async (t) => {
  const block = (id) =>
    `<!--@srs\n${JSON.stringify({ requirements: [requirement(id)] })}\n@srs-->\n`;
  const fx = await createSRSFixture({
    files: {
      'srs.md': block('FR-A') + block('FR-B') + 'Only FR-B has prose.\n',
    },
  });
  t.after(() => fx.cleanup());
  await withMCP(fx, async (call) => {
    const all = await call('check_consistency', { file_path: 'srs.md' });
    assert.equal(all.total_yaml_blocks, 2);
    assert.equal(all.total_pairs, 1);
    assert.equal(all.pairs[0].index, 1);
    assert.equal(all.pairs[0].yaml.requirements[0].req_id, 'FR-B');
    assert.equal(all.pairs[0].markdown.trim(), 'Only FR-B has prose.');
    const filtered = await call('check_consistency', { file_path: 'srs.md', element_id: 'FR-B' });
    assert.deepEqual(filtered.pairs, all.pairs);
  });
});

test('domain failures and file failures are marked as MCP tool errors', async (t) => {
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  t.after(() => fx.cleanup());
  await withMCPClient(fx, async (client) => {
    for (const [name, args, pattern] of [
      ['set_element_status', { element_id: 'FR-001', new_status: 'banana' }, /Invalid status/],
      ['approve_review', { element_id: 'FR-001', review_id: 999 }, /not found/],
      ['check_consistency', { file_path: 'missing.md' }, /Failed to read/],
    ]) {
      const result = await client.callTool({ name, arguments: args });
      assert.equal(result.isError, true, name);
      const payload = JSON.parse(result.content[0].text);
      assert.equal(payload.success, false);
      assert.match(payload.error, pattern);
    }
    const success = await client.callTool({ name: 'get_project_state', arguments: {} });
    assert.notEqual(success.isError, true);
    assert.equal(JSON.parse(success.content[0].text).success, true);
  });
});
