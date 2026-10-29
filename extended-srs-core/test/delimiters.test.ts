// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
/**
 * Delimiter forms. The specification fixes `<!--@srs` / `@srs-->` with no
 * whitespace. The parser deliberately tolerates whitespace in hand-written
 * documents; both forms must keep parsing to the same result.
 */

import { describe, it, expect } from 'vitest';
import { extractYAMLBlocks, parseYAMLBlock } from '../src/parsing/yamlParser';

const canonical = [
  '# Title',
  '',
  '<!--@srs',
  'manifest:',
  '  format: extended-srs/v1',
  '  project_name: Example',
  '@srs-->',
  '',
].join('\n');
const tolerated = canonical.replace('<!--@srs', '<!-- @srs');

const canonicalPartial = [
  '# Title',
  '',
  '<!--@srs: project-overview',
  'objective: Example',
  '@srs-->',
  '',
].join('\n');
const toleratedPartial = canonicalPartial.replace('<!--@srs:', '<!-- @srs :');

describe('metadata block delimiters', () => {
  it('parses the canonical no-space form defined by the specification', () => {
    const blocks = extractYAMLBlocks(canonical);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].isPartial).toBe(false);
    expect(parseYAMLBlock(blocks[0]).data).toEqual({
      manifest: { format: 'extended-srs/v1', project_name: 'Example' },
    });
  });

  it('tolerates whitespace after <!-- as the same block (deliberate, not a second form)', () => {
    const [a] = extractYAMLBlocks(canonical);
    const [b] = extractYAMLBlocks(tolerated);
    expect(b).toBeDefined();
    expect(parseYAMLBlock(b).data).toEqual(parseYAMLBlock(a).data);
    expect([b.startLine, b.endLine]).toEqual([a.startLine, a.endLine]);
  });

  it('applies the same rule to the partial notation', () => {
    const [a] = extractYAMLBlocks(canonicalPartial);
    const [b] = extractYAMLBlocks(toleratedPartial);
    expect(a.isPartial).toBe(true);
    expect(a.path).toBeDefined();
    expect(b.path).toEqual(a.path);
    expect(parseYAMLBlock(b).data).toEqual(parseYAMLBlock(a).data);
  });
});
