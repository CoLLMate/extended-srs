// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import type {
  LifecycleContext,
  LifecycleRequest,
  StatusChange,
  DependencyEvidence,
} from 'extended-srs-core/api';
import { core } from '../core.js';
import { replaceDocument } from '../io/documentStorage.js';
import { readOrderedDocuments } from '../io/project.js';
import { readReviews } from '../io/reviewStorage.js';
import { commitFile } from '../io/git.js';
import { withRuleResult } from '../protocol/result.js';
import { openStorageRoot, type StorageRoot, type StoragePath } from '../io/storageRoot.js';
import { withMutation } from '../io/mutation.js';

export async function prepareStatusChange(
  projectPath: StoragePath,
  request: LifecycleRequest,
  context: LifecycleContext = {},
) {
  const root = await openStorageRoot(projectPath);
  try {
    const snapshot = await readOrderedDocuments(root);
    const reviews = context.reviews ?? (await readReviews(root, request.element_id));
    return {
      root,
      change: core.planElementStatusChange(snapshot.documents, request, { ...context, reviews }),
    };
  } catch (error) {
    await root.close();
    throw error;
  }
}

export async function applyStatusChange(
  prepared: { root: StorageRoot; change: StatusChange },
  reason?: string,
) {
  const { root, change } = prepared;
  try {
    let commitSha: string | null = null;
    if (!change.no_op) {
      await replaceDocument(root, change.file, change.original, change.content);
      commitSha = commitFile(
        root,
        change.file,
        `lifecycle: ${change.element_id} ${change.previous_status} → ${change.new_status}${reason ? ` (${reason})` : ''}`,
      );
    }
    return {
      success: true,
      element_id: change.element_id,
      previous_status: change.previous_status,
      new_status: change.new_status,
      file: change.file,
      commit_sha: commitSha,
      no_op: change.no_op,
    };
  } finally {
    await root.close();
  }
}

export async function handleSetElementStatus(
  projectPath: string,
  args: {
    element_id: string;
    new_status: string;
    reason?: string;
    dependency_evidence?: DependencyEvidence;
  },
) {
  return withRuleResult(() =>
    withMutation(projectPath, async (root) =>
      applyStatusChange(
        await prepareStatusChange(root, args, {
          dependency_evidence: args.dependency_evidence,
        }),
        args.reason,
      ),
    ),
  );
}

export async function handleApproveElement(
  projectPath: string,
  args: { element_id: string; comment?: string; dependency_evidence?: DependencyEvidence },
) {
  return withRuleResult(() =>
    withMutation(projectPath, async (root) =>
      applyStatusChange(
        await prepareStatusChange(
          root,
          { element_id: args.element_id, action: 'approve', reason: args.comment },
          { dependency_evidence: args.dependency_evidence },
        ),
        args.comment ?? 'approve_element',
      ),
    ),
  );
}

export async function handleRejectElement(
  projectPath: string,
  args: { element_id: string; reason: string },
) {
  return withRuleResult(() =>
    withMutation(projectPath, async (root) =>
      applyStatusChange(
        await prepareStatusChange(root, { ...args, action: 'reject' }),
        args.reason,
      ),
    ),
  );
}
