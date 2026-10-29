// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { handleValidate } from '../tools/validate.js';
import { handleGetProjectState, handleGetUnblockedElements } from '../tools/project.js';
import { handleCheckConsistency } from '../tools/consistency.js';
import { handleGetStatusHistory, handleGetChangeLog } from '../tools/history.js';
import {
  handleSubmitForReview,
  handleGetReviewHistory,
  handleApproveReview,
  handleRejectReview,
} from '../tools/review.js';
import {
  handleSetElementStatus,
  handleApproveElement,
  handleRejectElement,
} from '../tools/lifecycle.js';
import { tools } from './tools.js';
import { toToolResult } from './result.js';

function adapt<T extends object>(handler: (root: string, args: T) => Promise<unknown>) {
  return (root: string, args: Record<string, unknown>) => handler(root, args as T);
}

const handlers = new Map([
  ['validate_extended_srs', adapt(handleValidate)],
  ['get_project_state', adapt(handleGetProjectState)],
  ['get_unblocked_elements', adapt(handleGetUnblockedElements)],
  ['check_consistency', adapt(handleCheckConsistency)],
  ['get_status_history', adapt(handleGetStatusHistory)],
  ['get_change_log', adapt(handleGetChangeLog)],
  ['submit_for_review', adapt(handleSubmitForReview)],
  ['get_review_history', adapt(handleGetReviewHistory)],
  ['approve_review', adapt(handleApproveReview)],
  ['reject_review', adapt(handleRejectReview)],
  ['set_element_status', adapt(handleSetElementStatus)],
  ['approve_element', adapt(handleApproveElement)],
  ['reject_element', adapt(handleRejectElement)],
]);

export async function dispatchTool(
  projectPath: string | undefined,
  name: string,
  args: Record<string, unknown>,
) {
  try {
    if (!projectPath) {
      throw new Error('EXTENDED_SRS_ROOT environment variable is not set');
    }
    const handler = handlers.get(name);
    if (!handler) {
      throw new Error(`Unknown tool: ${name}`);
    }
    for (const field of [
      ...(tools.find((tool) => tool.name === name)!.inputSchema.required ?? []),
    ].sort((left, right) => Number(right === 'element_id') - Number(left === 'element_id'))) {
      if (field === 'review_id' ? args[field] === undefined : !args[field]) {
        throw new Error(
          `${field} is required${name === 'check_consistency' ? ' for check_consistency' : ''}`,
        );
      }
    }
    return toToolResult(await handler(projectPath, args));
  } catch (error) {
    return toToolResult({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
