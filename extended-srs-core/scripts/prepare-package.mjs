// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const repositoryRoot = resolve(packageRoot, '..');

// Copy the schema the package validates against. Published archives already
// contain it, so they can build and test without the repository.
if (existsSync(resolve(repositoryRoot, 'schema'))) {
  rmSync(resolve(packageRoot, 'schema'), { recursive: true, force: true });
  cpSync(resolve(repositoryRoot, 'schema'), resolve(packageRoot, 'schema'), { recursive: true });
}
if (!existsSync(resolve(packageRoot, 'schema/extended-srs-schema.json'))) {
  throw new Error(
    'Missing schema/extended-srs-schema.json: use the complete extended-srs checkout or package archive',
  );
}
