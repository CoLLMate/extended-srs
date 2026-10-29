// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import commonSchema from '../../schema/schemas/common-definitions-schema.json';
import { SRSRuleError } from './errors';
import { extractElements, unmetDependencies, type DependencyEvidence } from './project';
import { assertWorkflowTransition, type WorkflowContext } from './workflow';

export type LifecycleState =
  | 'draft'
  | 'tentative'
  | 'approved'
  | 'in_progress'
  | 'blocked'
  | 'in_review'
  | 'rejected'
  | 'implemented'
  | 'verified'
  | 'deferred'
  | 'dropped';
export const LIFECYCLE_STATES: readonly string[] = Object.freeze([
  ...commonSchema.definitions.status.enum,
]);

// common-definitions-schema x-docs §1.2. The conformance test compares this
// table with the specification's diagram; transport implementations do not copy it.
const TRANSITIONS: Readonly<Record<LifecycleState, readonly LifecycleState[]>> = {
  draft: ['tentative', 'dropped'],
  tentative: ['approved', 'rejected', 'dropped'],
  approved: ['in_progress', 'deferred', 'dropped'],
  in_progress: ['in_review', 'blocked'],
  blocked: ['in_progress'],
  in_review: ['implemented', 'rejected'],
  rejected: ['draft'],
  implemented: ['verified'],
  verified: [],
  deferred: ['draft', 'approved', 'dropped'],
  dropped: [],
};

export function allowedTransitions(from: string): readonly LifecycleState[] {
  return LIFECYCLE_STATES.includes(from) ? [...TRANSITIONS[from as LifecycleState]] : [];
}
export interface LifecycleContext extends WorkflowContext {
  dependency_evidence?: DependencyEvidence;
}

export function assertLifecycleTransition(
  srs: any,
  elementId: string,
  from: string,
  to: string,
  reason?: string,
  context: LifecycleContext = {},
): void {
  if (!LIFECYCLE_STATES.includes(to)) {
    throw new SRSRuleError(
      `Invalid status "${to}". Must be one of: ${LIFECYCLE_STATES.join(', ')}`,
    );
  }
  if (!LIFECYCLE_STATES.includes(from)) {
    throw new SRSRuleError(`Invalid current status "${from}"`);
  }
  if (from === to) {
    return;
  }
  // §2.1 permits draft → approved only according to approval gate settings.
  const skipTentative = from === 'draft' && to === 'approved';
  if (!skipTentative && !allowedTransitions(from).includes(to as LifecycleState)) {
    throw new SRSRuleError(`Transition "${from}" → "${to}" is not allowed by the lifecycle`, {
      allowed_from_current: allowedTransitions(from),
    });
  }
  if (to === 'rejected' && (typeof reason !== 'string' || !reason.trim())) {
    throw new SRSRuleError('reason is required for rejection');
  }
  if (to === 'in_progress') {
    const element = extractElements(srs).find((candidate) => candidate.element_id === elementId);
    const unmet = element ? unmetDependencies(srs, element, context.dependency_evidence) : [];
    if (unmet.length) {
      throw new SRSRuleError('Dependencies are not satisfied', { unmet_dependencies: unmet });
    }
  }
  if (skipTentative) {
    assertWorkflowTransition(srs, elementId, 'draft', 'tentative', context);
    assertWorkflowTransition(srs, elementId, 'tentative', 'approved', context);
  }
  assertWorkflowTransition(srs, elementId, from, to, context);
}

/** Convenience operation; authorization still goes through assertLifecycleTransition. */
export function approvalTarget(status: string): string {
  if (!LIFECYCLE_STATES.includes(status)) {
    throw new SRSRuleError(`Invalid current status "${status}"`);
  }
  const targets: Partial<Record<LifecycleState, LifecycleState>> = {
    draft: 'approved',
    tentative: 'approved',
    in_progress: 'in_review',
    in_review: 'implemented',
    implemented: 'verified',
    blocked: 'in_progress',
    rejected: 'draft',
  };
  return targets[status as LifecycleState] ?? status;
}

export function rejectionTarget(status: string, reason: string): string {
  if (typeof reason !== 'string' || !reason.trim()) {
    throw new SRSRuleError('reason is required for reject_element');
  }
  return status === 'rejected' ? 'draft' : 'rejected';
}
