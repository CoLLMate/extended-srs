// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { LIFECYCLE_STATES, GATE_TYPES, AUTOMATED_CHECKS } from 'extended-srs-core/api';

const dependencyEvidenceSchema = {
  type: 'object',
  description:
    'Caller-verified evidence for dependencies not established by the SRS: completed external IDs and IDs with an available interface contract.',
  properties: {
    completed: { type: 'array', items: { type: 'string' } },
    interfaces: { type: 'array', items: { type: 'string' } },
  },
  additionalProperties: false,
};
const checkResultsSchema = {
  type: 'object',
  description:
    'Results of checks executed by the caller. All checks required by the approval gate must be true.',
  properties: Object.fromEntries(AUTOMATED_CHECKS.map((check) => [check, { type: 'boolean' }])),
  additionalProperties: false,
};

export const tools: Tool[] = [
  {
    name: 'validate_extended_srs',
    description:
      'Validate an Extended SRS project in the SRS root directory. Aggregates all .md files, merges metadata, and validates against the Extended SRS schema. Returns validation errors, warnings, conflicts, and completeness status. Pass include_files=true to also receive per-file details (name, size, modified timestamp) for a full project overview. Uses EXTENDED_SRS_ROOT environment variable to locate the SRS root.',
    inputSchema: {
      type: 'object',
      properties: {
        include_files: {
          type: 'boolean',
          description:
            'If true, include per-file details (path, name, size, modified) in the response. Defaults to false.',
        },
      },
    },
  },
  {
    name: 'get_project_state',
    description:
      'Get all SRS elements with their status, dependencies, and priority. Aggregates use-cases, functional-requirements, non-functional-requirements, system-architecture modules, and development milestones. Use for Plan construction.',
    inputSchema: {
      type: 'object',
      properties: {
        filter_status: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Filter elements by status (e.g., ["draft", "approved"]). Omit to return all.',
        },
      },
    },
  },
  {
    name: 'get_unblocked_elements',
    description:
      'Find SRS elements whose dependencies are all satisfied and are ready for work. Returns elements sorted by priority. Use for Plan construction to identify actionable items.',
    inputSchema: {
      type: 'object',
      properties: {
        dependency_evidence: dependencyEvidenceSchema,
        work_type: {
          type: 'string',
          enum: ['spec', 'impl', 'verify'],
          description:
            'Filter by work phase: "spec" (draft→tentative), "impl" (approved→implemented), "verify" (implemented→verified).',
        },
      },
    },
  },
  {
    name: 'check_consistency',
    description:
      'Extract YAML↔Markdown pairs from an SRS file for consistency evaluation. Returns structured pairs of {yaml (parsed), markdown (raw text)} for each @srs block and its following content section. The calling agent should then evaluate each pair semantically: can the YAML be reconstructed from the prose? Does the prose accurately reflect the YAML?',
    inputSchema: {
      type: 'object',
      required: ['file_path'],
      properties: {
        file_path: {
          type: 'string',
          description:
            'Path to a file inside the SRS root (relative to that root or absolute). Paths outside the root and symlinks below it are rejected.',
        },
        element_id: {
          type: 'string',
          description: 'Filter pairs to only those containing this element ID.',
        },
      },
    },
  },
  {
    name: 'get_status_history',
    description:
      'Get status change history for an SRS element by analyzing git log. Returns chronological list of status transitions with author, timestamp, and commit reference.',
    inputSchema: {
      type: 'object',
      required: ['element_id'],
      properties: {
        element_id: {
          type: 'string',
          description: 'The element ID to get status history for (e.g., "FR-001", "UC-002").',
        },
      },
    },
  },
  {
    name: 'get_change_log',
    description:
      'Get all changes to files containing an SRS element via git log. Returns current version, last modifier, and chronological list of commits with diff summaries.',
    inputSchema: {
      type: 'object',
      required: ['element_id'],
      properties: {
        element_id: {
          type: 'string',
          description: 'The element ID to get change log for.',
        },
        since: {
          type: 'string',
          format: 'date-time',
          description: 'Only return changes after this date-time.',
        },
      },
    },
  },
  {
    name: 'submit_for_review',
    description:
      'Submit an SRS element for human review. Creates a review record in <SRS_ROOT>/reviews/<element_id>/ and optionally notifies the configured Agent Communication Service. Called by Agent after completing work on an element.',
    inputSchema: {
      type: 'object',
      required: ['element_id', 'gate_type'],
      properties: {
        gate_id: {
          type: 'string',
          description: 'Configured approval gate. Required when multiple gates share gate_type.',
        },
        element_id: { type: 'string' },
        gate_type: {
          type: 'string',
          enum: [...GATE_TYPES],
        },
        summary: { type: 'string', description: 'Summary of changes made.' },
        affected_elements: {
          type: 'array',
          items: { type: 'string' },
          description: 'Other element IDs affected by this change.',
        },
        acceptance_criteria_status: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              criterion: { type: 'string' },
              passed: { type: 'boolean' },
            },
          },
        },
        consistency_check_result: {
          type: 'object',
          description: 'Result from check_consistency tool.',
        },
      },
    },
  },
  {
    name: 'get_review_history',
    description:
      'Get all review records for an SRS element. Returns chronological list of reviews with status, gate type, author, and resolution details.',
    inputSchema: {
      type: 'object',
      required: ['element_id'],
      properties: {
        element_id: { type: 'string' },
      },
    },
  },
  {
    name: 'approve_review',
    description:
      'Approve a pending review using core workflow rules. Requires the configured project role and automated checks, records the decision, and applies on_approval_status_transition when configured. reviewer_role identifies human or agent; unresolved automatic-approval conditions require human review.',
    inputSchema: {
      type: 'object',
      required: ['review_id', 'element_id'],
      properties: {
        checks: checkResultsSchema,
        approver_role: {
          type: 'string',
          description:
            'Project role required by the workflow, e.g. product_owner or architect; separate from human/agent.',
        },
        review_id: { type: 'integer' },
        element_id: { type: 'string' },
        comment: { type: 'string' },
        reviewer_role: {
          type: 'string',
          enum: ['human', 'agent'],
          description: 'Role of the reviewer recording this decision. Defaults to "human".',
        },
      },
    },
  },
  {
    name: 'reject_review',
    description:
      'Reject a pending review and request changes. Updates the review record with reason and commits to git. Called by human reviewer (or by an autonomous agent — set reviewer_role accordingly).',
    inputSchema: {
      type: 'object',
      required: ['review_id', 'element_id', 'reason'],
      properties: {
        approver_role: {
          type: 'string',
          description:
            'Project role required by the workflow, e.g. product_owner or architect; separate from human/agent.',
        },
        review_id: { type: 'integer' },
        element_id: { type: 'string' },
        reason: { type: 'string' },
        requested_changes: {
          type: 'array',
          items: { type: 'string' },
        },
        reviewer_role: {
          type: 'string',
          enum: ['human', 'agent'],
          description: 'Role of the reviewer recording this decision. Defaults to "human".',
        },
      },
    },
  },
  {
    name: 'set_element_status',
    description:
      'Update the lifecycle status of an SRS element by rewriting the status field in its YAML block in place and committing the change to git. Validates the transition against the 11-state lifecycle (common-definitions-schema §1.2). The element must be defined as a primary id (uc_id, req_id, module_id, milestone_id, element_id) in some .md file under EXTENDED_SRS_ROOT; files that merely reference the id are ignored.',
    inputSchema: {
      type: 'object',
      required: ['element_id', 'new_status'],
      properties: {
        dependency_evidence: dependencyEvidenceSchema,
        element_id: {
          type: 'string',
          description: 'Element ID whose status should change (e.g., "FR-001").',
        },
        new_status: {
          type: 'string',
          enum: [...LIFECYCLE_STATES],
          description:
            'Target lifecycle state. Must be reachable from the current state per the lifecycle diagram.',
        },
        reason: {
          type: 'string',
          description: 'Optional human-readable rationale appended to the commit message.',
        },
      },
    },
  },
  {
    name: 'approve_element',
    description:
      'Drive an SRS element forward through its lifecycle by one step. Picks the natural target state from the current state (e.g., draft→approved, tentative→approved, in_progress→in_review, in_review→implemented, implemented→verified, blocked→in_progress, rejected→draft) and calls set_element_status. No-op when the element is already in a stable terminal state. For non-default transitions use set_element_status directly.',
    inputSchema: {
      type: 'object',
      required: ['element_id'],
      properties: {
        dependency_evidence: dependencyEvidenceSchema,
        element_id: { type: 'string' },
        comment: {
          type: 'string',
          description: 'Optional rationale appended to the commit message.',
        },
      },
    },
  },
  {
    name: 'reject_element',
    description:
      'Reject an SRS element by transitioning its status to "rejected" (or back to "draft" if it is already rejected, signalling re-opening for revision). A non-empty reason is required and is recorded in the commit message.',
    inputSchema: {
      type: 'object',
      required: ['element_id', 'reason'],
      properties: {
        element_id: { type: 'string' },
        reason: { type: 'string' },
      },
    },
  },
];
