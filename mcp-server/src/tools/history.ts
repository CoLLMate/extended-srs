// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { core } from '../core.js';
import { readCommits, readSnapshot, changedFilesSummary } from '../io/gitHistory.js';
import { withStorageRoot, type StorageRoot } from '../io/storageRoot.js';

async function elementAt(projectPath: StorageRoot, sha: string, elementId: string) {
  const project = await core.aggregateDocuments(readSnapshot(projectPath, sha), {
    allowStandalone: true,
  });
  return core.findElement(project, elementId);
}

export async function handleGetStatusHistory(projectPath: string, args: { element_id: string }) {
  return withStorageRoot(projectPath, async (root) => {
    const history: Array<{
      status: string;
      previous_status?: string;
      changed_by: string;
      timestamp: string;
      commit_sha: string;
      reason: string;
    }> = [];
    let previous: string | undefined;
    for (const commit of readCommits(root).reverse()) {
      const current = (await elementAt(root, commit.sha, args.element_id))?.status;
      if (current !== undefined && current !== previous) {
        history.push({
          status: current,
          previous_status: previous,
          changed_by: commit.author,
          timestamp: commit.date,
          commit_sha: commit.sha,
          reason: commit.message,
        });
      }
      // Deletion is omitted; re-creation starts a new lifetime.
      previous = current;
    }
    return { success: true, history };
  });
}

export async function handleGetChangeLog(
  projectPath: string,
  args: { element_id: string; since?: string },
) {
  return withStorageRoot(projectPath, async (root) => {
    const changes: Array<{
      commit_sha: string;
      author: string;
      timestamp: string;
      message: string;
      diff_summary: string;
    }> = [];
    for (const commit of readCommits(root, args.since)) {
      const current = await elementAt(root, commit.sha, args.element_id);
      const previous = commit.parent
        ? await elementAt(root, commit.parent, args.element_id)
        : undefined;
      const files = [
        ...new Set([...(current?.source_files ?? []), ...(previous?.source_files ?? [])]),
      ];
      if (!files.length) {
        continue;
      }
      // Manifest changes may alter the effective element without touching its definition files.
      const diff = changedFilesSummary(root, commit, [...files, 'srs.md']);
      if (!diff) {
        continue;
      }
      changes.push({
        commit_sha: commit.sha,
        author: commit.author,
        timestamp: commit.date,
        message: commit.message,
        diff_summary: diff,
      });
    }
    const latest = changes[0];
    return {
      success: true,
      current_version: latest?.commit_sha ?? null,
      last_modified_by: latest?.author ?? null,
      last_modified_at: latest?.timestamp ?? null,
      changes,
    };
  });
}
