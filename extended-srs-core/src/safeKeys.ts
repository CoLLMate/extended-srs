// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
/**
 * Guards for object keys and path segments that come from documents.
 *
 * Metadata paths (`<!--@srs: a: b`) and YAML mapping keys are controlled by
 * whoever writes the SRS document. Navigating into or assigning through
 * `__proto__`, `prototype` or `constructor` would write to shared prototypes
 * (prototype pollution), so such keys are never created, descended into or
 * merged. Descending is also limited to own properties so that inherited
 * members such as `toString` are never used as merge targets.
 */

const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export function isUnsafeKey(key: string): boolean {
  return UNSAFE_KEYS.has(key);
}

export function hasOwn(target: unknown, key: string): boolean {
  return (
    target !== null &&
    typeof target === 'object' &&
    Object.prototype.hasOwnProperty.call(target, key)
  );
}
