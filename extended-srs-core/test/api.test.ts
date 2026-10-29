// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { createCoreApi } from '../src/api';

const block = (data: unknown) => `<!--@srs\n${JSON.stringify(data)}\n@srs-->\n`;
const definition = (status: string) => ({
  'functional-requirements': { requirements: [{ req_id: 'FR-1', name: 'Example', status }] },
});

describe.each([false, true])('partial field values (standalone: %s)', (standalone) => {
  it.each([
    { path: ['project-overview', 'objective'], value: '更新した目的' },
    { path: ['project-overview', 'objective'], value: '' },
    { path: ['manifest', 'authors'], value: ['Author A', 'Author B'] },
    { path: ['manifest', 'authors'], value: [] },
    { path: ['manifest', 'created'], value: 0 },
    { path: ['workflow', 'config', 'consistency_check', 'enabled'], value: false },
  ])('preserves $path = $value during aggregation', async ({ path, value }) => {
    const base = {
      manifest: {
        format: 'extended-srs/v1',
        project_name: 'Partial fields',
        authors: ['Original author'],
        created: 1,
      },
      'project-overview': { objective: 'Original objective', context: 'Preserved context' },
      workflow: { config: { consistency_check: { enabled: true } } },
    };
    const expected: any = structuredClone(base);
    let parent = expected;
    for (const key of path.slice(0, -1)) {
      parent = parent[key];
    }
    parent[path.at(-1)!] = value;
    const content =
      block(base) + `<!--@srs: ${path.join(': ')}\n${JSON.stringify(value)}\n@srs-->\n`;
    const documents = [{ path: standalone ? 'draft.md' : 'srs.md', content }];
    const project = await createCoreApi().aggregateDocuments(documents, {
      allowStandalone: standalone,
    });

    expect(project.aggregate.srs).toEqual(expected);
    expect(project.aggregate.validation.errors).toEqual([]);
    expect(documents[0].content).toBe(content);
    if (!standalone) {
      expect(project.aggregate.fieldSources?.[path.join('.')]).toContain('srs.md');
    }
  });
});

describe('core public API v1', () => {
  it('aggregates in manifest order and exposes effective status and source paths', async () => {
    const api = createCoreApi();
    expect(api.apiVersion).toBe(1);
    const documents = [
      { path: 'ignored.md', content: block(definition('verified')) },
      { path: 'last.md', content: block(definition('approved')) },
      { path: 'first.md', content: block(definition('draft')) },
      {
        path: 'srs.md',
        content: block({
          manifest: {
            format: 'extended-srs/v1',
            project_name: 'API',
            files: ['first.md', 'last.md'],
          },
        }),
      },
    ];
    const original = JSON.stringify(documents);
    const project = await api.aggregateDocuments(documents);
    expect(project.documents.map((document) => document.path)).toEqual([
      'srs.md',
      'first.md',
      'last.md',
    ]);
    expect(project.metadata.hasFunctionalRequirements).toBe(true);
    expect(api.findElement(project, 'FR-1')).toMatchObject({
      status: 'approved',
      source_files: ['first.md', 'last.md'],
    });
    expect(api.findElement(project, 'missing')).toBeUndefined();
    expect(api.getProjectState(project.aggregate.srs).elements[0].status).toBe('approved');
    expect(JSON.stringify(documents)).toBe(original);
  });

  it('supports explicit standalone document analysis without weakening normal entry validation', async () => {
    const api = createCoreApi();
    const documents = [
      { path: 'draft.md', content: block({ requirements: [{ req_id: 'FR-1' }] }) },
    ];
    const normal = await api.aggregateDocuments(documents);
    expect(normal.aggregate.validation.errors.length).toBeGreaterThan(0);
    expect(api.findElement(normal, 'FR-1')).toBeUndefined();
    const standalone = await api.aggregateDocuments(documents, { allowStandalone: true });
    expect(api.findElement(standalone, 'FR-1')).toMatchObject({ status: 'draft' });
  });

  it('pairs by source boundaries, including adjacent, invalid, empty and partial blocks', () => {
    const api = createCoreApi();
    const content =
      block({ req_id: 'FR-A' }) +
      block({ req_id: 'FR-B' }) +
      '# B\nB text.\n' +
      '<!--@srs\n[broken\n@srs-->\nBroken text.\n' +
      block({}) +
      'Empty text.\n' +
      '<!--@srs: use-cases\nlist:\n  - uc_id: UC-1\n@srs-->\n# Use case\nUC text.\n';
    const result = api.extractConsistencyPairs(content);
    expect(result.total_yaml_blocks).toBe(5);
    expect(result.pairs.map((pair) => pair.index)).toEqual([1, 4]);
    expect(result.pairs[0]).toMatchObject({ yaml: { req_id: 'FR-B' }, headings: ['B'] });
    expect(result.pairs[0].markdown.trim()).toBe('# B\nB text.');
    expect(result.pairs[1]).toMatchObject({
      is_partial: true,
      partial_path: 'use-cases',
      headings: ['Use case'],
    });
    const lines = content.split('\n');
    for (const pair of result.pairs) {
      expect(lines.slice(pair.markdown_lines.start, pair.markdown_lines.end + 1).join('\n')).toBe(
        pair.markdown,
      );
    }
    expect(api.extractConsistencyPairs(content, 'FR-B').pairs).toEqual([result.pairs[0]]);
    expect(api.extractConsistencyPairs(content, 'FR-A').pairs).toEqual([]);
    expect(api.extractConsistencyPairs('plain prose')).toEqual({
      total_yaml_blocks: 0,
      total_pairs: 0,
      pairs: [],
    });
  });

  it('keeps lifecycle, review and work decisions available through the typed interface', async () => {
    const api = createCoreApi();
    const source = definition('draft');
    const metadata = { id: 1, actor: 'browser', timestamp: '2026-10-28T00:00:00Z' };
    const pending = api.createReview(
      source,
      { element_id: 'FR-1', gate_type: 'content' },
      metadata,
    );
    const resolution = api.resolveReview(
      source,
      [pending],
      { element_id: 'FR-1', review_id: 1 },
      'approved',
      metadata,
    );
    expect(resolution.review.status).toBe('approved');
    expect(api.getReviewHistory([resolution.review])[0].status).toBe('approved');
    expect(api.getUnblockedElements(source).elements[0].ready_for).toBe('spec');
    expect(api.getWorkflowConfig(source)).toEqual({});
    expect(api.extractElements(source)[0].element_id).toBe('FR-1');
    const change = api.planElementStatusChange([{ path: 'srs.md', content: block(source) }], {
      element_id: 'FR-1',
      action: 'approve',
    });
    expect(change.new_status).toBe('approved');
  });
});
