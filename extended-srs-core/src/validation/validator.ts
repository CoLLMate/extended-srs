// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
/**
 * Extended SRS Validator (Core)
 * Schema-based validation using AJV
 */

import { assertSafeParsedData } from '../parsing/inputSafety';
import { collectSchemaDiagnostics } from './schemaDiagnostics';
import { createYamlLineLookup, parseYamlDocument } from '../parsing/yamlDocument';
import { parsePath } from '../aggregation/mergeUtils';
import { schemaForValidation } from '../schema/validationPolicy';
import { collectUnknownProperties, unknownPropertyMessage } from './unknownProperties';
import {
  initializeAjv,
  initializeExtendedSRSSchemas,
  getValidationFunction,
  loadExtendedSRSSchema,
  getAjvInstance,
  resolveSchemaReference,
} from '../schema/schemaLoader';

export interface SchemaValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  path: string;
  message: string;
  line?: number;
  column?: number;
  severity: 'error' | 'warning';
  type?: string;
  sourceFile?: string;
}

export interface ValidationWarning {
  path: string;
  message: string;
  line?: number;
  column?: number;
  type?: string;
  severity?: 'warning';
  sourceFile?: string;
}

/**
 * Field location information for source tracking
 */
export interface FieldLocation {
  filepath: string;
  lineStart: number;
  lineEnd: number;
}

/**
 * Validate YAML content against Extended SRS schema
 */
