// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { beforeAll, describe, expect, it } from 'vitest';
import {
  clearResolveCache,
  getSchemaNodeForPath,
  initializeExtendedSRSSchemas,
  loadExtendedSRSSchema,
  resolveSchemaReference,
  schemaMap,
  validateExtendedSRS,
  validateYAML,
} from '../src';

const originalSchemas = JSON.stringify(schemaMap);

describe('Referenced Schema fields', () => {
  beforeAll(initializeExtendedSRSSchemas);

  it.each([
    {
      path: ['functional-requirements', 'requirements', '0', 'acceptance_criteria', '0', 'given'],
      yaml: '- A document',
      type: 'array',
    },
    {
      path: ['functional-requirements', 'requirements', 'acceptance_criteria', 'given'],
      yaml: '- A document',
      type: 'array',
    },
    {
      path: ['functional-requirements', 'requirements', '0', 'acceptance_criteria', '0', 'x-notes'],
      yaml: 'nested: allowed',
      type: undefined,
    },
    {
      path: ['functional-requirements', 'requirements', '0', 'status'],
      yaml: 'approved',
      type: 'string',
    },
    { path: ['use-cases', 'list', '0', 'status'], yaml: 'approved', type: 'string' },
  ])('resolves and validates $path', async ({ path, yaml, type }) => {
    const node = getSchemaNodeForPath(loadExtendedSRSSchema(), path);
    expect(node).not.toBeNull();
    expect(node.type).toBe(type);
    expect(await validateYAML(yaml, 0, path, true)).toEqual({
      isValid: true,
      errors: [],
      warnings: [],
    });
  });

  it('applies the same constraints to referenced fields in full and partial validation', async () => {
    const criterion = {
      given: ['A document'],
      when: ['Validated'],
      then: ['Data is retained'],
      'x-notes': { nested: 'allowed' },
    };
    const requirement = {
      req_id: 'FR-001',
      name: 'Example',
      priority: 'must',
      acceptance_criteria: [criterion],
    };
    const data = {
      manifest: { format: 'extended-srs/v1', project_name: 'References' },
      'functional-requirements': { requirements: [requirement] },
    };
    expect((await validateExtendedSRS(data)).isValid).toBe(true);
    const path = ['functional-requirements', 'requirements'];
    expect((await validateYAML(JSON.stringify([requirement]), 0, path, true)).errors).toEqual([]);

    const invalidData = {
      ...data,
      'functional-requirements': {
        requirements: [{ ...requirement, acceptance_criteria: [{ ...criterion, given: [123] }] }],
      },
    };
    expect((await validateExtendedSRS(invalidData)).isValid).toBe(false);
    const invalid = await validateYAML(
      '[123]',
      0,
      [...path, '0', 'acceptance_criteria', '0', 'given'],
      true,
    );
    expect(invalid.isValid).toBe(false);
    expect(invalid.errors[0].message).toContain('string');
    expect(invalid.errors[0].message).not.toContain('不明なパス');
  });

  it('still reports genuinely unknown fields below references', async () => {
    const path = [
      'functional-requirements',
      'requirements',
      '0',
      'acceptance_criteria',
      '0',
      'unknown',
    ];
    expect(getSchemaNodeForPath(loadExtendedSRSSchema(), path)).toBeNull();
    const result = await validateYAML('keep', 0, path, true);
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings[0]).toMatchObject({ type: 'unknown-property', severity: 'warning' });
    expect(result.warnings[0].message).toContain('不明なプロパティ "unknown"');
  });

  it('resolves repeated references throughout the canonical Schema without changing its source', () => {
    const unresolved: string[] = [];
    const visit = (value: any, path: string) => {
      if (!value || typeof value !== 'object') {
        return;
      }
      if (typeof value.$ref === 'string') {
        unresolved.push(`${path}: ${value.$ref}`);
      }
      for (const [key, child] of Object.entries(value)) {
        visit(child, `${path}/${key}`);
      }
    };
    visit(loadExtendedSRSSchema(), '');
    // Recursive meta-schemas remain references; expanding them as finite SRS fields
    // would either truncate the definition or recurse indefinitely.
    expect(unresolved.length).toBeGreaterThan(0);
    expect(
      unresolved.every((ref) => ref.endsWith(': http://json-schema.org/draft-07/schema#')),
    ).toBe(true);
    expect(JSON.stringify(schemaMap)).toBe(originalSchemas);
  });
});

describe('Reference documents and fragments', () => {
  it.each([
    'common-definitions-schema.json#/definitions/status',
    './schemas/common-definitions-schema.json#/definitions/status',
    'https://exsrs.org/extended-srs/v1/schemas/common-definitions.json#/definitions/status',
  ])('resolves %s without loading external resources', (ref) => {
    expect(resolveSchemaReference(ref)).toMatchObject({
      type: 'string',
      enum: expect.arrayContaining(['approved']),
    });
  });

  it('keeps anonymous and same-id document reference caches separate', () => {
    for (const id of [undefined, 'same-id']) {
      const first = { $id: id, definitions: { value: { type: 'string' } } };
      const second = { $id: id, definitions: { value: { type: 'number' } } };
      expect(resolveSchemaReference('#/definitions/value', first)).toEqual({ type: 'string' });
      expect(resolveSchemaReference('#/definitions/value', second)).toEqual({ type: 'number' });
    }
  });

  it('supports root fragments, escaped JSON pointers and boolean schemas', () => {
    const schema = { definitions: { 'a/b~c': { type: 'string' }, never: false } };
    expect(resolveSchemaReference('#', schema)).toEqual(schema);
    expect(resolveSchemaReference('#/definitions/a~1b~0c', schema)).toEqual({ type: 'string' });
    expect(resolveSchemaReference('#/definitions/never', schema)).toBe(false);
    expect(resolveSchemaReference('#/constructor', schema)).toBeNull();
    expect(resolveSchemaReference('#/definitions/missing', schema)).toBeNull();
  });

  it.each([
    'constructor',
    '__proto__',
    'missing.json#/definitions/value',
    '#named-anchor',
    '#/%ZZ',
  ])('returns null for an unavailable reference %s', (ref) => {
    expect(resolveSchemaReference(ref, { definitions: {} })).toBeNull();
  });

  it('clears cached local reference values', () => {
    const schema = { definitions: { value: { type: 'string' } } };
    const first = resolveSchemaReference('#/definitions/value', schema);
    expect(resolveSchemaReference('#/definitions/value', schema)).toBe(first);
    schema.definitions.value.type = 'number';
    clearResolveCache();
    expect(resolveSchemaReference('#/definitions/value', schema)).toEqual({ type: 'number' });
  });
});
