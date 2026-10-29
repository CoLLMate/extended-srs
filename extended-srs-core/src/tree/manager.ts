// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import yaml from 'yaml';
import { ExtendedSRSTree, MetadataBlock, MetadataLocation, SRSTreeManager } from './treeTypes';
import { ExtendedSRSTreeParser } from './parser';
import { hasOwn, isUnsafeKey } from '../safeKeys';
import { getValueAtPath, parsePath, removeValueAtPath } from '../aggregation/mergeUtils';

export class ExtendedSRSTreeManager implements SRSTreeManager {
  private parser: ExtendedSRSTreeParser;
  private documents: Map<string, { content: string; commitId?: string }>;
  private tree: ExtendedSRSTree | null;

  constructor() {
    this.parser = new ExtendedSRSTreeParser();
    this.documents = new Map();
    this.tree = null;
  }

  /**
   * Load a single document
   */
  loadDocument(filepath: string, content: string, commitId?: string): void {
    this.documents.set(filepath, { content, commitId });
    this.rebuildTree();
  }

  /**
   * Load multiple documents
   */
  loadDocuments(documents: Array<{ filepath: string; content: string; commitId?: string }>): void {
    for (const doc of documents) {
      this.documents.set(doc.filepath, { content: doc.content, commitId: doc.commitId });
    }
    this.rebuildTree();
  }

  /**
   * Get the merged tree
   */
  getTree(): ExtendedSRSTree {
    if (!this.tree) {
      this.rebuildTree();
    }
    return this.tree!;
  }

  /**
   * Get value at a specific path
   */
  getValueAt(path: string): any {
    const tree = this.getTree();
    const parts = path.split('.');
    let current = tree.data;

    for (const part of parts) {
      // Check for array notation
      const arrayMatch = part.match(/^(.+)\[(\d+)\]$/);
      if (arrayMatch) {
        const key = arrayMatch[1];
        const index = parseInt(arrayMatch[2], 10);
        if (
          isUnsafeKey(key) ||
          !hasOwn(current, key) ||
          !Array.isArray(current[key]) ||
          !hasOwn(current[key], String(index))
        ) {
          return undefined;
        }
        current = current[key][index];
      } else {
        if (isUnsafeKey(part) || !hasOwn(current, part)) {
          return undefined;
        }
        current = current[part];
      }

      if (current === undefined) {
        return undefined;
      }
    }

    return current;
  }

  /**
   * Get all source locations for a specific path
   */
  getSourcesFor(path: string): MetadataLocation[] {
    const tree = this.getTree();
    const entry = tree.mergeMap.get(path);
    return entry ? entry.sources : [];
  }

  /**
   * Update a metadata block
   */
  updateMetadataBlock(location: MetadataLocation, newContent: string): void {
    const doc = this.documents.get(location.filepath);
    if (!doc) {
      return;
    }

    const lines = doc.content.split('\n');
    const startLine = location.lineStart; // Already 0-based from parser
    const endLine = location.lineEnd;

    // Replace the old metadata block with the new one
    const newLines = [
      ...lines.slice(0, startLine),
      ...newContent.split('\n'),
      ...lines.slice(endLine + 1),
    ];

    doc.content = newLines.join('\n');
    this.rebuildTree();
  }

  /**
   * Add a new metadata block
   */
  addMetadataBlock(
    filepath: string,
    lineNumber: number,
    content: string,
    type: 'full' | 'partial',
    path?: string,
  ): void {
    const doc = this.documents.get(filepath);
    if (!doc) {
      return;
    }

    const lines = doc.content.split('\n');
    const insertLine = Math.min(lineNumber - 1, lines.length); // Convert to 0-based

    // Format the metadata block (Extended SRS v1.0.4 format)
    let metadataBlock: string;
    if (type === 'full') {
      metadataBlock = `<!-- @srs\n${content}\n@srs-->`;
    } else {
      metadataBlock = `<!-- @srs: ${path}\n${content}\n@srs-->`;
    }

    // Insert the metadata block
    const newLines = [
      ...lines.slice(0, insertLine),
      ...metadataBlock.split('\n'),
      ...lines.slice(insertLine),
    ];

    doc.content = newLines.join('\n');
    this.rebuildTree();
  }

