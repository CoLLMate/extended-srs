// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { FileInfo } from 'extended-srs-core/api';
import { withStorageRoot, type StoragePath } from './storageRoot.js';

export interface StoredDocument extends FileInfo {
  content: string;
}
export interface DocumentSnapshot {
  root: string;
  documents: StoredDocument[];
}

function relativeFile(projectPath: string, root: string, filename: string): string {
  if (typeof filename !== 'string' || !filename || /[\\\0]/.test(filename)) {
    throw new Error('Unsafe SRS path: invalid filename');
  }
  let relative = filename;
  if (path.isAbsolute(filename)) {
    relative = path.relative(path.resolve(projectPath), filename);
    if (relative === '..' || relative.startsWith('../')) {
      relative = path.relative(root, filename);
    }
  }
  const parts = relative.split('/').filter((part) => part && part !== '.');
  if (!parts.length || parts.includes('..')) {
    throw new Error('Unsafe SRS path: file is outside the SRS root');
  }
  return parts.join('/');
}

// The child pins its cwd to descriptor 3 and traverses one component at a
// time. Path validation alone cannot prevent a directory replacement race.
async function operate(
  projectPath: StoragePath,
  request: {
    operation: 'scan' | 'read' | 'replace';
    file?: string;
    expected?: string;
    content?: string;
  },
): Promise<DocumentSnapshot> {
  return withStorageRoot(projectPath, async (pinned) => {
    const root = pinned.path;
    const input = {
      ...request,
      file:
        request.file === undefined
          ? undefined
          : relativeFile(typeof projectPath === 'string' ? projectPath : root, root, request.file),
    };
    const output = execFileSync(
      process.execPath,
      [fileURLToPath(new URL('./documentStorageWorker.js', import.meta.url))],
      {
        cwd: root,
        input: JSON.stringify(input),
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe', pinned.directory.fd],
        timeout: pinned.workerTimeout(),
        killSignal: 'SIGKILL',
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    const result = JSON.parse(output);
    if (result.error) {
      if (result.error.code === 'ELOCKED') {
        throw new Error('SRS document changed concurrently; retry the operation');
      }
      throw Object.assign(new Error(result.error.message), { code: result.error.code });
    }
    return { root, documents: result.documents };
  });
}

export async function readDocuments(projectPath: StoragePath): Promise<DocumentSnapshot> {
  return operate(projectPath, { operation: 'scan' });
}

export async function readDocument(
  projectPath: StoragePath,
  file: string,
): Promise<StoredDocument> {
  const result = await operate(projectPath, { operation: 'read', file });
  return result.documents[0];
}

export async function replaceDocument(
  projectPath: StoragePath,
  file: string,
  expected: string,
  content: string,
): Promise<void> {
  await operate(projectPath, { operation: 'replace', file, expected, content });
}
