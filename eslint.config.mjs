// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const javascriptFiles = ['**/*.{js,cjs,mjs}'];
const typescriptFiles = ['**/*.{ts,cts,mts}'];

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.nyc_output/**',
      '.cache/**',
    ],
  },
  {
    files: javascriptFiles,
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    files: typescriptFiles,
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      // SRS metadata is dynamically shaped JSON/YAML. Introducing linting does
      // not change those public data types; unused variables remain errors.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  prettier,
  {
    files: [...javascriptFiles, ...typescriptFiles],
    rules: {
      curly: ['error', 'all'],
      'no-nested-ternary': 'error',
      'max-statements-per-line': ['error', { max: 1 }],
    },
  },
);
