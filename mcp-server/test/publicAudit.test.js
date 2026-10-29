// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createSRSFixture } from './fixture.js';
import { withMCP, document, requirement, manifest } from './mcpClient.js';

test('MCP boundary: a linked Markdown file cannot expose, update or commit an external document', async () => {
  const fx = await createSRSFixture({
    files: { 'srs.md': document({ manifest: manifest(['linked.md']) }) },
  });
  try {
    const outside = document(
      { 'functional-requirements': { requirements: [requirement('FR-OUTSIDE')] } },
      'EXTERNAL_MARKER',
    );
    await fx.writeOutsideSpec('outside.md', outside);
    await fs.symlink('../outside.md', path.join(fx.specRoot, 'linked.md'));
    fx.commitAll('external document and link');
    const head = fx.git(['rev-parse', 'HEAD']).trim();
    await withMCP(
      fx,
      async (call) => {
        for (const [name, args] of [
          ['set_element_status', { new_status: 'approved' }],
          ['approve_element', {}],
          ['reject_element', { reason: 'test' }],
        ]) {
          const result = await call(name, { element_id: 'FR-OUTSIDE', ...args });
          assert.equal(result.success, false, JSON.stringify(result));
        }
        const state = await call('get_project_state');
        assert.equal(state.success, true);
        assert.deepEqual(state.elements, []);
        const validation = await call('validate_extended_srs', { include_files: true });
        assert.equal(validation.success, true);
        assert.deepEqual(
          validation.result.files.map((f) => f.path),
          ['srs.md'],
        );
        const consistency = await call('check_consistency', { file_path: 'linked.md' });
        assert.equal(consistency.success, false);
        assert.ok(!JSON.stringify(consistency).includes('EXTERNAL_MARKER'));
      },
      true,
    );
    assert.equal(await fs.readFile(path.join(fx.root, 'outside.md'), 'utf8'), outside);
    assert.equal(fx.git(['rev-parse', 'HEAD']).trim(), head);
    assert.equal(fx.git(['diff', '--cached', '--name-only']).trim(), '');
  } finally {
    await fx.cleanup();
  }
});

test('MCP boundary: consistency rejects traversal, external absolute paths and linked directories', async () => {
  const fx = await createSRSFixture({
    files: { 'srs.md': document({ manifest: manifest() }, 'INSIDE_MARKER') },
  });
  try {
    await fx.writeOutsideSpec('outside.md', document({ note: 'external' }, 'EXTERNAL_MARKER'));
    await fx.writeOutsideSpec(
      'spec-sibling/outside.md',
      document({ note: 'external' }, 'EXTERNAL_MARKER'),
    );
    await fs.symlink(
      path.join(fx.root, 'spec-sibling'),
      path.join(fx.specRoot, 'linked-dir'),
      'dir',
    );
    await withMCP(fx, async (call) => {
      for (const file_path of [
        '../outside.md',
        path.join(fx.root, 'outside.md'),
        path.join(fx.root, 'spec-sibling/outside.md'),
        'linked-dir/outside.md',
      ]) {
        const result = await call('check_consistency', { file_path });
        assert.equal(result.success, false, file_path);
        assert.ok(!JSON.stringify(result).includes('EXTERNAL_MARKER'));
      }
      for (const file_path of ['srs.md', path.join(fx.specRoot, 'srs.md')]) {
        const result = await call('check_consistency', { file_path });
        assert.equal(result.success, true, JSON.stringify(result));
        assert.equal(result.pairs[0].markdown.trim(), 'INSIDE_MARKER');
      }
    });
  } finally {
    await fx.cleanup();
  }
});

