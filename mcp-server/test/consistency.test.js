// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for check_consistency.
 *
 * Focus: P4 — element_id filter must use strict structural matching, not
 * substring search. Two cases that the old substring filter got wrong:
 *   1. Prefix collision (FR-001 vs FR-0010 in the same file)
 *   2. Reference matches (a block whose depends_on lists FR-001 but
 *      whose primary id is something else)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleCheckConsistency } from '../dist/tools/consistency.js';
import { createSRSFixture } from './fixture.js';

const PREFIX_COLLISION_FILES = {
  'srs/fr.md': `# Functional Requirements

<!--@srs
functional-requirements:
  requirements:
    - req_id: "FR-001"
      name: "Auth"
      status: "draft"
@srs-->

FR-001 implements authentication.

<!--@srs
functional-requirements:
  requirements:
    - req_id: "FR-0010"
      name: "Logout"
      status: "draft"
@srs-->

FR-0010 implements logout.
`,
};

test('check_consistency: prefix collision — FR-001 must not match FR-0010', async () => {
  const fx = await createSRSFixture({ files: PREFIX_COLLISION_FILES });
  try {
    const result = await handleCheckConsistency(fx.specRoot, {
      file_path: 'srs/fr.md',
      element_id: 'FR-001',
    });
    assert.equal(result.success, true);
    assert.equal(result.pairs.length, 1, 'should match exactly one block');
    const ids = result.pairs.map(
      (p) => p.yaml['functional-requirements']?.requirements?.[0]?.req_id,
    );
    assert.deepEqual(ids, ['FR-001']);
  } finally {
    await fx.cleanup();
  }
});

test('check_consistency: reference-only mention does not match', async () => {
  const fx = await createSRSFixture({
    files: {
      'srs/fr.md': `# FR

<!--@srs
functional-requirements:
  requirements:
    - req_id: "FR-100"
      name: "Wrapper"
      status: "draft"
      depends_on:
        - "FR-001"
@srs-->

FR-100 wraps FR-001.

<!--@srs
functional-requirements:
  requirements:
    - req_id: "FR-001"
      name: "Auth"
      status: "draft"
@srs-->

FR-001 implements authentication.
`,
    },
  });
  try {
    const result = await handleCheckConsistency(fx.specRoot, {
      file_path: 'srs/fr.md',
      element_id: 'FR-001',
    });
    assert.equal(result.success, true);
    // Only the block whose primary req_id is FR-001 should match;
    // the FR-100 block (which references FR-001 in depends_on) must not.
    assert.equal(result.pairs.length, 1);
    assert.equal(result.pairs[0].yaml['functional-requirements'].requirements[0].req_id, 'FR-001');
  } finally {
    await fx.cleanup();
  }
});

test('check_consistency: returns all pairs when no element_id filter', async () => {
  const fx = await createSRSFixture({ files: PREFIX_COLLISION_FILES });
  try {
    const result = await handleCheckConsistency(fx.specRoot, {
      file_path: 'srs/fr.md',
    });
    assert.equal(result.success, true);
    assert.equal(result.pairs.length, 2);
  } finally {
    await fx.cleanup();
  }
});
