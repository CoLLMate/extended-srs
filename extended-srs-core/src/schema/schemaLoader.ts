// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
/**
 * Extended SRS Schema Loader
 *
 * Handles loading and caching of Extended SRS schemas
 */

import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import draft7MetaSchema from 'ajv/dist/refs/json-schema-draft-07.json';
import { hasOwn } from '../safeKeys';
import { schemaForValidation } from './validationPolicy';

// 配布物に同梱したスキーマを静的インポート（prebuild で正本から生成）
import mainSchema from '../../schema/extended-srs-schema.json';
import manifestSchema from '../../schema/schemas/manifest-schema.json';
import projectOverviewSchema from '../../schema/schemas/project-overview-schema.json';
import systemArchitectureSchema from '../../schema/schemas/system-architecture-schema.json';
import functionalRequirementsSchema from '../../schema/schemas/functional-requirements-schema.json';
import nonFunctionalRequirementsSchema from '../../schema/schemas/non-functional-requirements-schema.json';
import useCasesSchema from '../../schema/schemas/use-cases-schema.json';
import domainModelSchema from '../../schema/schemas/domain-model-schema.json';
import constraintsSchema from '../../schema/schemas/constraints-schema.json';
import developmentImplementationSchema from '../../schema/schemas/development-implementation-schema.json';
import workflowSchema from '../../schema/schemas/workflow-schema.json';
import commonDefinitionsSchema from '../../schema/schemas/common-definitions-schema.json';

// Extended SRS Schema types
export interface ExtendedSRSSchema {
  $schema: string;
  $id: string;
  type: string;
  required: string[];
  properties: {
    [key: string]: any;
  };
}

// AJV instance for schema validation
let ajvInstance: Ajv | null = null;
let validationFunction: any = null;
let isInitialized = false;

// Schema cache
let cachedSchema: ExtendedSRSSchema | null = null;
const schemaCache: Map<string, any> = new Map();

// Keep the standard meta-schema in the dependency bundle. Its recursive references
// remain absolute when a field schema is extracted for partial validation or a UI.
function qualifyMetaReferences(value: any): any {
  if (!value || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(qualifyMetaReferences);
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      key === '$ref' && typeof child === 'string' && child.startsWith('#')
        ? `http://json-schema.org/draft-07/schema${child}`
        : qualifyMetaReferences(child),
    ]),
  );
}
const bundledMetaSchema = {
  ...qualifyMetaReferences(draft7MetaSchema),
  // Make Draft 7's implicit allowance explicit for field-path lookups.
  additionalProperties: true,
};
const metaSchemaIds = new Set([
  'http://json-schema.org/draft-07/schema',
  'https://json-schema.org/draft-07/schema',
]);

// Schema map for static access
export const schemaMap: Record<string, any> = {
  'extended-srs-schema.json': mainSchema,
  'manifest-schema.json': manifestSchema,
  'project-overview-schema.json': projectOverviewSchema,
  'system-architecture-schema.json': systemArchitectureSchema,
  'functional-requirements-schema.json': functionalRequirementsSchema,
  'non-functional-requirements-schema.json': nonFunctionalRequirementsSchema,
  'use-cases-schema.json': useCasesSchema,
  'domain-model-schema.json': domainModelSchema,
  'constraints-schema.json': constraintsSchema,
  'development-implementation-schema.json': developmentImplementationSchema,
  'workflow-schema.json': workflowSchema,
  'common-definitions-schema.json': commonDefinitionsSchema,
};

// Load schema from static imports
export function loadSchemaFromFile(schemaPath: string): any {
  if (schemaCache.has(schemaPath)) {
    return schemaCache.get(schemaPath);
  }

  try {
    // Extract schema filename from path
    const schemaFile = schemaPath.replace(/.*\/([^/]+)$/, '$1');

    // Get schema from static imports
    const schemaData = schemaMap[schemaFile];

    if (schemaData) {
      schemaCache.set(schemaPath, schemaData);
      return schemaData;
    } else {
      console.error(`Schema not found: ${schemaPath}`);
      return {};
    }
  } catch (error) {
    console.error(`Failed to load schema ${schemaPath}:`, error);
    return {};
  }
}

