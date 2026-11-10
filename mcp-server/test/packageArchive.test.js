// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const core = 'node_modules/extended-srs-core';

/** Lists the files `npm pack` would archive, without building or writing the archive. */
function archivePaths() {
  const env = { ...process.env };
  delete env.NODE_V8_COVERAGE;
  const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: packageRoot,
    encoding: 'utf8',
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Set(JSON.parse(output)[0].files.map((file) => file.path));
}

/** Resolves a dependency the way Node.js does, using only files inside the archive. */
function resolveInArchive(paths, fromDirectory, name) {
  for (let directory = fromDirectory; ; directory = path.posix.dirname(directory)) {
    const candidate = path.posix.join(directory, 'node_modules', name);
    if (paths.has(`${candidate}/package.json`)) {
      return candidate;
    }
    if (directory === '.') {
      return undefined;
    }
  }
}

test('the package archive bundles core with every runtime dependency it needs', () => {
  const paths = archivePaths();
  assert.deepEqual(
    [...paths].filter((file) => file.split('/').includes('..')),
    [],
    'archive entries must stay inside the package',
  );
  assert.ok(paths.has(`${core}/dist/api/index.js`), 'the built core API must be bundled');

  const pending = [core];
  const seen = new Set(pending);
  while (pending.length > 0) {
    const directory = pending.pop();
    const manifest = JSON.parse(
      readFileSync(path.join(packageRoot, directory, 'package.json'), 'utf8'),
    );
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      const resolved = resolveInArchive(paths, directory, name);
      assert.ok(resolved, `${name} required by ${directory} is missing from the archive`);
      if (!seen.has(resolved)) {
        seen.add(resolved);
        pending.push(resolved);
      }
    }
  }
});
