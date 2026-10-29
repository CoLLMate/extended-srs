// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { hasOwn, isUnsafeKey } from '../safeKeys';
import { assertSafeArrayIndex } from '../parsing/inputSafety';
/**
 * Common merge utilities for Extended SRS
 * Extracted from parser.ts and aggregator.ts to eliminate duplication
 */

import { MetadataLocation } from '../tree/treeTypes';

export interface MergeOptions {
  // Track field sources for debugging/audit
  trackSources?: boolean;
  // Override strategy: 'last-write' (default) or 'first-write'
  overrideStrategy?: 'last-write' | 'first-write';
  // Track which fields were overridden
  trackOverrides?: boolean;
}

export interface MergeContext {
  sources?: Map<string, MetadataLocation[]>;
  overrides?: Set<string>;
  currentLocation?: MetadataLocation;
  currentFilePath?: string;
}

/**
 * Deep merge objects with configurable merge strategy
 * Supports both parser.ts style (with MetadataLocation) and aggregator.ts style (with file paths)
 */
export function deepMerge(
  target: any,
  source: any,
  path: string = '',
  options: MergeOptions = {},
  context: MergeContext = {},
): void {
  // Preserve the no-op behavior for empty YAML sources.
  if (source === null || source === undefined) {
    return;
  }

  const strategy = options.overrideStrategy || 'last-write';

  for (const key of Object.keys(source)) {
    // Keys come from the document: never merge into Object.prototype.
    if (isUnsafeKey(key)) {
      continue;
    }
    const currentPath = path ? `${path}.${key}` : key;
    const sourceValue = source[key];

    if (sourceValue === null || sourceValue === undefined) {
      continue;
    }

    // Track override if target already has value
    if (options.trackOverrides && target[key] !== undefined && context.overrides) {
      context.overrides.add(currentPath);
    }

    // Handle arrays
    if (Array.isArray(sourceValue)) {
      if (strategy === 'last-write' || !target[key]) {
        target[key] = [...sourceValue];
        trackSource(currentPath, options, context);
      }
    }
    // Handle objects (recursive merge)
    else if (typeof sourceValue === 'object' && sourceValue !== null) {
      if (
        !hasOwn(target, key) ||
        !target[key] ||
        typeof target[key] !== 'object' ||
        Array.isArray(target[key])
      ) {
        target[key] = {};
      }
      deepMerge(target[key], sourceValue, currentPath, options, context);
    }
    // Handle primitives
    else {
      if (strategy === 'last-write' || target[key] === undefined) {
        target[key] = sourceValue;
        trackSource(currentPath, options, context);
      }
    }
  }
}

/**
 * Merge arrays with configurable strategy
 */
export function mergeArrays(
  target: any[],
  source: any[],
  _path: string,
  options: MergeOptions = {},
  _context: MergeContext = {},
): any[] {
  const strategy = options.overrideStrategy || 'last-write';

  if (strategy === 'last-write') {
    // Replace entire array
    return [...source];
  } else {
    // First-write: keep existing array
    return target || [...source];
  }
}

/**
 * Parse a path string that may contain array notation
 * e.g., "use-cases: list[0]" -> [{key: "use-cases"}, {key: "list", index: 0}]
 */
export function parsePath(path: string): Array<{ key: string; index?: number }> {
  const parts = path.split(':').map((p) => p.trim());
  if (parts.length > 100) {
    throw new Error('Partial path nesting exceeds the supported depth of 100');
  }
  const result: Array<{ key: string; index?: number }> = [];

  for (const part of parts) {
    // Check for array notation
    const arrayMatch = part.match(/^(.+)\[(\d+)\]$/);
    if (arrayMatch) {
      const index = Number(arrayMatch[2]);
      assertSafeArrayIndex(index);
      result.push({
        key: arrayMatch[1],
        index,
      });
    } else {
      result.push({ key: part });
    }
  }

  return result;
}

/**
 * Get value from object using a parsed path
 */
