// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import * as fs from 'node:fs';
import { git } from './git.js';

try {
  const expected = fs.fstatSync(3, { bigint: true });
  const actual = fs.statSync('.', { bigint: true });
  if (!expected.isDirectory() || expected.dev !== actual.dev || expected.ino !== actual.ino) {
    throw Object.assign(
      new Error('Unsafe SRS path: directory changed before reading Git history'),
      {
        code: 'UNSAFE_SRS_PATH',
      },
    );
  }
  const { args } = JSON.parse(fs.readFileSync(0, 'utf8'));
  process.stdout.write(JSON.stringify({ output: git(args, '.') }));
} catch (error) {
  const failure = error as NodeJS.ErrnoException;
  process.stdout.write(JSON.stringify({ error: { message: failure.message, code: failure.code } }));
}
