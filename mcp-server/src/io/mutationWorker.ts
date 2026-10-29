// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import * as fs from 'node:fs';
import { lockFile } from './fileLock.js';

try {
  const expected = fs.fstatSync(3, { bigint: true });
  const actual = fs.statSync('.', { bigint: true });
  if (!expected.isDirectory() || expected.dev !== actual.dev || expected.ino !== actual.ino) {
    throw new Error('Unsafe SRS path: directory changed before acquiring update lock');
  }
  const release = lockFile('srs-mutation', 'SRS mutation', {
    stale: 120000,
    releaseOnExit: false,
  });
  let released = false;
  process.once('message', () => {
    release();
    released = true;
    process.disconnect!();
  });
  process.once('disconnect', () => {
    if (!released) {
      // A dead parent may still have an I/O child. Leave a stale lease rather
      // than unlock immediately while that child's write is in flight.
      process.kill(process.pid, 'SIGKILL');
    }
  });
  process.send!({ ready: true });
} catch (error) {
  const failure = error as NodeJS.ErrnoException;
  process.send!({ error: { message: failure.message, code: failure.code } });
  process.disconnect!();
}
