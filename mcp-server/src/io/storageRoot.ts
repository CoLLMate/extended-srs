// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';

/** A live directory descriptor prevents both path redirection and inode reuse. */
export class StorageRoot {
  private closing?: Promise<void>;
  mutationDeadline?: number;
  mutationFailure?: Error;

  constructor(
    readonly path: string,
    readonly directory: fs.FileHandle,
  ) {}

  close(): Promise<void> {
    return (this.closing ??= this.directory.close());
  }

  workerTimeout(): number {
    if (this.mutationFailure) {
      throw this.mutationFailure;
    }
    const remaining = (this.mutationDeadline ?? Infinity) - Date.now();
    if (remaining <= 0) {
      throw new Error('SRS update timed out; reload the project before retrying');
    }
    return Math.min(30000, remaining);
  }
}

export type StoragePath = string | StorageRoot;

export async function openStorageRoot(projectPath: StoragePath): Promise<StorageRoot> {
  if (typeof projectPath !== 'string') {
    return projectPath;
  }
  if (!constants.O_DIRECTORY || !constants.O_NOFOLLOW) {
    throw new Error('Safe SRS storage requires directory handles and O_NOFOLLOW support');
  }
  const root = await fs.realpath(projectPath);
  const directory = await fs.open(
    root,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  return new StorageRoot(root, directory);
}

export async function withStorageRoot<T>(
  projectPath: StoragePath,
  run: (root: StorageRoot) => Promise<T>,
): Promise<T> {
  if (typeof projectPath !== 'string') {
    return run(projectPath);
  }
  const root = await openStorageRoot(projectPath);
  try {
    return await run(root);
  } finally {
    await root.close();
  }
}
