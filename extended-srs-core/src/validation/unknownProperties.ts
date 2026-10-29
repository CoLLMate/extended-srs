// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import type Ajv from 'ajv';
import type { ValidateFunction } from 'ajv';
import { schemaForValidation } from '../schema/validationPolicy';
import { resolveSchemaReference } from '../schema/schemaLoader';

const validators = new WeakMap<Ajv, WeakMap<object, ValidateFunction>>();

export function unknownPropertyMessage(property: string): string {
  return `不明なプロパティ "${property}" はExtended SRSスキーマに定義されていません。値は保持します`;
}

/** Find undeclared keys only in applicable branches, including oneOf alternatives. */
export function collectUnknownProperties(data: unknown, schema: any, ajv: Ajv): string[][] {
  const paths = new Map<string, string[]>();
  let cache = validators.get(ajv);
  if (!cache) {
    cache = new WeakMap();
    validators.set(ajv, cache);
  }
  function matches(node: any, value: any): boolean {
    if (typeof node === 'boolean') {
      return node;
    }
    let validate = cache!.get(node);
    if (!validate) {
      validate = ajv.compile(schemaForValidation(node));
      cache!.set(node, validate);
    }
    return Boolean(validate(value));
  }
  function visit(value: any, node: any, path: string[], active: Set<any>): void {
    if (!node || typeof node !== 'object' || active.has(node)) {
      return;
    }
    const nextActive = new Set(active).add(node);
    if (node.$ref) {
      // The embedded meta-schema has its own keyword diagnostics; these are not SRS fields.
      if (/^https?:\/\/json-schema\.org\/draft-07\/schema(?:#|$)/.test(node.$ref)) {
        return;
      }
      visit(value, resolveSchemaReference(node.$ref, schema), path, nextActive);
      return;
    }
    for (const keyword of ['allOf', 'anyOf', 'oneOf']) {
      for (const branch of node[keyword] ?? []) {
        if (keyword === 'allOf' || matches(branch, value)) {
          visit(value, branch, path, nextActive);
        }
      }
    }
    if (node.if) {
      visit(value, matches(node.if, value) ? node.then : node.else, path, nextActive);
    }
    if (Array.isArray(value)) {
      if (node.items !== undefined) {
        value.forEach((child, index) =>
          visit(
            child,
            Array.isArray(node.items) ? (node.items[index] ?? node.additionalItems) : node.items,
            [...path, String(index)],
            new Set(),
          ),
        );
      }
    } else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        const candidates = [];
        if (Object.prototype.hasOwnProperty.call(node.properties ?? {}, key)) {
          candidates.push(node.properties[key]);
        }
        for (const [pattern, constraint] of Object.entries(node.patternProperties ?? {})) {
          if (new RegExp(pattern).test(key)) {
            candidates.push(constraint);
          }
        }
        const childPath = [...path, key];
        if (candidates.length === 0) {
          if (node.additionalProperties === false) {
            paths.set(JSON.stringify(childPath), childPath);
          }
          candidates.push(node.additionalProperties);
        }
        for (const constraint of candidates) {
          visit(child, constraint, childPath, new Set());
        }
      }
    }
  }
  visit(data, schema, [], new Set());
  return [...paths.values()];
}
