// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0

/** Bound sparse-array expansion independently of the size of a metadata block. */
export function assertSafeArrayIndex(index: number): void {
  if (!Number.isSafeInteger(index) || index < 0 || index >= 10000) {
    throw new Error(`Array index ${index} is outside the supported range 0–9999`);
  }
}

/** YAML aliases may share values, but cycles cannot be merged or serialized as SRS data. */
export function assertSafeParsedData(data: unknown): void {
  const active = new WeakSet<object>();
  const checked = new WeakSet<object>();
  function visit(value: unknown, depth: number): void {
    if (value === null || typeof value !== 'object') {
      return;
    }
    if (depth > 100) {
      throw new Error('YAML nesting exceeds the supported depth of 100');
    }
    if (active.has(value)) {
      throw new Error('Cyclic YAML aliases are not supported');
    }
    if (checked.has(value)) {
      return;
    }
    if (Array.isArray(value) && value.length > 0) {
      assertSafeArrayIndex(value.length - 1);
    }
    active.add(value);
    for (const child of Object.values(value)) {
      visit(child, depth + 1);
    }
    active.delete(value);
    checked.add(value);
  }
  visit(data, 0);
}