// Initialize AJV with main schema and static reference resolution
export async function initializeAjv(): Promise<Ajv> {
  if (ajvInstance && isInitialized) {
    return ajvInstance;
  }

  try {
    // Create AJV instance with dynamic reference resolution
    ajvInstance = new Ajv({
      allErrors: true,
      verbose: true,
      strict: false, // Allow custom keywords like x-sdk-name
      validateSchema: false, // Skip meta-schema validation
      addUsedSchema: true, // Let AJV manage schema registration
      inlineRefs: false, // Don't inline refs for better debugging
      strictSchema: false, // Allow custom keywords in schemas
      removeAdditional: false, // Don't remove additional properties, just validate them
      useDefaults: false, // Don't apply default values
      loadSchema: async (uri: string) => {
        // Schema should already be loaded during initialization
        // This function should not be called if we pre-loaded all schemas correctly
        console.warn(`Unexpected schema load request for: ${uri}`);

        // Try to find the schema by various patterns
        if (uri.startsWith('./schemas/')) {
          const fileName = uri.replace('./schemas/', '');
          if (schemaMap[fileName]) {
            return schemaForValidation(schemaMap[fileName]);
          }
        }

        // Handle https URLs
        if (uri.includes('extended-srs/v1/schemas/')) {
          const fileName = uri.split('/').pop();
          if (fileName && schemaMap[fileName]) {
            return schemaForValidation(schemaMap[fileName]);
          }
        }

        // Handle direct filename references
        if (schemaMap[uri]) {
          return schemaForValidation(schemaMap[uri]);
        }

        throw new Error(`Schema not found: ${uri}`);
      },
    });

    // Add format support
    addFormats(ajvInstance);

    // Pre-load all sub-schemas first (before main schema)
    Object.entries(schemaMap).forEach(([fileName, schema]) => {
      if (fileName === 'extended-srs-schema.json') {
        return; // Skip main schema for now
      }

      // Unknown SRS fields are reported separately as warnings.
      const processedSchema = schemaForValidation(schema);

      try {
        // Add schema with both its $id and relative path for reference resolution
        if (processedSchema.$id) {
          // Check if schema already added
          if (!ajvInstance!.getSchema(processedSchema.$id)) {
            ajvInstance!.addSchema(processedSchema);
          }
        }

        // Also add with relative path to support ./schemas/ references
        // Use exsrs.org to match the main schema's $id base URL
        const relativePath = `https://exsrs.org/extended-srs/v1/schemas/${fileName}`;
        if (!ajvInstance!.getSchema(relativePath)) {
          ajvInstance!.addSchema(processedSchema, relativePath);
        }

        // Add with simple relative path for test compatibility
        const simpleRelativePath = `./schemas/${fileName}`;
        if (!ajvInstance!.getSchema(simpleRelativePath)) {
          ajvInstance!.addSchema(processedSchema, simpleRelativePath);
        }
      } catch (error) {
        // Ignore duplicate schema errors
        if (error instanceof Error && !error.message?.includes('already exists')) {
          console.warn(`Failed to add schema ${fileName}:`, error);
        }
      }
    });

    // Now add the main schema after all sub-schemas are loaded
    const processedMainSchema = schemaForValidation(mainSchema);
    ajvInstance!.addSchema(processedMainSchema);

    // Compile validation function for main schema
    validationFunction = ajvInstance.compile(processedMainSchema);

    // Mark as initialized
    isInitialized = true;

    // Extended SRS AJV initialized successfully
    return ajvInstance;
  } catch (error) {
    console.error('Failed to initialize AJV:', error);
    // Fallback to simple AJV instance
    ajvInstance = new Ajv({ allErrors: true, strict: false });
    isInitialized = true;
    return ajvInstance;
  }
}

// Load schema from file (legacy function)
export function loadSchema(schemaPath: string): any {
  return loadSchemaFromFile(schemaPath);
}

