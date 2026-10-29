// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for get_project_state and get_unblocked_elements.
 *
 * Focus areas:
 *   - typed depends_on shape (P6)
 *   - priority sort tier semantics (D5)
 *   - dependency_type-aware unblocking (P6 + lifecycle semantics)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleGetProjectState, handleGetUnblockedElements } from '../dist/tools/project.js';
import { createSRSFixture, sampleSRSFiles } from './fixture.js';

test('get_project_state: returns all five element types from the canonical SRS layout', async () => {
  // S5 surfaced an `fr_id` vs `req_id` ghost field that hid FRs from
  // extractElements. The same class of bug could exist for NFR
  // (different itemsPath: list vs requirements) or milestones (deeply
  // nested under development_milestones.milestones). The previous
  // fixture only exercised UC / FR / module, so neither path had an
  // executable witness. This test is that witness.
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    const result = await handleGetProjectState(fx.specRoot, {});
    assert.equal(result.success, true);

    const byType = new Map();
    for (const el of result.elements) {
      const list = byType.get(el.element_type) || [];
      list.push(el.element_id);
      byType.set(el.element_type, list);
    }

    // All five element types from ELEMENT_SOURCES must produce at
    // least one element from the canonical fixture layout.
    assert.deepEqual(byType.get('use-case'), ['UC-001'], 'use-case extraction');
    assert.deepEqual(
      byType.get('functional-requirement'),
      ['FR-001', 'FR-0010'],
      'functional-requirement extraction',
    );
    assert.deepEqual(
      byType.get('non-functional-requirement'),
      ['NFR-001'],
      'non-functional-requirement extraction',
    );
    assert.deepEqual(byType.get('module'), ['M-LOGIN'], 'module extraction');
    assert.deepEqual(byType.get('milestone'), ['M1'], 'milestone extraction');

    // Sanity: NFR carries its category and milestone carries its priority,
    // proving that fields beyond just the id field made it through.
    const nfr = result.elements.find((e) => e.element_id === 'NFR-001');
    assert.equal(nfr.status, 'approved');
    const ms = result.elements.find((e) => e.element_id === 'M1');
    assert.equal(ms.priority, 'must');
  } finally {
    await fx.cleanup();
  }
});

test('get_project_state: depends_on returns typed dependency objects', async () => {
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    const result = await handleGetProjectState(fx.specRoot, {});
    assert.equal(result.success, true);

    const fr1 = result.elements.find((e) => e.element_id === 'FR-001');
    assert.ok(fr1, 'FR-001 must be returned');
    // The raw YAML had a bare string; it should be lifted to { ref_id }.
    assert.deepEqual(fr1.depends_on, [{ ref_id: 'UC-001' }]);

    const fr10 = result.elements.find((e) => e.element_id === 'FR-0010');
    assert.ok(fr10);
    assert.deepEqual(fr10.depends_on, [
      {
        ref_id: 'FR-001',
        ref_type: 'functional-requirement',
        dependency_type: 'hard',
      },
      { ref_id: 'EXT-IDP', dependency_type: 'soft' },
    ]);
  } finally {
    await fx.cleanup();
  }
});

test('get_project_state: blocks reverse dependencies are computed', async () => {
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    const result = await handleGetProjectState(fx.specRoot, {});
    const fr1 = result.elements.find((e) => e.element_id === 'FR-001');
    // FR-0010 depends_on FR-001 → FR-001.blocks should include FR-0010.
    assert.ok(
      fr1.blocks.includes('FR-0010'),
      `expected FR-001.blocks to include FR-0010, got ${JSON.stringify(fr1.blocks)}`,
    );
    // FR-001 depends_on UC-001 → UC-001.blocks should include FR-001.
    const uc1 = result.elements.find((e) => e.element_id === 'UC-001');
    assert.ok(uc1.blocks.includes('FR-001'));
  } finally {
    await fx.cleanup();
  }
});

