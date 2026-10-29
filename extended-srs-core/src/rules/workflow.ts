// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import Ajv from 'ajv';
import schema from '../../schema/schemas/workflow-schema.json';
import { findElementById } from './elementSearch';
import { SRSRuleError } from './errors';
import type { ReviewRecord } from './reviews';

export type GateType = 'content' | 'implementation' | 'verification' | 'architecture';
export const GATE_TYPES: readonly string[] = Object.freeze([
  ...schema.definitions.approvalGateConfig.properties.gate_type.enum,
]);
export const AUTOMATED_CHECKS: readonly string[] = Object.freeze([
  ...schema.definitions.approvalGateConfig.properties.automated_checks.items.enum,
]);

export interface AutonomyLevel {
  gate: boolean;
  conditions?: string[];
  approver_role?: string;
}
export interface ApprovalGate {
  gate_id: string;
  gate_type: GateType;
  required_for?: string[];
  approver_role?: string;
  auto_approve_conditions?: string[];
  automated_checks?: string[];
  blocking?: boolean;
  on_approval_status_transition?: string;
}
export interface WorkflowConfig {
  autonomy_policy?: { default_gate?: boolean; operations?: Record<string, AutonomyLevel> };
  approval_gates?: ApprovalGate[];
  consistency_check?: {
    enabled?: boolean;
    check_on_commit?: boolean;
    check_fields?: string[];
    strict_mode?: boolean;
  };
}
export interface WorkflowContext {
  reviews?: readonly ReviewRecord[];
  /** Conditions have no expression language in the schema. The host evaluates them. */
  evaluateCondition?: (condition: string) => boolean | undefined;
  /** The schema does not specify how conditions override gate; the host supplies that policy. */
  resolveAutonomyGate?: (operation: string, level: Readonly<AutonomyLevel>) => boolean | undefined;
}

// Validate only the workflow config here; incomplete SRS documents can still
// be edited. AJV does not apply defaults or mutate the caller's data.
const validateConfig = new Ajv({ strict: false, allErrors: true }).compile({
  definitions: schema.definitions,
  $ref: '#/definitions/workflowConfig',
});

export function getWorkflowConfig(srs: any): WorkflowConfig {
  if (
    srs?.workflow !== undefined &&
    (!srs.workflow || typeof srs.workflow !== 'object' || Array.isArray(srs.workflow))
  ) {
    throw new SRSRuleError('Invalid workflow section');
  }
  const config = srs?.workflow?.config === undefined ? {} : srs.workflow.config;
  if (!validateConfig(config)) {
    throw new SRSRuleError('Invalid workflow config', { validation_errors: validateConfig.errors });
  }
  const ids = (config as WorkflowConfig).approval_gates?.map((gate) => gate.gate_id) ?? [];
  if (new Set(ids).size !== ids.length || ids.some((id) => !id.trim())) {
    throw new SRSRuleError('Approval gate ids must be non-empty and unique');
  }
  return config as WorkflowConfig;
}

/** A deterministic, portable snapshot prevents approvals for old content/config being reused. */
function canonical(value: any): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function reviewSubject(srs: any, elementId: string): string {
  return canonical({ element: findElementById(srs, elementId), config: getWorkflowConfig(srs) });
}

export function selectApprovalGate(
  config: WorkflowConfig,
  gateType: string,
  gateId?: string,
): ApprovalGate | undefined {
  if (!GATE_TYPES.includes(gateType)) {
    throw new SRSRuleError(`Invalid gate_type "${gateType}"`);
  }
  const candidates = (config.approval_gates ?? []).filter(
    (gate) => gate.gate_type === gateType && (gateId === undefined || gate.gate_id === gateId),
  );
  if (gateId !== undefined && !candidates.length) {
    throw new SRSRuleError(`Unknown approval gate "${gateId}" for ${gateType}`);
  }
  if (candidates.length > 1) {
    throw new SRSRuleError('Multiple approval gates match; specify gate_id');
  }
  return candidates[0];
}