export function getValueAtPath(obj: any, pathParts: Array<{ key: string; index?: number }>): any {
  let current = obj;

  for (const part of pathParts) {
    if (isUnsafeKey(part.key) || !hasOwn(current, part.key)) {
      return undefined;
    }
    if (part.index !== undefined) {
      // Array access
      if (!Array.isArray(current[part.key]) || !hasOwn(current[part.key], String(part.index))) {
        return undefined;
      }
      current = current[part.key][part.index];
    } else {
      // Object access
      current = current[part.key];
    }

    if (current === undefined) {
      return undefined;
    }
  }

  return current;
}

/**
 * Set value in object using a parsed path
 */
export function setValueAtPath(
  obj: any,
  pathParts: Array<{ key: string; index?: number }>,
  value: any,
): void {
  for (const part of pathParts) {
    if (part.index !== undefined) {
      assertSafeArrayIndex(part.index);
    }
  }
  // The path comes from the document: never navigate into Object.prototype.
  if (pathParts.some((part) => isUnsafeKey(part.key))) {
    return;
  }
  let current = obj;

  for (let i = 0; i < pathParts.length - 1; i++) {
    const part = pathParts[i];

    if (part.index !== undefined) {
      // Array access
      if (!hasOwn(current, part.key) || !current[part.key]) {
        current[part.key] = [];
      }
      if (!hasOwn(current[part.key], String(part.index)) || !current[part.key][part.index]) {
        current[part.key][part.index] = {};
      }
      current = current[part.key][part.index];
    } else {
      // Object access
      if (!hasOwn(current, part.key) || !current[part.key]) {
        current[part.key] = {};
      }
      current = current[part.key];
    }
  }

  // Set the final value
  const lastPart = pathParts[pathParts.length - 1];
  if (lastPart.index !== undefined) {
    if (!hasOwn(current, lastPart.key) || !current[lastPart.key]) {
      current[lastPart.key] = [];
    }
    current[lastPart.key][lastPart.index] = value;
  } else {
    current[lastPart.key] = value;
  }
}

/**
 * Remove value from object using a parsed path
 */
export function removeValueAtPath(
  obj: any,
  pathParts: Array<{ key: string; index?: number }>,
): void {
  if (pathParts.some((part) => isUnsafeKey(part.key))) {
    return;
  }
  let current = obj;

  for (let i = 0; i < pathParts.length - 1; i++) {
    const part = pathParts[i];

    if (!hasOwn(current, part.key)) {
      return;
    }

    if (part.index !== undefined) {
      // Array access
      if (!Array.isArray(current[part.key]) || !hasOwn(current[part.key], String(part.index))) {
        return;
      }
      current = current[part.key][part.index];
    } else {
      // Object access
      current = current[part.key];
    }

    if (current === undefined || current === null) {
      return;
    }
  }

  // Remove the final key
  if (!current || typeof current !== 'object') {
    return;
  }
  const lastPart = pathParts[pathParts.length - 1];
  if (!hasOwn(current, lastPart.key)) {
    return;
  }
  if (lastPart.index !== undefined) {
    const key = lastPart.key;
    const index = lastPart.index;
    if (current[key] && Array.isArray(current[key])) {
      current[key].splice(index, 1);
    }
  } else {
    delete current[lastPart.key];
  }
}

// Helper function to track source
function trackSource(path: string, options: MergeOptions, context: MergeContext): void {
  if (!options.trackSources || !context.sources) {
    return;
  }

  if (context.currentLocation) {
    // Parser style: track MetadataLocation
    if (!context.sources.has(path)) {
      context.sources.set(path, []);
    }
    context.sources.get(path)!.push(context.currentLocation);
  } else if (context.currentFilePath) {
    // Aggregator style: track file path as simple location
    const simpleLocation: MetadataLocation = {
      filepath: context.currentFilePath,
      lineStart: 0,
      lineEnd: 0,
      timestamp: Date.now(),
    };
    if (!context.sources.has(path)) {
      context.sources.set(path, []);
    }
    context.sources.get(path)!.push(simpleLocation);
  }
}
