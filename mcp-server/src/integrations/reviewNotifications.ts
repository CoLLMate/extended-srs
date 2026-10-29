// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
export async function notifyReviewEvent(
  type: string,
  elementId: string,
  reviewId: number,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const agentCommUrl = process.env.AGENT_COMMUNICATION_URL;
  const teamId = process.env.TEAM_ID;
  const projectId = process.env.PROJECT_ID;
  const projectToken = process.env.GIT_AUTH_TOKEN;
  const agentWorkspaceId = process.env.AGENT_WORKSPACE_ID || '';

  if (!agentCommUrl || !teamId || !projectId || !projectToken) {
    // Notification integration is not configured.
    return;
  }

  try {
    const url = `${agentCommUrl}/api/${teamId}/${projectId}/notifications`;
    await fetch(url, {
      method: 'POST',
      // Custom authentication headers are otherwise forwarded across origins.
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        'X-Project-Token': projectToken,
      },
      body: JSON.stringify({
        type,
        title: `Review ${type} for ${elementId}`,
        message: `Review #${reviewId} for element ${elementId}`,
        agentWorkspaceId,
        metadata: { element_id: elementId, review_id: reviewId, ...metadata },
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    // Best-effort — don't fail the tool call
  }
}
