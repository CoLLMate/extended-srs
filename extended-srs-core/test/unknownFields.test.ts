// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { createCoreApi } from 'extended-srs-core/api';
import { validateExtendedSRS, validateExtendedSRSFile } from 'extended-srs-core';

const requirement = {
  req_id: 'FR-001',
  name: 'Preserve authored data',
  priority: 'must',
  acceptance_criteria: [
    {
      scenario: 'Authored data is retained',
      given: ['A document'],
      when: ['Validated'],
      then: ['Data is retained'],
    },
  ],
};
const block = (data: unknown) => `<!--@srs\n${stringify(data)}@srs-->\n`;

describe('Unknown fields are retained and reported', () => {
  it('does not mutate data and reports the unknown field with its source location', async () => {
    const data = {
      manifest: { format: 'extended-srs/v1', project_name: 'Unknown fields' },
      'functional-requirements': {
        requirements: [{ ...requirement, extra_unknown_field: { keep: ['authored', 'values'] } }],
      },
    };
    const original = structuredClone(data);
    const field = 'functional-requirements.requirements[0].extra_unknown_field';
    const result = await validateExtendedSRS(
      data,
      { [field]: ['requirements.md'] },
      { [field]: [{ filepath: 'requirements.md', lineStart: 12, lineEnd: 12 }] },
    );
    expect(data).toEqual(original);
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        path: 'functional-requirements.requirements.0.extra_unknown_field',
        sourceFile: 'requirements.md',
        line: 13,
        severity: 'warning',
        type: 'unknown-property',
        message: expect.stringContaining('不明なプロパティ "extra_unknown_field"'),
      }),
    ]);
  });

  it.each([
    ['extra_unknown_field', false],
    ['x-notes', true],
  ])(
    'preserves %s during aggregation and reports only prohibited fields',
    async (field, allowed) => {
      const value = { nested: ['keep', { original: true }] };
      const data = {
        'functional-requirements': { requirements: [{ ...requirement, [field]: value }] },
      };
      const documents = [
        {
          path: 'srs.md',
          content: block({
            manifest: {
              format: 'extended-srs/v1',
              project_name: 'Fields',
              files: ['requirements.md'],
            },
          }),
        },
        { path: 'requirements.md', content: block(data) },
      ];
      const original = structuredClone(documents);
      const project = await createCoreApi().aggregateDocuments(documents);
      expect(documents).toEqual(original);
      expect(project.aggregate.srs['functional-requirements']).toEqual(
        data['functional-requirements'],
      );
      expect(project.aggregate.validation.isComplete).toBe(true);
      expect(project.aggregate.validation.errors).toEqual([]);
      if (allowed) {
        expect(project.aggregate.validation.errors).toEqual([]);
        expect(project.aggregate.validation.warnings).toEqual([]);
      } else {
        const line =
          documents[1].content
            .split('\n')
            .findIndex((text) => text.trim().startsWith(`${field}:`)) + 1;
        expect(project.aggregate.validation.warnings).toEqual([
          expect.objectContaining({
            level: 'warning',
            field: `functional-requirements.requirements.0.${field}`,
            path: 'requirements.md',
            line,
            message: expect.stringContaining(`不明なプロパティ "${field}"`),
          }),
        ]);
      }
    },
  );

  it('reports an unknown field during Markdown validation while accepting x-* extensions', async () => {
    const content = block({
      manifest: { format: 'extended-srs/v1', project_name: 'Fields' },
      'functional-requirements': {
        requirements: [
          { ...requirement, extra_unknown_field: 'keep', 'x-notes': { nested: true } },
        ],
      },
    });
    const result = await validateExtendedSRSFile(content);
    const issues = [...result.errors, ...result.warnings];
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('extra_unknown_field');
    expect(issues[0].message).not.toContain('x-notes');
  });
});
