// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { core } from '../core.js';
import { readDocument } from '../io/documentStorage.js';

/** Extract pairs for the caller to evaluate semantically. */
export async function handleCheckConsistency(
  projectPath: string,
  args: {
    file_path: string;
    element_id?: string;
  },
) {
  const filePath = args.file_path;

  // Read the file
  let content: string;
  try {
    content = (await readDocument(projectPath, filePath)).content;
  } catch {
    return {
      success: false,
      error: `Failed to read file: ${filePath}`,
    };
  }

  return {
    success: true,
    file_path: filePath,
    ...core.extractConsistencyPairs(content, args.element_id),
  };
}
