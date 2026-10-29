// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0

/** Unknown properties are warnings in core. Preserve all other Schema constraints. */
export function schemaForValidation(schema: any): any {
  if (!schema || typeof schema !== 'object') {
    return schema;
  }
  if (Array.isArray(schema)) {
    return schema.map(schemaForValidation);
  }
  const result = { ...schema };
  if (result.additionalProperties === false) {
    result.additionalProperties = true;
  }
  for (const keyword of [
    'properties',
    'patternProperties',
    'definitions',
    '$defs',
    'dependencies',
  ]) {
    if (result[keyword] && typeof result[keyword] === 'object') {
      result[keyword] = Object.fromEntries(
        Object.entries(result[keyword]).map(([key, value]) => [key, schemaForValidation(value)]),
      );
    }
  }
  for (const keyword of [
    'items',
    'additionalItems',
    'additionalProperties',
    'allOf',
    'anyOf',
    'oneOf',
    'not',
    'if',
    'then',
    'else',
    'contains',
    'propertyNames',
  ]) {
    if (result[keyword] !== undefined) {
      result[keyword] = schemaForValidation(result[keyword]);
    }
  }
  return result;
}
