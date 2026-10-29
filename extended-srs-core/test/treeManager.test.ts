// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for ExtendedSRSTreeManager
 * Covers: loadDocument, loadDocuments, getTree, getValueAt, getSourcesFor,
 *         updateMetadataBlock, addMetadataBlock, splitMetadataBlock,
 *         exportToMarkdown, exportMergedMetadata
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ExtendedSRSTreeManager } from '../src/tree/manager';

describe('ExtendedSRSTreeManager', () => {
  let manager: ExtendedSRSTreeManager;

  beforeEach(() => {
    manager = new ExtendedSRSTreeManager();
  });

  describe('loadDocument', () => {
    it('should load a document and build tree', () => {
      manager.loadDocument(
        'srs.md',
        `<!-- @srs
manifest:
  project_name: "Test"
  format: "extended-srs/v1"
@srs-->`,
      );

      const tree = manager.getTree();
      expect(tree.data.manifest.project_name).toBe('Test');
    });

    it('should overwrite document with same filepath', () => {
      manager.loadDocument(
        'srs.md',
        `<!-- @srs
manifest:
  project_name: "First"
@srs-->`,
      );
      manager.loadDocument(
        'srs.md',
        `<!-- @srs
manifest:
  project_name: "Second"
@srs-->`,
      );

      expect(manager.getValueAt('manifest.project_name')).toBe('Second');
    });

    it('should handle document with no metadata blocks', () => {
      manager.loadDocument('readme.md', '# Just a readme\nNo SRS metadata here.');
      const tree = manager.getTree();
      expect(tree.data).toEqual({});
      expect(tree.metadataBlocks).toHaveLength(0);
    });

    it('should preserve commitId', () => {
      manager.loadDocument(
        'srs.md',
        `<!-- @srs
key: value
@srs-->`,
        'commit-abc',
      );

      const tree = manager.getTree();
      expect(tree.metadataBlocks[0].location.commitId).toBe('commit-abc');
    });

    it('should handle YAML parse errors gracefully', () => {
      manager.loadDocument(
        'srs.md',
        `<!-- @srs
invalid: yaml: : : syntax
@srs-->`,
      );

      const tree = manager.getTree();
      expect(tree.validationErrors.length).toBeGreaterThan(0);
    });
  });

  describe('loadDocuments', () => {
    it('should load multiple documents and merge', () => {
      manager.loadDocuments([
        {
          filepath: 'srs.md',
          content: `<!-- @srs
manifest:
  project_name: "Test"
  format: "extended-srs/v1"
@srs-->`,
        },
        {
          filepath: 'overview.md',
          content: `<!-- @srs
project-overview:
  objective: "Build system"
@srs-->`,
        },
      ]);

      const tree = manager.getTree();
      expect(tree.data.manifest.project_name).toBe('Test');
      expect(tree.data['project-overview'].objective).toBe('Build system');
    });

    it('should apply last-write-wins across documents', () => {
      manager.loadDocuments([
        {
          filepath: 'file1.md',
          content: `<!-- @srs
config:
  name: "from-file1"
@srs-->`,
        },
        {
          filepath: 'file2.md',
          content: `<!-- @srs
config:
  name: "from-file2"
@srs-->`,
        },
      ]);

      expect(manager.getValueAt('config.name')).toBe('from-file2');
    });

    it('should handle empty documents array', () => {
      manager.loadDocuments([]);
      const tree = manager.getTree();
      expect(tree.data).toEqual({});
    });
  });

  describe('getTree', () => {
    it('should return tree even when no documents loaded', () => {
      const tree = manager.getTree();
      expect(tree).toBeDefined();
      expect(tree.data).toEqual({});
      expect(tree.metadataBlocks).toHaveLength(0);
      expect(tree.mergeMap.size).toBe(0);
    });

    it('should rebuild tree when called after initial empty state', () => {
      const tree1 = manager.getTree();
      expect(tree1.data).toEqual({});

      manager.loadDocument(
        'srs.md',
        `<!-- @srs
key: value
@srs-->`,
      );

      const tree2 = manager.getTree();
      expect(tree2.data.key).toBe('value');
    });
  });

  describe('getValueAt', () => {
    beforeEach(() => {
      manager.loadDocument(
        'srs.md',
        `<!-- @srs
manifest:
  project_name: "Test Project"
  format: "extended-srs/v1"
items:
  - id: 1
    name: first
  - id: 2
    name: second
nested:
  deep:
    value: 42
@srs-->`,
      );
    });

    it('should get top-level value', () => {
      const manifest = manager.getValueAt('manifest');
      expect(manifest).toBeDefined();
      expect(manifest.project_name).toBe('Test Project');
    });

    it('should get nested value with dot notation', () => {
      expect(manager.getValueAt('manifest.project_name')).toBe('Test Project');
    });

    it('should get array item with bracket notation', () => {
      const item = manager.getValueAt('items[0]');
      expect(item).toEqual({ id: 1, name: 'first' });
    });

    it('should get nested value within array item', () => {
      expect(manager.getValueAt('items[1].name')).toBe('second');
    });

    it('should get deeply nested value', () => {
      expect(manager.getValueAt('nested.deep.value')).toBe(42);
    });

    it('should return undefined for non-existent path', () => {
      expect(manager.getValueAt('nonexistent')).toBeUndefined();
    });

    it('should return undefined for non-existent nested path', () => {
      expect(manager.getValueAt('manifest.nonexistent')).toBeUndefined();
    });

    it('should return undefined for out-of-bounds array index', () => {
      expect(manager.getValueAt('items[99]')).toBeUndefined();
    });

    it('should return undefined when array notation on non-array', () => {
      expect(manager.getValueAt('manifest[0]')).toBeUndefined();
    });

    it('should return undefined when traversing through primitive', () => {
      expect(manager.getValueAt('manifest.project_name.sub')).toBeUndefined();
    });
  });

  describe('getSourcesFor', () => {
    it('should return sources for a known path', () => {
      manager.loadDocument(
        'srs.md',
        `<!-- @srs
manifest:
  project_name: "Test"
@srs-->`,
      );

      const sources = manager.getSourcesFor('manifest.project_name');
      expect(sources.length).toBeGreaterThan(0);
      expect(sources[0].filepath).toBe('srs.md');
    });

    it('should return empty array for unknown path', () => {
      manager.loadDocument(
        'srs.md',
        `<!-- @srs
key: value
@srs-->`,
      );

      const sources = manager.getSourcesFor('nonexistent.path');
      expect(sources).toEqual([]);
    });

    it('should track multiple sources for overridden fields', () => {
      manager.loadDocuments([
        {
          filepath: 'file1.md',
          content: `<!-- @srs
config:
  name: "from-file1"
@srs-->`,
        },
        {
          filepath: 'file2.md',
          content: `<!-- @srs
config:
  name: "from-file2"
@srs-->`,
        },
      ]);

      const sources = manager.getSourcesFor('config.name');
      expect(sources).toHaveLength(2);
      expect(sources[0].filepath).toBe('file1.md');
      expect(sources[1].filepath).toBe('file2.md');
    });
  });

  describe('updateMetadataBlock', () => {
    it('should update an existing metadata block', () => {
      const content = `# Title
<!-- @srs
manifest:
  project_name: "Old Name"
@srs-->
# End`;

      manager.loadDocument('srs.md', content);
      const tree = manager.getTree();
      const block = tree.metadataBlocks[0];

      manager.updateMetadataBlock(
        block.location,
        `<!-- @srs
manifest:
  project_name: "New Name"
@srs-->`,
      );

      expect(manager.getValueAt('manifest.project_name')).toBe('New Name');

      // Verify document structure is preserved (no duplicate @srs--> tags)
      const exported = manager.exportToMarkdown();
      const doc = exported.get('srs.md')!;
      expect(doc).toContain('# Title');
      expect(doc).toContain('# End');
      // Count @srs--> occurrences — should be exactly 1
      const closingTags = doc.match(/@srs-->/g) || [];
      expect(closingTags).toHaveLength(1);
    });

    it('should do nothing for non-existent document', () => {
      manager.loadDocument(
        'srs.md',
        `<!-- @srs
key: value
@srs-->`,
      );

      manager.updateMetadataBlock(
        { filepath: 'nonexistent.md', lineStart: 1, lineEnd: 3, timestamp: 0 },
        'new content',
      );

      // Original should be unchanged
      expect(manager.getValueAt('key')).toBe('value');
    });
  });

  describe('addMetadataBlock', () => {
    it('should add a full metadata block', () => {
      manager.loadDocument('srs.md', '# Title\n\n## Content\n\nSome text');
      manager.addMetadataBlock('srs.md', 3, 'test:\n  value: "added"', 'full');

      expect(manager.getValueAt('test.value')).toBe('added');
    });

    it('should add a partial metadata block', () => {
      manager.loadDocument(
        'srs.md',
        `<!-- @srs
manifest:
  project_name: "Test"
@srs-->
# Content`,
      );

      manager.addMetadataBlock(
        'srs.md',
        100,
        'objective: "New objective"',
        'partial',
        'project-overview',
      );

      expect(manager.getValueAt('project-overview.objective')).toBe('New objective');
    });

    it('should do nothing for non-existent document', () => {
      manager.loadDocument(
        'srs.md',
        `<!-- @srs
key: value
@srs-->`,
      );

      manager.addMetadataBlock('nonexistent.md', 1, 'data: test', 'full');
      // Original should be unchanged, no crash
      expect(manager.getValueAt('key')).toBe('value');
    });

    it('should clamp insert line to end of document', () => {
      manager.loadDocument('srs.md', '# Short doc');
      manager.addMetadataBlock('srs.md', 9999, 'added: true', 'full');

      expect(manager.getValueAt('added')).toBe(true);
    });
  });

  describe('splitMetadataBlock', () => {
    it('should split a full block into full + partial blocks', () => {
      const content = `<!-- @srs
manifest:
  project_name: "Test"
  format: "extended-srs/v1"
project-overview:
  objective: "Build system"
@srs-->`;

      manager.loadDocument('srs.md', content);
      const tree = manager.getTree();
      const block = tree.metadataBlocks[0];

      manager.splitMetadataBlock(block.location, 'project-overview');

      // After split, both should still exist
      expect(manager.getValueAt('manifest.project_name')).toBe('Test');
      expect(manager.getValueAt('project-overview.objective')).toBe('Build system');

      // Should now have multiple metadata blocks
      const newTree = manager.getTree();
      expect(newTree.metadataBlocks.length).toBeGreaterThan(1);
    });

    it('should handle split of non-existent path gracefully', () => {
      const content = `<!-- @srs
manifest:
  project_name: "Test"
@srs-->`;

      manager.loadDocument('srs.md', content);
      const tree = manager.getTree();
      const block = tree.metadataBlocks[0];

      // Splitting a non-existent path should do nothing
      manager.splitMetadataBlock(block.location, 'nonexistent');
      expect(manager.getValueAt('manifest.project_name')).toBe('Test');
    });

    it('should handle split on non-existent document', () => {
      manager.loadDocument(
        'srs.md',
        `<!-- @srs
key: value
@srs-->`,
      );

      // Should not throw
      manager.splitMetadataBlock(
        { filepath: 'nonexistent.md', lineStart: 1, lineEnd: 3, timestamp: 0 },
        'key',
      );
    });

    it('should not split partial blocks', () => {
      const content = `<!-- @srs: project-overview
objective: "Test"
scope: "All"
@srs-->`;

      manager.loadDocument('srs.md', content);
      const tree = manager.getTree();
      const block = tree.metadataBlocks[0];

      // partial blocks should not be split
      manager.splitMetadataBlock(block.location, 'scope');

      // Block count should remain the same since split is skipped for partial blocks
      const newTree = manager.getTree();
      expect(newTree.metadataBlocks).toHaveLength(1);
    });

    it('should handle insertAfterLines parameter', () => {
      const content = `<!-- @srs
manifest:
  project_name: "Test"
project-overview:
  objective: "Build"
@srs-->
Some content between`;

      manager.loadDocument('srs.md', content);
      const tree = manager.getTree();
      const block = tree.metadataBlocks[0];

      // Split with insertAfterLines
      manager.splitMetadataBlock(block.location, 'project-overview', 1);

      // Both should still exist
      expect(manager.getValueAt('manifest.project_name')).toBe('Test');
      expect(manager.getValueAt('project-overview.objective')).toBe('Build');
    });
  });

  describe('exportToMarkdown', () => {
    it('should export all loaded documents', () => {
      manager.loadDocuments([
        { filepath: 'srs.md', content: '# SRS Content' },
        { filepath: 'overview.md', content: '# Overview Content' },
      ]);

      const exported = manager.exportToMarkdown();
      expect(exported.size).toBe(2);
      expect(exported.get('srs.md')).toBe('# SRS Content');
      expect(exported.get('overview.md')).toBe('# Overview Content');
    });

    it('should return empty map when no documents loaded', () => {
      const exported = manager.exportToMarkdown();
      expect(exported.size).toBe(0);
    });

    it('should reflect modifications after updateMetadataBlock', () => {
      const original = `<!-- @srs
key: "original"
@srs-->`;

      manager.loadDocument('srs.md', original);
      const tree = manager.getTree();
      const block = tree.metadataBlocks[0];

      manager.updateMetadataBlock(
        block.location,
        `<!-- @srs
key: "modified"
@srs-->`,
      );

      const exported = manager.exportToMarkdown();
      expect(exported.get('srs.md')).toContain('modified');
    });
  });

  describe('exportMergedMetadata', () => {
    it('should export merged data as YAML string', () => {
      manager.loadDocument(
        'srs.md',
        `<!-- @srs
manifest:
  project_name: "Test"
  format: "extended-srs/v1"
@srs-->`,
      );

      const yaml = manager.exportMergedMetadata();
      expect(yaml).toContain('manifest');
      expect(yaml).toContain('project_name');
      expect(yaml).toContain('Test');
    });

    it('should include data from all documents', () => {
      manager.loadDocuments([
        {
          filepath: 'srs.md',
          content: `<!-- @srs
manifest:
  project_name: "Test"
@srs-->`,
        },
        {
          filepath: 'overview.md',
          content: `<!-- @srs
project-overview:
  objective: "Build"
@srs-->`,
        },
      ]);

      const yaml = manager.exportMergedMetadata();
      expect(yaml).toContain('manifest');
      expect(yaml).toContain('project-overview');
    });

    it('should return valid YAML for empty tree', () => {
      const yaml = manager.exportMergedMetadata();
      expect(typeof yaml).toBe('string');
    });
  });

  describe('multi-document merge scenarios', () => {
    it('should merge partial blocks across documents', () => {
      manager.loadDocuments([
        {
          filepath: 'srs.md',
          content: `<!-- @srs
manifest:
  project_name: "Test"
  format: "extended-srs/v1"
@srs-->`,
        },
        {
          filepath: 'overview.md',
          content: `<!-- @srs: project-overview
objective: "Build system"
@srs-->`,
        },
        {
          filepath: 'usecases.md',
          content: `<!-- @srs: use-cases: list[0]
id: "UC001"
name: "User Login"
@srs-->`,
        },
      ]);

      expect(manager.getValueAt('manifest.project_name')).toBe('Test');
      expect(manager.getValueAt('project-overview.objective')).toBe('Build system');
      expect(manager.getValueAt('use-cases.list[0].id')).toBe('UC001');
    });

    it('should handle same-section partial blocks in different documents', () => {
      manager.loadDocuments([
        {
          filepath: 'file1.md',
          content: `<!-- @srs: project-overview
objective: "Original objective"
scope: "Original scope"
@srs-->`,
        },
        {
          filepath: 'file2.md',
          content: `<!-- @srs: project-overview
objective: "Updated objective"
timeline: "6 months"
@srs-->`,
        },
      ]);

      // Last-write-wins for objective, but scope preserved via deep merge
      expect(manager.getValueAt('project-overview.objective')).toBe('Updated objective');
      expect(manager.getValueAt('project-overview.scope')).toBe('Original scope');
      expect(manager.getValueAt('project-overview.timeline')).toBe('6 months');
    });
  });
});
