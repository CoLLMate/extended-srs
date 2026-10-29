// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import * as fs from 'node:fs';
import { lockSync } from 'proper-lockfile';

/** Lock relative to a worker's pinned cwd, without following lock symlinks. */
export function lockFile(
  filename: string,
  scope: string,
  options: { stale?: number; releaseOnExit?: boolean } = {},
): () => void {
  // Acquisition may need to remove an expired lease. Once acquired, a keeper
  // must not let proper-lockfile's exit cleanup unlock an in-flight operation.
  let allowRemoval = true;
  const release = lockSync(filename, {
    realpath: false,
    lockfilePath: `.${filename}.lock`,
    // Workers are killed after 30 seconds. A dead worker's lease can be
    // reclaimed after 60 seconds; an active competing writer fails promptly.
    stale: options.stale ?? 60000,
    fs: {
      ...fs,
      rmdirSync(name: fs.PathLike) {
        if (allowRemoval) {
          fs.rmdirSync(name);
        }
      },
      statSync(name: string) {
        const stat = fs.lstatSync(name);
        if (stat.isSymbolicLink()) {
          throw new Error(`Unsafe ${scope} path: symbolic links are not allowed (${name})`);
        }
        if (!stat.isDirectory()) {
          throw new Error(`Unsafe ${scope} path: expected a directory (${name})`);
        }
        return stat;
      },
      utimesSync(name: string, atime: Date, mtime: Date) {
        const fd = fs.openSync(
          name,
          fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW,
        );
        try {
          fs.futimesSync(fd, atime, mtime);
        } finally {
          fs.closeSync(fd);
        }
      },
    },
  });
  allowRemoval = options.releaseOnExit !== false;
  return () => {
    allowRemoval = true;
    release();
  };
}