function allConditions(
  conditions: readonly string[] | undefined,
  context: WorkflowContext,
): boolean {
  return (
    !!conditions?.length &&
    conditions.every((condition) => context.evaluateCondition?.(condition) === true)
  );
}

export function requiredChecksPass(
  gate: ApprovalGate,
  checks: Record<string, boolean> = {},
): boolean {
  return (gate.automated_checks ?? []).every(
    (check) => Object.prototype.hasOwnProperty.call(checks, check) && checks[check] === true,
  );
}

export function canAutoApprove(
  gate: ApprovalGate,
  checks: Record<string, boolean>,
  context: WorkflowContext,
): boolean {
  return allConditions(gate.auto_approve_conditions, context) && requiredChecksPass(gate, checks);
}

export function gatesForTransition(
  config: WorkflowConfig,
  from: string,
  to: string,
): ApprovalGate[] {
  return (config.approval_gates ?? []).filter((gate) =>
    gate.required_for?.length
      ? gate.required_for.some(
          (operation) =>
            operation === `${from}_to_${to}` || operation === `status_${from}_to_${to}`,
        )
      : gate.on_approval_status_transition === to,
  );
}

function latestReview(
  srs: any,
  elementId: string,
  reviews: readonly ReviewRecord[],
  gate: ApprovalGate | undefined,
  gateType?: GateType,
): ReviewRecord | undefined {
  const matches = reviews.filter(
    (review) =>
      review.element_id === elementId &&
      (gate ? review.gate_id === gate.gate_id : review.gate_type === gateType),
  );
  const latest = [...matches].sort((a, b) => b.review_id - a.review_id)[0];
  return latest?.subject === reviewSubject(srs, elementId) ? latest : undefined;
}

/** Gate checks apply to every client, including lifecycle mutations outside MCP. */
export function assertWorkflowTransition(
  srs: any,
  elementId: string,
  from: string,
  to: string,
  context: WorkflowContext = {},
): void {
  const config = getWorkflowConfig(srs);
  const reviews = context.reviews ?? [];
  const gates = gatesForTransition(config, from, to);
  for (const gate of gates) {
    if (gate.blocking === false) {
      continue;
    }
    const review = latestReview(srs, elementId, reviews, gate);
    const valid =
      review?.status === 'approved' &&
      requiredChecksPass(gate, review.checks) &&
      (!gate.approver_role || review.approver_role === gate.approver_role) &&
      (review.resolved_by_role === 'human' || canAutoApprove(gate, review.checks ?? {}, context));
    if (!valid) {
      throw new SRSRuleError(`Approval required for gate "${gate.gate_id}"`, {
        required_gate: gate.gate_id,
      });
    }
  }
  const policy = config.autonomy_policy;
  const operation = `status_${from}_to_${to}`;
  const level =
    policy?.operations && Object.prototype.hasOwnProperty.call(policy.operations, operation)
      ? policy.operations[operation]
      : undefined;
  // Without an evaluator, conditional policy cannot weaken human approval.
  const conditionalGate = level?.conditions?.length
    ? (context.resolveAutonomyGate?.(operation, level) ?? true)
    : undefined;
  const humanRequired = conditionalGate ?? level?.gate ?? policy?.default_gate ?? false;
  if (!humanRequired) {
    return;
  }
  let gateType: GateType;
  if (to === 'implemented') {
    gateType = 'implementation';
  } else if (to === 'verified') {
    gateType = 'verification';
  } else {
    gateType = 'content';
  }
  const relevant = gates.length
    ? gates.map((gate) => latestReview(srs, elementId, reviews, gate))
    : [latestReview(srs, elementId, reviews, undefined, gateType)];
  if (
    !relevant.some(
      (review) =>
        review?.status === 'approved' &&
        review.resolved_by_role === 'human' &&
        (!level?.approver_role || review.approver_role === level.approver_role),
    )
  ) {
    throw new SRSRuleError(`Human approval required for ${operation}`, {
      required_operation: operation,
    });
  }
}
