// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/index.ts', 'src/types.ts', 'src/tree/treeTypes.ts'],
      // Baseline measured with Node.js 24 and Vitest 5. Keep regressions visible.
      thresholds: {
        statements: 90.5,
        branches: 84.5,
        functions: 97.5,
        lines: 90.5,
        'src/safeKeys.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'src/rules/**': { statements: 85, branches: 80, functions: 100, lines: 95 },
      },
    },
  },
});
