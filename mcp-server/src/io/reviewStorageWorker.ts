// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { lockFile } from './fileLock.js';

// This module is a child-process entry point, never an in-process library.
// Descriptor 3 pins the SRS root selected by the parent. A cwd holds the same
// stable directory reference as a dirfd, even when its old name is replaced.
// Keep each directory open until chdir + fstat verifies that exact inode;
// this also prevents inode reuse between the identity check and entry.
function verifyCwd(fd: number): void {
  const expected = fs.fstatSync(fd, { bigint: true });
  const actual = fs.statSync('.', { bigint: true });
  if (!expected.isDirectory() || expected.dev !== actual.dev || expected.ino !== actual.ino) {
    throw new Error('Unsafe review path: directory changed while entering it');
  }
}

function requireSegment(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== 'string' ||
    !value ||
    value === '.' ||
    value === '..' ||
    /[\\/\0]/.test(value)
  ) {
    throw new Error(`Unsafe review path: invalid ${label}`);
  }
}

function checkEntry(name: string, type: 'file' | 'directory', allowMissing = false): boolean {
  let stat;
  try {
    stat = fs.lstatSync(name);
  } catch (error) {
    if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
  if (stat.isSymbolicLink()) {
    throw new Error(`Unsafe review path: symbolic links are not allowed (${name})`);
  }
  if (type === 'file' ? !stat.isFile() : !stat.isDirectory()) {
    throw new Error(`Unsafe review path: expected a ${type} (${name})`);
  }
  return true;
}

function enterDirectory(name: string, create: boolean): boolean {
  if (create) {
    try {
      fs.mkdirSync(name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }
  }
  if (!checkEntry(name, 'directory', !create)) {
    return false;
  }
  const fd = fs.openSync(
    name,
    fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW,
  );
  try {
    process.chdir(name);
    verifyCwd(fd);
  } finally {
    fs.closeSync(fd);
  }
  return true;
}

function readRecord(name: string): string {
  checkEntry(name, 'file');
  const fd = fs.openSync(
    name,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
  );
  try {
    if (!fs.fstatSync(fd).isFile()) {
      throw new Error(`Unsafe review path: expected a file (${name})`);
    }
    return fs.readFileSync(fd, 'utf-8');
  } finally {
    fs.closeSync(fd);
  }
}

function readRecords(): unknown[] {
  const records = [];
  for (const name of fs
    .readdirSync('.')
    .filter((name) => name.endsWith('.json'))
    .sort()) {
    const content = readRecord(name);
    try {
      records.push(JSON.parse(content));
    } catch {
      // Malformed JSON is skipped; filesystem errors above still propagate.
    }
  }
  return records;
}

/** Compare and replace under a process-shared lock in the pinned directory. */
function updateRecord(filename: string, content: string, expected: unknown): void {
  requireSegment(filename, 'record filename');
  const release = lockFile(filename, 'review');
  try {
    if (!isDeepStrictEqual(JSON.parse(readRecord(filename)), expected)) {
      throw Object.assign(new Error('Concurrent review update conflict'), {
        code: 'REVIEW_CONFLICT',
      });
    }
    writeRecord(filename, content);
  } finally {
    release();
  }
}

function writeRecord(filename: string, content: string, create = false): boolean {
  requireSegment(filename, 'record filename');
  checkEntry(filename, 'file', true);
  const temporary = `.${filename}.${randomUUID()}.tmp`;
  const fd = fs.openSync(
    temporary,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
    0o666,
  );
  let installed = false;
  try {
    try {
      fs.writeFileSync(fd, content, 'utf-8');
    } finally {
      fs.closeSync(fd);
    }
    checkEntry(filename, 'file', true);
    if (create) {
      try {
        // Publish a complete record only if this ID is still unused. link is
        // atomic across processes and never replaces an existing record.
        fs.linkSync(temporary, filename);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          return false;
        }
        throw error;
      }
    }
    // Both names are single components in the pinned cwd. rename replaces a
    // last-moment symlink itself; it never writes through that link's target.
    fs.renameSync(temporary, filename);
    installed = true;
    return true;
  } finally {
    if (!installed) {
      fs.unlinkSync(temporary);
    }
  }
}

function createRecord(content: string): unknown {
  const record = JSON.parse(content);
  for (let id = record.review_id; Number.isSafeInteger(id) && id > 0; id++) {
    const candidate = { ...record, review_id: id };
    if (
      writeRecord(`${String(id).padStart(4, '0')}.json`, JSON.stringify(candidate, null, 2), true)
    ) {
      return candidate;
    }
  }
  throw new Error('Invalid review id for a new review');
}

try {
  verifyCwd(3);
  const request = JSON.parse(fs.readFileSync(0, 'utf-8'));
  requireSegment(request.elementId, 'element_id');
  const create = request.record !== undefined;
  let reviews: unknown[] = [];
  if (enterDirectory('reviews', create) && enterDirectory(request.elementId, create)) {
    if (create && request.record.allocateId) {
      reviews = [createRecord(request.record.content)];
    } else if (create) {
      updateRecord(request.record.filename, request.record.content, request.record.expected);
    } else {
      reviews = readRecords();
    }
  }
  process.stdout.write(JSON.stringify({ reviews }));
} catch (error) {
  const failure = error as NodeJS.ErrnoException;
  process.stdout.write(JSON.stringify({ error: { message: failure.message, code: failure.code } }));
}
