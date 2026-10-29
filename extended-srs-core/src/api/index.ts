// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
export { createCoreApi } from './core';
export type {
  CoreApiV1,
  CoreDocument,
  CoreProject,
  ProjectMetadata,
  ElementDefinition,
  ConsistencyPair,
  ConsistencyResult,
  ProjectState,
  WorkSelection,
  ReviewDecision,
  ReviewHistoryEntry,
  LifecycleRequest,
  StatusChange,
  LifecycleContext,
  DependencyEvidence,
  ProjectElement,
  WorkType,
  ReviewRecord,
  ReviewSubmission,
  ReviewResolution,
  ReviewerRole,
  WorkflowConfig,
  WorkflowContext,
} from './contracts';
export { SRSRuleError } from '../rules/errors';
export { LIFECYCLE_STATES } from '../rules/lifecycle';
export { GATE_TYPES, AUTOMATED_CHECKS } from '../rules/workflow';
export type { FileInfo } from '../types';
export type { AggregatedExtendedSRS } from '../aggregation/aggregator';
export type { RuleDocument } from '../rules/documents';
