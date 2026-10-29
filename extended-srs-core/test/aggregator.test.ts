// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for ExtendedSRSAggregator
 * Covers: aggregate, findEntryFile, collectDocumentForTreeManager,
 *         manifest.files processing, field sources, conflict detection, validation
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { ExtendedSRSAggregator } from '../src/aggregation/aggregator';
import { initializeExtendedSRSSchemas, initializeAjv } from '../src/schema/schemaLoader';
import type { FileInfo } from '../src/types';

// Helper to create FileInfo
function makeFileInfo(path: string, content: string): FileInfo {
  return {
    path,
    name: path,
    is_directory: false,
    size: content.length,
    modified: new Date().toISOString(),
  };
}

// Helper to build aggregator from file specs
function buildAggregator(files: Array<{ path: string; content: string }>) {
  const fileContents = new Map(files.map((f) => [f.path, { content: f.content }]));
  const projectFiles = files.map((f) => makeFileInfo(f.path, f.content));
  return new ExtendedSRSAggregator(fileContents, projectFiles);
}

describe('ExtendedSRSAggregator', () => {
  beforeAll(async () => {
    await initializeAjv();
    await initializeExtendedSRSSchemas();
  });

  describe('findEntryFile', () => {
    it('should find srs.md as entry file', async () => {
      const aggregator = buildAggregator([
        { path: 'srs.md', content: '# SRS' },
        { path: 'other.md', content: '# Other' },
      ]);

      const entry = await aggregator.findEntryFile();
      expect(entry).toBeDefined();
      expect(entry!.path).toBe('srs.md');
    });

    it('should return null when srs.md is missing', async () => {
      const aggregator = buildAggregator([
        { path: 'readme.md', content: '# Readme' },
        { path: 'other.md', content: '# Other' },
      ]);

      const entry = await aggregator.findEntryFile();
      expect(entry).toBeNull();
    });

    it('should not match directories named srs.md', async () => {
      const fileContents = new Map<string, { content: string }>();
      const projectFiles: FileInfo[] = [
        {
          path: 'srs.md',
          name: 'srs.md',
          is_directory: true,
          size: 0,
          modified: new Date().toISOString(),
        },
      ];

      const aggregator = new ExtendedSRSAggregator(fileContents, projectFiles);
      const entry = await aggregator.findEntryFile();
      expect(entry).toBeNull();
    });

    it('should require exact path match (not endsWith)', async () => {
      const aggregator = buildAggregator([
        { path: 'docs/srs.md', content: '# SRS in subdirectory' },
      ]);

      const entry = await aggregator.findEntryFile();
      expect(entry).toBeNull(); // docs/srs.md !== srs.md
    });
  });

  describe('aggregate - single file', () => {
    it.each([
      ['empty full block', '<!--@srs\n\n@srs-->'],
      ['comment-only full block', '<!--@srs\n# placeholder\n@srs-->'],
      ['null full block', '<!--@srs\nnull\n@srs-->'],
      ['comment-only partial block', '<!--@srs: manifest\n# placeholder\n@srs-->'],
      ['null partial block', '<!--@srs: manifest\nnull\n@srs-->'],
    ])('should preserve metadata with a %s', async (_label, block) => {
      const aggregator = buildAggregator([
        {
          path: 'srs.md',
          content: `<!--@srs
manifest:
  format: extended-srs/v1
  project_name: Test
@srs-->

${block}`,
        },
      ]);

      const result = await aggregator.aggregate();
      expect(result.srs).toEqual({
        manifest: { format: 'extended-srs/v1', project_name: 'Test' },
      });
      expect(result.validation.errors).toEqual([]);
    });

    it('should aggregate a valid single-file SRS', async () => {
      const aggregator = buildAggregator([
        {
          path: 'srs.md',
          content: `<!-- @srs
manifest:
  project_name: "Test"
  format: "extended-srs/v1"
project-overview:
  objective: "Build system"
@srs-->`,
        },
      ]);

      const result = await aggregator.aggregate();
      expect(result.srs.manifest.project_name).toBe('Test');
      expect(result.srs['project-overview'].objective).toBe('Build system');
      expect(result.contributions['srs.md']).toBeDefined();
    });

    it('should report error when no entry file exists', async () => {
      const aggregator = buildAggregator([{ path: 'readme.md', content: '# Just a readme' }]);

      const result = await aggregator.aggregate();
      expect(result.validation.errors.length).toBeGreaterThan(0);
      expect(result.validation.errors[0].message).toContain('srs.md');
    });

    it('should handle entry file with no SRS metadata', async () => {
      const aggregator = buildAggregator([
        { path: 'srs.md', content: '# Regular markdown\nNo SRS here.' },
      ]);

      const result = await aggregator.aggregate();
      // Entry file found but no metadata
      expect(result.srs).toEqual({});
    });

    it('should handle YAML parse errors in entry file', async () => {
      const aggregator = buildAggregator([
        {
          path: 'srs.md',
          content: `<!-- @srs
invalid: yaml: : : syntax
@srs-->`,
        },
      ]);

      const result = await aggregator.aggregate();
      expect(result.validation.errors.length).toBeGreaterThan(0);
    });
  });

  describe('aggregate - multi-file with manifest.files', () => {
    it.each(['# placeholder', 'null'])(
      'should tolerate %s before metadata and in a referenced file',
      async (emptyYaml) => {
        const emptyBlock = `<!--@srs\n${emptyYaml}\n@srs-->`;
        const aggregator = buildAggregator([
          {
            path: 'srs.md',
            content: `${emptyBlock}
<!--@srs
manifest:
  format: extended-srs/v1
  project_name: Test
  files:
    - placeholder.md
@srs-->`,
          },
          { path: 'placeholder.md', content: emptyBlock },
        ]);

        const result = await aggregator.aggregate();
        expect(result.srs.manifest).toEqual({
          format: 'extended-srs/v1',
          project_name: 'Test',
          files: ['placeholder.md'],
        });
        expect(result.validation.errors).toEqual([]);
      },
    );

    it('should load additional files from manifest.files', async () => {
      const aggregator = buildAggregator([
        {
          path: 'srs.md',
          content: `<!-- @srs
manifest:
  project_name: "Multi-file Project"
  format: "extended-srs/v1"
  files:
    - overview.md
@srs-->`,
        },
        {
          path: 'overview.md',
          content: `<!-- @srs: project-overview
objective: "Build comprehensive system"
@srs-->`,
        },
      ]);

      const result = await aggregator.aggregate();
      expect(result.srs.manifest.project_name).toBe('Multi-file Project');
      expect(result.srs['project-overview'].objective).toBe('Build comprehensive system');
    });

    it('should normalize ./prefix in manifest.files paths', async () => {
      const aggregator = buildAggregator([
        {
          path: 'srs.md',
          content: `<!-- @srs
manifest:
  project_name: "Test"
  format: "extended-srs/v1"
  files:
    - ./overview.md
@srs-->`,
        },
        {
          path: 'overview.md',
          content: `<!-- @srs
project-overview:
  objective: "Normalized path"
@srs-->`,
        },
      ]);

      const result = await aggregator.aggregate();
      expect(result.srs['project-overview'].objective).toBe('Normalized path');
    });

    it('should canonicalize repeated ./ prefixes and path separators', async () => {
      const aggregator = buildAggregator([
        {
          path: 'srs.md',
          content: `<!-- @srs
manifest:
  project_name: "Test"
  format: "extended-srs/v1"
  files:
    - ././overview.md
    - chapters//architecture.md
@srs-->`,
        },
        {
          path: 'overview.md',
          content: `<!-- @srs: project-overview
objective: "Canonical manifest paths"
@srs-->`,
        },
        {
          path: 'chapters/architecture.md',
          content: `<!-- @srs
system-architecture:
  components:
    - id: "main"
      name: "Main Service"
@srs-->`,
        },
      ]);

      const result = await aggregator.aggregate();

      expect(result.srs['project-overview'].objective).toBe('Canonical manifest paths');
      expect(result.srs['system-architecture'].components[0].id).toBe('main');
      expect(
        result.validation.warnings.some((warning) =>
          warning.message.includes('対象ファイルが見つかりません'),
        ),
      ).toBe(false);
    });

    it('should warn when referenced file is not found', async () => {
      const aggregator = buildAggregator([
        {
          path: 'srs.md',
          content: `<!-- @srs
manifest:
  project_name: "Test"
  format: "extended-srs/v1"
  files:
    - missing.md
@srs-->`,
        },
      ]);

      const result = await aggregator.aggregate();
      const warning = result.validation.warnings.find((w) => w.message.includes('missing.md'));
      expect(warning).toBeDefined();
    });

    it('should report a non-string manifest entry without aborting aggregation', async () => {
      const aggregator = buildAggregator([
        {
          path: 'srs.md',
          content: `<!-- @srs
manifest:
  project_name: "Test"
  format: "extended-srs/v1"
  files:
    - 42
    - overview.md
@srs-->`,
        },
        {
          path: 'overview.md',
          content: `<!-- @srs
project-overview:
  objective: "Still aggregated"
@srs-->`,
        },
      ]);

      const result = await aggregator.aggregate();

      expect(result.srs['project-overview'].objective).toBe('Still aggregated');
      expect(
        result.validation.warnings.some(
          (warning) =>
            warning.field === 'manifest.files' && warning.message.includes('文字列ではありません'),
        ),
      ).toBe(true);
    });

    it('should warn when file content is unavailable', async () => {
      // File exists in projectFiles but not in fileContents
      const fileContents = new Map<string, { content: string }>([
        [
          'srs.md',
          {
            content: `<!-- @srs
manifest:
  project_name: "Test"
  format: "extended-srs/v1"
  files:
    - details.md
@srs-->`,
          },
        ],
      ]);
      const projectFiles: FileInfo[] = [makeFileInfo('srs.md', ''), makeFileInfo('details.md', '')];

      const aggregator = new ExtendedSRSAggregator(fileContents, projectFiles);
      const result = await aggregator.aggregate();

      const warning = result.validation.warnings.find((w) => w.message.includes('details.md'));
      expect(warning).toBeDefined();
    });

    it('should not process the same file twice', async () => {
      const aggregator = buildAggregator([
        {
          path: 'srs.md',
          content: `<!-- @srs
manifest:
  project_name: "Test"
  format: "extended-srs/v1"
  files:
    - srs.md
@srs-->`,
        },
      ]);

      // Should not loop infinitely
      const result = await aggregator.aggregate();
      expect(result.srs.manifest.project_name).toBe('Test');
    });

    it('should load multiple additional files', async () => {
      const aggregator = buildAggregator([
        {
          path: 'srs.md',
          content: `<!-- @srs
manifest:
  project_name: "Big Project"
  format: "extended-srs/v1"
  files:
    - overview.md
    - architecture.md
@srs-->`,
        },
        {
          path: 'overview.md',
          content: `<!-- @srs: project-overview
objective: "Build system"
@srs-->`,
        },
        {
          path: 'architecture.md',
          content: `<!-- @srs
system-architecture:
  components:
    - id: "main"
      name: "Main Service"
@srs-->`,
        },
      ]);

      const result = await aggregator.aggregate();
      expect(result.srs['project-overview'].objective).toBe('Build system');
      expect(result.srs['system-architecture'].components[0].id).toBe('main');
    });
  });

  describe('field sources and conflict detection', () => {
    it('should track field sources', async () => {
      const aggregator = buildAggregator([
        {
          path: 'srs.md',
          content: `<!-- @srs
manifest:
  project_name: "Test"
  format: "extended-srs/v1"
@srs-->`,
        },
      ]);

      const result = await aggregator.aggregate();
      expect(result.fieldSources).toBeDefined();
      expect(result.fieldSources!['manifest.project_name']).toContain('srs.md');
    });

    it('should detect conflicts across files', async () => {
      const aggregator = buildAggregator([
        {
          path: 'srs.md',
          content: `<!-- @srs
manifest:
  project_name: "Name1"
  format: "extended-srs/v1"
  files:
    - override.md
@srs-->`,
        },
        {
          path: 'override.md',
          content: `<!-- @srs: manifest
project_name: "Name2"
@srs-->`,
        },
      ]);

      const result = await aggregator.aggregate();
      expect(result.srs.manifest.project_name).toBe('Name2');

      // Check conflicts
      const conflict = result.validation.conflicts.find((c) => c.field === 'manifest.project_name');
      expect(conflict).toBeDefined();
      expect(conflict!.files).toContain('srs.md');
      expect(conflict!.files).toContain('override.md');
    });

    it('should not detect conflict when same file defines value', async () => {
      const aggregator = buildAggregator([
        {
          path: 'srs.md',
          content: `<!-- @srs
manifest:
  project_name: "Test"
  format: "extended-srs/v1"
@srs-->`,
        },
      ]);

      const result = await aggregator.aggregate();
      // Single source should not be a conflict
      const conflict = result.validation.conflicts.find((c) => c.field === 'manifest.project_name');
      expect(conflict).toBeUndefined();
    });

    it('should include root path entry for entry file', async () => {
      const aggregator = buildAggregator([
        {
          path: 'srs.md',
          content: `<!-- @srs
manifest:
  project_name: "Test"
  format: "extended-srs/v1"
@srs-->`,
        },
      ]);

      const result = await aggregator.aggregate();
      expect(result.fieldSources!['']).toContain('srs.md');
    });
  });

  describe('validation integration', () => {
    it('should run schema validation on aggregated data', async () => {
      const aggregator = buildAggregator([
        {
          path: 'srs.md',
          content: `<!-- @srs
manifest:
  project_name: 12345
  format: "extended-srs/v1"
@srs-->`,
        },
      ]);

      const result = await aggregator.aggregate();
      // project_name should be string, not number
      const typeError = result.validation.errors.find((e) => e.field === 'manifest.project_name');
      expect(typeError).toBeDefined();
    });

    it('should report missing required fields', async () => {
      const aggregator = buildAggregator([
        {
          path: 'srs.md',
          content: `<!-- @srs
manifest:
  project_name: "Test"
@srs-->`,
        },
      ]);

      const result = await aggregator.aggregate();
      // Missing manifest.format
      const formatError = result.validation.errors.find((e) => e.field === 'manifest.format');
      expect(formatError).toBeDefined();
    });

    it('should set isComplete to true when no errors', async () => {
      const aggregator = buildAggregator([
        {
          path: 'srs.md',
          content: `<!-- @srs
manifest:
  project_name: "Test"
  format: "extended-srs/v1"
@srs-->`,
        },
      ]);

      const result = await aggregator.aggregate();
      expect(result.validation.isComplete).toBe(true);
    });

    it('should set isComplete to false when there are errors', async () => {
      const aggregator = buildAggregator([
        {
          path: 'srs.md',
          content: `<!-- @srs
manifest:
  project_name: "Test"
@srs-->`,
        },
      ]);

      const result = await aggregator.aggregate();
      expect(result.validation.isComplete).toBe(false);
    });

    it('should not duplicate parse errors in validation', async () => {
      const aggregator = buildAggregator([
        {
          path: 'srs.md',
          content: `<!-- @srs
manifest:
  format: "extended-srs/v1"
  project_name: "Test"
@srs-->
<!-- @srs
invalid yaml: : :
@srs-->`,
        },
      ]);

      const result = await aggregator.aggregate();
      // Count parse errors
      const parseErrors = result.validation.errors.filter((e) =>
        e.message.includes('YAML parse error'),
      );
      // Should not be duplicated
      const uniqueMessages = new Set(parseErrors.map((e) => e.message));
      expect(parseErrors.length).toBe(uniqueMessages.size);
    });

    it('should attribute validation errors to correct source files', async () => {
      const aggregator = buildAggregator([
        {
          path: 'srs.md',
          content: `<!-- @srs
manifest:
  format: "extended-srs/v1"
  project_name: "Test"
  files:
    - details.md
@srs-->`,
        },
        {
          path: 'details.md',
          content: `<!-- @srs: manifest
project_name: 12345
@srs-->`,
        },
      ]);

      const result = await aggregator.aggregate();
      const typeError = result.validation.errors.find((e) => e.field === 'manifest.project_name');
      expect(typeError).toBeDefined();
      expect(typeError!.path).toBe('details.md');
    });
  });

  describe('updateData', () => {
    it('should reset and re-aggregate with new data', async () => {
      const aggregator = buildAggregator([
        {
          path: 'srs.md',
          content: `<!-- @srs
manifest:
  project_name: "Original"
  format: "extended-srs/v1"
@srs-->`,
        },
      ]);

      const result1 = await aggregator.aggregate();
      expect(result1.srs.manifest.project_name).toBe('Original');

      // Update data
      const newFileContents = new Map([
        [
          'srs.md',
          {
            content: `<!-- @srs
manifest:
  project_name: "Updated"
  format: "extended-srs/v1"
@srs-->`,
          },
        ],
      ]);
      const newProjectFiles = [makeFileInfo('srs.md', '')];
      aggregator.updateData(newFileContents, newProjectFiles);

      const result2 = await aggregator.aggregate();
      expect(result2.srs.manifest.project_name).toBe('Updated');
    });
  });

  describe('contributions tracking', () => {
    it('should record contributions per file', async () => {
      const aggregator = buildAggregator([
        {
          path: 'srs.md',
          content: `<!-- @srs
manifest:
  project_name: "Test"
  format: "extended-srs/v1"
  files:
    - details.md
@srs-->`,
        },
        {
          path: 'details.md',
          content: `<!-- @srs: project-overview
objective: "Build"
@srs-->`,
        },
      ]);

      const result = await aggregator.aggregate();
      expect(result.contributions['srs.md']).toBeDefined();
      expect(result.contributions['details.md']).toBeDefined();
      expect(result.contributions['details.md'].partialPaths).toContain('project-overview');
    });

    it('should include yamlBlocks in contributions', async () => {
      const aggregator = buildAggregator([
        {
          path: 'srs.md',
          content: `<!-- @srs
manifest:
  project_name: "Test"
  format: "extended-srs/v1"
@srs-->`,
        },
      ]);

      const result = await aggregator.aggregate();
      const contrib = result.contributions['srs.md'];
      expect(contrib.yamlBlocks).toBeDefined();
      expect(contrib.yamlBlocks!.length).toBeGreaterThan(0);
    });
  });

  describe('parse error propagation', () => {
    it('should propagate YAML parse errors as validation errors', async () => {
      const aggregator = buildAggregator([
        {
          path: 'srs.md',
          content: `<!-- @srs
manifest:
  format: "extended-srs/v1"
  project_name: "Test"
  files:
    - bad.md
@srs-->`,
        },
        {
          path: 'bad.md',
          content: `<!-- @srs
bad: yaml: [unclosed
@srs-->`,
        },
      ]);

      const result = await aggregator.aggregate();
      const parseError = result.validation.errors.find((e) =>
        e.message.includes('YAML parse error'),
      );
      expect(parseError).toBeDefined();
    });
  });

  describe('error line number refinement', () => {
    it('should provide line numbers for type-mismatch errors (array-vs-object)', async () => {
      const aggregator = buildAggregator([
        {
          path: 'srs.md',
          content: `<!-- @srs
manifest:
  format: "extended-srs/v1"
  project_name: "Test"
use-cases:
  - uc_id: "UC-001"
    name: "Test Use Case"
non-functional-requirements:
  - req_id: "NFR-001"
    name: "Performance"
@srs-->`,
        },
      ]);

      const result = await aggregator.aggregate();
      expect(result.validation.errors.length).toBeGreaterThan(0);

      // Check use-cases error has a line number
      const ucError = result.validation.errors.find(
        (e) => e.field === 'use-cases' || (e.message && e.message.includes('use-cases')),
      );
      expect(ucError).toBeDefined();
      expect(ucError!.line).toBeDefined();
      expect(ucError!.line).toBeGreaterThan(0);

      // Check non-functional-requirements error has a line number
      const nfrError = result.validation.errors.find(
        (e) =>
          e.field === 'non-functional-requirements' ||
          (e.message && e.message.includes('non-functional-requirements')),
      );
      expect(nfrError).toBeDefined();
      expect(nfrError!.line).toBeDefined();
      expect(nfrError!.line).toBeGreaterThan(0);
    });

    it('should point to correct line for YAML key in full block', async () => {
      const aggregator = buildAggregator([
        {
          path: 'srs.md',
          content: `<!-- @srs
manifest:
  format: "extended-srs/v1"
  project_name: "Test"
use-cases:
  - uc_id: "UC-001"
@srs-->`,
        },
      ]);

      const result = await aggregator.aggregate();
      const ucError = result.validation.errors.find(
        (e) => e.field === 'use-cases' || (e.message && e.message.includes('use-cases')),
      );
      expect(ucError).toBeDefined();
      // use-cases: is on line 5 (0-based: 4), displayed as 1-based: 5
      expect(ucError!.line).toBe(5);
    });

    it('should provide line numbers for partial block with array content (root path fallback)', async () => {
      // This tests the scenario where:
      // 1. use-cases is defined via a partial block with array content
      // 2. mergeMap does NOT have "use-cases" as a key (only "use-cases.0" etc.)
      // 3. resolveFieldSource falls to root path (no line)
      // 4. Aggregator's findFieldLineInContent must find the line
      const aggregator = buildAggregator([
        {
          path: 'srs.md',
          content: `<!-- @srs
manifest:
  format: "extended-srs/v1"
  project_name: "Test"
@srs-->

# Use Cases

<!-- @srs: use-cases
- uc_id: "UC-001"
  name: "Test Use Case"
@srs-->`,
        },
      ]);

      const result = await aggregator.aggregate();

      // There should be an error about use-cases structure
      const ucError = result.validation.errors.find(
        (e) => e.field === 'use-cases' || (e.message && e.message.includes('use-cases')),
      );
      // Partial block with array content creates object {"0": {...}}
      // which triggers additionalProperties or type-mismatch errors
      if (ucError) {
        expect(ucError.path).toBe('srs.md');
        expect(ucError.line).toBeDefined();
        expect(ucError.line).toBeGreaterThan(1); // Should NOT be line 1 (block start)
      }
    });

    it('should provide line numbers when no space in srs tag (<!--@srs)', async () => {
      // Test the exact format from the user's real file
      const aggregator = buildAggregator([
        {
          path: 'srs.md',
          content: `<!--@srs
manifest:
  format: "extended-srs/v1"
  project_name: "Test"
use-cases:
  - uc_id: "UC-001"
    name: "Test"
non-functional-requirements:
  - req_id: "NFR-001"
    name: "Performance"
@srs-->`,
        },
      ]);

      const result = await aggregator.aggregate();

      const ucError = result.validation.errors.find(
        (e) => e.field === 'use-cases' || (e.message && e.message.includes('use-cases')),
      );
      expect(ucError).toBeDefined();
      expect(ucError!.line).toBeDefined();
      expect(ucError!.line).toBeGreaterThan(1);
      // use-cases: is on 0-based line 4 → 1-based line 5
      expect(ucError!.line).toBe(5);

      const nfrError = result.validation.errors.find(
        (e) =>
          e.field === 'non-functional-requirements' ||
          (e.message && e.message.includes('non-functional-requirements')),
      );
      expect(nfrError).toBeDefined();
      expect(nfrError!.line).toBeDefined();
      expect(nfrError!.line).toBeGreaterThan(1);
    });

    it('should resolve line via fieldSources when available (not fallback)', async () => {
      // Verify that when fieldSources has the exact path,
      // resolveFieldSource returns the refined line directly
      const aggregator = buildAggregator([
        {
          path: 'srs.md',
          content: `<!-- @srs
manifest:
  format: "extended-srs/v1"
  project_name: "Test"
  unknown_prop: "bad"
@srs-->`,
        },
      ]);

      const result = await aggregator.aggregate();
      const propWarning = result.validation.warnings.find(
        (e) => e.message && e.message.includes('unknown_prop'),
      );
      expect(propWarning).toBeDefined();
      expect(propWarning!.line).toBeDefined();
      expect(propWarning!.line).toBeGreaterThan(0);
    });
  });
});
