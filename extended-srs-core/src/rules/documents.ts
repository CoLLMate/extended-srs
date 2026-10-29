// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import * as YAML from 'yaml';
import { parseYamlDocument } from '../parsing/yamlDocument';
import { extractYAMLBlocks, parseYAMLBlock } from '../parsing/yamlParser';
import { ExtendedSRSTreeManager } from '../tree/manager';
import { containsElementById, findElementStatus, ID_FIELDS } from './elementSearch';
import {
  assertLifecycleTransition,
  approvalTarget,
  rejectionTarget,
  type LifecycleContext,
} from './lifecycle';
import { SRSRuleError } from './errors';

export interface RuleDocument {
  path: string;
  content: string;
}
export interface LifecycleRequest {
  element_id: string;
  action?: 'set' | 'approve' | 'reject';
  new_status?: string;
  reason?: string;
}
export interface StatusChange {
  element_id: string;
  previous_status: string;
  new_status: string;
  file: string;
  original: string;
  content: string;
  no_op: boolean;
}

/** Documents must be in aggregation order (entry, manifest.files, then block order). */
export function planElementStatusChange(
  documents: readonly RuleDocument[],
  request: LifecycleRequest,
  context: LifecycleContext = {},
): StatusChange {
  const tree = new ExtendedSRSTreeManager();
  tree.loadDocuments(documents.map((file) => ({ filepath: file.path, content: file.content })));
  const data = tree.getTree().data;
  const id = request.element_id;
  if (!containsElementById(data, id)) {
    throw new SRSRuleError(`Element "${id}" is not defined by any SRS document`);
  }
  const previous = findElementStatus(data, id) ?? 'draft';
  let target: string;
  if (request.action === 'approve') {
    target = approvalTarget(previous);
  } else if (request.action === 'reject') {
    target = rejectionTarget(previous, request.reason ?? '');
  } else {
    target = request.new_status ?? '';
  }
  assertLifecycleTransition(data, id, previous, target, request.reason, context);
  for (const file of [...documents].reverse()) {
    for (const block of extractYAMLBlocks(file.content).reverse()) {
      const parsed = parseYAMLBlock(block);
      if (parsed.error || !containsElementById(parsed.data, id)) {
        continue;
      }
      const base = {
        element_id: id,
        previous_status: previous,
        new_status: target,
        file: file.path,
        original: file.content,
        content: file.content,
        no_op: previous === target,
      };
      if (base.no_op) {
        return base;
      }
      const rewritten = rewriteFileContentForStatus(file.content, id, target, block.startLine);
      if (!rewritten) {
        throw new SRSRuleError(`Element "${id}" could not be rewritten`);
      }
      const preview = new ExtendedSRSTreeManager();
      preview.loadDocuments(
        documents.map((document) => ({
          filepath: document.path,
          content: document.path === file.path ? rewritten.newContent : document.content,
        })),
      );
      if (findElementStatus(preview.getTree().data, id) !== target) {
        throw new SRSRuleError(`Cannot safely update the effective definition of "${id}"`);
      }
      return { ...base, content: rewritten.newContent };
    }
  }
  throw new SRSRuleError(`Element "${id}" has no editable definition`);
}

function updateStatusInDoc(
  doc: YAML.Document.Parsed,
  elementId: string,
  newStatus: string,
): { previous: string } | undefined {
  let result: { previous: string } | undefined;

  YAML.visit(doc, {
    Map(_key, node) {
      for (const idField of ID_FIELDS) {
        const idValueNode = node.get(idField, true);
        const idValue =
          idValueNode && YAML.isScalar(idValueNode) ? idValueNode.value : node.get(idField);
        if (idValue === elementId) {
          const statusNode = node.get('status', true);
          if (statusNode && YAML.isScalar(statusNode)) {
            result = { previous: String(statusNode.value ?? '(unset)') };
            statusNode.value = newStatus;
          } else {
            result = { previous: '(unset)' };
            node.set('status', newStatus);
          }
          return YAML.visit.BREAK;
        }
      }
      return undefined;
    },
  });

  return result;
}

/**
 * Locate the YAML block in ``content`` that defines ``elementId``,
 * mutate its status in place, and return the rewritten file content
 * along with the previous status. Returns ``null`` if no defining
 * block exists.
 *
 * The mutation operates on the YAML block in isolation and splices the
 * re-serialized block back into the original markdown line-by-line, so
 * surrounding markdown content (headings, prose, other YAML blocks) is
 * preserved exactly.
 */
function rewriteFileContentForStatus(
  content: string,
  elementId: string,
  newStatus: string,
  blockStart: number,
): { newContent: string; previous: string } | null {
  const blocks = extractYAMLBlocks(content);
  const lines = content.split('\n');

  for (const block of blocks) {
    if (block.startLine !== blockStart) {
      continue;
    }
    const parsed = parseYAMLBlock(block);
    if (parsed.error || !parsed.data) {
      continue;
    }
    if (!containsElementById(parsed.data, elementId)) {
      continue;
    }

    const doc = parseYamlDocument(block.content);
    const updated = updateStatusInDoc(doc, elementId, newStatus);
    if (!updated) {
      continue;
    }

    const newBlockText = doc.toString();
    // doc.toString() always ends with a trailing newline; the original
    // block content captured by extractYAMLBlocks does not, so we drop
    // the final empty entry to keep line counts aligned.
    const newBlockLines = newBlockText.split('\n');
    if (newBlockLines.length > 0 && newBlockLines[newBlockLines.length - 1] === '') {
      newBlockLines.pop();
    }

    const before = lines.slice(0, block.yamlStartLine);
    const after = lines.slice(block.yamlEndLine + 1);
    const newLines = [...before, ...newBlockLines, ...after];

    return {
      newContent: newLines.join('\n'),
      previous: updated.previous,
    };
  }

  return null;
}
