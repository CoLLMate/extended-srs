// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import type { ReviewSubmission, ReviewResolution } from 'extended-srs-core/api';
import { core } from '../core.js';
import { aggregateSRS } from '../io/project.js';
import {
  assertReviewElementId,
  readReviews,
  nextReviewId,
  writeReview,
} from '../io/reviewStorage.js';
import { prepareStatusChange, applyStatusChange } from './lifecycle.js';
import { commitFile } from '../io/git.js';
import { withRuleResult } from '../protocol/result.js';
import { notifyReviewEvent } from '../integrations/reviewNotifications.js';
import { withMutation } from '../io/mutation.js';

export async function handleSubmitForReview(projectPath: string, args: ReviewSubmission) {
  const result = await withRuleResult(() =>
    withMutation(
      projectPath,
      async (root) => {
        assertReviewElementId(args.element_id);
        const srs = (await aggregateSRS(root)).srs;
        const record = core.createReview(srs, args, {
          id: await nextReviewId(root, args.element_id),
          actor: process.env.USER_ID || process.env.USER || 'agent',
          timestamp: new Date().toISOString(),
        });
        const reviewId = await writeReview(root, args.element_id, record, true);
        const commitSha = commitFile(
          root,
          `reviews/${args.element_id}/${String(reviewId).padStart(4, '0')}.json`,
          `review: submit ${args.element_id} for ${args.gate_type} review (#${reviewId})`,
        );
        return {
          success: true,
          review_id: reviewId,
          element_id: args.element_id,
          gate_type: args.gate_type,
          gate_id: record.gate_id,
          commit_sha: commitSha,
        };
      },
      true,
    ),
  );
  if (result.success && 'review_id' in result) {
    await notifyReviewEvent('review_submitted', args.element_id, result.review_id, {
      gate_type: args.gate_type,
    });
  }
  return result;
}

export async function handleGetReviewHistory(projectPath: string, args: { element_id: string }) {
  return withRuleResult(async () => ({
    success: true,
    reviews: core.getReviewHistory(await readReviews(projectPath, args.element_id)),
  }));
}

async function resolve(
  projectPath: string,
  args: ReviewResolution,
  decision: 'approved' | 'rejected',
) {
  const result = await withRuleResult(() =>
    withMutation(projectPath, async (root) => {
      assertReviewElementId(args.element_id);
      const reviews = await readReviews(root, args.element_id);
      const srs = (await aggregateSRS(root)).srs;
      const resolution = core.resolveReview(srs, reviews, args, decision, {
        actor: process.env.USER_ID || process.env.USER || args.reviewer_role || 'human',
        timestamp: new Date().toISOString(),
      });
      // Validate configured status changes before saving approval. Include the
      // candidate decision so core can check all gates and dependency rules.
      const prepared =
        resolution.new_status && !resolution.transition_pending
          ? await prepareStatusChange(
              root,
              { element_id: args.element_id, new_status: resolution.new_status },
              {
                reviews: reviews.map((review) =>
                  review.review_id === args.review_id ? resolution.review : review,
                ),
              },
            )
          : undefined;
      await writeReview(
        root,
        args.element_id,
        resolution.review,
        false,
        reviews.find((review) => review.review_id === args.review_id)!,
      );
      const commitSha = commitFile(
        root,
        `reviews/${args.element_id}/${String(args.review_id).padStart(4, '0')}.json`,
        `review: ${decision === 'approved' ? 'approve' : 'reject'} ${args.element_id} (#${args.review_id})${args.reason ? `: ${args.reason}` : ''}`,
      );
      let transition;
      if (prepared) {
        try {
          transition = await applyStatusChange(prepared, `review #${args.review_id} approved`);
        } catch (error) {
          // Approval is durable even if the document changed concurrently.
          // Report the partial result; the caller can retry set_element_status.
          return {
            success: false,
            review_saved: true,
            review_id: args.review_id,
            status: decision,
            error: error instanceof Error ? error.message : String(error),
            commit_sha: commitSha,
          };
        }
      }
      return {
        success: true,
        review_id: args.review_id,
        element_id: args.element_id,
        status: decision,
        ...(decision === 'rejected'
          ? { reason: args.reason, requested_changes: args.requested_changes }
          : {}),
        ...(resolution.transition_pending
          ? { transition_pending: resolution.transition_pending }
          : {}),
        ...(transition ? { transition } : {}),
        commit_sha: commitSha,
      };
    }),
  );
  if (result.success) {
    await notifyReviewEvent(
      decision === 'approved' ? 'review_approved' : 'review_rejected',
      args.element_id,
      args.review_id,
      decision === 'rejected' ? { reason: args.reason } : undefined,
    );
  }
  return result;
}

export async function handleApproveReview(projectPath: string, args: ReviewResolution) {
  return resolve(projectPath, args, 'approved');
}

export async function handleRejectReview(
  projectPath: string,
  args: ReviewResolution & { reason: string },
) {
  return resolve(projectPath, args, 'rejected');
}
