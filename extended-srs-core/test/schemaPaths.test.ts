// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { beforeAll, describe, expect, it } from 'vitest';
import {
  getSchemaNodeForPath,
  initializeExtendedSRSSchemas,
  loadExtendedSRSSchema,
  validateYAML,
  validateExtendedSRSFile,
} from '../src';

describe('Schema paths for known, unknown and extension fields', () => {
  beforeAll(initializeExtendedSRSSchemas);

  it.each(
    [
      ['functional-requirements', 'requirements', '0', 'req_id'],
      ['functional-requirements', 'requirements', '12', 'req_id'],
      ['functional-requirements', 'requirements', 'req_id'],
    ].map((path) => ({ path })),
  )('resolves the field Schema for $path', ({ path }) => {
    expect(getSchemaNodeForPath(loadExtendedSRSSchema(), path)).toMatchObject({ type: 'string' });
  });

  it.each(
    [
      ['manifest', 'extra_unknown_field'],
      ['system-architecture', 'components'],
      ['functional-requirements', 'requirements', '0', 'extra_unknown_field'],
      ['functional-requirements', 'requirements', 'extra_unknown_field'],
      ['functional-requirements', 'requirements', '0', 'req_id', 'extra_unknown_field'],
      ['manifest', 'constructor'],
      ['manifest', 'toString'],
    ].map((path) => ({ path })),
  )('does not return an unrelated Schema for $path', ({ path }) => {
    expect(getSchemaNodeForPath(loadExtendedSRSSchema(), path)).toBeNull();
  });

  it.each(
    [
      ['manifest', 'x-notes'],
      ['manifest', 'x-notes', 'nested', '0', 'value'],
      ['functional-requirements', 'requirements', '0', 'x-notes'],
      ['functional-requirements', 'requirements', 'x-notes', 'nested', 'value'],
    ].map((path) => ({ path })),
  )('recognizes an explicitly permitted extension at $path', ({ path }) => {
    expect(getSchemaNodeForPath(loadExtendedSRSSchema(), path)).toEqual({});
  });

  it('resolves nested arrays with explicit indices or omitted indices', () => {
    const schema = {
      type: 'array',
      items: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' } } } },
    };
    expect(getSchemaNodeForPath(schema, ['0', '1', 'name'])).toEqual({ type: 'string' });
    expect(getSchemaNodeForPath(schema, ['name'])).toEqual({ type: 'string' });
    expect(getSchemaNodeForPath(schema, ['unknown'])).toBeNull();
  });

  it('uses numeric object keys as properties', () => {
    const schema = { type: 'object', properties: { '0': { type: 'number' } } };
    expect(getSchemaNodeForPath(schema, ['0'])).toEqual({ type: 'number' });
  });

  it('uses declared pattern and additional-property schemas', () => {
    const schema = {
      type: 'object',
      patternProperties: { '^x-': { type: 'string' } },
      additionalProperties: { type: 'number' },
    };
    expect(getSchemaNodeForPath(schema, ['x-score'])).toEqual({ type: 'string' });
    expect(getSchemaNodeForPath(schema, ['score'])).toEqual({ type: 'number' });
    expect(getSchemaNodeForPath({ additionalProperties: true }, ['custom', 'nested'])).toEqual({});
    expect(getSchemaNodeForPath(true, ['custom', 'nested'])).toEqual({});
  });

  it('resolves tuple indices without treating a property name as an index', () => {
    const schema = {
      type: 'array',
      items: [{ type: 'string' }, { type: 'object', properties: { name: { type: 'string' } } }],
      additionalItems: false,
    };
    expect(getSchemaNodeForPath(schema, ['0'])).toEqual({ type: 'string' });
    expect(getSchemaNodeForPath(schema, ['1', 'name'])).toEqual({ type: 'string' });
    expect(getSchemaNodeForPath(schema, ['name'])).toBeNull();
    expect(getSchemaNodeForPath(schema, ['2'])).toBe(false);
    expect(getSchemaNodeForPath(schema, ['2', 'name'])).toBeNull();
    expect(getSchemaNodeForPath({ items: [] }, ['0', 'custom'])).toEqual({});
  });

  it.each(['-1', '01', '1.5'])("does not treat '%s' as an array index", (index) => {
    const schema = { type: 'array', items: { type: 'string' } };
    expect(getSchemaNodeForPath(schema, [index])).toBeNull();
  });

  it.each(
    [
      ['functional-requirements', 'requirements', '0', 'req_id'],
      ['functional-requirements', 'requirements', 'req_id'],
    ].map((path) => ({ path })),
  )('validates a known partial field against its own Schema at $path', async ({ path }) => {
    const valid = await validateYAML('FR-001', 0, path, true);
    expect(valid.errors).toEqual([]);
    const invalid = await validateYAML('123', 0, path, true);
    expect(invalid.isValid).toBe(false);
    expect(invalid.errors[0].message).toContain('型が一致しません');
  });

  it.each(
    [
      ['manifest', 'extra_unknown_field'],
      ['system-architecture', 'components'],
      ['functional-requirements', 'requirements', '0', 'extra_unknown_field'],
      ['functional-requirements', 'requirements', 'extra_unknown_field'],
    ].map((path) => ({ path })),
  )(
    'reports an unknown partial path instead of silently accepting it at $path',
    async ({ path }) => {
      const result = await validateYAML('keep this value', 7, path, true);
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([
        expect.objectContaining({
          path: path.join('.'),
          line: 7,
          severity: 'warning',
          type: 'unknown-property',
          message: expect.stringContaining('定義されていません'),
        }),
      ]);
      expect(result.warnings[0].message).toContain(path.at(-1));
    },
  );

  it('reports an unknown partial path through Markdown validation', async () => {
    const result = await validateExtendedSRSFile(
      '# Draft\n\n<!--@srs: manifest.extra_unknown_field\nkeep this value\n@srs-->',
    );
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        path: 'manifest.extra_unknown_field',
        line: 3,
        message: expect.stringContaining('定義されていません'),
      }),
    ]);
  });

  it('accepts arbitrary content under an allowed extension partial path', async () => {
    const result = await validateYAML(
      'nested:\n  values: [1, two, null]',
      0,
      ['manifest', 'x-notes'],
      true,
    );
    expect(result).toEqual({ isValid: true, errors: [], warnings: [] });
  });
});
