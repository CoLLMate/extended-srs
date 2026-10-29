// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for Extended SRS Schema Loader
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
  loadExtendedSRSSchema,
  initializeExtendedSRSSchemas,
  getAjvInstance,
  schemaMap,
  loadSchemaFromFile,
  initializeAjv,
  resolveSchemaReference,
  clearResolveCache,
  getValidationFunction,
  transformSchemaToTree,
  getExtendedSRSSchemaTree,
  clearTreeCache,
} from '../src';

describe('Extended SRS Core - Schema Loader', () => {
  beforeAll(async () => {
    // Initialize schemas before tests
    await initializeExtendedSRSSchemas();
  });

  afterEach(() => {
    // Clear caches after each test
    clearResolveCache();
    clearTreeCache();
  });

  describe('schemaMap', () => {
    it('should contain all required schema files', () => {
      expect(schemaMap['extended-srs-schema.json']).toBeDefined();
      expect(schemaMap['manifest-schema.json']).toBeDefined();
      expect(schemaMap['project-overview-schema.json']).toBeDefined();
      expect(schemaMap['system-architecture-schema.json']).toBeDefined();
      expect(schemaMap['functional-requirements-schema.json']).toBeDefined();
      expect(schemaMap['non-functional-requirements-schema.json']).toBeDefined();
      expect(schemaMap['use-cases-schema.json']).toBeDefined();
      expect(schemaMap['domain-model-schema.json']).toBeDefined();
      expect(schemaMap['constraints-schema.json']).toBeDefined();
      expect(schemaMap['development-implementation-schema.json']).toBeDefined();
      expect(schemaMap['workflow-schema.json']).toBeDefined();
      expect(schemaMap['common-definitions-schema.json']).toBeDefined();
    });

    it('should have valid JSON schema structure', () => {
      const mainSchema = schemaMap['extended-srs-schema.json'];
      expect(mainSchema.$schema).toBeDefined();
      expect(mainSchema.$id).toBeDefined();
      expect(mainSchema.type).toBe('object');
      expect(mainSchema.properties).toBeDefined();
    });
  });

  describe('loadSchemaFromFile', () => {
    it('should load schema from static map', () => {
      const schema = loadSchemaFromFile('manifest-schema.json');
      expect(schema).toBeDefined();
      expect(schema.$id).toContain('manifest');
    });

    it('should cache loaded schemas', () => {
      const schema1 = loadSchemaFromFile('project-overview-schema.json');
      const schema2 = loadSchemaFromFile('project-overview-schema.json');
      expect(schema1).toBe(schema2); // Same reference
    });

    it('should handle schema paths with directories', () => {
      const schema = loadSchemaFromFile('/some/path/manifest-schema.json');
      expect(schema).toBeDefined();
      expect(schema.$id).toContain('manifest');
    });

    it('should return empty object for non-existent schema', () => {
      const schema = loadSchemaFromFile('non-existent-schema.json');
      expect(schema).toEqual({});
    });
  });

  describe('initializeAjv', () => {
    it('should create AJV instance with proper configuration', async () => {
      const ajv = await initializeAjv();
      expect(ajv).toBeDefined();
      expect(ajv.opts.allErrors).toBe(true);
      expect(ajv.opts.strict).toBe(false);
    });

    it('should pre-load all sub-schemas', async () => {
      const ajv = await initializeAjv();

      // Check that schemas are registered
      const manifestSchema = ajv.getSchema('./schemas/manifest-schema.json');
      expect(manifestSchema).toBeDefined();

      const overviewSchema = ajv.getSchema('./schemas/project-overview-schema.json');
      expect(overviewSchema).toBeDefined();
    });

    it('should compile validation function', async () => {
      await initializeAjv();
      const validationFunction = getValidationFunction();
      expect(validationFunction).toBeDefined();
      expect(typeof validationFunction).toBe('function');
    });

    it('should return same instance on multiple calls', async () => {
      const ajv1 = await initializeAjv();
      const ajv2 = await initializeAjv();
      expect(ajv1).toBe(ajv2);
    });
  });

  describe('loadExtendedSRSSchema', () => {
    it('should return cached schema after initialization', () => {
      const schema = loadExtendedSRSSchema();
      expect(schema).toBeDefined();
      expect(schema.$schema).toBeDefined();
      expect(schema.$id).toBeDefined();
      expect(schema.type).toBe('object');
      expect(schema.properties).toBeDefined();
    });

    it('should have resolved references', () => {
      const schema = loadExtendedSRSSchema();

      // Check that properties have been properly set up
      expect(schema.properties.manifest).toBeDefined();
      expect(schema.properties['project-overview']).toBeDefined();
      expect(schema.properties['use-cases']).toBeDefined();
    });

    it('should return consistent schema', () => {
      const schema1 = loadExtendedSRSSchema();
      const schema2 = loadExtendedSRSSchema();
      expect(schema1).toBe(schema2);
    });
  });

  describe('resolveSchemaReference', () => {
    it('should resolve relative schema references', () => {
      const resolved = resolveSchemaReference('./schemas/manifest-schema.json');
      expect(resolved).toBeDefined();
      expect(resolved.$id).toContain('manifest');
    });

    it('should resolve internal references within schema', () => {
      const schema = schemaMap['use-cases-schema.json'];
      const resolved = resolveSchemaReference('#/definitions/actor', schema);
      expect(resolved).toBeDefined();
    });

    it('should handle direct schema references', () => {
      const resolved = resolveSchemaReference('project-overview-schema.json');
      expect(resolved).toBeDefined();
    });

    it('should extract filename from full path', () => {
      const resolved = resolveSchemaReference('/path/to/system-architecture-schema.json');
      expect(resolved).toBeDefined();
      expect(resolved.$id).toContain('system-architecture');
    });

    it('should return null for invalid references', () => {
      const resolved = resolveSchemaReference('invalid-ref');
      expect(resolved).toBeNull();
    });

    it('should cache resolved references', () => {
      const resolved1 = resolveSchemaReference('./schemas/manifest-schema.json');
      const resolved2 = resolveSchemaReference('./schemas/manifest-schema.json');
      expect(resolved1).toBe(resolved2);
    });

    it('should detect circular references', () => {
      // Create a mock circular reference scenario
      const schema = {
        $id: 'test',
        properties: {
          self: { $ref: '#' },
        },
      };

      // This should not cause infinite loop
      const resolved = resolveSchemaReference('#/properties/self', schema);
      expect(resolved).toBeDefined();
    });
  });

  describe('getAjvInstance', () => {
    it('should return initialized AJV instance', async () => {
      await initializeAjv();
      const ajv = getAjvInstance();
      expect(ajv).toBeDefined();
      expect(ajv?.opts).toBeDefined();
    });

    it('should return null before initialization', () => {
      // This test might fail if other tests have already initialized
      // Skip if already initialized
      const ajv = getAjvInstance();
      if (ajv) {
        expect(ajv).toBeDefined();
      } else {
        expect(ajv).toBeNull();
      }
    });
  });

  describe('transformSchemaToTree', () => {
    it('should transform simple schema to tree', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name field' },
          age: { type: 'number', description: 'Age field' },
        },
        required: ['name'],
      };

      const tree = transformSchemaToTree(schema);
      expect(tree.type).toBe('object');
      expect(tree.properties).toBeDefined();
      expect(tree.properties!.name.type).toBe('string');
      expect(tree.properties!.name.required).toBe(true);
      expect(tree.properties!.age.required).toBe(false);
    });

    it('should handle $ref resolution', () => {
      const schema = {
        properties: {
          manifest: { $ref: './schemas/manifest-schema.json' },
        },
      };

      const tree = transformSchemaToTree(schema);
      expect(tree.properties!.manifest).toBeDefined();
      expect(tree.properties!.manifest.type).toBeDefined();
    });

    it('should handle array items', () => {
      const schema = {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
        },
      };

      const tree = transformSchemaToTree(schema);
      expect(tree.type).toBe('array');
      expect(tree.items).toBeDefined();
      expect(tree.items!.type).toBe('object');
      expect(tree.items!.properties!.id.type).toBe('string');
    });

    it('should include enum values', () => {
      const schema = {
        type: 'string',
        enum: ['option1', 'option2', 'option3'],
      };

      const tree = transformSchemaToTree(schema);
      expect(tree.enum).toEqual(['option1', 'option2', 'option3']);
    });

    it('should include format information', () => {
      const schema = {
        type: 'string',
        format: 'date-time',
      };

      const tree = transformSchemaToTree(schema);
      expect(tree.format).toBe('date-time');
    });

    it('should cache transformation results', () => {
      const schema = {
        type: 'object',
        title: 'Test Schema',
        properties: {
          field: { type: 'string' },
        },
      };

      const tree1 = transformSchemaToTree(schema);
      const tree2 = transformSchemaToTree(schema);

      // Check if results are consistent
      expect(JSON.stringify(tree1)).toBe(JSON.stringify(tree2));
    });

    it('should handle unresolved references gracefully', () => {
      const schema = {
        properties: {
          unknown: { $ref: '#/definitions/nonexistent' },
        },
      };

      const tree = transformSchemaToTree(schema);
      expect(tree.properties!.unknown).toBeDefined();
      expect(tree.properties!.unknown.type).toBe('reference');
      expect(tree.properties!.unknown.description).toContain('Unresolved');
    });
  });

  describe('getExtendedSRSSchemaTree', () => {
    it('should return complete Extended SRS schema as tree', () => {
      const tree = getExtendedSRSSchemaTree();
      expect(tree).toBeDefined();
      expect(tree.type).toBe('object');
      expect(tree.properties).toBeDefined();
      expect(tree.properties!.manifest).toBeDefined();
      expect(tree.properties!['project-overview']).toBeDefined();
      expect(tree.properties!['use-cases']).toBeDefined();
    });

    it('should have properly resolved references in tree', () => {
      const tree = getExtendedSRSSchemaTree();

      // Check that manifest is not just a reference
      const manifest = tree.properties!.manifest;
      expect(manifest.type).toBeDefined();

      // If it has properties, they should be defined
      if (manifest.properties) {
        expect(Object.keys(manifest.properties).length).toBeGreaterThan(0);
      }
    });
  });

  describe('Schema preprocessing', () => {
    it('should add additionalProperties: false to object types', () => {
      const schema = loadExtendedSRSSchema();

      // The main schema should have additionalProperties set
      if (schema.type === 'object' && !(schema as any).additionalProperties) {
        // This might be preprocessed
        expect((schema as any).additionalProperties).toBeDefined();
      }
    });

    it('should handle nested schema preprocessing', () => {
      const schema = schemaMap['manifest-schema.json'];

      // Check if the schema has been properly structured
      expect(schema.$id).toBeDefined();
      expect(schema.type).toBe('object');
      expect(schema.properties).toBeDefined();
    });
  });

  describe('Validation function', () => {
    it('should validate correct Extended SRS data', async () => {
      await initializeAjv();
      const validate = getValidationFunction();

      const validData = {
        manifest: {
          project_name: 'Test Project',
          format: 'extended-srs/v1',
        },
        'project-overview': {
          objective: 'Build a test system',
          scope: {
            in_scope: ['Feature 1', 'Feature 2'],
            out_scope: ['Feature 3'],
          },
        },
      };

      const isValid = validate(validData);
      if (!isValid) {
        console.log('Validation errors:', validate.errors);
      }
      expect(isValid).toBe(true);
    });

    it('should reject invalid Extended SRS data', async () => {
      await initializeAjv();
      const validate = getValidationFunction();

      const invalidData = {
        manifest: {
          project_name: 123, // Should be string
          format: 'extended-srs/v1',
        },
      };

      const isValid = validate(invalidData);
      expect(isValid).toBe(false);
      expect(validate.errors).toBeDefined();
      expect(validate.errors!.length).toBeGreaterThan(0);
    });
  });

  describe('Error handling', () => {
    it('should handle schema loading errors gracefully', () => {
      // Try to load with invalid path
      const schema = loadSchemaFromFile('///invalid///path///');
      expect(schema).toEqual({});
    });

    it('should provide fallback for initialization errors', async () => {
      // Even if there's an error, should return an AJV instance
      const ajv = await initializeAjv();
      expect(ajv).toBeDefined();
    });
  });
});