// Helper function to recursively resolve all $refs in a schema
function resolveAllRefs(schema: any, contextSchema: any, active = new Set<any>()): any {
  if (!schema || typeof schema !== 'object') {
    return schema;
  }

  // Only references on the current branch indicate a cycle. Reusing a
  // definition in another property must still produce a resolved Schema.
  if (schema.$ref) {
    // A recursive meta-schema is a boundary, not a finite set of SRS fields to expand.
    if (metaSchemaIds.has(schema.$ref.split('#')[0])) {
      return { ...schema };
    }
    const reference = findReferencedSchema(schema.$ref, contextSchema);
    if (!reference || active.has(reference.value)) {
      return { ...schema };
    }
    const nextActive = new Set(active);
    nextActive.add(reference.value);
    return resolveAllRefs(reference.value, reference.document, nextActive);
  }

  if (Array.isArray(schema)) {
    return schema.map((item) => resolveAllRefs(item, contextSchema, active));
  }

  const document = schema.$id ? schema : contextSchema;
  return Object.fromEntries(
    Object.entries(schema).map(([key, value]) => [key, resolveAllRefs(value, document, active)]),
  );
}

// Initialize Extended SRS schemas
export async function initializeExtendedSRSSchemas(): Promise<void> {
  // Skip if already initialized
  if (cachedSchema && isInitialized) {
    return;
  }

  try {
    // Initialize AJV with pre-loaded schemas first
    await initializeAjv();

    // Create a fully resolved version of the main schema
    const resolvedSchema = resolveAllRefs(mainSchema, mainSchema) as ExtendedSRSSchema;

    // Cache the fully resolved schema
    cachedSchema = resolvedSchema;

    // Extended SRS schemas initialized successfully with fully resolved references
  } catch (error) {
    console.error('Failed to initialize Extended SRS schemas:', error);
    // Fallback to raw schema
    cachedSchema = mainSchema as ExtendedSRSSchema;
  }
}

// Load Extended SRS schema (synchronous, requires initialization)
export function loadExtendedSRSSchema(): ExtendedSRSSchema {
  if (cachedSchema) {
    return cachedSchema;
  }

  // Fallback if not initialized
  console.warn('Extended SRS schemas not initialized. Using main schema only.');
  cachedSchema = mainSchema as ExtendedSRSSchema;
  return cachedSchema;
}

// Resolve only against bundled documents; references never trigger network I/O.
function findReferencedSchema(
  ref: string,
  contextSchema?: any,
): { value: any; document: any } | null {
  const fragmentStart = ref.indexOf('#');
  const documentRef = fragmentStart < 0 ? ref : ref.slice(0, fragmentStart);
  const fragment = fragmentStart < 0 ? '' : ref.slice(fragmentStart + 1);
  let document = contextSchema;
  if (documentRef) {
    const filename = documentRef.slice(documentRef.lastIndexOf('/') + 1);
    const byReference = hasOwn(schemaMap, documentRef) ? schemaMap[documentRef] : undefined;
    const byFilename = hasOwn(schemaMap, filename) ? schemaMap[filename] : undefined;
    document =
      (metaSchemaIds.has(documentRef) ? bundledMetaSchema : undefined) ??
      byReference ??
      byFilename ??
      Object.values(schemaMap).find(
        (schema) => schema.$id === documentRef || schema.$id?.endsWith(`/${filename}`),
      );
  }
  if (document === undefined || document === null) {
    return null;
  }

  let value = document;
  if (fragment) {
    let pointer: string;
    try {
      pointer = decodeURIComponent(fragment);
    } catch {
      return null;
    }
    if (!pointer.startsWith('/')) {
      return null;
    }
    for (const token of pointer.slice(1).split('/')) {
      const key = token.replace(/~1/g, '/').replace(/~0/g, '~');
      if (!hasOwn(value, key)) {
        return null;
      }
      value = value[key];
    }
  }
  return value === undefined ? null : { value, document };
}

const resolveCache = new Map<string, any>();
let documentResolveCaches = new WeakMap<object, Map<string, any>>();