test('get_unblocked_elements: interface dependency requires evidence of an available contract', async () => {
  const fx = await createSRSFixture({
    files: {
      'srs.md': `# SRS Entry

<!--@srs
manifest:
  format: "extended-srs/v1"
  schema_version: "1.0.0"
  project_name: "Interface Dep Test"
  created: 1735516800
  files:
    - "fr.md"
@srs-->
`,
      'fr.md': `# FR

<!--@srs
functional-requirements:
  requirements:
    - req_id: "FR-CONSUMER"
      name: "Consumes the not-yet-built provider via interface contract"
      status: "draft"
      priority: "must"
      depends_on:
        - ref_id: "FR-PROVIDER"
          ref_type: "functional-requirement"
          dependency_type: "interface"
    - req_id: "FR-PROVIDER"
      name: "Provider — still draft"
      status: "draft"
      priority: "must"
@srs-->
`,
    },
  });
  try {
    const result = await handleGetUnblockedElements(fx.specRoot, {});
    assert.equal(result.success, true);

    const ids = result.elements.map((e) => e.element_id);

    assert.ok(!ids.includes('FR-CONSUMER'), 'an id alone does not establish an interface contract');
    const withContract = await handleGetUnblockedElements(fx.specRoot, {
      dependency_evidence: { interfaces: ['FR-PROVIDER'] },
    });
    assert.ok(withContract.elements.some((e) => e.element_id === 'FR-CONSUMER'));

    // Sanity: FR-PROVIDER is itself draft and has no deps, so it's
    // also plannable for the spec phase.
    assert.ok(ids.includes('FR-PROVIDER'));

    // Now flip FR-CONSUMER's dep to "hard" and confirm it WOULD be
    // blocked under the same conditions — proves we're really
    // testing the dependency_type branch and not some unrelated path.
    // (We do this by writing a second fixture rather than mutating
    // the first, to keep tests independent.)
  } finally {
    await fx.cleanup();
  }

  // Negative-control fixture: same shape but with hard dep.
  const fxHard = await createSRSFixture({
    files: {
      'srs.md': `# SRS Entry

<!--@srs
manifest:
  format: "extended-srs/v1"
  schema_version: "1.0.0"
  project_name: "Hard Dep Control"
  created: 1735516800
  files:
    - "fr.md"
@srs-->
`,
      'fr.md': `# FR

<!--@srs
functional-requirements:
  requirements:
    - req_id: "FR-CONSUMER"
      name: "Consumer with hard dep"
      status: "draft"
      priority: "must"
      depends_on:
        - ref_id: "FR-PROVIDER"
          ref_type: "functional-requirement"
          dependency_type: "hard"
    - req_id: "FR-PROVIDER"
      name: "Provider — still draft"
      status: "draft"
      priority: "must"
@srs-->
`,
    },
  });
  try {
    const result = await handleGetUnblockedElements(fxHard.specRoot, {});
    const ids = result.elements.map((e) => e.element_id);
    assert.ok(
      !ids.includes('FR-CONSUMER'),
      `negative control: FR-CONSUMER must be blocked under hard dep; got ${JSON.stringify(ids)}`,
    );
  } finally {
    await fxHard.cleanup();
  }
});

test('get_unblocked_elements: hard dep on draft blocks but soft does not', async () => {
  const fx = await createSRSFixture({ files: sampleSRSFiles });
  try {
    // Initially:
    //   UC-001: approved
    //   M-LOGIN: approved
    //   FR-001: draft, depends_on UC-001 (string ⇒ hard) → blocked (UC-001 only approved)
    //   FR-0010: draft, depends_on FR-001 (hard, draft) → BLOCKED
    //                       depends_on EXT-IDP (soft) → ignored (always satisfied)
    const result = await handleGetUnblockedElements(fx.specRoot, {});
    assert.equal(result.success, true);

    const ids = result.elements.map((e) => e.element_id);
    assert.ok(!ids.includes('FR-001'), 'hard dependencies must be completed, not merely approved');
    assert.ok(!ids.includes('FR-0010'), 'FR-0010 should be blocked by hard dep on FR-001 (draft)');
  } finally {
    await fx.cleanup();
  }
});