export async function validateYAML(
  yamlContent: string,
  startLine: number = 0,
  targetPath?: string[],
  isPartialExtraction: boolean = false,
): Promise<SchemaValidationResult> {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  try {
    // Parse YAML
    if (targetPath) {
      parsePath(targetPath.join(':'));
    }
    const doc = parseYamlDocument(yamlContent);

    // Check YAML syntax errors
    if (doc.errors && doc.errors.length > 0) {
      for (const err of doc.errors) {
        errors.push({
          path: '',
          message: err.message,
          line: startLine + (err.linePos?.[0]?.line ?? 1),
          column: err.linePos?.[0]?.col,
          severity: 'error',
          type: 'yaml-syntax',
        });
      }
      return { isValid: false, errors, warnings };
    }

    const data = doc.toJSON();
    assertSafeParsedData(data);
    const lineForPath = createYamlLineLookup(doc);

    // Load schema (ensure initialization)
    await initializeExtendedSRSSchemas();
    await initializeAjv(); // Ensure AJV is initialized
    const schema = loadExtendedSRSSchema();
    const ajv = getAjvInstance();

    if (!ajv || !schema) {
      errors.push({
        path: '',
        message: 'Schema validation not available',
        severity: 'error',
        type: 'schema-load',
      });
      return { isValid: false, errors, warnings };
    }

    // For partial extraction, validate against specific schema node
    if (isPartialExtraction) {
      if (targetPath && targetPath.length > 0) {
        // For partial blocks, the data is already the content of the target section
        // So we need to get the schema for that section from the top level
        const targetSchema = getSchemaNodeForPath(schema, targetPath);
        if (targetSchema !== null) {
          // Debug: log what schema we're using
          // if (process.env.NODE_ENV === 'test') {
          //   console.log('Partial validation - Target path:', targetPath);
          //   console.log('Target schema required:', targetSchema.required);
          //   console.log('Target schema properties:', Object.keys(targetSchema.properties || {}));
          //   console.log('Data keys:', Object.keys(data));
          // }

          // For partial blocks, validate the data directly against the target schema
          // We need to compile without adding to the schema registry since it might already exist
          let validate: any;
          try {
            // Try to compile the schema
            validate = ajv.compile(schemaForValidation(targetSchema));
          } catch (compileError: any) {
            // If compilation fails due to duplicate schema, create a new validator
            if (compileError.message?.includes('already exists')) {
              // Create a new AJV instance for this validation
              const tempAjv = new (await import('ajv')).default({ allErrors: true, strict: false });
              // Remove $id to avoid conflicts
              const tempSchema = schemaForValidation(targetSchema);
              delete tempSchema.$id;
              validate = tempAjv.compile(tempSchema);
            } else {
              throw compileError;
            }
          }

          const valid = validate(data);

          if (!valid && validate.errors) {
            for (const err of validate.errors) {
              // Format the error message properly
              const message = formatAjvError(err);
              errors.push({
                path: err.instancePath || '',
                message,
                line: startLine,
                severity: 'error',
                type: 'schema-validation',
              });
            }
          }
        } else {
          warnings.push({
            path: targetPath.join('.'),
            message: unknownPropertyMessage(targetPath[targetPath.length - 1]),
            line: startLine,
            severity: 'warning',
            type: 'unknown-property',
          });
        }
      }
      // For partial blocks without specific path, skip validation
      // Just return without errors
    } else {
      // Full schema validation - use pre-compiled validation function
      const validate = getValidationFunction();
      if (!validate) {
        errors.push({
          path: '',
          message: 'Validation function not available',
          severity: 'error',
          type: 'schema-load',
        });
        return { isValid: false, errors, warnings };
      }

      const valid = validate(data);

      if (!valid && validate.errors) {
        for (const err of validate.errors) {
          const path = err.instancePath || '';
          const message = formatAjvError(err);

          // Determine if it's a warning or error
          if (isWarning(err)) {
            // For warnings, also find the line number
            const warningLine = lineForPath(jsonPointerSegments(err.instancePath));
            warnings.push({
              path,
              message,
              line: warningLine,
              type: 'schema-validation',
            });
          } else {
            // Try to find the line number in YAML for this error
            const errorLine = lineForPath(jsonPointerSegments(err.instancePath));
            errors.push({
              path,
              message,
              line: errorLine, // Line number within YAML content (0-based)
              severity: 'error',
              type: 'schema-validation',
            });
          }
        }
      }
    }

    let diagnosticSchema = schema;
    if (isPartialExtraction) {
      diagnosticSchema = targetPath?.length ? getSchemaNodeForPath(schema, targetPath) : null;
    }
    for (const keys of collectUnknownProperties(data, diagnosticSchema, ajv)) {
      warnings.push({
        path: '/' + keys.map((key) => key.replace(/~/g, '~0').replace(/\//g, '~1')).join('/'),
        message: unknownPropertyMessage(keys[keys.length - 1]),
        type: 'unknown-property',
        severity: 'warning',
        line: (isPartialExtraction ? startLine : 0) + lineForPath(keys),
      });
    }
    const parent =
      isPartialExtraction && targetPath?.length
        ? {
            schema: getSchemaNodeForPath(schema, targetPath.slice(0, -1)),
            key: targetPath[targetPath.length - 1],
          }
        : undefined;
    for (const diagnostic of collectSchemaDiagnostics(data, diagnosticSchema, parent)) {
      const path =
        '/' + diagnostic.path.map((key) => key.replace(/~/g, '~0').replace(/\//g, '~1')).join('/');
      const localLine = lineForPath(diagnostic.path);
      warnings.push({
        path,
        message: diagnostic.message,
        type: diagnostic.type,
        severity: 'warning',
        line: (isPartialExtraction ? startLine : 0) + localLine,
      });
    }
  } catch (error: any) {
    errors.push({
      path: '',
      message: `Validation error: ${error.message}`,
      severity: 'error',
      type: 'validation-error',
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

function jsonPointerSegments(path: string): string[] {
  return path
    ? path
        .slice(1)
        .split('/')
        .map((key) => key.replace(/~1/g, '/').replace(/~0/g, '~'))
    : [];
}

/**
 * Get the declared Schema for a field path, or null for an unknown path.
 * Array indices are separate segments (e.g. ['requirements', '0', 'req_id']).
 * Omitting an index descends into homogeneous items without consuming the field.
 * Explicitly allowed extensions return their Schema, including {} for free-form data.
 * This lookup does not filter data; validation reports prohibited fields separately.
 */
export function getSchemaNodeForPath(schema: any, path: string[]): any {
  if (!schema || !path || path.length === 0) {
    return schema;
  }

  function combine(keyword: 'allOf' | 'anyOf', candidates: any[]): any {
    const present = candidates.filter((candidate) => candidate !== null);
    if (present.length === 0) {
      return null;
    }
    const constrained = present.filter(
      (candidate) =>
        candidate === false || (candidate !== true && Object.keys(candidate).length > 0),
    );
    if (keyword === 'anyOf' && constrained.length !== present.length) {
      return {};
    }
    if (constrained.length === 0) {
      return {};
    }
    return constrained.length === 1 ? constrained[0] : { [keyword]: constrained };
  }

  function lookup(current: any, index: number, active: Set<any>): any {
    if (index === path.length) {
      return current;
    }
    if (current === true) {
      return {};
    }
    if (!current || typeof current !== 'object' || active.has(current)) {
      return null;
    }
    if (Object.keys(current).length === 0) {
      return current;
    }
    const nextActive = new Set(active).add(current);
    if (current.$ref) {
      return lookup(resolveSchemaReference(current.$ref, schema), index, nextActive);
    }

    const segment = path[index];
    let direct: any = null;
    if (current.properties && Object.prototype.hasOwnProperty.call(current.properties, segment)) {
      direct = lookup(current.properties[segment], index + 1, new Set());
    } else if (current.items !== undefined) {
      if (/^(0|[1-9]\d*)$/.test(segment)) {
        const item = Array.isArray(current.items)
          ? (current.items[Number(segment)] ?? current.additionalItems ?? {})
          : current.items;
        direct = lookup(item, index + 1, new Set());
      } else if (!Array.isArray(current.items)) {
        direct = lookup(current.items, index, nextActive);
      }
    } else {
      const patterns = Object.entries(current.patternProperties ?? {}).filter(([pattern]) =>
        new RegExp(pattern).test(segment),
      );
      if (patterns.length) {
        direct = combine(
          'allOf',
          patterns.map(([, child]) => lookup(child, index + 1, new Set())),
        );
      } else if (current.additionalProperties === true) {
        direct = {};
      } else if (current.additionalProperties && typeof current.additionalProperties === 'object') {
        direct = lookup(current.additionalProperties, index + 1, new Set());
      }
    }

    const constraints = [direct];
    for (const keyword of ['allOf', 'anyOf', 'oneOf']) {
      if (Array.isArray(current[keyword])) {
        constraints.push(
          combine(
            keyword === 'allOf' ? 'allOf' : 'anyOf',
            current[keyword].map((branch: any) => lookup(branch, index, nextActive)),
          ),
        );
      }
    }
    return combine('allOf', constraints);
  }

  return lookup(schema, 0, new Set());
}

/**
 * Format AJV error message
 */
function formatAjvError(error: any): string {
  const path = error.instancePath || '';

  switch (error.keyword) {
    case 'required': {
      const location = path ? ` (${path})` : '';
      return `必須フィールド '${error.params.missingProperty}' がありません${location}`;
    }
    case 'type': {
      const typePath = path || 'ルート';
      return `型が一致しません (${typePath}): ${error.params.type}型が必要です`;
    }
    case 'enum': {
      const enumPath = path || 'ルート';
      return `無効な値です (${enumPath}): ${error.params.allowedValues?.join(', ')}のいずれかである必要があります`;
    }
    case 'const': {
      const constPath = path || 'ルート';
      return `値は '${error.params.allowedValue}' でなければなりません (${constPath})`;
    }
    case 'pattern': {
      const patternPath = path || 'ルート';
      return `無効な形式です (${patternPath}): パターン ${error.params.pattern} に一致する必要があります`;
    }
    case 'minLength': {
      const minPath = path || 'ルート';
      return `値が短すぎます (${minPath}) - 最小 ${error.params.limit} 文字`;
    }
    case 'maxLength': {
      const maxPath = path || 'ルート';
      return `値が長すぎます (${maxPath}) - 最大 ${error.params.limit} 文字`;
    }
    case 'additionalProperties': {
      const propLocation = path ? ` (${path}内)` : '';
      return `未定義のプロパティ '${error.params.additionalProperty}' は使用できません${propLocation}`;
    }
    default:
      return error.message || 'Validation error';
  }
}

/**
 * Determine if an error should be treated as a warning
 */
function isWarning(error: any): boolean {
  // Treat certain validation errors as warnings
  const warningKeywords = ['format', 'pattern', 'additionalProperties'];
  const warningPaths = ['/metadata', '/notes', '/comments'];

  return (
    warningKeywords.includes(error.keyword) ||
    warningPaths.some((p) => error.instancePath?.startsWith(p)) ||
    (error.keyword === 'additionalProperties' && error.instancePath?.includes('/metadata'))
  );
}

/**
 * Validate multiple SRS files
 */
export async function validateMultipleFiles(
  files: Array<{ path: string; content: string }>,
): Promise<Map<string, SchemaValidationResult>> {
  const results = new Map<string, SchemaValidationResult>();

  for (const file of files) {
    const result = await validateExtendedSRSFile(file.content);
    results.set(file.path, result);
  }

  return results;
}

/**
 * Resolve source file and line number for a given field path.
 * Tries exact match first, then walks up parent paths.
 */
function resolveFieldSource(
  fieldPath: string,
  fieldSources?: { [fieldPath: string]: string[] },
  fieldLocations?: { [fieldPath: string]: FieldLocation[] },
  requireExactLine: boolean = false,
): { sourceFile?: string; line?: number } {
  if (!fieldSources) {
    return {};
  }

  // Helper to look up source and location for a given path
  // Returns 1-based line numbers for frontend display compatibility
  const lookupPath = (path: string): { sourceFile?: string; line?: number } | null => {
    if (fieldSources[path]) {
      const sources = fieldSources[path];
      const sourceFile = sources[sources.length - 1];
      const locations = fieldLocations?.[path];
      const lineStart = locations?.[locations.length - 1]?.lineStart;
      // Convert 0-based lineStart to 1-based for display
      const exactPath =
        path === fieldPath || path === fieldPath.replace(/\.(\d+)(?=\.|$)/g, '[$1]');
      const line =
        lineStart !== undefined && (!requireExactLine || exactPath) ? lineStart + 1 : undefined;
      return { sourceFile, line };
    }
    return null;
  };

  // Try exact path first, then walk up parent paths
  let tryPath = fieldPath;
  while (tryPath !== '') {
    // Try dot notation as-is (e.g., "use-cases.list.0.name")
    const result = lookupPath(tryPath);
    if (result) {
      return result;
    }

    // Try converting dot-notation array indices to bracket notation
    // e.g., "use-cases.list.0.name" → "use-cases.list[0].name"
    const bracketPath = tryPath.replace(/\.(\d+)(?=\.|$)/g, '[$1]');
    if (bracketPath !== tryPath) {
      const bracketResult = lookupPath(bracketPath);
      if (bracketResult) {
        return bracketResult;
      }
    }

    // Move to parent path: "manifest.format" → "manifest" → ""
    const lastDot = tryPath.lastIndexOf('.');
    tryPath = lastDot >= 0 ? tryPath.substring(0, lastDot) : '';
  }

  // Try root path as last resort (sourceFile only, no line — line should be
  // refined at the aggregator level by searching file content for the key)
  if (fieldSources['']) {
    const sources = fieldSources[''];
    return { sourceFile: sources[sources.length - 1] };
  }

  return {};
}

/**
 * Validate an Extended SRS data object (universal, Monaco-independent)
 * This is the core validation logic used by both server-side AI tools and client-side Monaco
 * Uses AJV for all schema validation
 * @param data The parsed SRS data object
 * @param fieldSources Optional field source mapping for error reporting (fieldPath → filepath[])
 * @param fieldLocations Optional field location mapping for line number tracking
 */
export async function validateExtendedSRS(
  data: any,
  fieldSources?: { [fieldPath: string]: string[] },
  fieldLocations?: { [fieldPath: string]: FieldLocation[] },
): Promise<SchemaValidationResult> {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  try {
    assertSafeParsedData(data);
  } catch (error) {
    return {
      isValid: false,
      errors: [
        { path: '', message: (error as Error).message, severity: 'error', type: 'input-safety' },
      ],
      warnings,
    };
  }

  // Initialize schemas and AJV
  await initializeExtendedSRSSchemas();
  await initializeAjv();

  // Use pre-compiled validation function
  const validate = getValidationFunction();
  if (!validate) {
    errors.push({
      path: '',
      message: 'Validation function not available',
      severity: 'error',
      type: 'schema-load',
    });
    return { isValid: false, errors, warnings };
  }

  const isValid = validate(data);

  if (!isValid && validate.errors) {
    for (const err of validate.errors) {
      const fieldPath = err.instancePath.replace(/^\//, '').replace(/\//g, '.');

      // Convert AJV errors to user-friendly messages
      if (err.keyword === 'type') {
        const expectedType = err.params.type;
        const actualType = Array.isArray(err.data) ? 'array' : typeof err.data;
        const resolved = resolveFieldSource(fieldPath, fieldSources, fieldLocations);

        // Better message for array-vs-object mismatch
        if (expectedType === 'object' && actualType === 'array') {
          // Skip if already reported as type-mismatch from additionalProperties handler
          const alreadyReported = errors.some(
            (e) => e.path === fieldPath && e.type === 'type-mismatch',
          );
          if (!alreadyReported) {
            errors.push({
              path: fieldPath,
              message: `"${fieldPath}" は配列ではなくオブジェクト型で定義する必要があります。スキーマ定義を確認してください`,
              severity: 'error',
              type: 'type-mismatch',
              sourceFile: resolved.sourceFile,
              line: resolved.line,
            });
          }
        } else {
          const typeNameMap: Record<string, string> = {
            object: 'オブジェクト',
            array: '配列',
            string: '文字列',
            number: '数値',
            boolean: '真偽値',
            null: 'null',
          };
          const expectedName = typeNameMap[expectedType] || expectedType;
          const actualName = typeNameMap[actualType] || actualType;
          errors.push({
            path: fieldPath,
            message: `型が不正です。${expectedName}型が期待されていますが、${actualName}型が指定されています`,
            severity: 'error',
            type: 'schema',
            sourceFile: resolved.sourceFile,
            line: resolved.line,
          });
        }
      } else if (err.keyword === 'required') {
        const missingProp = err.params.missingProperty;
        const fullPath = fieldPath ? `${fieldPath}.${missingProp}` : missingProp;

        // For required errors, the parent path is where the missing field should be defined
        const resolved = resolveFieldSource(fieldPath || fullPath, fieldSources, fieldLocations);

        let message = `必須プロパティ "${missingProp}" が不足しています`;
        if (missingProp === 'manifest') {
          message = 'manifestセクションが必要です';
        } else if (fullPath === 'manifest.format') {
          message = 'manifest.formatは必須です';
        } else if (fullPath === 'manifest.project_name') {
          message = 'manifest.project_nameは必須です';
        }

        errors.push({
          path: fullPath,
          message,
          severity: 'error',
          type: 'required',
          sourceFile: resolved.sourceFile,
          line: resolved.line,
        });
      } else if (err.keyword === 'enum' || err.keyword === 'const') {
        const resolved = resolveFieldSource(fieldPath, fieldSources, fieldLocations);

        let message = `許可されていない値です: ${JSON.stringify(err.data)}`;
        if (fieldPath === 'manifest.format') {
          message = `manifest.formatの値が不正です: "${err.data}"。"extended-srs/v1"である必要があります`;
        } else if (err.params.allowedValues) {
          message += `。許可される値: ${err.params.allowedValues.join(', ')}`;
        } else if (err.params.allowedValue) {
          message = `値は '${err.params.allowedValue}' でなければなりません (${fieldPath})`;
        }

        errors.push({
          path: fieldPath,
          message,
          severity: 'error',
          type: err.keyword,
          sourceFile: resolved.sourceFile,
          line: resolved.line,
        });
      } else if (err.keyword === 'pattern') {
        const resolved = resolveFieldSource(fieldPath, fieldSources, fieldLocations);
        errors.push({
          path: fieldPath,
          message: `値が正規表現パターンに一致しません: ${err.params.pattern}`,
          severity: 'error',
          type: 'pattern',
          sourceFile: resolved.sourceFile,
          line: resolved.line,
        });
      } else if (err.keyword === 'minLength') {
        const resolved = resolveFieldSource(fieldPath, fieldSources, fieldLocations);
        errors.push({
          path: fieldPath,
          message: `文字列が短すぎます。最小${err.params.limit}文字必要です`,
          severity: 'error',
          type: 'minLength',
          sourceFile: resolved.sourceFile,
          line: resolved.line,
        });
      } else if (err.keyword === 'maxLength') {
        const resolved = resolveFieldSource(fieldPath, fieldSources, fieldLocations);
        errors.push({
          path: fieldPath,
          message: `文字列が長すぎます。最大${err.params.limit}文字までです`,
          severity: 'error',
          type: 'maxLength',
          sourceFile: resolved.sourceFile,
          line: resolved.line,
        });
      } else if (err.keyword === 'minimum' || err.keyword === 'exclusiveMinimum') {
        const resolved = resolveFieldSource(fieldPath, fieldSources, fieldLocations);
        const exclusive = err.keyword === 'exclusiveMinimum' ? 'より大きい' : '以上';
        errors.push({
          path: fieldPath,
          message: `値は${err.params.limit}${exclusive}である必要があります`,
          severity: 'error',
          type: err.keyword,
          sourceFile: resolved.sourceFile,
          line: resolved.line,
        });
      } else if (err.keyword === 'maximum' || err.keyword === 'exclusiveMaximum') {
        const resolved = resolveFieldSource(fieldPath, fieldSources, fieldLocations);
        const exclusive = err.keyword === 'exclusiveMaximum' ? 'より小さい' : '以下';
        errors.push({
          path: fieldPath,
          message: `値は${err.params.limit}${exclusive}である必要があります`,
          severity: 'error',
          type: err.keyword,
          sourceFile: resolved.sourceFile,
          line: resolved.line,
        });
      } else {
        const resolved = resolveFieldSource(fieldPath, fieldSources, fieldLocations);
        errors.push({
          path: fieldPath,
          message: err.message || 'スキーマ検証エラー',
          severity: 'error',
          type: err.keyword,
          sourceFile: resolved.sourceFile,
          line: resolved.line,
        });
      }
    }
  }

  for (const keys of collectUnknownProperties(data, loadExtendedSRSSchema(), getAjvInstance()!)) {
    const path = keys.join('.');
    warnings.push({
      path,
      message: unknownPropertyMessage(keys[keys.length - 1]),
      type: 'unknown-property',
      severity: 'warning',
      ...resolveFieldSource(path, fieldSources, fieldLocations, true),
    });
  }

  for (const diagnostic of collectSchemaDiagnostics(data, loadExtendedSRSSchema())) {
    const path = diagnostic.path.join('.');
    warnings.push({
      path,
      message: diagnostic.message,
      type: diagnostic.type,
      severity: 'warning',
      ...resolveFieldSource(path, fieldSources, fieldLocations, true),
    });
  }

  return { isValid: errors.length === 0, errors, warnings };
}

/**
 * Validate a complete Extended SRS file
 */
export async function validateExtendedSRSFile(content: string): Promise<SchemaValidationResult> {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  try {
    // Import parser functions
    const { extractYAMLBlocks } = await import('../parsing/yamlParser');

    // Extract all YAML blocks
    const blocks = extractYAMLBlocks(content);

    if (blocks.length === 0) {
      errors.push({
        path: '',
        message: 'No Extended SRS metadata found',
        severity: 'error',
        type: 'structure',
      });
      return { isValid: false, errors, warnings };
    }

    // Validate each block
    for (const block of blocks) {
      // Validate the block
      const result = await validateYAML(
        block.content,
        block.yamlStartLine,
        block.path,
        block.isPartial,
      );

      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
  } catch (error: any) {
    errors.push({
      path: '',
      message: `File validation error: ${error.message}`,
      severity: 'error',
      type: 'file-validation',
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}
