// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import draft7MetaSchema from 'ajv/dist/refs/json-schema-draft-07.json';
import { resolveSchemaReference } from '../schema/schemaLoader';

interface SchemaDiagnostic {
  path: string[];
  message: string;
  type: 'unknown-schema-keyword' | 'schema-reference-unchecked';
}

/** Inspect schema definitions as data. Never compile them or retrieve their references. */
export function collectSchemaDiagnostics(
  data: unknown,
  schema: any,
  parent?: { schema: any; key: string },
): SchemaDiagnostic[] {
  const diagnostics = new Map<string, SchemaDiagnostic>();

  function report(diagnostic: SchemaDiagnostic): void {
    diagnostics.set(JSON.stringify([diagnostic.path, diagnostic.type]), diagnostic);
  }

  function visit(value: any, node: any, path: string[], active: Set<any>): void {
    if (!node || typeof node !== 'object' || active.has(node)) {
      return;
    }
    const nextActive = new Set(active).add(node);
    if (node.$ref) {
      visit(value, resolveSchemaReference(node.$ref, schema), path, nextActive);
      return;
    }

    if (
      node.$id === draft7MetaSchema.$id &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      for (const key of Object.keys(value)) {
        if (
          !Object.prototype.hasOwnProperty.call(draft7MetaSchema.properties, key) &&
          !key.startsWith('x-')
        ) {
          report({
            path: [...path, key],
            message: `不明な JSON Schema キーワード "${key}" です。値は保持しますが、Draft 7 の検証規則としては解釈しません`,
            type: 'unknown-schema-keyword',
          });
        }
      }
      if (typeof value.$ref === 'string') {
        report({
          path: [...path, '$ref'],
          message: `型定義の $ref "${value.$ref}" は保持します。参照先の解決と適合性は検証していません`,
          type: 'schema-reference-unchecked',
        });
      }
    }

    for (const keyword of ['allOf', 'anyOf', 'oneOf']) {
      if (Array.isArray(node[keyword])) {
        for (const branch of node[keyword]) {
          visit(value, branch, path, nextActive);
        }
      }
    }
    if (Array.isArray(value)) {
      if (node.items !== undefined) {
        value.forEach((item, index) =>
          visit(
            item,
            Array.isArray(node.items) ? (node.items[index] ?? node.additionalItems) : node.items,
            [...path, String(index)],
            new Set(),
          ),
        );
      }
    } else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        const candidates: any[] = [];
        if (Object.prototype.hasOwnProperty.call(node.properties ?? {}, key)) {
          candidates.push(node.properties[key]);
        }
        for (const [pattern, constraint] of Object.entries(node.patternProperties ?? {})) {
          if (new RegExp(pattern).test(key)) {
            candidates.push(constraint);
          }
        }
        if (candidates.length === 0) {
          candidates.push(node.additionalProperties);
        }
        for (const constraint of candidates) {
          visit(child, constraint, [...path, key], new Set());
        }
      }
    }
  }

  visit(data, schema, [], new Set());

  // A scalar partial block may itself be an unknown keyword or a $ref value.
  // Inspect its key in the parent schema as well, keeping paths relative to the block.
  function hasArrayBranch(node: any, active = new Set<any>()): boolean {
    if (!node || typeof node !== 'object' || active.has(node)) {
      return false;
    }
    const nextActive = new Set(active).add(node);
    if (node.$ref) {
      return hasArrayBranch(resolveSchemaReference(node.$ref, parent?.schema), nextActive);
    }
    if (
      node.type === 'array' ||
      node.items !== undefined ||
      (Array.isArray(node.type) && node.type.includes('array'))
    ) {
      return true;
    }
    return ['allOf', 'anyOf', 'oneOf'].some(
      (key) =>
        Array.isArray(node[key]) &&
        node[key].some((branch: any) => hasArrayBranch(branch, nextActive)),
    );
  }
  if (parent && !(/^(0|[1-9]\d*)$/.test(parent.key) && hasArrayBranch(parent.schema))) {
    const siblings = collectSchemaDiagnostics({ [parent.key]: data }, parent.schema);
    for (const diagnostic of siblings) {
      if (diagnostic.path.length === 1) {
        report({ ...diagnostic, path: [] });
      }
    }
  }
  return [...diagnostics.values()];
}
