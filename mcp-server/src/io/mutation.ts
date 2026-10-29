// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import { SRSRuleError } from 'extended-srs-core/api';
import { withStorageRoot, type StorageRoot } from './storageRoot.js';

async function acquire(root: StorageRoot): Promise<() => Promise<void>> {
  // The keeper has its own cwd and heartbeat. A synchronous storage/Git call
  // in the MCP process must not prevent the operation lock from being renewed.
  const keeper = fork(fileURLToPath(new URL('./mutationWorker.js', import.meta.url)), [], {
    cwd: root.path,
    execArgv: [],
    stdio: ['ignore', 'ignore', 'ignore', root.directory.fd, 'ipc'],
  });
  let releasing = false;
  const exited = once(keeper, 'exit');
  const stopped = exited.then(() => {
    if (!releasing) {
      root.mutationFailure = new Error(
        'SRS update lock was lost; reload the project before retrying',
      );
    }
    throw root.mutationFailure ?? new Error('SRS update lock keeper exited');
  });
  try {
    const [message] = await Promise.race([once(keeper, 'message'), stopped]);
    if (message.error) {
      throw Object.assign(new Error(message.error.message), { code: message.error.code });
    }
  } catch (error) {
    await exited.catch(() => undefined);
    throw error;
  }
  stopped.catch(() => undefined);
  return async () => {
    releasing = true;
    if (keeper.connected) {
      keeper.send('release');
    }
    await exited;
  };
}

/** Serialize the complete read/decide/save/commit operation for one SRS root. */
export async function withMutation<T>(
  projectPath: string,
  run: (root: StorageRoot) => Promise<T>,
  waitForTurn = false,
): Promise<T> {
  return withStorageRoot(projectPath, async (root) => {
    const deadline = Date.now() + (waitForTurn ? 30000 : 0);
    let release: () => Promise<void>;
    for (;;) {
      root.mutationFailure = undefined;
      try {
        release = await acquire(root);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ELOCKED') {
          throw error;
        }
        if (Date.now() >= deadline) {
          throw new SRSRuleError(
            'Concurrent SRS update conflict; reload the project before retrying',
          );
        }
        await setTimeout(25);
      }
    }
    root.mutationDeadline = Date.now() + 30000;
    try {
      return await run(root);
    } finally {
      await release();
    }
  });
}
