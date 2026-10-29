// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0

/** A specification rule failed. Contains data only; no transport or I/O policy. */
export class SRSRuleError extends Error {
  constructor(
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'SRSRuleError';
  }
}
