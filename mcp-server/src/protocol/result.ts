// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { SRSRuleError } from 'extended-srs-core/api';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export function toToolResult(result: unknown): CallToolResult {
  const failed =
    result !== null &&
    typeof result === 'object' &&
    'success' in result &&
    result.success === false;
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    ...(failed ? { isError: true } : {}),
  };
}

/** Map domain failures to the existing MCP result shape. I/O failures still propagate. */
export async function withRuleResult<T>(run: () => Promise<T>) {
  try {
    return await run();
  } catch (error) {
    if (error instanceof SRSRuleError) {
      return { success: false, error: error.message, ...error.details };
    }
    throw error;
  }
}
