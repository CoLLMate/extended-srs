// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleValidate } from '../dist/tools/validate.js';
import { createSRSFixture } from './fixture.js';

test('validate_srs exposes embedded-schema diagnostics without changing the document', async () => {
  const content = `<!--@srs
manifest:
  format: extended-srs/v1
  project_name: Embedded schemas
system-architecture:
  architecture:
    design_principles: [Explicit contracts]
    key_components:
      architecture_graph: graph TD; API
      components:
        - component_id: API
          name: API
          type: backend
          tech_stack: {}
  common_technical_policies:
    error_handling:
      error_response_format:
        type: object
        properties:
          code:
            type: string
            minLenght: 1
        required: [code]
        additionalProperties: false
@srs-->
`;
  const fixture = await createSRSFixture({ files: { 'srs.md': content } });
  try {
    const result = await handleValidate(fixture.specRoot, {});
    assert.equal(result.success, true);
    assert.deepEqual(result.result.errors, []);
    assert.equal(result.result.warnings.length, 1);
    assert.match(result.result.warnings[0].message, /不明な JSON Schema キーワード/);
    assert.equal(
      result.result.warnings[0].field,
      'system-architecture.common_technical_policies.error_handling.error_response_format.properties.code.minLenght',
    );
    assert.equal(result.result.warnings[0].path, 'srs.md');
    assert.equal(result.result.warnings[0].line, 22);
    assert.equal(await fixture.readFile('srs.md'), content);

    await fixture.writeFile('srs.md', content.replace('type: string', 'type: 123'));
    const invalid = await handleValidate(fixture.specRoot, {});
    assert.equal(invalid.result.isComplete, false);
    assert.ok(invalid.result.errors.some((error) => error.field.endsWith('.properties.code.type')));
  } finally {
    await fixture.cleanup();
  }
});
