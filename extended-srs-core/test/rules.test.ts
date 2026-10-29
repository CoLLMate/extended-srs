// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import common from '../../schema/schemas/common-definitions-schema.json';
import workflow from '../../schema/schemas/workflow-schema.json';
import {
  LIFECYCLE_STATES,
  GATE_TYPES,
  AUTOMATED_CHECKS,
  allowedTransitions,
  assertLifecycleTransition,
  approvalTarget,
  rejectionTarget,
  getProjectState,
  getUnblockedElements,
  extractElements,
  unmetDependencies,
  createReview,
  resolveReview,
  getReviewHistory,
  getWorkflowConfig,
  reviewSubject,
  selectApprovalGate,
  assertWorkflowTransition,
  canAutoApprove,
  findElementById,
  containsElementById,
  findElementStatus,
  planElementStatusChange,
  type ReviewRecord,
} from '../src';

const requirement = (id: string, status = 'draft', depends_on: any[] = []) => ({
  req_id: id,
  name: id,
  status,
  depends_on,
});
const project = (requirements: any[] = [requirement('FR-1')], config: any = {}) => ({
  'functional-requirements': { requirements },
  workflow: { config },
});
const metadata = { actor: 'tester', timestamp: '2026-10-28T00:00:00Z' };
const contentGate = {
  gate_id: 'content',
  gate_type: 'content',
  required_for: ['tentative_to_approved'],
  approver_role: 'product_owner',
  on_approval_status_transition: 'approved',
  automated_checks: ['type_check_pass'],
};
const submit = (srs: any, id = 1) =>
  createReview(srs, { element_id: 'FR-1', gate_type: 'content' }, { ...metadata, id });
const approve = (srs: any, pending: ReviewRecord, args: any = {}) =>
  resolveReview(
    srs,
    [pending],
    { element_id: 'FR-1', review_id: pending.review_id, ...args },
    'approved',
    metadata,
  ).review;
const doc = (data: any) =>
  `# Title\n\n<!--@srs\n${JSON.stringify(data)}\n@srs-->\n\nBody unchanged.\n`;

describe('schema lifecycle conformance', () => {
  it('uses schema enums and exactly implements the documented transition graph', () => {
    expect(LIFECYCLE_STATES).toEqual(common.definitions.status.enum);
    expect(GATE_TYPES).toEqual(workflow.definitions.approvalGateConfig.properties.gate_type.enum);
    expect(AUTOMATED_CHECKS).toEqual(
      workflow.definitions.approvalGateConfig.properties.automated_checks.items.enum,
    );
    const arrows = common['x-docs'].definition.flatMap((line) => {
      const match = line.trim().match(/^(\w+) --> (\w+)$/);
      return match ? [[match[1], match[2]]] : [];
    });
    for (const from of LIFECYCLE_STATES) {
      expect([...allowedTransitions(from)].sort()).toEqual(
        arrows
          .filter(([a]) => a === from)
          .map(([, b]) => b)
          .sort(),
      );
      for (const to of LIFECYCLE_STATES) {
        const action = () =>
          assertLifecycleTransition(
            project([requirement('FR-1', from)]),
            'FR-1',
            from,
            to,
            'reason',
          );
        // §2.1 explicitly permits skipping tentative according to gate settings.
        if (
          from === to ||
          arrows.some(([a, b]) => a === from && b === to) ||
          (from === 'draft' && to === 'approved')
        ) {
          expect(action).not.toThrow();
        } else {
          expect(action).toThrow(/not allowed/);
        }
      }
    }
  });
  it('does not repair invalid states by bypassing rules, and requires rejection reasons', () => {
    expect(allowedTransitions('constructor')).toEqual([]);
    expect(() => assertLifecycleTransition({}, 'X', 'banana', 'approved')).toThrow(
      /current status/,
    );
    expect(() => assertLifecycleTransition({}, 'X', 'draft', 'banana')).toThrow(/Invalid status/);
    expect(() => assertLifecycleTransition({}, 'X', 'in_review', 'rejected')).toThrow(/reason/);
    expect(() => approvalTarget('unknown')).toThrow(/current status/);
    expect(() => rejectionTarget('draft', ' ')).toThrow(/reason/);
    expect(rejectionTarget('rejected', 'revise')).toBe('draft');
    expect(rejectionTarget('in_review', 'revise')).toBe('rejected');
    for (const [from, to] of [
      ['draft', 'approved'],
      ['tentative', 'approved'],
      ['in_progress', 'in_review'],
      ['in_review', 'implemented'],
      ['implemented', 'verified'],
      ['blocked', 'in_progress'],
      ['rejected', 'draft'],
      ['verified', 'verified'],
      ['approved', 'approved'],
      ['deferred', 'deferred'],
    ]) {
      expect(approvalTarget(from)).toBe(to);
    }
  });
  it('applies gates even when draft skips tentative', () => {
    const srs = project(undefined, {
      autonomy_policy: { operations: { status_tentative_to_approved: { gate: true } } },
    });
    expect(() => assertLifecycleTransition(srs, 'FR-1', 'draft', 'approved')).toThrow(
      /Human approval/,
    );
    const approved = approve(srs, submit(srs));
    expect(() =>
      assertLifecycleTransition(srs, 'FR-1', 'draft', 'approved', undefined, {
        reviews: [approved],
      }),
    ).not.toThrow();
  });
});

