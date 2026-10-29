// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import type { AggregatedExtendedSRS } from '../aggregation/aggregator';
import type { RuleDocument, LifecycleRequest, StatusChange } from '../rules/documents';
import type { LifecycleContext } from '../rules/lifecycle';
import type { DependencyEvidence, ProjectElement, WorkType } from '../rules/project';
import type {
  ReviewRecord,
  ReviewSubmission,
  ReviewResolution,
  ReviewerRole,
} from '../rules/reviews';
import type { WorkflowConfig, WorkflowContext } from '../rules/workflow';
import type { FileInfo } from '../types';

/** Text and paths are provided by the host. Core never reads the filesystem. */
export interface CoreDocument extends RuleDocument {
  info?: FileInfo;
}

export interface ProjectMetadata {
  hasManifest: boolean;
  hasProjectOverview: boolean;
  hasUseCases: boolean;
  hasFunctionalRequirements: boolean;
  hasNonFunctionalRequirements: boolean;
  hasConstraints: boolean;
  hasSystemArchitecture: boolean;
  hasDevelopmentImplementation: boolean;
  hasDomainModel: boolean;
  hasWorkflow: boolean;
  detectedSections: string[];
  projectName: string;
  version: string | null;
}

export interface CoreProject {
  aggregate: AggregatedExtendedSRS;
  /** Only participating documents, in aggregation order. */
  documents: CoreDocument[];
  metadata: ProjectMetadata;
}

export interface ElementDefinition {
  value: Record<string, unknown>;
  status: string;
  /** Participating documents containing an explicit definition of the ID. */
  source_files: string[];
}

export interface ConsistencyPair {
  index: number;
  yaml: unknown;
  yaml_raw: string;
  is_partial: boolean;
  partial_path?: string;
  markdown: string;
  headings: string[];
  yaml_lines: { start: number; end: number };
  markdown_lines: { start: number; end: number };
}

export interface ConsistencyResult {
  total_yaml_blocks: number;
  total_pairs: number;
  pairs: ConsistencyPair[];
}

export interface ProjectState {
  elements: ProjectElement[];
  summary: { total: number; by_status: Record<string, number> };
}

export interface WorkSelection {
  elements: Array<{
    element_id: string;
    name: string;
    status: string;
    priority?: string;
    ready_for: WorkType;
  }>;
}

export interface ReviewDecision {
  review: ReviewRecord;
  new_status?: string;
  transition_pending?: { error: string; [key: string]: unknown };
}

export interface ReviewHistoryEntry {
  review_id: number;
  gate_type: string;
  gate_id?: string;
  author: string;
  action: string;
  comment: string;
  timestamp: string;
  status: ReviewRecord['status'];
  reviewer_role?: ReviewerRole;
  approver_role?: string;
}

/** Stable v1 application boundary. Additions are optional; incompatible changes require a new major API. */
export interface CoreApiV1 {
  readonly apiVersion: 1;
  aggregateDocuments(
    documents: readonly CoreDocument[],
    options?: { allowStandalone?: boolean },
  ): Promise<CoreProject>;
  findElement(project: CoreProject, elementId: string): ElementDefinition | undefined;
  extractConsistencyPairs(content: string, elementId?: string): ConsistencyResult;
  getProjectState(srs: unknown, filterStatus?: readonly string[]): ProjectState;
  getUnblockedElements(
    srs: unknown,
    workType?: string,
    evidence?: DependencyEvidence,
    context?: WorkflowContext,
  ): WorkSelection;
  getWorkflowConfig(srs: unknown): WorkflowConfig;
  extractElements(srs: unknown): ProjectElement[];
  planElementStatusChange(
    documents: readonly RuleDocument[],
    request: LifecycleRequest,
    context?: LifecycleContext,
  ): StatusChange;
  createReview(
    srs: unknown,
    request: ReviewSubmission,
    metadata: { id: number; actor: string; timestamp: string },
  ): ReviewRecord;
  resolveReview(
    srs: unknown,
    reviews: readonly ReviewRecord[],
    request: ReviewResolution,
    decision: 'approved' | 'rejected',
    metadata: { actor: string; timestamp: string },
    context?: WorkflowContext,
  ): ReviewDecision;
  getReviewHistory(reviews: readonly ReviewRecord[]): ReviewHistoryEntry[];
}

export type {
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
};