export function resolveSchemaReference(ref: string, contextSchema?: any): any {
  let cache = ref.startsWith('#') ? undefined : resolveCache;
  if (contextSchema && typeof contextSchema === 'object') {
    cache = documentResolveCaches.get(contextSchema);
    if (!cache) {
      cache = new Map();
      documentResolveCaches.set(contextSchema, cache);
    }
  }
  if (cache?.has(ref)) {
    return cache.get(ref);
  }

  const reference = findReferencedSchema(ref, contextSchema);
  if (!reference) {
    return null;
  }
  const resolved = JSON.parse(JSON.stringify(reference.value));
  cache?.set(ref, resolved);
  return resolved;
}

// Clear resolution cache (useful for tests or hot reloading)
export function clearResolveCache() {
  resolveCache.clear();
  documentResolveCaches = new WeakMap();
}

// Get validation function
export function getValidationFunction() {
  return validationFunction;
}

// Get AJV instance
export function getAjvInstance() {
  return ajvInstance;
}

// Schema node interface for tree display
export interface SchemaTreeNode {
  name: string;
  type: string;
  title?: string;
  description?: string;
  required?: boolean;
  properties?: Record<string, SchemaTreeNode>;
  items?: SchemaTreeNode;
  enum?: string[];
  format?: string;
}

// Transform schema to tree structure (with caching)
const treeCache = new Map<string, SchemaTreeNode>();

export function transformSchemaToTree(
  schema: any,
  rootSchema?: any,
  name?: string,
): SchemaTreeNode {
  // Create cache key
  const cacheKey = JSON.stringify({
    id: schema.$id || schema.$ref || 'inline',
    title: schema.title,
    type: schema.type,
    name: name,
  });

  // Check cache
  if (treeCache.has(cacheKey)) {
    return treeCache.get(cacheKey)!;
  }

  const transformNode = (
    obj: any,
    parentRequired: string[] = [],
    contextSchema?: any,
    nodeName?: string,
  ): SchemaTreeNode => {
    // Handle $ref
    if (obj.$ref) {
      const resolved = resolveSchemaReference(obj.$ref, contextSchema);
      if (resolved) {
        // Merge resolved schema with any local overrides
        const merged = { ...resolved };
        Object.keys(obj).forEach((key) => {
          if (key !== '$ref') {
            merged[key] = obj[key];
          }
        });
        // Pass the appropriate context for nested refs
        const newContext = obj.$ref.startsWith('#/') ? contextSchema : resolved;
        return transformNode(merged, parentRequired, newContext, nodeName);
      } else {
        return {
          name: nodeName || obj.$ref.split('/').pop() || 'Reference',
          type: 'reference',
          description: `Unresolved reference: ${obj.$ref}`,
        };
      }
    }

    const node: SchemaTreeNode = {
      name: nodeName || 'Schema',
      type: Array.isArray(obj.type) ? obj.type.join(' | ') : obj.type || 'object',
      title: obj.title,
      description: obj.description,
    };

    // Add format if present
    if (obj.format) {
      node.format = obj.format;
    }

    // Add enum if present
    if (obj.enum) {
      node.enum = obj.enum;
    }

    // Process properties
    if (obj.properties) {
      node.properties = {};
      const requiredFields = obj.required || [];

      for (const [key, value] of Object.entries(obj.properties)) {
        const childNode = transformNode(value as any, [], contextSchema || obj, key);
        childNode.required = requiredFields.includes(key);
        node.properties[key] = childNode;
      }
    }

    // Process array items
    if (obj.items) {
      node.items = transformNode(obj.items, [], contextSchema || obj, '[items]');
    }

    return node;
  };

  const result = transformNode(schema, [], rootSchema || schema, name);

  // Cache the result
  treeCache.set(cacheKey, result);

  return result;
}

// Get extended SRS schema as tree
export function getExtendedSRSSchemaTree(): SchemaTreeNode {
  const schema = loadExtendedSRSSchema();
  return transformSchemaToTree(schema);
}

// Clear tree cache
export function clearTreeCache() {
  treeCache.clear();
}
