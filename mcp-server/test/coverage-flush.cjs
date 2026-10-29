// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
// The stdio client's close() terminates the child with SIGTERM. V8 normally
// loses that child's coverage on a signal exit, so flush it during coverage runs.
if (process.env.NODE_V8_COVERAGE) {
  process.once('SIGTERM', () => {
    require('node:v8').takeCoverage();
    process.exit(0);
  });
}
