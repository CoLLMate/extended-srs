// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { extractElements } from './project';
import { SRSRuleError } from './errors';
import { assertLifecycleTransition } from './lifecycle';
import { findElementStatus } from './elementSearch';
import {
  AUTOMATED_CHECKS,
  canAutoApprove,
  getWorkflowConfig,
  requiredChecksPass,
  reviewSubject,
  selectApprovalGate,
  type WorkflowContext,
} from './workflow';

export type ReviewerRole = 'human' | 'agent';
export interface ReviewRecord {
  review_id: number;
  element_id: string;
  gate_type: string;
  gate_id?: string;
  subject?: string;
  summary?: string;
  affected_elements?: string[];
  acceptance_criteria_status?: Array<{ criterion: string; passed: boolean }>;
  consistency_check_result?: unknown;
  status: 'pending' | 'approved' | 'rejected';
  submitted_by: string;
  submitted_at: string;
  resolved_by?: string;
  resolved_at?: string;
  resolved_by_role?: ReviewerRole;
  approver_role?: string;
  checks?: Record<string, boolean>;
  comment?: string;
  reason?: string;
  requested_changes?: string[];
}
export interface ReviewSubmission {
  element_id: string;
  gate_type: string;
  gate_id?: string;
  summary?: string;
  affected_elements?: string[];
  acceptance_criteria_status?: Array<{ criterion: string; passed: boolean }>;
  consistency_check_result?: unknown;
}
export interface ReviewResolution {
  review_id: number;
  element_id: string;
  reviewer_role?: ReviewerRole;
  approver_role?: string;
  checks?: Record<string, boolean>;
  comment?: string;
  reason?: string;
  requested_changes?: string[];
}

export function createReview(
  srs: any,
  args: ReviewSubmission,
  metadata: { id: number; actor: string; timestamp: string },
): ReviewRecord {
  if (!extractElements(srs).some((element) => element.element_id === args.element_id)) {
    throw new SRSRuleError(`Element "${args.element_id}" not found in project`);
  }
  if (!Number.isSafeInteger(metadata.id) || metadata.id < 1) {
    throw new SRSRuleError('Invalid review id');
  }
  const gate = selectApprovalGate(getWorkflowConfig(srs), args.gate_type, args.gate_id);
  return {
    element_id: args.element_id,
    gate_type: args.gate_type,
    summary: args.summary,
    affected_elements: args.affected_elements,
    acceptance_criteria_status: args.acceptance_criteria_status,
    consistency_check_result: args.consistency_check_result,
    gate_id: gate?.gate_id,
    review_id: metadata.id,
    status: 'pending',
    submitted_by: metadata.actor,
    submitted_at: metadata.timestamp,
    subject: reviewSubject(srs, args.element_id),
  };
}

/** Resolve a record without mutating input or writing files. The host applies any returned transition. */
export function resolveReview(
  srs: any,
  reviews: readonly ReviewRecord[],
  args: ReviewResolution,
  decision: 'approved' | 'rejected',
  metadata: { actor: string; timestamp: string },
  context: WorkflowContext = {},
) {
  if (decision === 'rejected' && (typeof args.reason !== 'string' || !args.reason.trim())) {
    throw new SRSRuleError('reason is required for reject_review');
  }
  const review = reviews.find(
    (record) => record.review_id === args.review_id && record.element_id === args.element_id,
  );
  if (!review) {
    throw new SRSRuleError(`Review #${args.review_id} not found for element "${args.element_id}"`);
  }
  if (review.status !== 'pending') {
    throw new SRSRuleError(`Review #${args.review_id} is already ${review.status}`);
  }
  const role = args.reviewer_role ?? 'human';
  if (role !== 'human' && role !== 'agent') {
    throw new SRSRuleError(`Invalid reviewer_role "${role}"`);
  }
  const gate = selectApprovalGate(getWorkflowConfig(srs), review.gate_type, review.gate_id);
  if (decision === 'approved') {
    if (review.subject !== undefined && review.subject !== reviewSubject(srs, args.element_id)) {
      throw new SRSRuleError(
        'Review is stale; submit a new review for the current element and workflow',
      );
    }
    if (
      args.checks &&
      Object.entries(args.checks).some(
        ([key, value]) => !AUTOMATED_CHECKS.includes(key) || typeof value !== 'boolean',
      )
    ) {
      throw new SRSRuleError('Invalid automated check results');
    }
    if (gate) {
      if (gate.approver_role && args.approver_role !== gate.approver_role) {
        throw new SRSRuleError(`Approval requires approver_role "${gate.approver_role}"`);
      }
      if (!requiredChecksPass(gate, args.checks)) {
        throw new SRSRuleError('Required automated checks have not passed');
      }
      if (role === 'agent' && !canAutoApprove(gate, args.checks ?? {}, context)) {
        throw new SRSRuleError(
          'Automatic approval conditions have not been established; human review is required',
        );
      }
    }
  }
  const resolved: ReviewRecord = {
    ...review,
    status: decision,
    resolved_by: metadata.actor,
    resolved_at: metadata.timestamp,
    resolved_by_role: role,
    approver_role: args.approver_role,
    ...(decision === 'approved'
      ? { comment: args.comment, checks: args.checks }
      : { reason: args.reason, requested_changes: args.requested_changes }),
  };
  const target = decision === 'approved' ? gate?.on_approval_status_transition : undefined;
  let transitionPending: { error: string; [key: string]: unknown } | undefined;
  if (target) {
    try {
      assertLifecycleTransition(
        srs,
        args.element_id,
        findElementStatus(srs, args.element_id) ?? 'draft',
        target,
        undefined,
        { ...context, reviews: reviews.map((record) => (record === review ? resolved : record)) },
      );
    } catch (error) {
      if (
        !(error instanceof SRSRuleError) ||
        !(
          error.details.required_gate ||
          error.details.required_operation ||
          error.details.unmet_dependencies
        )
      ) {
        throw error;
      }
      // Multiple blocking gates can be approved independently. Their final
      // approval performs the transition; earlier approvals remain recorded.
      transitionPending = { error: error.message, ...error.details };
    }
  }
  return { review: resolved, new_status: target, transition_pending: transitionPending };
}

export function getReviewHistory(reviews: readonly ReviewRecord[]) {
  return [...reviews]
    .sort((a, b) => a.review_id - b.review_id)
    .map((review) => ({
      review_id: review.review_id,
      gate_type: review.gate_type,
      gate_id: review.gate_id,
      author: review.submitted_by,
      action: review.status === 'pending' ? 'submitted' : review.status,
      comment: review.comment || review.reason || review.summary || '',
      timestamp: review.resolved_at || review.submitted_at,
      status: review.status,
      reviewer_role: review.resolved_by_role,
      approver_role: review.approver_role,
    }));
}
