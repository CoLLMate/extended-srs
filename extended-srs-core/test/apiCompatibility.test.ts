// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { apiSurface } from '../scripts/api-surface.mjs';

for (const baseline of ['legacy-api-v1.json', 'core-api-v1.json']) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const expected = JSON.parse(
    readFileSync(new URL(`./contracts/${baseline}`, import.meta.url), 'utf8'),
  );
  for (const [entry, surface] of Object.entries(expected)) {
    // Each entry creates a TypeScript program. CI needs more than the default
    // five seconds, especially when collecting coverage on a cold runner.
    it(`preserves public signatures, enum values and members: ${baseline}: ${entry}`, () => {
      const current = apiSurface(root, entry);
      for (const [name, contract] of Object.entries(surface as object)) {
        expect(current[name], `${entry}: ${name}`).toEqual(contract);
      }
    }, 30000);
  }
}
