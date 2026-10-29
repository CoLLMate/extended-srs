// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import {
  execFileSync,
  spawnSync,
  type SpawnSyncOptionsWithStringEncoding,
} from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isAutoCommitEnabled } from './autoCommit.js';
import type { StorageRoot } from './storageRoot.js';

/** No shell interpolation; caller-controlled paths must follow `--` as literal pathspecs. */
export function git(args: string[], cwd: string | StorageRoot): string {
  if (typeof cwd !== 'string') {
    const response = execFileSync(
      process.execPath,
      [fileURLToPath(new URL('./gitReadWorker.js', import.meta.url))],
      {
        cwd: cwd.path,
        input: JSON.stringify({ args }),
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe', cwd.directory.fd],
        timeout: cwd.workerTimeout(),
        killSignal: 'SIGKILL',
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    const result = JSON.parse(response);
    if (result.error) {
      throw Object.assign(new Error(result.error.message), { code: result.error.code });
    }
    return result.output;
  }
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30000,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, HOME: process.env.HOME || '/workspace' },
  });
}

export const literalPath = (filename: string): string => `:(literal)${filename}`;

/** Commit only the file just persisted, preserving unrelated staged work. */
export function commitFile(
  root: StorageRoot,
  relativePath: string,
  message: string,
): string | null {
  if (!isAutoCommitEnabled()) {
    return null;
  }
  try {
    const options: SpawnSyncOptionsWithStringEncoding & { detached: true } = {
      cwd: root.path,
      detached: true,
      input: JSON.stringify({ relativePath, message }),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe', root.directory.fd],
      timeout: root.workerTimeout(),
      killSignal: 'SIGKILL',
      maxBuffer: 64 * 1024 * 1024,
    };
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('./gitCommitWorker.js', import.meta.url))],
      options,
    );
    if (result.error || result.status !== 0) {
      // The worker may be waiting on Git or a hook. Stop its entire process
      // group before releasing the operation lock, not just the worker itself.
      if (result.pid) {
        try {
          process.kill(-result.pid, 'SIGKILL');
        } catch {
          // The process group may already have exited.
        }
      }
      return null;
    }
    return JSON.parse(result.stdout).commitSha;
  } catch {
    // Persistence has succeeded; missing Git identity/repository or a changed path
    // must not turn a best-effort commit into a write to another location.
    return null;
  }
}
