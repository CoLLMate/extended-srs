// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
/**
 * Shared YAML element-search helpers.
 *
 * Several tools (history, consistency) need to ask: "does this parsed YAML
 * tree describe an element with id X?". A naive substring match against
 * ``JSON.stringify`` is wrong on three counts:
 *
 *   1. Prefix collisions ("FR-001" matches "FR-0010").
 *   2. Reference matches (depends_on lists, blocks lists, prose).
 *   3. Description matches ("implements FR-001" hits when the block is
 *      actually defining a different element).
 *
 * The functions here walk the parsed YAML structure and only return true
 * when they find an object whose id field — one of the canonical id field
 * names — exactly equals the requested element id.
 */

/**
 * The set of YAML field names that may carry a primary element identifier.
 * This list deliberately excludes reference-style fields like ``ref_id``
 * and ``depends_on``: we want to find the *defining* element, not the
 * elements that *mention* it.
 *
 * These names match the schema-canonical id fields: ``uc_id`` for
 * use-cases, ``req_id`` for functional/non-functional requirements,
 * ``module_id`` for architecture modules, ``milestone_id`` for
 * development milestones, and the generic ``element_id`` fallback.
 */
export const ID_FIELDS = ['uc_id', 'req_id', 'module_id', 'milestone_id', 'element_id'];

/** Return the defining object, not an object that merely references its id. */
export function findElementById(data: any, elementId: string): Record<string, any> | undefined {
  if (!data || typeof data !== 'object') {
    return undefined;
  }
  if (
    ID_FIELDS.some(
      (field) => Object.prototype.hasOwnProperty.call(data, field) && data[field] === elementId,
    )
  ) {
    return data;
  }
  for (const value of Object.values(data)) {
    const found = findElementById(value, elementId);
    if (found) {
      return found;
    }
  }
  return undefined;
}

/**
 * Whether the parsed YAML tree contains an object whose primary id field
 * equals ``elementId``. Walks depth-first; stops at the first hit.
 */
export function containsElementById(data: any, elementId: string): boolean {
  if (data === null || data === undefined) {
    return false;
  }

  if (Array.isArray(data)) {
    return data.some((item) => containsElementById(item, elementId));
  }

  if (typeof data !== 'object') {
    return false;
  }

  for (const field of ID_FIELDS) {
    if (data[field] === elementId) {
      return true;
    }
  }

  return Object.keys(data).some((key) => containsElementById(data[key], elementId));
}

/**
 * Find the ``status`` value of the object whose primary id field equals
 * ``elementId``. Returns ``undefined`` if no such object exists.
 *
 * Walks depth-first and stops at the first match. Callers that need the
 * effective project status must pass the merged SRS, rather than a source
 * document whose definition may have been overridden by a later document.
 */
export function findElementStatus(data: any, elementId: string): string | undefined {
  if (data === null || data === undefined) {
    return undefined;
  }

  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findElementStatus(item, elementId);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }

  if (typeof data !== 'object') {
    return undefined;
  }

  for (const field of ID_FIELDS) {
    if (data[field] === elementId) {
      return typeof data.status === 'string' ? data.status : undefined;
    }
  }

  for (const key of Object.keys(data)) {
    const found = findElementStatus(data[key], elementId);
    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
}
