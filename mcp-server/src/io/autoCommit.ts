// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
/** Read per operation: false / 0 / no / off disable all mutation-related Git calls. */
export function isAutoCommitEnabled(): boolean {
  const raw = process.env.EXTSRS_AUTO_COMMIT;
  if (raw === undefined || raw === '') {
    return true;
  }
  const normalized = raw.trim().toLowerCase();
  // Anything that clearly means "off" disables auto-commit. Everything
  // else — including the default unset case handled above — leaves it
  // on, matching the documented default of ``true``.
  return !(
    normalized === 'false' ||
    normalized === '0' ||
    normalized === 'no' ||
    normalized === 'off'
  );
}