test('MCP concurrency: simultaneous submissions from two servers retain every review with a unique id', async () => {
  const fx = await createSRSFixture({
    files: {
      'srs.md': document({
        manifest: manifest(),
        'functional-requirements': { requirements: [requirement('FR-REVIEW')] },
      }),
    },
  });
  try {
    await withMCP(fx, (first) =>
      withMCP(fx, async (second) => {
        const summaries = Array.from({ length: 12 }, (_, i) => `submission-${i}`);
        const results = await Promise.all(
          summaries.map((summary, i) =>
            (i % 2 ? first : second)('submit_for_review', {
              element_id: 'FR-REVIEW',
              gate_type: 'content',
              summary,
            }),
          ),
        );
        assert.ok(
          results.every((r) => r.success),
          JSON.stringify(results),
        );
        assert.equal(new Set(results.map((r) => r.review_id)).size, summaries.length);
        const history = await first('get_review_history', { element_id: 'FR-REVIEW' });
        assert.deepEqual(
          history.reviews.map((r) => r.review_id).sort((a, b) => a - b),
          summaries.map((_, i) => i + 1),
        );
        assert.deepEqual(history.reviews.map((r) => r.comment).sort(), summaries.sort());
        assert.equal(
          (await fs.readdir(path.join(fx.specRoot, 'reviews/FR-REVIEW'))).length,
          summaries.length,
        );
      }),
    );
  } finally {
    await fx.cleanup();
  }
});

for (const reverse of [false, true]) {
  for (const [name, starting, next, args] of [
    ['set_element_status', 'approved', 'dropped', { new_status: 'dropped' }],
    ['approve_element', 'in_review', 'implemented', {}],
    ['reject_element', 'in_review', 'rejected', { reason: 'revise' }],
  ]) {
    test(`MCP lifecycle: ${name} follows ${reverse ? 'reverse' : 'forward'} manifest order`, async () => {
      const base = reverse ? 'z-base.md' : 'a-base.md';
      const effective = reverse ? 'a-effective.md' : 'z-effective.md';
      const fx = await createSRSFixture({
        files: {
          'srs.md': document({ manifest: manifest([base, effective]) }),
          [base]: document({
            'functional-requirements': { requirements: [requirement('FR-LAYER', 'draft')] },
          }),
          [effective]: document({
            'functional-requirements': { requirements: [requirement('FR-LAYER', starting)] },
          }),
          'zz-unlisted.md': document({
            'functional-requirements': { requirements: [requirement('FR-LAYER', 'verified')] },
          }),
        },
      });
      try {
        const original = await fx.readFile(base);
        const unlisted = await fx.readFile('zz-unlisted.md');
        await withMCP(fx, async (call) => {
          const before = await call('get_project_state');
          assert.equal(before.elements[0].status, starting);
          const changed = await call(name, { element_id: 'FR-LAYER', ...args });
          assert.equal(changed.success, true, JSON.stringify(changed));
          assert.equal(changed.previous_status, starting);
          assert.equal(changed.file, effective);
          const after = await call('get_project_state');
          assert.equal(after.elements[0].status, next);
        });
        assert.equal(await fx.readFile(base), original);
        assert.equal(await fx.readFile('zz-unlisted.md'), unlisted);
      } finally {
        await fx.cleanup();
      }
    });
  }
}

test('MCP lifecycle: repeated definitions in one file update the effective block', async () => {
  const base = document({
    manifest: manifest(),
    'functional-requirements': { requirements: [requirement('FR-LAYER')] },
  });
  const fx = await createSRSFixture({
    files: {
      'srs.md':
        base +
        document({
          'functional-requirements': { requirements: [requirement('FR-LAYER', 'approved')] },
        }),
    },
  });
  try {
    await withMCP(fx, async (call) => {
      const changed = await call('set_element_status', {
        element_id: 'FR-LAYER',
        new_status: 'dropped',
      });
      assert.equal(changed.success, true);
      assert.equal(changed.previous_status, 'approved');
      const after = await call('get_project_state');
      assert.equal(after.elements[0].status, 'dropped');
    });
    assert.ok((await fx.readFile('srs.md')).startsWith(base));
  } finally {
    await fx.cleanup();
  }
});

test('MCP planning: implemented elements with satisfied dependencies are ready for verification', async () => {
  const fx = await createSRSFixture({
    files: {
      'srs.md': document({
        manifest: manifest(),
        'functional-requirements': {
          requirements: [
            requirement('FR-READY', 'implemented'),
            requirement('FR-DONE', 'verified'),
            requirement('FR-PROVIDER'),
            requirement('FR-BLOCKED', 'implemented', ['FR-PROVIDER']),
          ],
        },
      }),
    },
  });
  try {
    await withMCP(fx, async (call) => {
      const ready = await call('get_unblocked_elements', { work_type: 'verify' });
      assert.equal(ready.success, true);
      assert.deepEqual(
        ready.elements.map((e) => [e.element_id, e.ready_for]),
        [['FR-READY', 'verify']],
      );
      const all = await call('get_unblocked_elements');
      assert.ok(all.elements.some((e) => e.element_id === 'FR-READY'));
      const impl = await call('get_unblocked_elements', { work_type: 'impl' });
      assert.deepEqual(impl.elements, []);
    });
  } finally {
    await fx.cleanup();
  }
});