describe('dependency and work selection', () => {
  it('requires a completed hard dependency for selection and entry into implementation', () => {
    for (const status of [...LIFECYCLE_STATES, 'unknown']) {
      const srs = project([requirement('FR-1', 'approved', ['FR-2']), requirement('FR-2', status)]);
      const satisfied = status === 'implemented' || status === 'verified';
      expect(getUnblockedElements(srs, 'impl').elements.some((e) => e.element_id === 'FR-1')).toBe(
        satisfied,
      );
      const enter = () => assertLifecycleTransition(srs, 'FR-1', 'approved', 'in_progress');
      if (satisfied) {
        expect(enter).not.toThrow();
      } else {
        expect(enter).toThrow(/Dependencies/);
      }
    }
  });
  it('distinguishes mockable, unresolved external, typed and contract-only dependencies', () => {
    const srs: any = project([
      requirement('FR-1', 'approved', [
        { ref_id: 'EXT', dependency_type: 'soft' },
        { ref_id: 'M', ref_type: 'module', dependency_type: 'interface' },
      ]),
    ]);
    const element = extractElements(srs)[0];
    expect(unmetDependencies(srs, element).map((d) => d.ref_id)).toEqual(['M']);
    expect(unmetDependencies(srs, element, { interfaces: ['M'] })).toEqual([]);
    srs['system-architecture'] = {
      architecture: {
        key_components: {
          components: [
            {
              component_id: 'C',
              modules: [
                {
                  module_id: 'M',
                  status: 'draft',
                  provided_interfaces: [
                    {
                      interface_id: 'API',
                      version: '1',
                      interface_type: 'http-api',
                      definition: { type: 'http-api', path: '/items', method: 'GET' },
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    };
    expect(unmetDependencies(srs, element)).toEqual([]);
    const module = srs['system-architecture'].architecture.key_components.components[0].modules[0];
    const contract = module.provided_interfaces[0];
    contract.definition.request_schema = { type: 'object', properties: { id: { type: 'string' } } };
    expect(unmetDependencies(srs, element)).toEqual([]);
    contract.interface_type = 'grpc';
    expect(unmetDependencies(srs, element).map((d) => d.ref_id)).toEqual(['M']);
    contract.interface_type = 'http-api';
    contract.definition.request_schema = { type: 123 };
    expect(unmetDependencies(srs, element).map((d) => d.ref_id)).toEqual(['M']);
    module.provided_interfaces = [{ interface_id: 'API' }];
    expect(unmetDependencies(srs, element).map((d) => d.ref_id)).toEqual(['M']);
    srs['functional-requirements'].requirements[0].depends_on = ['MISSING'];
    expect(getUnblockedElements(srs, 'impl').elements).toEqual([]);
    expect(getUnblockedElements(srs, 'impl', { completed: ['MISSING'] }).elements).toHaveLength(1);
    for (const bad of [
      null,
      [],
      { completed: 'MISSING' },
      { interfaces: [null] },
      { completed: [''] },
      { unknown: [] },
    ]) {
      expect(() => getUnblockedElements(srs, 'impl', bad as any)).toThrow(/dependency_evidence/);
    }
    srs['functional-requirements'].requirements[0].depends_on = [
      { ref_id: 'M', ref_type: 'functional-requirement' },
    ];
    expect(getUnblockedElements(srs, 'impl').elements).toEqual([]);
  });
  it('returns canonical element types, recomputes reverse edges, and leaves input unchanged', () => {
    const srs: any = project([requirement('FR-1', 'draft', ['UC']), { name: 'no id' }, null]);
    srs['use-cases'] = { list: [{ uc_id: 'UC', title: 'Use case', blocks: ['stale'] }] };
    srs['non-functional-requirements'] = { list: [{ req_id: 'NFR', status: 'implemented' }] };
    srs['system-architecture'] = {
      architecture: { key_components: { components: [{ modules: [{ module_id: 'M' }] }, {}] } },
    };
    srs['development-implementation'] = {
      development_milestones: { milestones: [{ milestone_id: 'MS', status: 'tentative' }] },
    };
    const before = JSON.stringify(srs);
    const state = getProjectState(srs);
    expect(state.elements.map((e) => e.element_type)).toEqual([
      'use-case',
      'functional-requirement',
      'non-functional-requirement',
      'module',
      'milestone',
    ]);
    expect(state.elements[0].blocks).toEqual(['FR-1']);
    expect(state.elements.at(-1)?.pending_review).toBe(true);
    expect(getProjectState(srs, ['implemented']).summary).toEqual({
      total: 1,
      by_status: { implemented: 1 },
    });
    expect(JSON.stringify(srs)).toBe(before);
    expect(extractElements(undefined)).toEqual([]);
    expect(extractElements({ 'use-cases': { list: 'bad' } })).toEqual([]);
  });
  it('normalizes dependencies, rejects invalid work type and selects phases by priority', () => {
    const requirements = [
      'unknown',
      'wont',
      'low',
      'could',
      'medium',
      'should',
      'high',
      'must',
    ].map((priority, i) => ({ ...requirement(`FR-${i}`), priority }));
    const srs = project(requirements);
    expect(getUnblockedElements(srs).elements.map((e) => e.priority)).toEqual([
      'high',
      'must',
      'medium',
      'should',
      'low',
      'could',
      'wont',
      'unknown',
    ]);
    expect(() => getUnblockedElements(srs, 'other')).toThrow(/work_type/);
    srs['functional-requirements'].requirements = [
      requirement('FR-1', 'implemented'),
      requirement('FR-2', 'rejected'),
      requirement('FR-3', 'blocked'),
    ];
    expect(getUnblockedElements(srs, 'verify').elements.map((e) => e.element_id)).toEqual(['FR-1']);
    expect(getUnblockedElements(srs, 'impl').elements.map((e) => e.element_id)).toEqual(['FR-3']);
    srs['functional-requirements'].requirements = [
      requirement('FR-1', 'draft', [
        null,
        {},
        3,
        'A',
        { ref_id: 'B', ref_type: 'module', dependency_type: 'invalid' },
      ]),
    ];
    expect(extractElements(srs)[0].depends_on).toEqual([
      { ref_id: 'A' },
      { ref_id: 'B', ref_type: 'module' },
    ]);
  });
});

describe('workflow and review policy', () => {
  it('validates config and gate selection instead of silently ignoring malformed policy', () => {
    for (const bad of [
      null,
      { approval_gates: [{ gate_id: 'x', gate_type: 'spec' }] },
      { autonomy_policy: { default_gate: 'yes' } },
    ]) {
      expect(() => getWorkflowConfig(project(undefined, bad))).toThrow(/Invalid workflow/);
    }
    for (const bad of [null, [], 'bad']) {
      expect(() => getWorkflowConfig({ workflow: bad })).toThrow(/Invalid workflow/);
    }
    expect(() =>
      getWorkflowConfig(project(undefined, { approval_gates: [contentGate, contentGate] })),
    ).toThrow(/unique/);
    expect(() =>
      getWorkflowConfig(project(undefined, { approval_gates: [{ ...contentGate, gate_id: ' ' }] })),
    ).toThrow(/unique/);
    const config: any = { approval_gates: [contentGate, { ...contentGate, gate_id: 'another' }] };
    expect(() => selectApprovalGate(config, 'content')).toThrow(/specify gate_id/);
    expect(selectApprovalGate(config, 'content', 'another')?.gate_id).toBe('another');
    expect(() => selectApprovalGate(config, 'content', 'absent')).toThrow(/Unknown/);
    expect(() => selectApprovalGate({}, 'spec')).toThrow(/gate_type/);
  });
  it('requires role, successful checks and current approval before a gated transition', () => {
    const srs = project([requirement('FR-1', 'tentative')], { approval_gates: [contentGate] });
    const pending = submit(srs);
    expect(() => approve(srs, pending)).toThrow(/approver_role/);
    expect(() => approve(srs, pending, { approver_role: 'product_owner' })).toThrow(/checks/);
    expect(() =>
      approve(srs, pending, { approver_role: 'product_owner', checks: { type_check_pass: false } }),
    ).toThrow(/checks/);
    expect(() =>
      approve(srs, pending, {
        approver_role: 'product_owner',
        checks: { type_check_pass: true },
        reviewer_role: 'agent',
      }),
    ).toThrow(/human review/);
    const approved = approve(srs, pending, {
      approver_role: 'product_owner',
      checks: { type_check_pass: true },
    });
    expect(() => assertWorkflowTransition(srs, 'FR-1', 'tentative', 'approved')).toThrow(
      /Approval required/,
    );
    expect(() =>
      assertWorkflowTransition(srs, 'FR-1', 'tentative', 'approved', { reviews: [approved] }),
    ).not.toThrow();
    expect(() =>
      assertWorkflowTransition(srs, 'FR-1', 'tentative', 'approved', {
        reviews: [approved, submit(srs, 2)],
      }),
    ).toThrow(/Approval required/);
    srs['functional-requirements'].requirements[0].name = 'changed';
    expect(() =>
      assertWorkflowTransition(srs, 'FR-1', 'tentative', 'approved', { reviews: [approved] }),
    ).toThrow(/Approval required/);
    expect(() => approve(srs, pending)).toThrow(/stale/);
  });
  it('supports explicit condition evaluators and never evaluates strings as code', () => {
    const gate: any = { ...contentGate, auto_approve_conditions: ['caller says low risk'] };
    const srs = project([requirement('FR-1', 'tentative')], { approval_gates: [gate] });
    const checks = { type_check_pass: true };
    expect(canAutoApprove(gate, checks, {})).toBe(false);
    expect(canAutoApprove(gate, checks, { evaluateCondition: () => false })).toBe(false);
    const context = {
      evaluateCondition: (condition: string) => condition === 'caller says low risk',
    };
    const resolved = resolveReview(
      srs,
      [submit(srs)],
      {
        element_id: 'FR-1',
        review_id: 1,
        reviewer_role: 'agent',
        approver_role: 'product_owner',
        checks,
      },
      'approved',
      metadata,
      context,
    );
    expect(resolved.new_status).toBe('approved');
    expect(() =>
      assertWorkflowTransition(srs, 'FR-1', 'tentative', 'approved', {
        ...context,
        reviews: [resolved.review],
      }),
    ).not.toThrow();
    const conditional = project(undefined, {
      autonomy_policy: {
        operations: {
          status_draft_to_tentative: { gate: false, conditions: ['priority == must'] },
        },
      },
    });
    expect(() => assertWorkflowTransition(conditional, 'FR-1', 'draft', 'tentative')).toThrow(
      /Human approval/,
    );
    expect(() =>
      assertWorkflowTransition(conditional, 'FR-1', 'draft', 'tentative', {
        resolveAutonomyGate: () => false,
      }),
    ).not.toThrow();
  });
  it('respects nonblocking gates and human-only autonomy policies, including work selection', () => {
    const srs = project([requirement('FR-1', 'approved')], {
      autonomy_policy: {
        default_gate: true,
        operations: { status_approved_to_in_progress: { gate: true, approver_role: 'lead' } },
      },
      approval_gates: [
        {
          gate_id: 'advice',
          gate_type: 'content',
          required_for: ['status_approved_to_in_progress'],
          blocking: false,
        },
      ],
    });
    const pending = submit(srs);
    const agent = approve(srs, pending, { reviewer_role: 'human', approver_role: 'wrong' });
    expect(getUnblockedElements(srs, 'impl', {}, { reviews: [agent] }).elements).toEqual([]);
    const human = approve(srs, pending, { approver_role: 'lead' });
    expect(getUnblockedElements(srs, 'impl', {}, { reviews: [human] }).elements).toHaveLength(1);
    expect(getUnblockedElements(srs, 'impl').elements).toEqual([]);
    expect(() => getUnblockedElements({ workflow: { config: { nonsense: true } } })).toThrow(
      /Invalid workflow/,
    );
    expect(() =>
      assertWorkflowTransition(
        project(undefined, { approval_gates: [{ ...contentGate, blocking: false }] }),
        'FR-1',
        'tentative',
        'approved',
      ),
    ).not.toThrow();
  });
  it('keeps specification/verification work available before the resulting status is approved', () => {
    const srs = project([requirement('FR-1', 'draft'), requirement('FR-2', 'implemented')], {
      autonomy_policy: { default_gate: true },
      approval_gates: [
        {
          gate_id: 'verification',
          gate_type: 'verification',
          required_for: ['implemented_to_verified'],
        },
      ],
    });
    expect(getUnblockedElements(srs, 'spec').elements.map((e) => e.element_id)).toEqual(['FR-1']);
    expect(getUnblockedElements(srs, 'verify').elements.map((e) => e.element_id)).toEqual(['FR-2']);
    expect(() => assertLifecycleTransition(srs, 'FR-2', 'implemented', 'verified')).toThrow(
      /Approval required/,
    );
  });
  it('creates/resolves immutable records, validates inputs and sorts history', () => {
    const srs = project();
    const pending = submit(srs);
    const before = JSON.stringify(pending);
    const approved = approve(srs, pending, { comment: 'ok', reviewer_role: 'agent' });
    expect(JSON.stringify(pending)).toBe(before);
    expect(approved.status).toBe('approved');
    expect(() => approve(srs, approved)).toThrow(/already approved/);
    expect(() => approve(srs, pending, { reviewer_role: 'robot' })).toThrow(/reviewer_role/);
    expect(() => approve(srs, pending, { checks: { unknown_check: true } })).toThrow(
      /check results/,
    );
    expect(() =>
      createReview(srs, { element_id: 'missing', gate_type: 'content' }, { ...metadata, id: 1 }),
    ).toThrow(/not found/);
    expect(() => submit(srs, 0)).toThrow(/Invalid review id/);
    expect(() =>
      resolveReview(srs, [], { review_id: 1, element_id: 'FR-1' }, 'approved', metadata),
    ).toThrow(/not found/);
    expect(() =>
      resolveReview(
        srs,
        [pending],
        { review_id: 1, element_id: 'FR-1', reason: ' ' },
        'rejected',
        metadata,
      ),
    ).toThrow(/reason/);
    const rejected = resolveReview(
      srs,
      [submit(srs, 2)],
      { review_id: 2, element_id: 'FR-1', reason: 'revise', requested_changes: ['fix'] },
      'rejected',
      metadata,
    ).review;
    const history = getReviewHistory([rejected, approved, submit(srs, 3)]);
    expect(history.map((r) => r.action)).toEqual(['approved', 'rejected', 'submitted']);
    expect(history.map((r) => r.comment)).toEqual(['ok', 'revise', '']);
    expect(reviewSubject(srs, 'FR-1')).toBe(reviewSubject(JSON.parse(JSON.stringify(srs)), 'FR-1'));
  });
  it('records independent gates without deadlocking and rejects impossible configured transitions', () => {
    const gates = ['first', 'second'].map((gate_id) => ({
      ...contentGate,
      gate_id,
      approver_role: undefined,
      automated_checks: [],
    }));
    const srs = project([requirement('FR-1', 'tentative')], { approval_gates: gates });
    const first = createReview(
      srs,
      { element_id: 'FR-1', gate_type: 'content', gate_id: 'first' },
      { ...metadata, id: 1 },
    );
    const second = createReview(
      srs,
      { element_id: 'FR-1', gate_type: 'content', gate_id: 'second' },
      { ...metadata, id: 2 },
    );
    const partial = resolveReview(
      srs,
      [first, second],
      { element_id: 'FR-1', review_id: 1 },
      'approved',
      metadata,
    );
    expect(partial.review.status).toBe('approved');
    expect(partial.transition_pending?.required_gate).toBe('second');
    const final = resolveReview(
      srs,
      [partial.review, second],
      { element_id: 'FR-1', review_id: 2 },
      'approved',
      metadata,
    );
    expect(final.transition_pending).toBeUndefined();
    const invalid = project(undefined, {
      approval_gates: [
        { gate_id: 'invalid', gate_type: 'content', on_approval_status_transition: 'verified' },
      ],
    });
    expect(() => approve(invalid, submit(invalid))).toThrow(/not allowed/);
  });
});

describe('pure document operations', () => {
  it('finds definitions rather than references, including nested ids and unset statuses', () => {
    const tree = {
      depends_on: ['FR-1'],
      list: [
        null,
        1,
        { ref_id: 'FR-1' },
        { req_id: 'FR-10', status: 'draft' },
        { req_id: 'FR-1', status: 'approved' },
      ],
    };
    expect(findElementById(tree, 'FR-1')?.status).toBe('approved');
    expect(findElementStatus(tree, 'FR-1')).toBe('approved');
    expect(containsElementById(tree, 'FR-1')).toBe(true);
    expect(findElementById(tree, 'no')).toBeUndefined();
    expect(containsElementById({ ref_id: 'FR-1' }, 'FR-1')).toBe(false);
    expect(findElementStatus({ req_id: 'FR-1' }, 'FR-1')).toBeUndefined();
  });
  it('plans updates of the effective definition without mutating source documents', () => {
    const documents = [
      { path: 'a.md', content: doc(project()) },
      {
        path: 'b.md',
        content: doc({
          'functional-requirements': { requirements: [{ req_id: 'FR-1', name: 'override' }] },
        }),
      },
    ];
    const before = JSON.stringify(documents);
    const result = planElementStatusChange(documents, { element_id: 'FR-1', action: 'approve' });
    expect(result.file).toBe('b.md');
    expect(result.previous_status).toBe('draft');
    expect(result.new_status).toBe('approved');
    expect(result.content).toContain('Body unchanged.');
    expect(JSON.stringify(documents)).toBe(before);
    expect(
      planElementStatusChange(documents, { element_id: 'FR-1', new_status: 'draft' }).no_op,
    ).toBe(true);
    expect(() =>
      planElementStatusChange(documents, { element_id: 'missing', new_status: 'approved' }),
    ).toThrow(/not defined/);
    expect(() => planElementStatusChange(documents, { element_id: 'FR-1' })).toThrow(
      /Invalid status/,
    );
  });
  it('preserves YAML comments and refuses changes that cannot affect the merged result', () => {
    const content =
      '# Title\n<!--@srs\nfunctional-requirements:\n  requirements:\n    - req_id: FR-1 # id comment\n      status: tentative # status comment\n@srs-->\nBody';
    const result = planElementStatusChange([{ path: 'a.md', content }], {
      element_id: 'FR-1',
      action: 'reject',
      reason: 'revise',
    });
    expect(result.content).toContain('status: rejected # status comment');
    expect(result.content).toContain('FR-1 # id comment');
    const duplicates = [
      { path: 'base.md', content: doc(project()) },
      {
        path: 'a.md',
        content: doc({ 'use-cases': { list: [{ uc_id: 'FR-1', status: 'approved' }] } }),
      },
    ];
    expect(() =>
      planElementStatusChange(duplicates, { element_id: 'FR-1', new_status: 'dropped' }),
    ).toThrow(/Cannot safely update/);
  });
});
