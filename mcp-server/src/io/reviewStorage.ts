// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SRSRuleError, type ReviewRecord } from 'extended-srs-core/api';
import { withStorageRoot, type StoragePath } from './storageRoot.js';

function invalidElementId(elementId: unknown): string | null {
  if (
    typeof elementId !== 'string' ||
    elementId.length === 0 ||
    elementId === '.' ||
    elementId === '..' ||
    /[\\/\0]/.test(elementId)
  ) {
    return `Invalid element_id "${String(elementId)}": must be a single path segment without "/" or "\\"`;
  }
  return null;
}

// Node has no openat/fchdir API. Use an isolated Node process whose working
// directory is verified against a pinned directory descriptor. The worker
// then enters one component at a time and uses only single-component names.
// Changing this process's cwd would race with other MCP requests.
async function reviewStorage(
  projectPath: StoragePath,
  elementId: string,
  record?: { filename: string; content: string; allocateId?: boolean; expected?: ReviewRecord },
): Promise<ReviewRecord[]> {
  return withStorageRoot(projectPath, async (root) => {
    const output = execFileSync(
      process.execPath,
      [fileURLToPath(new URL('./reviewStorageWorker.js', import.meta.url))],
      {
        cwd: root.path,
        input: JSON.stringify({ elementId, record }),
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe', root.directory.fd],
        timeout: root.workerTimeout(),
        killSignal: 'SIGKILL',
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    const result = JSON.parse(output);
    if (result.error) {
      if (result.error.code === 'REVIEW_CONFLICT' || result.error.code === 'ELOCKED') {
        throw new SRSRuleError(
          'Concurrent review update conflict; reload the review before retrying',
        );
      }
      throw Object.assign(new Error(result.error.message), { code: result.error.code });
    }
    return result.reviews;
  });
}

export async function readReviews(
  projectPath: StoragePath,
  elementId: string,
): Promise<ReviewRecord[]> {
  assertReviewElementId(elementId);
  return reviewStorage(projectPath, elementId);
}

export async function nextReviewId(projectPath: StoragePath, elementId: string): Promise<number> {
  const reviews = await readReviews(projectPath, elementId);
  if (reviews.length === 0) {
    return 1;
  }
  return Math.max(...reviews.map((r) => r.review_id)) + 1;
}

export async function writeReview(
  projectPath: StoragePath,
  elementId: string,
  review: ReviewRecord,
  allocateId = false,
  expected?: ReviewRecord,
): Promise<number> {
  assertReviewElementId(elementId);
  const filename = `${String(review.review_id).padStart(4, '0')}.json`;
  const stored = await reviewStorage(projectPath, elementId, {
    filename,
    content: JSON.stringify(review, null, 2),
    allocateId,
    expected,
  });
  return allocateId ? stored[0].review_id : review.review_id;
}

export function assertReviewElementId(elementId: unknown): void {
  const error = invalidElementId(elementId);
  if (error) {
    throw new SRSRuleError(error);
  }
}
