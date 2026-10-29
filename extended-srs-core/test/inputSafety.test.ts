// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { extractYAMLBlocks, parseYAMLBlock } from '../src/parsing/yamlParser';
import { parsePath, setValueAtPath } from '../src/aggregation/mergeUtils';
import { ExtendedSRSTreeManager } from '../src/tree/manager';
import { validateYAML, validateExtendedSRS } from '../src/validation/validator';
import { createCoreApi } from '../src/api';

describe('untrusted document resource limits', () => {
  it.each(['10000', '4294967294', '9007199254740992', '9'.repeat(400)])(
    'reports oversized partial array index %s as a parse error',
    (index) => {
      const content = `<!--@srs: use-cases: list[${index}]\nuc_id: UC-AUDIT\n@srs-->`;
      const parsed = parseYAMLBlock(extractYAMLBlocks(content)[0]);
      expect(parsed.error).toMatch(/array index/i);
      expect(parsed.data).toBeUndefined();
      const tree = new ExtendedSRSTreeManager();
      tree.loadDocument('srs.md', content);
      expect(tree.getTree().validationErrors[0].message).toMatch(/array index/i);
      expect(tree.exportToMarkdown().get('srs.md')).toBe(content);
    },
  );

  it('retains supported indexes and ordinary extension data', () => {
    expect(parsePath('use-cases: list[0]')).toEqual([
      { key: 'use-cases' },
      { key: 'list', index: 0 },
    ]);
    expect(parsePath('x-list[9999]')).toEqual([{ key: 'x-list', index: 9999 }]);
    const content = '<!--@srs\nx-data: &shared {value: retained}\nx-copy: *shared\n@srs-->';
    const parsed = parseYAMLBlock(extractYAMLBlocks(content)[0]);
    expect(parsed.error).toBeUndefined();
    expect(parsed.data).toEqual({
      'x-data': { value: 'retained' },
      'x-copy': { value: 'retained' },
    });
  });

  it.each([-1, 10000, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects unsafe numeric indexes passed directly to the setter: %s',
    (index) => {
      const target = {};
      expect(() => setValueAtPath(target, [{ key: 'items', index }], 'value')).toThrow(
        /array index/i,
      );
      expect(target).toEqual({});
    },
  );

  it.each(['x-value: &cycle {self: *cycle}', 'x-value: &cycle [*cycle]'])(
    'rejects cyclic YAML data without throwing a stack overflow: %s',
    (yaml) => {
      const content = `<!--@srs\n${yaml}\n@srs-->`;
      const parsed = parseYAMLBlock(extractYAMLBlocks(content)[0]);
      expect(parsed.error).toMatch(/cyclic/i);
      expect(parsed.data).toBeUndefined();
      const tree = new ExtendedSRSTreeManager();
      expect(() => tree.loadDocument('srs.md', content)).not.toThrow();
      expect(tree.getTree().validationErrors[0].message).toMatch(/cyclic/i);
    },
  );

  it('rejects excessive nesting before recursive merge and validation', () => {
    const content = `<!--@srs\nx-data: ${'{child: '.repeat(110)}value${'}'.repeat(110)}\n@srs-->`;
    expect(parseYAMLBlock(extractYAMLBlocks(content)[0]).error).toMatch(/nesting/i);
  });

  it('reports unsafe data through YAML and structured validation entry points', async () => {
    const yaml = await validateYAML('x-data: &cycle {self: *cycle}');
    expect(yaml.isValid).toBe(false);
    expect(yaml.errors[0].message).toMatch(/cyclic/i);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const result = await validateExtendedSRS({ 'x-data': cyclic });
    expect(result.isValid).toBe(false);
    expect(result.errors[0].message).toMatch(/cyclic/i);
    const sparse = [];
    sparse[4294967294] = 'value';
    const oversized = await validateExtendedSRS({ 'x-data': sparse });
    expect(oversized.isValid).toBe(false);
    expect(oversized.errors[0].message).toMatch(/array index/i);
  });

  it('preserves parse errors when aggregating a standalone document', async () => {
    const result = await createCoreApi().aggregateDocuments(
      [{ path: 'draft.md', content: '<!--@srs: items[10000]\nname: invalid\n@srs-->' }],
      { allowStandalone: true },
    );
    expect(result.aggregate.validation.errors[0]).toMatchObject({
      path: 'draft.md',
      level: 'error',
      message: expect.stringMatching(/array index/i),
    });
  });

  it('rejects excessive partial-path nesting and full arrays', () => {
    expect(() => parsePath(Array(101).fill('child').join(':'))).toThrow(/nesting/i);
    const content = `<!--@srs\nx-array: [${Array(10001).fill('0').join(',')}]\n@srs-->`;
    expect(parseYAMLBlock(extractYAMLBlocks(content)[0]).error).toMatch(/array index/i);
  });

  it('the built public API terminates promptly for a tiny sparse-array payload', () => {
    const content =
      '<!--@srs\nmanifest: {format: extended-srs/v1, project_name: audit}\n@srs-->\n<!--@srs: use-cases: list[4294967294]\nuc_id: UC-AUDIT\n@srs-->';
    const script = `const {createCoreApi}=require('./dist/api/index.js');
      createCoreApi().aggregateDocuments([{path:'srs.md',content:${JSON.stringify(content)}}])
        .then(result=>console.log(JSON.stringify(result.aggregate.validation.errors)));`;
    const child = spawnSync(process.execPath, ['--max-old-space-size=192', '-e', script], {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
      timeout: 3000,
      killSignal: 'SIGKILL',
    });
    expect(child.error).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
    expect(
      JSON.parse(child.stdout).some((error: { message: string }) =>
        /array index/i.test(error.message),
      ),
    ).toBe(true);
  });
});
