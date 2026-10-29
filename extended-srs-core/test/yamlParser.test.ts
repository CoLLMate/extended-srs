// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for Extended SRS YAML Parser (Core)
 */

import { describe, it, expect } from 'vitest';
import {
  extractYAMLBlocks,
  parseYAMLBlock,
  parseExtendedSRS,
  parsePartialPath,
  applyPartialData,
  determineYamlPath,
  extractSectionsWithMetadata,
  extractContentSections,
  type YAMLBlock,
} from '../src';

describe('Extended SRS Core - YAML Parser', () => {
  describe('extractYAMLBlocks', () => {
    it('should extract full notation YAML blocks', () => {
      const content = `# Title
<!-- @srs
manifest:
  project_name: "Test Project"
  format: "extended-srs/v1"
@srs-->
Some content`;

      const blocks = extractYAMLBlocks(content);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].isPartial).toBe(false);
      expect(blocks[0].content).toContain('manifest:');
      expect(blocks[0].content).toContain('project_name: "Test Project"');
    });

    it('should extract partial notation YAML blocks', () => {
      const content = `# Title
<!-- @srs: project-overview
objective: "Build a system"
scope:
  - Feature 1
  - Feature 2
@srs-->
Some content`;

      const blocks = extractYAMLBlocks(content);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].isPartial).toBe(true);
      expect(blocks[0].path).toEqual(['project-overview']);
      expect(blocks[0].content).toContain('objective: "Build a system"');
    });

    it('should extract multiple YAML blocks', () => {
      const content = `# Title
<!-- @srs
manifest:
  project_name: "Test"
@srs-->
Middle content
<!-- @srs: use-cases
actors:
  - name: User
@srs-->
End content`;

      const blocks = extractYAMLBlocks(content);
      expect(blocks).toHaveLength(2);
      expect(blocks[0].isPartial).toBe(false);
      expect(blocks[1].isPartial).toBe(true);
      expect(blocks[1].path).toEqual(['use-cases']);
    });

    it('should calculate correct line numbers', () => {
      const content = `Line 1
Line 2
<!-- @srs
manifest:
  project_name: "Test"
@srs-->
Line 7`;

      const blocks = extractYAMLBlocks(content);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].startLine).toBe(2); // 0-based: Line 1 = 0, Line 2 = 1, <!-- @srs = 2
      expect(blocks[0].endLine).toBe(5); // 0-based: @srs--> = 5
      expect(blocks[0].yamlStartLine).toBe(3); // 0-based: manifest: = 3
      expect(blocks[0].yamlEndLine).toBe(4); // 0-based: project_name: = 4
    });

    it('should handle empty content', () => {
      const blocks = extractYAMLBlocks('');
      expect(blocks).toHaveLength(0);
    });

    it('should handle content without YAML blocks', () => {
      const content = `# Regular Markdown
This is just normal markdown content.
No Extended SRS blocks here.`;

      const blocks = extractYAMLBlocks(content);
      expect(blocks).toHaveLength(0);
    });

    it('should handle missing closing tag', () => {
      const content = `# Title
<!-- @srs
manifest:
  project_name: "Test"
Some regular content after unclosed block`;

      const blocks = extractYAMLBlocks(content);
      // Should either skip the unclosed block or handle gracefully
      // The important thing is no crash
      expect(blocks).toBeDefined();
    });

    it('should handle whitespace-only content in @srs block', () => {
      const content = `<!-- @srs


@srs-->`;

      const blocks = extractYAMLBlocks(content);
      expect(blocks).toHaveLength(1);
      const parsed = parseYAMLBlock(blocks[0]);
      // Should parse as empty or null, not error
      expect(
        parsed.data === null || parsed.data === undefined || typeof parsed.data === 'object',
      ).toBe(true);
    });

    it('should handle nested HTML comments (not @srs)', () => {
      const content = `<!-- Regular HTML comment -->
<!-- @srs
manifest:
  project_name: "Test"
@srs-->
<!-- Another regular comment -->`;

      const blocks = extractYAMLBlocks(content);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].content).toContain('manifest');
    });

    it('should handle block with only a newline', () => {
      const content = `<!-- @srs
@srs-->`;

      const blocks = extractYAMLBlocks(content);
      expect(blocks).toHaveLength(1);
      const parsed = parseYAMLBlock(blocks[0]);
      // Should not crash
      expect(parsed).toBeDefined();
    });

    it('should handle conflicting same-path partial blocks', () => {
      const content = `<!-- @srs: project-overview
objective: "First objective"
@srs-->
<!-- @srs: project-overview
objective: "Second objective"
scope: "Added scope"
@srs-->`;

      const blocks = extractYAMLBlocks(content);
      expect(blocks).toHaveLength(2);
      expect(blocks[0].isPartial).toBe(true);
      expect(blocks[1].isPartial).toBe(true);
      // Both should have same path
      expect(blocks[0].path).toEqual(blocks[1].path);
    });

    it('should handle @srs tag variations with extra whitespace', () => {
      const content = `<!--  @srs
manifest:
  project_name: "Test"
@srs  -->`;

      const blocks = extractYAMLBlocks(content);
      // Behavior depends on parser strictness, but should not crash
      expect(blocks).toBeDefined();
    });
  });

  describe('parseYAMLBlock', () => {
    it('should parse valid YAML', () => {
      const block: YAMLBlock = {
        content: `manifest:
  project_name: "Test"
  format: "extended-srs/v1"`,
        startLine: 1,
        endLine: 3,
        yamlStartLine: 1,
        yamlEndLine: 3,
        isPartial: false,
      };

      const parsed = parseYAMLBlock(block);
      expect(parsed.data).toBeDefined();
      expect(parsed.data.manifest.project_name).toBe('Test');
      expect(parsed.data.manifest.format).toBe('extended-srs/v1');
      expect(parsed.error).toBeUndefined();
    });

    it('should handle YAML parse errors', () => {
      const block: YAMLBlock = {
        content: `manifest:
  project_name: "Test
  format: "extended-srs/v1"`, // Missing closing quote
        startLine: 1,
        endLine: 3,
        yamlStartLine: 1,
        yamlEndLine: 3,
        isPartial: false,
      };

      const parsed = parseYAMLBlock(block);
      expect(parsed.error).toBeDefined();
      expect(parsed.data).toBeUndefined();
    });

    it('should parse complex nested structures', () => {
      const block: YAMLBlock = {
        content: `system-architecture:
  components:
    - name: Frontend
      type: web
      technologies:
        - React
        - TypeScript
    - name: Backend
      type: api
      technologies:
        - Node.js
        - Express`,
        startLine: 1,
        endLine: 11,
        yamlStartLine: 1,
        yamlEndLine: 11,
        isPartial: false,
      };

      const parsed = parseYAMLBlock(block);
      expect(parsed.data).toBeDefined();
      expect(parsed.data['system-architecture'].components).toHaveLength(2);
      expect(parsed.data['system-architecture'].components[0].name).toBe('Frontend');
      expect(parsed.data['system-architecture'].components[0].technologies).toContain('React');
    });
  });

  describe('parsePartialPath', () => {
    it('should parse colon notation paths', () => {
      expect(parsePartialPath('project-overview: objective')).toEqual([
        'project-overview',
        'objective',
      ]);
      expect(parsePartialPath('use-cases: actors: 0')).toEqual(['use-cases', 'actors', '0']);
    });

    it('should parse dot notation paths', () => {
      expect(parsePartialPath('project-overview.objective')).toEqual([
        'project-overview',
        'objective',
      ]);
      expect(parsePartialPath('use-cases.actors.0')).toEqual(['use-cases', 'actors', '0']);
    });

    it('should handle paths with spaces', () => {
      expect(parsePartialPath('project-overview : objective')).toEqual([
        'project-overview',
        'objective',
      ]);
      expect(parsePartialPath('use-cases . actors . 0')).toEqual(['use-cases', 'actors', '0']);
    });

    it('should filter empty segments', () => {
      expect(parsePartialPath('project-overview::')).toEqual(['project-overview']);
      expect(parsePartialPath('..use-cases..')).toEqual(['use-cases']);
    });
  });

  describe('applyPartialData', () => {
    it('should apply data to nested path', () => {
      const target = {};
      applyPartialData(target, ['project-overview', 'objective'], 'Build a system');

      expect(target).toEqual({
        'project-overview': {
          objective: 'Build a system',
        },
      });
    });

    it('should merge objects at target path', () => {
      const target = {
        'project-overview': {
          objective: 'Old objective',
          scope: 'Existing scope',
        },
      };

      applyPartialData(target, ['project-overview'], {
        objective: 'New objective',
        timeline: '6 months',
      });

      expect(target).toEqual({
        'project-overview': {
          objective: 'New objective',
          scope: 'Existing scope',
          timeline: '6 months',
        },
      });
    });

    it('should replace arrays and primitives', () => {
      const target = {
        'use-cases': {
          actors: ['Old Actor'],
        },
      };

      applyPartialData(target, ['use-cases', 'actors'], ['New Actor 1', 'New Actor 2']);

      expect(target).toEqual({
        'use-cases': {
          actors: ['New Actor 1', 'New Actor 2'],
        },
      });
    });

    it('should create intermediate objects as needed', () => {
      const target = {};
      applyPartialData(target, ['deep', 'nested', 'path', 'value'], 'test');

      expect(target).toEqual({
        deep: {
          nested: {
            path: {
              value: 'test',
            },
          },
        },
      });
    });
  });

  describe('parseExtendedSRS', () => {
    it('should parse complete Extended SRS document with content sections', () => {
      const content = `# Software Requirements Specification

<!-- @srs
manifest:
  project_name: "Test Project"
  format: "extended-srs/v1"
@srs-->

## Project Overview

<!-- @srs: project-overview
objective: "Build a comprehensive system"
scope:
  - Feature 1
  - Feature 2
@srs-->

## Use Cases

<!-- @srs: use-cases
actors:
  - name: Admin
    description: System administrator
  - name: User
    description: End user
@srs-->`;

      const parsed = parseExtendedSRS(content);
      expect(parsed).toBeDefined();
      expect(parsed?.srsData.manifest.project_name).toBe('Test Project');
      expect(parsed?.srsData['project-overview'].objective).toBe('Build a comprehensive system');
      expect(parsed?.srsData['use-cases'].actors).toHaveLength(2);
      expect(parsed?.yamlBlocks).toHaveLength(3);
      expect(parsed?.partialPaths).toContain('project-overview');
      expect(parsed?.partialPaths).toContain('use-cases');

      // Test content sections
      expect(parsed?.contentSections).toBeDefined();
      expect(parsed?.contentSections).toHaveLength(2);

      // First content section (after manifest)
      expect(parsed?.contentSections?.[0].sections).toEqual(['manifest']);
      expect(parsed?.contentSections?.[0].headings).toEqual(['Project Overview']);

      // Second content section (after project-overview)
      expect(parsed?.contentSections?.[1].sections).toEqual(['project-overview']);
      expect(parsed?.contentSections?.[1].headings).toEqual(['Use Cases']);

      // Note: No third content section since use-cases block is at the end of file
    });

    it('should extract markdown sections', () => {
      const content = `# Main Title
## Section 1
### Subsection 1.1
## Section 2`;

      const parsed = parseExtendedSRS(content);
      expect(parsed?.sections).toHaveLength(4);
      expect(parsed?.sections[0]).toEqual({
        level: 1,
        title: 'Main Title',
        line: 1,
      });
      expect(parsed?.sections[1]).toEqual({
        level: 2,
        title: 'Section 1',
        line: 2,
      });
    });

    it('should handle empty content', () => {
      const parsed = parseExtendedSRS('');
      expect(parsed).toBeNull();
    });

    it('should handle null content', () => {
      const parsed = parseExtendedSRS(null as any);
      expect(parsed).toBeNull();
    });

    it('should merge multiple full notation blocks', () => {
      const content = `<!-- @srs
manifest:
  project_name: "Test"
@srs-->

<!-- @srs
project-overview:
  objective: "Build system"
@srs-->`;

      const parsed = parseExtendedSRS(content);
      expect(parsed?.srsData.manifest.project_name).toBe('Test');
      expect(parsed?.srsData['project-overview'].objective).toBe('Build system');
    });
  });

  describe('determineYamlPath', () => {
    it('should determine path for nested YAML', () => {
      const yamlLines = [
        'manifest:',
        '  project_name: "Test"',
        '  metadata:',
        '    author: "John"',
        '    date: "2024"',
      ];

      expect(determineYamlPath(yamlLines, 1)).toEqual(['manifest', 'project_name']);
      expect(determineYamlPath(yamlLines, 3)).toEqual(['manifest', 'metadata', 'author']);
      expect(determineYamlPath(yamlLines, 4)).toEqual(['manifest', 'metadata', 'date']);
    });

    it('should handle array items', () => {
      const yamlLines = [
        'use-cases:',
        '  actors:',
        '    - name: User',
        '      role: admin',
        '    - name: Guest',
      ];

      expect(determineYamlPath(yamlLines, 2)).toEqual(['use-cases', 'actors']);
      expect(determineYamlPath(yamlLines, 3)).toEqual(['use-cases', 'actors', 'role']);
    });

    it('should ignore comments and empty lines', () => {
      const yamlLines = [
        '# Comment',
        'manifest:',
        '',
        '  project_name: "Test"',
        '  # Another comment',
        '  version: "1.0"',
      ];

      expect(determineYamlPath(yamlLines, 3)).toEqual(['manifest', 'project_name']);
      expect(determineYamlPath(yamlLines, 5)).toEqual(['manifest', 'version']);
    });
  });

  describe('extractSectionsWithMetadata', () => {
    it('should extract all metadata sections', () => {
      const content = `<!-- @srs
manifest:
  project_name: "Test"
project-overview:
  objective: "Build"
use-cases:
  actors:
    - name: User
@srs-->`;

      const sections = extractSectionsWithMetadata(content);
      expect(sections.size).toBe(3);
      expect(sections.has('manifest')).toBe(true);
      expect(sections.has('project-overview')).toBe(true);
      expect(sections.has('use-cases')).toBe(true);
      expect(sections.get('manifest')).toEqual({
        project_name: 'Test',
      });
    });

    it('should handle partial notation sections', () => {
      const content = `<!-- @srs
manifest:
  project_name: "Test"
@srs-->

<!-- @srs: project-overview.objective
Build a comprehensive system
@srs-->

<!-- @srs: use-cases
actors:
  - name: Admin
@srs-->`;

      const sections = extractSectionsWithMetadata(content);
      expect(sections.size).toBeGreaterThan(0);
      expect(sections.get('manifest')).toEqual({
        project_name: 'Test',
      });
      expect(sections.get('project-overview')).toBeDefined();
      expect(sections.get('use-cases')).toBeDefined();
    });

    it('should return empty map for content without metadata', () => {
      const content = `# Regular Markdown
This is just normal content.`;

      const sections = extractSectionsWithMetadata(content);
      expect(sections.size).toBe(0);
    });
  });

  describe('extractContentSections', () => {
    it('should extract content sections between YAML blocks', () => {
      const content = `<!-- @srs
manifest:
  format: extended-srs/v1
  project_name: Test Project
@srs-->

# Main Title

This is the content after the manifest block.

<!-- @srs:project-overview
objective: Build a system
@srs-->

## Overview Section

This is the content after the project-overview block.

<!-- @srs:use-cases
actors:
  - name: User
@srs-->

### Use Cases Section

This is the content after the use-cases block.`;

      const sections = extractContentSections(content);

      expect(sections).toHaveLength(3);

      // First section (after manifest)
      expect(sections[0].sections).toEqual(['manifest']);
      expect(sections[0].headings).toEqual(['Main Title']);
      expect(sections[0].content).toContain('This is the content after the manifest block.');

      // Second section (after project-overview)
      expect(sections[1].sections).toEqual(['project-overview']);
      expect(sections[1].headings).toEqual(['Overview Section']);
      expect(sections[1].content).toContain(
        'This is the content after the project-overview block.',
      );

      // Third section (after use-cases)
      expect(sections[2].sections).toEqual(['use-cases']);
      expect(sections[2].headings).toEqual(['Use Cases Section']);
      expect(sections[2].content).toContain('This is the content after the use-cases block.');
    });

    it('should handle multiple heading levels', () => {
      const content = `<!-- @srs
manifest:
  format: extended-srs/v1
@srs-->

# Level 1
## Level 2
### Level 3
#### Level 4
##### Level 5
###### Level 6

Content with multiple heading levels.`;

      const sections = extractContentSections(content);

      expect(sections).toHaveLength(1);
      expect(sections[0].headings).toEqual([
        'Level 1',
        'Level 2',
        'Level 3',
        'Level 4',
        'Level 5',
        'Level 6',
      ]);
    });

    it('should handle partial notation with complex paths', () => {
      const content = `<!-- @srs:system-architecture:components:list[0]
component_id: frontend
name: Frontend Application
@srs-->

## Frontend Component

Details about the frontend component.

<!-- @srs:system-architecture:components:list[1]
component_id: backend
name: Backend API
@srs-->

## Backend Component

Details about the backend component.`;

      const sections = extractContentSections(content);

      expect(sections).toHaveLength(2);

      // First section - partial path should use first element
      expect(sections[0].sections).toEqual(['system-architecture']);
      expect(sections[0].headings).toEqual(['Frontend Component']);

      // Second section
      expect(sections[1].sections).toEqual(['system-architecture']);
      expect(sections[1].headings).toEqual(['Backend Component']);
    });

    it('should handle empty content between blocks', () => {
      const content = `<!-- @srs
manifest:
  format: extended-srs/v1
@srs-->
<!-- @srs:project-overview
objective: Test
@srs-->
<!-- @srs:use-cases
actors: []
@srs-->`;

      const sections = extractContentSections(content);

      // No content sections since blocks are adjacent
      expect(sections).toHaveLength(0);
    });

    it('should handle content with no YAML blocks', () => {
      const content = `# Regular Markdown

This is just normal markdown content.

## Section 1

Some text.

## Section 2

More text.`;

      const sections = extractContentSections(content);

      expect(sections).toHaveLength(0);
    });

    it('should correctly parse sections from full notation blocks', () => {
      const content = `<!-- @srs
manifest:
  format: extended-srs/v1
project-overview:
  objective: Build system
use-cases:
  actors:
    - name: Admin
@srs-->

# Content after full notation

This content belongs to the full notation block with multiple sections.`;

      const sections = extractContentSections(content);

      expect(sections).toHaveLength(1);
      expect(sections[0].sections).toContain('manifest');
      expect(sections[0].sections).toContain('project-overview');
      expect(sections[0].sections).toContain('use-cases');
      expect(sections[0].headings).toEqual(['Content after full notation']);
    });

    it('should handle mixed full and partial notations', () => {
      const content = `<!-- @srs
manifest:
  format: extended-srs/v1
@srs-->

# Project Title

Main project description.

<!-- @srs:functional-requirements
- id: FR001
  description: User login
- id: FR002
  description: User logout
@srs-->

## Requirements

Requirements content.

<!-- @srs
system-architecture:
  components:
    - name: Web
@srs-->

## Architecture

Architecture content.`;

      const sections = extractContentSections(content);

      expect(sections).toHaveLength(3);

      // First section (full notation)
      expect(sections[0].sections).toEqual(['manifest']);
      expect(sections[0].headings).toEqual(['Project Title']);

      // Second section (partial notation)
      expect(sections[1].sections).toEqual(['functional-requirements']);
      expect(sections[1].headings).toEqual(['Requirements']);

      // Third section (full notation)
      expect(sections[2].sections).toEqual(['system-architecture']);
      expect(sections[2].headings).toEqual(['Architecture']);
    });

    it('should calculate correct line numbers for content sections', () => {
      const content = `<!-- @srs
manifest:
  format: extended-srs/v1
@srs-->
Line 5
Line 6
<!-- @srs:project-overview
objective: Test
@srs-->
Line 10
Line 11`;

      const sections = extractContentSections(content);

      expect(sections).toHaveLength(2);

      // First content section
      expect(sections[0].startLine).toBe(4); // Line after @srs-->
      expect(sections[0].endLine).toBe(5); // Line before next block

      // Second content section
      expect(sections[1].startLine).toBe(9); // Line after @srs-->
      expect(sections[1].endLine).toBe(10); // End of file
    });

    it('should handle content at the end of file', () => {
      const content = `<!-- @srs
manifest:
  format: extended-srs/v1
@srs-->

# Final Section

This content goes to the end of the file.

No more YAML blocks after this.`;

      const sections = extractContentSections(content);

      expect(sections).toHaveLength(1);
      expect(sections[0].content).toContain('No more YAML blocks after this.');
      expect(sections[0].headings).toEqual(['Final Section']);
    });

    it('should handle special characters in headings', () => {
      const content = `<!-- @srs
manifest:
  format: extended-srs/v1
@srs-->

# Title with Special Characters: !@#$%^&*()
## 日本語の見出し
### Title with "quotes" and 'apostrophes'

Content with special heading characters.`;

      const sections = extractContentSections(content);

      expect(sections).toHaveLength(1);
      expect(sections[0].headings).toEqual([
        'Title with Special Characters: !@#$%^&*()',
        '日本語の見出し',
        'Title with "quotes" and \'apostrophes\'',
      ]);
    });

    it('should handle Windows-style line endings', () => {
      const content = `<!-- @srs\r\nmanifest:\r\n  format: extended-srs/v1\r\n@srs-->\r\n\r\n# Windows Content\r\n\r\nContent with CRLF line endings.`;

      const sections = extractContentSections(content);

      expect(sections).toHaveLength(1);
      expect(sections[0].headings).toEqual(['Windows Content']);
      expect(sections[0].content).toContain('Content with CRLF line endings.');
    });

    it('should handle edge case with only whitespace between blocks', () => {
      const content = `<!-- @srs
manifest:
  format: extended-srs/v1
@srs-->
   
   
   
<!-- @srs:project-overview
objective: Test
@srs-->`;

      const sections = extractContentSections(content);

      expect(sections).toHaveLength(1);
      // Content is only whitespace but should still be captured
      expect(sections[0].content.trim()).toBe('');
      expect(sections[0].headings).toEqual([]);
    });

    it('should correctly identify partial notation paths', () => {
      const content = `<!-- @srs:use-cases:list[0]:actors
- name: Admin
  role: Administrator
@srs-->

## Admin Use Cases

Admin-related content.

<!-- @srs:use-cases:list[0]:scenarios:list[0]
name: Login Scenario
steps:
  - Step 1
  - Step 2
@srs-->

### Login Scenario

Scenario details.`;

      const sections = extractContentSections(content);

      expect(sections).toHaveLength(2);

      // Both should use 'use-cases' as the section
      expect(sections[0].sections).toEqual(['use-cases']);
      expect(sections[1].sections).toEqual(['use-cases']);
    });

    it('should handle YAML parse errors gracefully', () => {
      const content = `<!-- @srs
manifest:
  format: "extended-srs/v1
  project_name: Test
@srs-->

# Content after invalid YAML

This content should still be extracted.

<!-- @srs:project-overview
objective: Valid YAML
@srs-->

## Valid Section

This should also work.`;

      const sections = extractContentSections(content);

      // Should still extract content sections even if YAML parsing fails
      expect(sections.length).toBeGreaterThan(0);
    });
  });
});