test('MCP lifecycle: a partial definition is updated and unreferenced definitions are not editable', async () => {
  const fx = await createSRSFixture({
    files: {
      'srs.md': document({
        manifest: manifest(['partial.md']),
        'functional-requirements': { requirements: [requirement('FR-001')] },
      }),
      'partial.md': `# Override\n<!--@srs: functional-requirements: requirements[0]\n${JSON.stringify(requirement('FR-001', 'approved'))}\n@srs-->\n`,
      'unlisted.md': document({
        'functional-requirements': { requirements: [requirement('FR-HIDDEN')] },
      }),
    },
  });
  try {
    const entry = await fx.readFile('srs.md');
    const unlisted = await fx.readFile('unlisted.md');
    await withMCP(fx, async (call) => {
      const changed = await call('set_element_status', {
        element_id: 'FR-001',
        new_status: 'dropped',
      });
      assert.equal(changed.success, true, JSON.stringify(changed));
      assert.equal(changed.file, 'partial.md');
      assert.equal(changed.previous_status, 'approved');
      assert.equal((await call('get_project_state')).elements[0].status, 'dropped');
      assert.equal(
        (await call('set_element_status', { element_id: 'FR-HIDDEN', new_status: 'approved' }))
          .success,
        false,
      );
    });
    assert.equal(await fx.readFile('srs.md'), entry);
    assert.equal(await fx.readFile('unlisted.md'), unlisted);
  } finally {
    await fx.cleanup();
  }
});

for (const alreadyTarget of [false, true]) {
  test(`MCP lifecycle: an ambiguous duplicate cannot report success (source already at target: ${alreadyTarget})`, async () => {
    const fx = await createSRSFixture({
      files: {
        'srs.md': document({
          manifest: manifest(['duplicate.md']),
          'functional-requirements': { requirements: [requirement('SHARED-ID')] },
        }),
        'duplicate.md': `# Duplicate\n<!--@srs\nuse-cases:\n  list:\n    - uc_id: SHARED-ID\n      name: ambiguous\n      status: ${alreadyTarget ? 'approved' : 'draft'}\n@srs-->\n`,
      },
    });
    try {
      const before = await fx.readFile('duplicate.md');
      await withMCP(fx, async (call) => {
        const result = await call('set_element_status', {
          element_id: 'SHARED-ID',
          new_status: 'approved',
        });
        assert.equal(result.success, false);
        assert.match(result.error, /Cannot safely update/);
      });
      assert.equal(await fx.readFile('duplicate.md'), before);
    } finally {
      await fx.cleanup();
    }
  });
}

test('MCP validation: presence flags match canonical section keys, including absent sections', async () => {
  const sections = [
    'project-overview',
    'system-architecture',
    'functional-requirements',
    'non-functional-requirements',
    'use-cases',
    'domain-model',
    'constraints',
    'development-implementation',
  ];
  const fx = await createSRSFixture({
    files: {
      'srs.md': document({
        manifest: manifest(),
        ...Object.fromEntries(sections.map((key) => [key, {}])),
      }),
    },
  });
  try {
    await withMCP(fx, async (call) => {
      const complete = await call('validate_extended_srs');
      assert.equal(complete.success, true);
      assert.ok(
        Object.values(complete.result.srsStructure).every(Boolean),
        JSON.stringify(complete.result.srsStructure),
      );
      await fx.writeFile('srs.md', document({ manifest: manifest() }));
      const minimal = await call('validate_extended_srs');
      assert.equal(minimal.result.srsStructure.hasManifest, true);
      assert.ok(
        Object.entries(minimal.result.srsStructure)
          .filter(([key]) => key !== 'hasManifest')
          .every(([, value]) => !value),
      );
    });
  } finally {
    await fx.cleanup();
  }
});
