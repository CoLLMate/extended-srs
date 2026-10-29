// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSRSFixture } from './fixture.js';
import { withMCP } from './mcpClient.js';

test('stdio validation reports unknown fields as warnings and preserves authored values', async () => {
  const content = `# Validation

<!--@srs
manifest:
  format: extended-srs/v1
  project_name: Warnings
project-overview:
  objective: Example
  extra: {authored: value}
  x-extension: {allowed: true}
@srs-->
`;
  const fixture = await createSRSFixture({ files: { 'srs.md': content } });
  try {
    await withMCP(fixture, async (call) => {
      const response = await call('validate_extended_srs', { include_files: true });
      assert.equal(response.success, true);
      assert.equal(response.result.isComplete, true);
      assert.deepEqual(response.result.errors, []);
      assert.equal(response.result.warnings.length, 1);
      assert.equal(response.result.warnings[0].field, 'project-overview.extra');
      assert.equal(response.result.warnings[0].level, 'warning');
      assert.equal(response.result.warnings[0].path, 'srs.md');
      assert.equal(response.result.warnings[0].line, 9);
      assert.match(response.result.warnings[0].message, /不明なプロパティ "extra".*値は保持します/);
      assert.equal(await fixture.readFile('srs.md'), content);

      await fixture.writeFile('srs.md', content.replace('objective: Example', 'objective: 123'));
      const invalid = await call('validate_extended_srs');
      assert.equal(invalid.result.isComplete, false);
      assert.ok(
        invalid.result.errors.some((error) => error.field === 'project-overview.objective'),
      );
      assert.equal(invalid.result.warnings.length, 1);
    });
  } finally {
    await fixture.cleanup();
  }
});