  /**
   * Export all documents to markdown
   */
  exportToMarkdown(): Map<string, string> {
    const result = new Map<string, string>();

    for (const [filepath, doc] of this.documents) {
      result.set(filepath, doc.content);
    }

    return result;
  }

  /**
   * Export merged metadata as YAML
   */
  exportMergedMetadata(): string {
    const tree = this.getTree();
    return yaml.stringify(tree.data, {
      lineWidth: 0,
      defaultStringType: 'QUOTE_DOUBLE',
      defaultKeyType: 'PLAIN',
    });
  }

  /**
   * Split a metadata block at a specific path
   */
  splitMetadataBlock(
    location: MetadataLocation,
    splitPath: string,
    insertAfterLines: number = 0,
  ): void {
    const doc = this.documents.get(location.filepath);
    if (!doc) {
      return;
    }

    // Parse the existing block
    const { blocks } = this.parser.parseDocument(doc.content, location.filepath, doc.commitId);
    const targetBlock = blocks.find(
      (b: MetadataBlock) =>
        b.location.lineStart === location.lineStart && b.location.lineEnd === location.lineEnd,
    );

    if (!targetBlock || targetBlock.type !== 'full') {
      return;
    }

    // Get the value at the split path
    const value = this.getValueFromObject(targetBlock.yamlContent, splitPath);
    if (value === undefined) {
      return;
    }

    // Remove the value from the original block
    const newYamlContent = { ...targetBlock.yamlContent };
    this.removeValueFromObject(newYamlContent, splitPath);

    // Update the original block
    const newOriginalContent = yaml.stringify(newYamlContent, {
      lineWidth: 0,
      defaultStringType: 'QUOTE_DOUBLE',
      defaultKeyType: 'PLAIN',
    });

    const originalBlockContent = `<!-- @srs\n${newOriginalContent}@srs-->`;

    // Create the new partial block
    const partialContent = yaml.stringify(value, {
      lineWidth: 0,
      defaultStringType: 'QUOTE_DOUBLE',
      defaultKeyType: 'PLAIN',
    });

    const partialBlockContent = `<!-- @srs: ${splitPath}\n${partialContent}@srs-->`;

    // Replace in document
    const lines = doc.content.split('\n');
    const startLine = location.lineStart; // Already 0-based from parser
    const endLine = location.lineEnd;
    const insertLine = endLine + 1 + insertAfterLines;

    const newLines = [
      ...lines.slice(0, startLine),
      ...originalBlockContent.split('\n'),
      ...lines.slice(endLine + 1, insertLine),
      ...partialBlockContent.split('\n'),
      ...lines.slice(insertLine),
    ];

    doc.content = newLines.join('\n');
    this.rebuildTree();
  }

  private rebuildTree(): void {
    const allBlocks: MetadataBlock[] = [];
    const allParseErrors: import('./treeTypes').TreeValidationError[] = [];

    // Parse all documents
    for (const [filepath, doc] of this.documents) {
      const { blocks, parseErrors } = this.parser.parseDocument(
        doc.content,
        filepath,
        doc.commitId,
      );
      allBlocks.push(...blocks);
      allParseErrors.push(...parseErrors);
    }

    // Merge blocks with parse errors
    this.tree = this.parser.mergeMetadataBlocks(allBlocks, allParseErrors);
  }

  private getValueFromObject(obj: any, path: string): any {
    return getValueAtPath(obj, parsePath(path));
  }

  private removeValueFromObject(obj: any, path: string): void {
    removeValueAtPath(obj, parsePath(path));
  }
}
