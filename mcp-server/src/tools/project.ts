// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import type { DependencyEvidence } from 'extended-srs-core/api';
import { core } from '../core.js';
import { aggregateSRS } from '../io/project.js';
import { withRuleResult } from '../protocol/result.js';
import { readReviews } from '../io/reviewStorage.js';

export async function handleGetProjectState(
  projectPath: string,
  args: { filter_status?: string[] },
) {
  return withRuleResult(async () => ({
    success: true,
    ...core.getProjectState((await aggregateSRS(projectPath)).srs, args.filter_status),
  }));
}

export async function handleGetUnblockedElements(
  projectPath: string,
  args: { work_type?: string; dependency_evidence?: DependencyEvidence },
) {
  return withRuleResult(async () => {
    const srs = (await aggregateSRS(projectPath)).srs;
    const config = core.getWorkflowConfig(srs);
    const reviews =
      config.autonomy_policy || config.approval_gates?.length
        ? (
            await Promise.all(
              core
                .extractElements(srs)
                .map((element) => readReviews(projectPath, element.element_id)),
            )
          ).flat()
        : [];
    return {
      success: true,
      ...core.getUnblockedElements(srs, args.work_type, args.dependency_evidence, { reviews }),
    };
  });
}
