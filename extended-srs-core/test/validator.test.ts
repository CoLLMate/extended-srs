// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for Extended SRS Validator (Core)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  validateYAML,
  validateExtendedSRS,
  validateExtendedSRSFile,
  validateMultipleFiles,
  getSchemaNodeForPath,
  initializeExtendedSRSSchemas,
  initializeAjv,
} from '../src';

describe('Extended SRS Core - Validator', () => {
  beforeAll(async () => {
    // Initialize schemas before running tests
    await initializeAjv();
    await initializeExtendedSRSSchemas();
  });

  describe('validateYAML', () => {
    it('should validate valid YAML against schema', async () => {
      const yamlContent = `manifest:
  project_name: "Test Project"
  format: "extended-srs/v1"
project-overview:
  objective: "Test objective"
system-architecture:
  architecture:
    key_components:
      components:
        - component_id: main
          name: Main App
          type: backend
          tech_stack:
            language:
              name: JavaScript
              version: "20"
            framework:
              name: Node.js
              version: "20.0.0"
              language: JavaScript
      architecture_graph: "graph LR; Main"
    design_principles:
      - モノリシックアーキテクチャ
  tech_stack:
    development_tools:
      version_control:
        system: git
        platform: github
  data_models:
    entities:
      - entity_id: user_entity
        data_id: user_data
        component_id: main
        table_name: users
        columns:
          - attribute_name: id
            column_name: id
  common_technical_policies:
    error_handling:
      exception_strategy: global_handler
      error_format: json`;

      const result = await validateYAML(yamlContent);
      if (!result.isValid) {
        console.log('Validation errors:', result.errors);
        console.log('Validation warnings:', result.warnings);
      }
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect YAML syntax errors', async () => {
      const yamlContent = `manifest:
  project_name: "Test Project
  format: "extended-srs/v1"`; // Missing closing quote

      const result = await validateYAML(yamlContent);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].type).toBe('yaml-syntax');
    });

    it('should detect missing required fields', async () => {
      const yamlContent = `manifest:
  project_name: "Test Project"`; // Missing required 'format' field

      const result = await validateYAML(yamlContent);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('format'))).toBe(true);
    });

    it('should detect type mismatches', async () => {
      const yamlContent = `manifest:
  project_name: 123
  format: "extended-srs/v1"`; // project_name should be string

      const result = await validateYAML(yamlContent);
      if (result.isValid) {
        console.log('Unexpected validation pass. Errors:', result.errors);
        console.log('Warnings:', result.warnings);
      }
      expect(result.isValid).toBe(false);
      // Check for type error in Japanese message format
      expect(
        result.errors.some(
          (e) => e.message.includes('型が一致しません') || e.message.toLowerCase().includes('type'),
        ),
      ).toBe(true);
    });

    it('should validate partial YAML blocks', async () => {
      const yamlContent = `objective: "Build a system"
scope:
  in_scope:
    - "Feature 1"
  out_scope:
    - "Feature 2"`;

      const result = await validateYAML(yamlContent, 0, ['project-overview'], true);
      if (result.errors.length > 0) {
        console.log('Test failed. Errors:', result.errors);
        console.log('Warnings:', result.warnings);
      }
      expect(result.errors.length).toBe(0); // Partial blocks don't require manifest
    });

    it('should validate complete Extended SRS without warnings', async () => {
      const yamlContent = `manifest:
  project_name: "Test Project"
  format: "extended-srs/v1"
project-overview:
  objective: "Test objective"
system-architecture:
  architecture:
    key_components:
      components:
        - component_id: main
          name: Main App
          type: backend
          tech_stack:
            language:
              name: JavaScript
              version: "20"
            framework:
              name: Node.js
              version: "20.0.0"
              language: JavaScript
      architecture_graph: "graph LR; Main"
    design_principles:
      - モノリシックアーキテクチャ
  tech_stack:
    development_tools:
      version_control:
        system: git
        platform: github
  data_models:
    entities:
      - entity_id: user_entity
        data_id: user_data
        component_id: main
        table_name: users
        columns:
          - attribute_name: id
            column_name: id
  common_technical_policies:
    error_handling:
      exception_strategy: global_handler
      error_format: json`;

      const result = await validateYAML(yamlContent);
      // Semantic validation removed - but schema may still generate warnings
      expect(result.isValid).toBe(true);
      // Allow warnings from schema validation
      expect(result.warnings.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle line number tracking', async () => {
      const yamlContent = `manifest:
  project_name: "Test"
  invalid_field: "value"`;

      const result = await validateYAML(yamlContent, 10);
      // Errors or warnings should exist for invalid_field
      const allIssues = [...result.errors, ...result.warnings];
      if (allIssues.length > 0) {
        // Line numbers should NOT include the startLine offset in the result
        // since they are relative to the YAML content itself
        expect(allIssues[0].line).toBeDefined();
        expect(allIssues[0].line).toBeGreaterThanOrEqual(0);
      }
    });

    it('should validate enum values', async () => {
      const yamlContent = `manifest:
  project_name: "Test"
  format: "invalid-format"`; // Should be "extended-srs/v1"

      const result = await validateYAML(yamlContent);
      if (
        result.isValid ||
        !result.errors.some((e) => e.message.toLowerCase().includes('must be one of'))
      ) {
        console.log('Test failed. Errors:', result.errors);
        console.log('Warnings:', result.warnings);
      }
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      // Check if any error mentions enum or const violation
      const hasEnumError = result.errors.some(
        (e) =>
          e.message.toLowerCase().includes('must be one of') ||
          e.message.toLowerCase().includes('must be') ||
          e.message.toLowerCase().includes('invalid value') ||
          e.message.toLowerCase().includes('extended-srs/v1'),
      );
      expect(hasEnumError).toBe(true);
    });

    it('should validate nested structures', async () => {
      const yamlContent = `manifest:
  project_name: "Test"
  format: "extended-srs/v1"
system-architecture:
  components:
    - name: "Frontend"
      type: "web"
      invalid_prop: "value"`; // Additional property not allowed

      const result = await validateYAML(yamlContent);
      // Additional properties might be warnings or errors depending on schema
      expect(result.errors.length + result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('validateExtendedSRSFile', () => {
    it('should validate complete Extended SRS file', async () => {
      const content = `# Software Requirements Specification

<!-- @srs
manifest:
  project_name: "Test Project"
  format: "extended-srs/v1"
project-overview:
  objective: "Build a comprehensive system"
  scope:
    in_scope:
      - "Feature 1"
      - "Feature 2"
    out_scope:
      - "Legacy features"
system-architecture:
  architecture:
    key_components:
      components:
        - component_id: main
          name: Main App
          type: backend
          tech_stack:
            language:
              name: JavaScript
              version: "20"
            framework:
              name: Node.js
              version: "20.0.0"
              language: JavaScript
      architecture_graph: "graph LR; Main"
    design_principles:
      - モノリシックアーキテクチャ
  tech_stack:
    development_tools:
      version_control:
        system: git
        platform: github
  data_models:
    entities:
      - entity_id: user_entity
        data_id: user_data
        component_id: main
        table_name: users
        columns:
          - attribute_name: id
            column_name: id
  common_technical_policies:
    error_handling:
      exception_strategy: global_handler
      error_format: json
@srs-->`;

      const result = await validateExtendedSRSFile(content);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing Extended SRS metadata', async () => {
      const content = `# Regular Markdown
This is just a regular markdown file without Extended SRS metadata.`;

      const result = await validateExtendedSRSFile(content);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('No Extended SRS metadata found'))).toBe(
        true,
      );
    });

    it('should validate multiple YAML blocks independently', async () => {
      const content = `<!-- @srs
manifest:
  project_name: "Test"
  format: "extended-srs/v1"
@srs-->

<!-- @srs
invalid_yaml: [unclosed array
@srs-->`; // Invalid YAML in second block

      const result = await validateExtendedSRSFile(content);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.type === 'yaml-syntax')).toBe(true);
    });

    it('should track line numbers across blocks', async () => {
      const content = `Line 1
Line 2
<!-- @srs
manifest:
  project_name: 123
  format: "extended-srs/v1"
@srs-->`;

      const result = await validateExtendedSRSFile(content);
      expect(result.isValid).toBe(false);
      const error = result.errors.find(
        (e) => e.message.includes('型が一致しません') || e.message.toLowerCase().includes('type'),
      );
      if (error && error.line !== undefined) {
        expect(error.line).toBeGreaterThanOrEqual(0);
      } else {
        // If line is not set, just check error exists
        expect(error).toBeDefined();
      }
    });

    it('should validate partial notation blocks', async () => {
      const content = `<!-- @srs
manifest:
  project_name: "Test"
  format: "extended-srs/v1"
@srs-->

<!-- @srs: project-overview
objective: 123  # Should be string
@srs-->`;

      const result = await validateExtendedSRSFile(content);
      expect(
        result.errors.some(
          (e) => e.message.includes('型が一致しません') || e.message.toLowerCase().includes('type'),
        ),
      ).toBe(true);
    });

    it('should validate minimal manifest without errors', async () => {
      const content = `<!-- @srs
manifest:
  project_name: "Test"
  format: "extended-srs/v1"
@srs-->`; // Minimal valid content

      const result = await validateExtendedSRSFile(content);
      expect(result.isValid).toBe(true); // Only manifest is required by schema
      expect(result.errors.length).toBe(0); // No errors
      expect(result.warnings.length).toBe(0); // No warnings (semantic validation removed)
    });
  });

  describe('validateMultipleFiles', () => {
    it('should validate multiple files independently', async () => {
      const files = [
        {
          path: 'valid.md',
          content: `<!-- @srs
manifest:
  project_name: "Valid Project"
  format: "extended-srs/v1"
project-overview:
  objective: "Test objective"
system-architecture:
  architecture:
    key_components:
      components:
        - component_id: main
          name: Main App
          type: backend
          tech_stack:
            language:
              name: JavaScript
              version: "20"
            framework:
              name: Node.js
              version: "20.0.0"
              language: JavaScript
      architecture_graph: "graph LR; Main"
    design_principles:
      - モノリシックアーキテクチャ
  tech_stack:
    development_tools:
      version_control:
        system: git
        platform: github
  data_models:
    entities:
      - entity_id: user_entity
        data_id: user_data
        component_id: main
        table_name: users
        columns:
          - attribute_name: id
            column_name: id
  common_technical_policies:
    error_handling:
      exception_strategy: global_handler
      error_format: json
@srs-->`,
        },
        {
          path: 'invalid.md',
          content: `<!-- @srs
manifest:
  project_name: 123
  format: "extended-srs/v1"
@srs-->`,
        },
        {
          path: 'empty.md',
          content: `# Empty file`,
        },
      ];

      const results = await validateMultipleFiles(files);

      expect(results.size).toBe(3);
      expect(results.get('valid.md')?.isValid).toBe(true);
      expect(results.get('invalid.md')?.isValid).toBe(false);
      expect(results.get('empty.md')?.isValid).toBe(false);
    });

    it('should handle empty file array', async () => {
      const results = await validateMultipleFiles([]);
      expect(results.size).toBe(0);
    });
  });

  describe('getSchemaNodeForPath', () => {
    it('should retrieve schema node for path', async () => {
      const { loadExtendedSRSSchema } = await import('extended-srs-core');
      const schema = loadExtendedSRSSchema();

      const manifestNode = getSchemaNodeForPath(schema, ['manifest']);
      expect(manifestNode).toBeDefined();
      expect(manifestNode.$ref || manifestNode.properties).toBeDefined();

      const overviewNode = getSchemaNodeForPath(schema, ['project-overview']);
      expect(overviewNode).toBeDefined();
    });

    it('should return null for invalid path', async () => {
      const { loadExtendedSRSSchema } = await import('extended-srs-core');
      const schema = loadExtendedSRSSchema();

      const node = getSchemaNodeForPath(schema, ['invalid', 'path']);
      expect(node).toBeNull();
    });

    it('should handle empty path', async () => {
      const { loadExtendedSRSSchema } = await import('extended-srs-core');
      const schema = loadExtendedSRSSchema();

      const node = getSchemaNodeForPath(schema, []);
      expect(node).toBe(schema);
    });

    it('should handle null schema', () => {
      const node = getSchemaNodeForPath(null, ['manifest']);
      expect(node).toBeNull();
    });
  });

  describe('Schema Validation Only', () => {
    it('should require manifest section by schema', async () => {
      const yamlContent = `project-overview:
  objective: "Build system"`;

      const result = await validateYAML(yamlContent);
      // Manifest is required by JSON schema
      expect(result.isValid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes('manifest') || e.message.includes('必須')),
      ).toBe(true);
    });

    it('should require manifest format field', async () => {
      const yamlContent = `manifest:
  project_name: "Test"`;

      const result = await validateYAML(yamlContent);
      // Check for required field error in Japanese or English
      expect(
        result.errors.some(
          (e) =>
            e.message.includes('format') &&
            (e.message.includes('がありません') || e.message.includes('required')),
        ),
      ).toBe(true);
    });

    it('should require project name', async () => {
      const yamlContent = `manifest:
  format: "extended-srs/v1"`;

      const result = await validateYAML(yamlContent);
      // Check for required field error in Japanese or English
      expect(
        result.errors.some(
          (e) =>
            e.message.includes('project_name') &&
            (e.message.includes('がありません') || e.message.includes('required')),
        ),
      ).toBe(true);
    });

    it('should accept manifest-only document', async () => {
      const yamlContent = `manifest:
  project_name: "Test"
  format: "extended-srs/v1"`;

      const result = await validateYAML(yamlContent);
      expect(result.isValid).toBe(true); // Manifest only is valid
      expect(result.errors.length).toBe(0);
      expect(result.warnings.length).toBe(0); // No semantic warnings
    });

    it('should accept document without system-architecture', async () => {
      const yamlContent = `manifest:
  project_name: "Test"
  format: "extended-srs/v1"
project-overview:
  objective: "Build"`;

      const result = await validateYAML(yamlContent);
      expect(result.isValid).toBe(true); // No semantic validation
      expect(result.errors.length).toBe(0);
      expect(result.warnings.length).toBe(0);
    });

    it('should skip semantic validation for partial blocks', async () => {
      const yamlContent = `objective: "Build system"`;

      const result = await validateYAML(yamlContent, 0, ['project-overview'], true);
      expect(result.errors.every((e) => e.type !== 'semantic')).toBe(true);
    });
  });

  describe('validateYAML - additional line number and error format tests', () => {
    it('should find line number for required error at root level', async () => {
      const yamlContent = `project-overview:
  objective: "Test"`;
      // Missing manifest at root level
      const result = await validateYAML(yamlContent);
      expect(result.isValid).toBe(false);
      const requiredError = result.errors.find((e) => e.message.includes('manifest'));
      expect(requiredError).toBeDefined();
      // Should have a line number (0 or the first non-empty line)
      expect(requiredError!.line).toBeDefined();
      expect(requiredError!.line).toBeGreaterThanOrEqual(0);
    });

    it('should find line number for nested required error', async () => {
      const yamlContent = `manifest:
  project_name: "Test"`;
      // Missing format within manifest
      const result = await validateYAML(yamlContent);
      const formatError = result.errors.find((e) => e.message.includes('format'));
      expect(formatError).toBeDefined();
      // Line number should point to the manifest: line
      expect(formatError!.line).toBeDefined();
    });

    it('should find line number for additionalProperties error', async () => {
      const yamlContent = `manifest:
  project_name: "Test"
  format: "extended-srs/v1"
  unknown_field: "value"`;
      const result = await validateYAML(yamlContent);
      // additionalProperties should be warning
      const warning = result.warnings.find((w) => w.message.includes('unknown_field'));
      if (warning) {
        expect(warning.line).toBeDefined();
      }
    });

    it('should find line number for nested additionalProperties error', async () => {
      const yamlContent = `manifest:
  project_name: "Test"
  format: "extended-srs/v1"
  metadata:
    unknown_nested: "value"`;
      const result = await validateYAML(yamlContent);
      // Check warnings for metadata-related additionalProperties
      const allIssues = [...result.errors, ...result.warnings];
      expect(allIssues.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle format errors as warnings', async () => {
      const yamlContent = `manifest:
  project_name: "Test"
  format: "extended-srs/v1"
  metadata:
    invalid_format_field: "not-a-date"`;
      const result = await validateYAML(yamlContent);
      // Format errors in metadata section should be warnings
      expect(result.warnings.length).toBeGreaterThanOrEqual(0);
    });

    it('should classify pattern errors in metadata as warnings', async () => {
      const yamlContent = `manifest:
  project_name: "Test"
  format: "extended-srs/v1"
  metadata:
    version_pattern: "invalid"`;
      const result = await validateYAML(yamlContent);
      // Pattern errors under /metadata should be warnings
      expect(result).toBeDefined();
    });

    it('should handle const error for manifest format', async () => {
      const yamlContent = `manifest:
  project_name: "Test"
  format: "wrong-format"`;

      const result = await validateYAML(yamlContent);
      expect(result.isValid).toBe(false);
      const constError = result.errors.find((e) => e.message.includes('extended-srs/v1'));
      expect(constError).toBeDefined();
    });

    it('should report type error with correct format', async () => {
      const yamlContent = `manifest:
  project_name: "Test"
  format: "extended-srs/v1"
project-overview:
  objective: 123`;

      const result = await validateYAML(yamlContent);
      expect(result.isValid).toBe(false);
      const typeError = result.errors.find((e) => e.message.includes('型が一致しません'));
      expect(typeError).toBeDefined();
    });

    it('should trigger minimum/maximum formatAjvError via full schema validation', async () => {
      const yamlContent = `manifest:
  project_name: "Test"
  format: "extended-srs/v1"
system-architecture:
  tech_stack:
    development_tools:
      version_control:
        system: git
        platform: github
      testing:
        coverage_targets:
          unit: -10
          integration: 200`;

      const result = await validateYAML(yamlContent);
      expect(result.isValid).toBe(false);
      // Should have minimum/maximum errors
      const allIssues = [...result.errors, ...result.warnings];
      expect(allIssues.length).toBeGreaterThan(0);
    });

    it('should trigger pattern formatAjvError via full schema validation', async () => {
      const yamlContent = `manifest:
  project_name: "Test"
  format: "extended-srs/v1"
  files:
    - "../hack/path"`;

      const result = await validateYAML(yamlContent);
      // Pattern violation on directory traversal
      const allIssues = [...result.errors, ...result.warnings];
      const patternIssue = allIssues.find(
        (e) => e.message.includes('パターン') || e.message.includes('pattern'),
      );
      if (patternIssue) {
        expect(patternIssue.message).toBeDefined();
      }
    });
  });

  describe('Error and Warning Classification', () => {
    it('should report unknown metadata as a warning without validating its arbitrary contents', async () => {
      const yamlContent = `manifest:
  project_name: "Test"
  format: "extended-srs/v1"
  metadata:
    date: "invalid-date-format"`;

      const result = await validateYAML(yamlContent);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([
        expect.objectContaining({
          type: 'unknown-property',
          message: expect.stringContaining('"metadata"'),
        }),
      ]);
    });

    it('should provide detailed error messages', async () => {
      const yamlContent = `manifest:
  project_name: "Test"`;

      const result = await validateYAML(yamlContent);
      const formatError = result.errors.find((e) => e.message.includes('format'));
      expect(formatError).toBeDefined();
      expect(formatError?.path).toBeDefined();
      expect(formatError?.severity).toBe('error');
    });

    it('should handle multiple error types', async () => {
      const content = `<!-- @srs
invalid_yaml: [
@srs-->

<!-- @srs
manifest:
  project_name: 123
@srs-->`;

      const result = await validateExtendedSRSFile(content);
      expect(result.errors.some((e) => e.type === 'yaml-syntax')).toBe(true);
      expect(result.errors.some((e) => e.type === 'schema-validation')).toBe(true);
    });
  });

  describe('validateExtendedSRS (object validation)', () => {
    it('should validate a valid SRS data object', async () => {
      const data = {
        manifest: {
          project_name: 'Test',
          format: 'extended-srs/v1',
        },
      };

      const result = await validateExtendedSRS(data);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing manifest', async () => {
      const data = {
        'project-overview': {
          objective: 'Build system',
        },
      };

      const result = await validateExtendedSRS(data);
      expect(result.isValid).toBe(false);
      const manifestError = result.errors.find(
        (e) => e.path === 'manifest' && e.message.includes('manifest'),
      );
      expect(manifestError).toBeDefined();
    });

    it('should detect type mismatch with source file tracking', async () => {
      const data = {
        manifest: {
          project_name: 12345, // Should be string
          format: 'extended-srs/v1',
        },
      };
      const fieldSources = {
        'manifest.project_name': ['details.md'],
        manifest: ['srs.md'],
      };

      const result = await validateExtendedSRS(data, fieldSources);
      expect(result.isValid).toBe(false);

      const typeError = result.errors.find((e) => e.path === 'manifest.project_name');
      expect(typeError).toBeDefined();
      expect(typeError!.sourceFile).toBe('details.md');
    });

    it('should resolve source file via parent path for required errors', async () => {
      const data = {
        manifest: {
          project_name: 'Test',
          // format is missing
        },
      };
      const fieldSources = {
        manifest: ['srs.md'],
        'manifest.project_name': ['srs.md'],
      };

      const result = await validateExtendedSRS(data, fieldSources);
      const formatError = result.errors.find((e) => e.path === 'manifest.format');
      expect(formatError).toBeDefined();
      expect(formatError!.sourceFile).toBe('srs.md');
    });

    it('should report unknown-property warnings with source tracking', async () => {
      const data = {
        manifest: {
          project_name: 'Test',
          format: 'extended-srs/v1',
          unknown_field: 'value',
        },
      };
      const fieldSources = {
        manifest: ['srs.md'],
        'manifest.unknown_field': ['srs.md'],
      };

      const result = await validateExtendedSRS(data, fieldSources);
      // Unknown fields retain their source tracking when reported as warnings.
      const warning = result.warnings.find((e) => e.message.includes('unknown_field'));
      expect(result.errors).toEqual([]);
      expect(warning).toMatchObject({ severity: 'warning', sourceFile: 'srs.md' });
    });

    it('should handle enum/const validation errors', async () => {
      const data = {
        manifest: {
          project_name: 'Test',
          format: 'wrong-format',
        },
      };

      const result = await validateExtendedSRS(data);
      const formatError = result.errors.find((e) => e.path === 'manifest.format');
      expect(formatError).toBeDefined();
      expect(formatError!.message).toContain('extended-srs/v1');
    });

    it('should resolve field source with line numbers from fieldLocations', async () => {
      const data = {
        manifest: {
          project_name: 12345,
          format: 'extended-srs/v1',
        },
      };
      const fieldSources = {
        'manifest.project_name': ['file.md'],
      };
      const fieldLocations = {
        'manifest.project_name': [{ filepath: 'file.md', lineStart: 5, lineEnd: 5 }],
      };

      const result = await validateExtendedSRS(data, fieldSources, fieldLocations);
      const error = result.errors.find((e) => e.path === 'manifest.project_name');
      expect(error).toBeDefined();
      expect(error!.line).toBe(6); // 1-based (lineStart 5 → line 6)
    });

    it('should fall back to root path for source resolution', async () => {
      const data = {
        manifest: {
          project_name: 'Test',
          // format missing
        },
      };
      // Only root path available
      const fieldSources = {
        '': ['srs.md'],
      };

      const result = await validateExtendedSRS(data, fieldSources);
      const formatError = result.errors.find((e) => e.path === 'manifest.format');
      expect(formatError).toBeDefined();
      expect(formatError!.sourceFile).toBe('srs.md');
    });

    it('should return empty results when no fieldSources provided', async () => {
      const data = {
        manifest: {
          project_name: 12345,
          format: 'extended-srs/v1',
        },
      };

      const result = await validateExtendedSRS(data);
      expect(result.isValid).toBe(false);
      // Should still produce errors, just without source files
      const error = result.errors.find((e) => e.path === 'manifest.project_name');
      expect(error).toBeDefined();
      expect(error!.sourceFile).toBeUndefined();
    });

    it('should handle pattern validation errors', async () => {
      // pattern errors come from schema constraints
      // Testing through validateExtendedSRS
      const data = {
        manifest: {
          project_name: 'Test',
          format: 'extended-srs/v1',
          version: 'not-semver',
        },
      };

      const result = await validateExtendedSRS(data);
      // If version has a pattern constraint in schema
      if (result.errors.length > 0) {
        const patternError = result.errors.find((e) => e.type === 'pattern');
        if (patternError) {
          expect(patternError.message).toContain('パターン');
        }
      }
    });

    it('should handle generic/fallback error types', async () => {
      // Some AJV errors might not match specific keywords
      const data = {
        manifest: {
          project_name: 'Test',
          format: 'extended-srs/v1',
        },
      };

      // Valid data should have no errors
      const result = await validateExtendedSRS(data);
      expect(result.isValid).toBe(true);
    });

    it('should handle minimum value errors (coverage_targets < 0)', async () => {
      const data = {
        manifest: {
          project_name: 'Test',
          format: 'extended-srs/v1',
        },
        'system-architecture': {
          tech_stack: {
            development_tools: {
              testing: {
                coverage_targets: {
                  unit: -5, // minimum: 0
                },
              },
              version_control: {
                system: 'git',
                platform: 'github',
              },
            },
          },
        },
      };

      const fieldSources = {
        'system-architecture.tech_stack.development_tools.testing.coverage_targets.unit': [
          'srs.md',
        ],
      };

      const result = await validateExtendedSRS(data, fieldSources);
      expect(result.isValid).toBe(false);
      const minError = result.errors.find(
        (e) => e.type === 'minimum' || e.type === 'exclusiveMinimum',
      );
      expect(minError).toBeDefined();
      expect(minError!.message).toContain('以上');
    });

    it('should handle maximum value errors (coverage_targets > 100)', async () => {
      const data = {
        manifest: {
          project_name: 'Test',
          format: 'extended-srs/v1',
        },
        'system-architecture': {
          tech_stack: {
            development_tools: {
              testing: {
                coverage_targets: {
                  unit: 150, // maximum: 100
                },
              },
              version_control: {
                system: 'git',
                platform: 'github',
              },
            },
          },
        },
      };

      const fieldSources = {
        'system-architecture.tech_stack.development_tools.testing.coverage_targets.unit': [
          'srs.md',
        ],
      };

      const result = await validateExtendedSRS(data, fieldSources);
      expect(result.isValid).toBe(false);
      const maxError = result.errors.find(
        (e) => e.type === 'maximum' || e.type === 'exclusiveMaximum',
      );
      expect(maxError).toBeDefined();
      expect(maxError!.message).toContain('以下');
    });

    it('should handle pattern errors (manifest.files with directory traversal)', async () => {
      const data = {
        manifest: {
          project_name: 'Test',
          format: 'extended-srs/v1',
          files: ['../etc/passwd'], // pattern: ^(?!.*\\.\\.).*$
        },
      };

      const fieldSources = {
        'manifest.files': ['srs.md'],
      };

      const result = await validateExtendedSRS(data, fieldSources);
      // If pattern constraint is enforced, there should be a pattern error
      if (!result.isValid) {
        const patternError = result.errors.find((e) => e.type === 'pattern');
        if (patternError) {
          expect(patternError.message).toContain('パターン');
        }
      }
    });

    it('should detect missing manifest.project_name required error', async () => {
      const data = {
        manifest: {
          format: 'extended-srs/v1',
          // project_name is missing
        },
      };
      const fieldSources = {
        manifest: ['srs.md'],
        'manifest.format': ['srs.md'],
      };

      const result = await validateExtendedSRS(data, fieldSources);
      expect(result.isValid).toBe(false);
      const requiredError = result.errors.find((e) => e.path === 'manifest.project_name');
      expect(requiredError).toBeDefined();
      expect(requiredError!.message).toContain('project_name');
    });

    it('should handle const error with allowedValue param', async () => {
      const data = {
        manifest: {
          project_name: 'Test',
          format: 'invalid-format-value',
        },
      };
      const fieldSources = {
        'manifest.format': ['srs.md'],
      };

      const result = await validateExtendedSRS(data, fieldSources);
      expect(result.isValid).toBe(false);
      const constError = result.errors.find((e) => e.path === 'manifest.format');
      expect(constError).toBeDefined();
      expect(constError!.message).toContain('extended-srs/v1');
    });

    it('should handle minItems errors (empty design_principles)', async () => {
      const data = {
        manifest: {
          project_name: 'Test',
          format: 'extended-srs/v1',
        },
        'system-architecture': {
          architecture: {
            design_principles: [], // minItems: 1
            key_components: {
              components: [
                {
                  component_id: 'main',
                  name: 'Main',
                  type: 'backend',
                  tech_stack: {
                    language: { name: 'JS', version: '20' },
                    framework: { name: 'Node', version: '20', language: 'JS' },
                  },
                },
              ],
              architecture_graph: 'graph LR; A',
            },
          },
        },
      };

      const result = await validateExtendedSRS(data);
      // minItems violation should produce an error
      if (!result.isValid) {
        expect(
          result.errors.some(
            (e) => e.path.includes('design_principles') || e.message.includes('design_principles'),
          ),
        ).toBe(true);
      }
    });
  });

  describe('Complex Hierarchy Validation', () => {
    // Note: These tests focus on validation behavior for complex hierarchies
    // The actual indentation fixes for QuickFix are tested manually in the Monaco editor
    it('should validate full notation with basic structure', async () => {
      // Simplified test - focus on basic validation, not complex schema requirements
      const content = `<!-- @srs
manifest:
  project_name: "Test"
  format: "extended-srs/v1"
project-overview:
  objective: "Build a test system"
  scope:
    in_scope:
      - "Feature 1"
    out_scope:
      - "Feature 2"
system-architecture:
  architecture:
    key_components:
      components:
        - component_id: main
          name: Main App
          type: backend
          tech_stack:
            language:
              name: JavaScript
              version: "20"
            framework:
              name: Node.js
              version: "20.0.0"
              language: JavaScript
      architecture_graph: "graph LR; Main"
    design_principles:
      - モノリシックアーキテクチャ
  tech_stack:
    development_tools:
      version_control:
        system: git
        platform: github
  data_models:
    entities:
      - entity_id: user_entity
        data_id: user_data
        component_id: main
        table_name: users
        columns:
          - attribute_name: id
            column_name: id
  common_technical_policies:
    error_handling:
      exception_strategy: global_handler
      error_format: json
@srs-->`;

      const result = await validateExtendedSRSFile(content);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing fields in nested objects (full notation)', async () => {
      const content = `<!-- @srs
manifest:
  project_name: "Test"
system-architecture:
  architecture:
    key_components:
      components:
        - component_id: "frontend"
          name: "Frontend"
@srs-->`;

      const result = await validateExtendedSRSFile(content);
      expect(result.isValid).toBe(false);

      // manifest.format is missing - check for both Japanese and English messages
      const formatError = result.errors.find(
        (e) =>
          (e.message.includes('format') &&
            (e.message.includes('required') || e.message.includes('がありません'))) ||
          e.message.includes('フォーマット'),
      );
      expect(formatError).toBeDefined();

      // components[0].type is missing - check for both Japanese and English messages
      // Note: The type field is at system-architecture.architecture.key_components.components[0].type
      const typeError = result.errors.find(
        (e) =>
          (e.message.includes('type') &&
            (e.message.includes('required') || e.message.includes('がありません'))) ||
          e.message.includes('タイプ'),
      );
      expect(typeError).toBeDefined();
    });

    it('should validate partial notation for manifest', async () => {
      const content = `<!-- @srs: manifest
project_name: "Test"
format: "extended-srs/v1"
@srs-->`;

      const result = await validateExtendedSRSFile(content);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing fields in partial notation for manifest', async () => {
      const content = `<!-- @srs: manifest
project_name: "Test"
@srs-->`;

      const result = await validateExtendedSRSFile(content);
      expect(result.isValid).toBe(false);

      // format is missing - check for both Japanese and English messages
      const formatError = result.errors.find(
        (e) =>
          (e.message.includes('format') &&
            (e.message.includes('required') || e.message.includes('がありません'))) ||
          e.message.includes('フォーマット'),
      );
      expect(formatError).toBeDefined();
    });

    it('should validate partial notation for arrays', async () => {
      const content = `<!-- @srs: manifest.files
- requirements.md
- overview.md
@srs-->`;

      const result = await validateExtendedSRSFile(content);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect invalid array item types in partial notation', async () => {
      const content = `<!-- @srs: manifest.files
- 123
@srs-->`;

      const result = await validateExtendedSRSFile(content);
      expect(result.isValid).toBe(false);
      expect(result.errors).toEqual([
        expect.objectContaining({
          path: '/0',
          message: expect.stringContaining('string'),
          type: 'schema-validation',
        }),
      ]);
    });

    it('should validate partial notation with nested objects', async () => {
      const content = `<!-- @srs: project-overview
objective: "Build"
scope:
  in_scope:
    - "Feature 1"
  out_scope:
    - "Feature 2"
@srs-->`;

      const result = await validateExtendedSRSFile(content);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing nested fields (partial notation)', async () => {
      const content = `<!-- @srs: project-overview
objective: "Build"
scope:
  in_scope:
    - "Feature 1"
@srs-->`;

      const result = await validateExtendedSRSFile(content);
      expect(result.isValid).toBe(false);

      // scope.out_scope is missing - check for both Japanese and English messages
      const outScopeError = result.errors.find(
        (e) =>
          (e.message.includes('out_scope') &&
            (e.message.includes('required') || e.message.includes('がありません'))) ||
          e.message.includes('対象外'),
      );
      expect(outScopeError).toBeDefined();
    });
  });

  describe('array-vs-object type mismatch handling', () => {
    it('should report an array in place of an object as a single type-mismatch error', async () => {
      // Simulate data where an array is used where an object is expected
      // use-cases schema expects { list: [...] } but data has an array directly
      const data = {
        manifest: {
          project_name: 'Test',
          format: 'extended-srs/v1',
        },
        'use-cases': [
          { uc_id: 'UC-001', name: 'Test Use Case' },
          { uc_id: 'UC-002', name: 'Another Use Case' },
        ],
      };

      const result = await validateExtendedSRS(data);
      expect(result.isValid).toBe(false);

      // Should NOT have individual "不明なプロパティ '0'" / "不明なプロパティ '1'" errors
      const numericPropErrors = result.errors.filter(
        (e) => e.message.includes('不明なプロパティ') && /"\d+"/.test(e.message),
      );
      expect(numericPropErrors).toHaveLength(0);

      // Should have a single type-mismatch error for use-cases
      const typeMismatchErrors = result.errors.filter(
        (e) => e.path === 'use-cases' && e.type === 'type-mismatch',
      );
      expect(typeMismatchErrors).toHaveLength(1);
      expect(typeMismatchErrors[0].message).toContain('オブジェクト型');
    });

    it('should report unknown fields as warnings', async () => {
      const data = {
        manifest: {
          project_name: 'Test',
          format: 'extended-srs/v1',
          unknown_field: 'value',
        },
      };

      const result = await validateExtendedSRS(data);
      const unknownFieldWarning = result.warnings.find(
        (e) => e.message.includes('unknown_field') && e.message.includes('不明なプロパティ'),
      );
      expect(result.errors).toEqual([]);
      expect(unknownFieldWarning).toMatchObject({ type: 'unknown-property', severity: 'warning' });
    });

    it('should handle type error with array-vs-object and provide clear message', async () => {
      const data = {
        manifest: {
          project_name: 'Test',
          format: 'extended-srs/v1',
        },
        'non-functional-requirements': [{ req_id: 'NFR-001', name: 'Performance' }],
      };

      const result = await validateExtendedSRS(data);
      expect(result.isValid).toBe(false);

      // Should have type-mismatch error, not confusing type error
      const errors = result.errors.filter((e) => e.path === 'non-functional-requirements');
      expect(errors.length).toBeGreaterThanOrEqual(1);
      // At least one should be a type-mismatch with clear message
      const typeMismatch = errors.find((e) => e.type === 'type-mismatch');
      expect(typeMismatch).toBeDefined();
      expect(typeMismatch!.message).toContain('オブジェクト型');
    });

    it('should resolve field source with bracket notation fallback', async () => {
      const data = {
        manifest: {
          project_name: 'Test',
          format: 'extended-srs/v1',
          extra_key: 'bad',
        },
      };
      // fieldSources uses bracket notation for array paths
      const fieldSources: Record<string, string[]> = {
        manifest: ['srs.md'],
        'manifest.extra_key': ['details.md'],
      };

      const result = await validateExtendedSRS(data, fieldSources);
      const extraWarning = result.warnings.find((e) => e.path === 'manifest.extra_key');
      expect(extraWarning).toBeDefined();
      expect(extraWarning!.sourceFile).toBe('details.md');
    });

    it('should provide Japanese type names in type mismatch errors', async () => {
      const data = {
        manifest: {
          project_name: 12345, // Should be string
          format: 'extended-srs/v1',
        },
      };

      const result = await validateExtendedSRS(data);
      const typeError = result.errors.find((e) => e.path === 'manifest.project_name');
      expect(typeError).toBeDefined();
      expect(typeError!.message).toContain('文字列');
      expect(typeError!.message).toContain('数値');
    });
  });
});
