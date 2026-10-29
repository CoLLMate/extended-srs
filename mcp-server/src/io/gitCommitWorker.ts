// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import * as fs from 'node:fs';
import * as path from 'node:path';
import { git, literalPath } from './git.js';

// Keep Git in the directory selected when the operation began. Resolving the
// root path again after persistence could stage files from a replacement root.
let commitSha: string | null = null;
try {
  const expected = fs.fstatSync(3, { bigint: true });
  const actual = fs.statSync('.', { bigint: true });
  if (!expected.isDirectory() || expected.dev !== actual.dev || expected.ino !== actual.ino) {
    throw new Error('SRS root changed before commit');
  }
  const { relativePath, message } = JSON.parse(fs.readFileSync(0, 'utf8'));
  const project = fs.realpathSync('.');
  const repository = fs.realpathSync(git(['rev-parse', '--show-toplevel'], '.').trim());
  const filename = path.resolve(project, relativePath);
  const withinProject = path.relative(project, filename);
  const withinRepo = path.relative(repository, filename);
  if (
    [withinProject, withinRepo].some(
      (name) => name === '..' || name.startsWith('../') || path.isAbsolute(name),
    )
  ) {
    throw new Error('File is outside the SRS root or repository');
  }
  // All filesystem and Git operations are relative to the pinned cwd.
  let current = '.';
  const components = withinProject.split(path.sep);
  for (const [index, component] of components.entries()) {
    current = path.join(current, component);
    const stat = fs.lstatSync(current);
    if (
      stat.isSymbolicLink() ||
      (index === components.length - 1 ? !stat.isFile() : !stat.isDirectory())
    ) {
      throw new Error('File path changed before commit');
    }
  }
  const spec = literalPath(withinProject);
  git(['add', '--', spec], '.');
  if (git(['diff', '--cached', '--name-only', '--', spec], '.').trim()) {
    git(['commit', '-m', message, '--', spec], '.');
  }
  commitSha = git(['rev-parse', 'HEAD'], '.').trim();
} catch {
  // Document persistence is independent of best-effort Git commits.
}
process.stdout.write(JSON.stringify({ commitSha }));
