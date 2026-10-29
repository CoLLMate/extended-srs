// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
/**
 * Documents must not be able to write to Object.prototype through metadata
 * paths (`<!--@srs: __proto__: x`) or YAML mapping keys (prototype pollution).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { parseExtendedSRS } from '../src/parsing/yamlParser';
import { ExtendedSRSTreeManager } from '../src/tree/manager';
import { ExtendedSRSAggregator } from '../src/aggregation/aggregator';
import { validateExtendedSRS } from '../src/validation/validator';
import {
  deepMerge,
  parsePath,
  setValueAtPath,
  getValueAtPath,
  removeValueAtPath,
} from '../src/aggregation/mergeUtils';

const probe = () => ({}) as Record<string, unknown>;
const PROBES = ['polluted', 'polluted2', 'polluted3', 'polluted4'];

afterEach(() => {
  // Contain the damage if a guard ever regresses: other tests must not see it.
  for (const key of PROBES) {
    delete (Object.prototype as Record<string, unknown>)[key];
  }
});

describe('prototype pollution guards', () => {
  it('read and remove paths cannot access inherited objects or shared prototypes', () => {
    const inherited = { value: 'preserve' };
    const target = Object.create({ inherited });
    expect(getValueAtPath(target, parsePath('inherited: value'))).toBeUndefined();
    removeValueAtPath(target, parsePath('inherited: value'));
    expect(inherited.value).toBe('preserve');
    (Object.prototype as Record<string, unknown>).polluted4 = 'preserve';
    removeValueAtPath({}, parsePath('__proto__: polluted4'));
    expect(probe().polluted4).toBe('preserve');
  });

  it('array indexes cannot traverse inherited entries', () => {
    const inherited = { value: 'preserve' };
    const array = Object.setPrototypeOf([], { 0: inherited });
    const target = { items: array };
    expect(getValueAtPath(target, parsePath('items[0]: value'))).toBeUndefined();
    removeValueAtPath(target, parsePath('items[0]: value'));
    expect(inherited.value).toBe('preserve');
    setValueAtPath(target, parsePath('items[0]: value'), 'own value');
    expect(target.items[0].value).toBe('own value');
    expect(inherited.value).toBe('preserve');
  });

  it('splitting metadata cannot delete an inherited prototype property', () => {
    (Object.prototype as Record<string, unknown>).polluted4 = 'preserve';
    const content = '<!--@srs\nmanifest: {project_name: audit}\n@srs-->';
    const manager = new ExtendedSRSTreeManager();
    manager.loadDocument('srs.md', content);
    const location = manager.getTree().metadataBlocks[0].location;
    expect(manager.getValueAt('__proto__.polluted4')).toBeUndefined();
    manager.splitMetadataBlock(location, '__proto__: polluted4');
    expect(probe().polluted4).toBe('preserve');
    expect(manager.exportToMarkdown().get('srs.md')).toBe(content);
  });

  it('partial-path blocks cannot reach Object.prototype', () => {
    const doc = [
      '# T',
      '',
      '<!--@srs',
      'manifest:',
      '  format: extended-srs/v1',
      '  project_name: T',
      '@srs-->',
      '',
      '<!--@srs: __proto__: polluted',
      'value: 1',
      '@srs-->',
      '',
      '<!--@srs: constructor: prototype: polluted3',
      'value: 1',
      '@srs-->',
      '',
    ].join('\n');
    const parsed = parseExtendedSRS(doc);
    expect(probe().polluted).toBeUndefined();
    expect(probe().polluted3).toBeUndefined();
    expect(parsed?.srsData.manifest.project_name).toBe('T');
  });

  it('YAML __proto__ keys are ignored by the tree merge and by aggregation', async () => {
    const doc = [
      '# T',
      '',
      '<!--@srs',
      'manifest:',
      '  format: extended-srs/v1',
      '  project_name: T',
      '__proto__:',
      '  polluted2: yes',
      '@srs-->',
      '',
    ].join('\n');

    const manager = new ExtendedSRSTreeManager();
    manager.loadDocument('srs.md', doc);
    manager.getTree();
    expect(probe().polluted2).toBeUndefined();

    const files = [
      { path: 'srs.md', name: 'srs.md', is_directory: false, size: doc.length, modified: '' },
    ];
    const result = await new ExtendedSRSAggregator(
      new Map([['srs.md', { content: doc }]]),
      files,
    ).aggregate();
    expect(probe().polluted2).toBeUndefined();
    expect(result.srs.manifest.project_name).toBe('T');

    // The validator keeps working afterwards (pollution used to break Ajv).
    const validation = await validateExtendedSRS({
      manifest: { format: 'extended-srs/v1', project_name: 'T' },
    });
    expect(validation.isValid).toBe(true);
  });

  it('merge utilities skip unsafe keys and paths', () => {
    const target: Record<string, unknown> = {};
    deepMerge(target, JSON.parse('{"__proto__": {"polluted4": 1}, "ok": 1}'));
    expect(probe().polluted4).toBeUndefined();
    expect(target.ok).toBe(1);

    setValueAtPath(target, parsePath('__proto__: polluted4'), 1);
    expect(probe().polluted4).toBeUndefined();
  });
});
