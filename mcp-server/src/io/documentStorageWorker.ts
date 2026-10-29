// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { StoredDocument } from './documentStorage.js';
import { lockFile } from './fileLock.js';

// Isolated process: cwd remains a stable directory reference across renames.
// Hold each directory descriptor until entry has been verified against it.
function verifyCwd(fd: number): void {
  const expected = fs.fstatSync(fd, { bigint: true });
  const actual = fs.statSync('.', { bigint: true });
  if (!expected.isDirectory() || expected.dev !== actual.dev || expected.ino !== actual.ino) {
    throw new Error('Unsafe SRS path: directory changed while entering it');
  }
}

function enter(name: string): void {
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
}

function read(name: string): { content: string; stat: fs.Stats } {
  const fd = fs.openSync(
    name,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
  );
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) {
      throw new Error('Unsafe SRS path: expected a regular file');
    }
    return { content: fs.readFileSync(fd, 'utf8'), stat };
  } finally {
    fs.closeSync(fd);
  }
}

function document(name: string, relative: string): StoredDocument {
  const { content, stat } = read(name);
  return {
    path: relative,
    name,
    is_directory: false,
    size: stat.size,
    modified: stat.mtime.toISOString(),
    content,
  };
}

function scan(prefix: string): StoredDocument[] {
  const documents: StoredDocument[] = [];
  const parent = process.cwd();
  const fd = fs.openSync('.', fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
  try {
    const entries = fs
      .readdirSync('.', { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (
        entry.name === 'node_modules' ||
        entry.name === '.srs-mutation.lock' ||
        entry.isSymbolicLink()
      ) {
        continue;
      }
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        enter(entry.name);
        documents.push(...scan(relative));
        process.chdir(parent);
        verifyCwd(fd);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        documents.push(document(entry.name, relative));
      }
    }
  } finally {
    fs.closeSync(fd);
  }
  return documents;
}

function replaceLocked(name: string, expected: string, content: string): void {
  const original = read(name);
  if (original.content !== expected) {
    throw new Error('SRS document changed concurrently; retry the operation');
  }
  const temporary = `.${name}.${randomUUID()}.tmp`;
  const fd = fs.openSync(
    temporary,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
    original.stat.mode & 0o777,
  );
  let installed = false;
  try {
    try {
      fs.writeFileSync(fd, content, 'utf8');
    } finally {
      fs.closeSync(fd);
    }
    const current = fs.lstatSync(name);
    if (
      !current.isFile() ||
      current.dev !== original.stat.dev ||
      current.ino !== original.stat.ino
    ) {
      throw new Error('Unsafe SRS path: file changed before replacement');
    }
    const latest = read(name);
    if (
      latest.content !== expected ||
      latest.stat.dev !== original.stat.dev ||
      latest.stat.ino !== original.stat.ino
    ) {
      throw new Error('SRS document changed concurrently; retry the operation');
    }
    // rename replaces a last-moment symlink itself, without following it.
    fs.renameSync(temporary, name);
    installed = true;
  } finally {
    if (!installed) {
      fs.unlinkSync(temporary);
    }
  }
}

function replace(name: string, expected: string, content: string): void {
  const release = lockFile(name, 'SRS');
  try {
    replaceLocked(name, expected, content);
  } finally {
    release();
  }
}

try {
  verifyCwd(3);
  const request = JSON.parse(fs.readFileSync(0, 'utf8'));
  let documents: StoredDocument[] = [];
  if (request.operation === 'scan') {
    documents = scan('');
  } else {
    const parts: string[] = typeof request.file === 'string' ? request.file.split('/') : [];
    if (
      !parts.length ||
      parts.some((part) => !part || part === '.' || part === '..' || /[\\\0]/.test(part))
    ) {
      throw new Error('Unsafe SRS path: invalid file components');
    }
    const name = parts.pop()!;
    for (const part of parts) {
      enter(part);
    }
    if (request.operation === 'read') {
      documents = [document(name, request.file)];
    } else {
      replace(name, request.expected, request.content);
    }
  }
  process.stdout.write(JSON.stringify({ documents }));
} catch (error) {
  const failure = error as NodeJS.ErrnoException;
  process.stdout.write(JSON.stringify({ error: { message: failure.message, code: failure.code } }));
}