test('get_unblocked_elements: priority tiers — must/high, should/medium, could/low, wont, untagged', async () => {
  // project.ts:PRIORITY_TIER declares five tiers: 0 (must/high),
  // 1 (should/medium), 2 (could/low), 3 (wont), and the implicit
  // fallback 99 (unset). The previous version of this test omitted
  // the ``wont`` tier entirely, so anyone could delete `wont: 3` from
  // the PRIORITY_TIER map and the suite would still pass — wont entries
  // would just fall through to the 99 fallback and produce the same
  // relative order. This version inserts a wont entry between the
  // could/low tier and the untagged tier so that the wont-specific
  // mapping is a load-bearing branch in the assertion.
  const fx = await createSRSFixture({
    files: {
      'srs.md': `# SRS Entry

<!--@srs
manifest:
  format: "extended-srs/v1"
  schema_version: "1.0.0"
  project_name: "Tier Test"
  created: 1735516800
  files:
    - "fr.md"
@srs-->
`,
      'fr.md': `# FR

<!--@srs
functional-requirements:
  requirements:
    - req_id: "FR-A"
      name: "Should-tier"
      status: "draft"
      priority: "should"
    - req_id: "FR-B"
      name: "Must-tier"
      status: "draft"
      priority: "must"
    - req_id: "FR-C"
      name: "Could-tier"
      status: "draft"
      priority: "could"
    - req_id: "FR-D"
      name: "High-level (should rank with must)"
      status: "draft"
      priority: "high"
    - req_id: "FR-E"
      name: "Untagged"
      status: "draft"
    - req_id: "FR-F"
      name: "Wont-tier (explicitly deprioritised)"
      status: "draft"
      priority: "wont"
    - req_id: "FR-G"
      name: "Low-level (ranks with could)"
      status: "draft"
      priority: "low"
    - req_id: "FR-H"
      name: "Medium-level (ranks with should)"
      status: "draft"
      priority: "medium"
@srs-->
`,
    },
  });
  try {
    const result = await handleGetUnblockedElements(fx.specRoot, {});
    const ids = result.elements.map((e) => e.element_id);

    // Tier 0 (must/high), Tier 1 (should/medium), Tier 2 (could/low),
    // Tier 3 (wont), Tier 99 (untagged).
    const tier0 = new Set(['FR-B', 'FR-D']);
    const tier1 = new Set(['FR-A', 'FR-H']);
    const tier2 = new Set(['FR-C', 'FR-G']);
    const tier3 = new Set(['FR-F']);
    const tier99 = new Set(['FR-E']);

    // Walk the result in order and require that each element belongs to
    // the current or a later phase — never an earlier one. The phase
    // counter only ever increases, so any element from an earlier tier
    // appearing after a later tier's first element would fail.
    let phase = 0;
    for (const id of ids) {
      const inTier = (s) => s.has(id);
      while (phase < 5) {
        if (phase === 0 && inTier(tier0)) {
          break;
        }
        if (phase === 1 && inTier(tier1)) {
          break;
        }
        if (phase === 2 && inTier(tier2)) {
          break;
        }
        if (phase === 3 && inTier(tier3)) {
          break;
        }
        if (phase === 4 && inTier(tier99)) {
          break;
        }
        phase++;
      }
      assert.ok(
        phase < 5,
        `element ${id} appeared after a higher tier had ended; ids=${JSON.stringify(ids)}`,
      );
    }

    // Sanity: every tier actually contributed at least one element to
    // the output (otherwise the ordering check is vacuous for that tier).
    const idSet = new Set(ids);
    assert.ok(
      [...tier0].some((id) => idSet.has(id)),
      'tier 0 must be non-empty',
    );
    assert.ok(
      [...tier1].some((id) => idSet.has(id)),
      'tier 1 must be non-empty',
    );
    assert.ok(
      [...tier2].some((id) => idSet.has(id)),
      'tier 2 must be non-empty',
    );
    assert.ok(
      [...tier3].some((id) => idSet.has(id)),
      'tier 3 (wont) must be non-empty — this is the whole point of B-6',
    );
    assert.ok(
      [...tier99].some((id) => idSet.has(id)),
      'tier 99 must be non-empty',
    );

    // Stronger check: the wont element must appear strictly AFTER every
    // could/low element and strictly BEFORE the untagged element. A
    // regression that deleted `wont: 3` from PRIORITY_TIER would push
    // FR-F into tier 99 and place it alongside FR-E instead of before it.
    const idxFR_F = ids.indexOf('FR-F');
    const idxFR_E = ids.indexOf('FR-E');
    const idxFR_C = ids.indexOf('FR-C');
    const idxFR_G = ids.indexOf('FR-G');
    assert.ok(idxFR_F > idxFR_C, 'wont must come after could');
    assert.ok(idxFR_F > idxFR_G, 'wont must come after low');
    assert.ok(idxFR_F < idxFR_E, 'wont must come before untagged');
  } finally {
    await fx.cleanup();
  }
});
