// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import {
  MetadataBlock,
  MetadataLocation,
  ExtendedSRSTree,
  MergedMetadataEntry,
  TreeValidationError,
  SRSTreeParser,
} from './treeTypes';
import { extractYAMLBlocks, parseYAMLBlock } from '../parsing/yamlParser';
import { parsePath } from '../aggregation/mergeUtils';
import { hasOwn, isUnsafeKey } from '../safeKeys';

export class ExtendedSRSTreeParser implements SRSTreeParser {
  /**
   * Parse a document and extract all metadata blocks
   * Now uses yamlParser.extractYAMLBlocks to avoid duplication
   * Returns both blocks and parse errors
   */
  parseDocument(
    content: string,
    filepath: string,
    commitId?: string,
  ): {
    blocks: MetadataBlock[];
    parseErrors: TreeValidationError[];
  } {
    const blocks: MetadataBlock[] = [];
    const parseErrors: TreeValidationError[] = [];

    // Use yamlParser to extract YAML blocks
    const yamlBlocks = extractYAMLBlocks(content);

    for (const yamlBlock of yamlBlocks) {
      // Parse the YAML content
      const parsedBlock = parseYAMLBlock(yamlBlock);

      if (parsedBlock.error) {
        // YAML parse error
        parseErrors.push({
          path: yamlBlock.path ? yamlBlock.path.join('.') : 'root',
          message: `YAML parse error: ${parsedBlock.error}`,
          locations: [
            {
              filepath,
              commitId,
              lineStart: yamlBlock.startLine,
              lineEnd: yamlBlock.endLine,
              timestamp: Date.now(),
            },
          ],
          severity: 'error',
        });
      }

      if (parsedBlock.data !== undefined) {
        // Convert YAMLBlock to MetadataBlock
        blocks.push({
          content: yamlBlock.content, // Raw YAML content
          yamlContent: parsedBlock.data, // Parsed YAML object
          location: {
            filepath,
            commitId,
            lineStart: yamlBlock.startLine,
            lineEnd: yamlBlock.endLine,
            timestamp: Date.now(),
          },
          type: yamlBlock.isPartial ? 'partial' : 'full',
          path: yamlBlock.path ? yamlBlock.path.join(': ') : undefined,
        });
      }
    }

    return { blocks, parseErrors };
  }

  /**
   * Merge metadata blocks according to extended-srs rules
   */
  mergeMetadataBlocks(
    blocks: MetadataBlock[],
    parseErrors?: TreeValidationError[],
  ): ExtendedSRSTree {
    const mergeMap = new Map<string, MergedMetadataEntry>();
    const mergedData: any = {};

    // Don't sort blocks - preserve the order they were added
    // This maintains the document loading order (files loaded later override earlier ones)
    // Within each file, parsing orders full blocks before partial blocks,
    // preserving source order within each notation.
    const sortedBlocks = [...blocks];

    // Process each block
    for (const block of sortedBlocks) {
      if (block.type === 'full') {
        // Full metadata block
        this.mergeFullBlock(mergedData, block, mergeMap);
      } else {
        // Partial extraction notation
        this.mergePartialBlock(mergedData, block, mergeMap);
      }
    }

    // Return parse errors as validation errors
    return {
      data: mergedData,
      metadataBlocks: blocks,
      mergeMap,
      validationErrors: parseErrors || [],
    };
  }

  // REMOVED: validateTree function - validation should be done in validator.ts, not in parser
  // Parser should only parse and merge, not validate

  private mergeFullBlock(
    target: any,
    block: MetadataBlock,
    mergeMap: Map<string, MergedMetadataEntry>,
  ) {
    // Directly perform deep merge and track in merge map
    this.deepMergeWithTracking(target, block.yamlContent, '', block.location, mergeMap);
  }

  private deepMergeWithTracking(
    target: any,
    source: any,
    path: string,
    location: MetadataLocation,
    mergeMap: Map<string, MergedMetadataEntry>,
  ) {
    // Comment-only YAML (and an explicit null) has no fields to merge.
    if (source === null || source === undefined) {
      return;
    }

    for (const key of Object.keys(source)) {
      // Keys come from the document: never merge into Object.prototype.
      if (isUnsafeKey(key)) {
        continue;
      }
      const currentPath = path ? `${path}.${key}` : key;
      const sourceValue = source[key];

      if (Array.isArray(sourceValue)) {
        // Array handling - replace entire array
        target[key] = sourceValue;
        this.updateMergeMap(currentPath, sourceValue, location, mergeMap);
      } else if (typeof sourceValue === 'object' && sourceValue !== null) {
        // Object handling - recursive merge
        if (
          !hasOwn(target, key) ||
          !target[key] ||
          typeof target[key] !== 'object' ||
          Array.isArray(target[key])
        ) {
          target[key] = {};
        }
        // Track the object-level path itself (for parent path lookups in validation)
        this.updateMergeMap(currentPath, sourceValue, location, mergeMap);
        this.deepMergeWithTracking(target[key], sourceValue, currentPath, location, mergeMap);
      } else {
        // Primitive value - direct assignment
        target[key] = sourceValue;
        this.updateMergeMap(currentPath, sourceValue, location, mergeMap);
      }
    }
  }

  private mergePartialBlock(
    target: any,
    block: MetadataBlock,
    mergeMap: Map<string, MergedMetadataEntry>,
  ) {
    if (!block.path) {
      return;
    }

    // Use the merge utility to parse the path
    const pathParts = parsePath(block.path);
    // The path comes from the document: never navigate into Object.prototype.
    if (pathParts.some((part) => isUnsafeKey(part.key))) {
      return;
    }

    // Navigate to the target location (creating objects as needed)
    let current = target;
    let currentPath = '';

    for (let i = 0; i < pathParts.length; i++) {
      const part = pathParts[i];
      if (i > 0) {
        currentPath += '.';
      }
      currentPath += part.key;

      if (i === pathParts.length - 1) {
        // Last part - do a deep merge here instead of replacement
        if (part.index !== undefined) {
          currentPath += `[${part.index}]`;
          if (!hasOwn(current, part.key) || !current[part.key]) {
            current[part.key] = [];
          }
          current[part.key][part.index] = block.yamlContent;
          this.updateMergeMap(currentPath, block.yamlContent, block.location, mergeMap);
        } else if (
          block.yamlContent !== null &&
          (typeof block.yamlContent !== 'object' || Array.isArray(block.yamlContent))
        ) {
          // Scalar and array fields replace the value at the selected path.
          // Only object fields are merged property by property.
          current[part.key] = block.yamlContent;
          this.updateMergeMap(currentPath, block.yamlContent, block.location, mergeMap);
        } else {
          // For object paths, ensure the target exists and do deep merge
          if (
            !hasOwn(current, part.key) ||
            !current[part.key] ||
            typeof current[part.key] !== 'object' ||
            Array.isArray(current[part.key])
          ) {
            current[part.key] = {};
          }
          // Deep merge the content into the existing object
          this.deepMergeWithTracking(
            current[part.key],
            block.yamlContent,
            currentPath,
            block.location,
            mergeMap,
          );
        }
      } else {
        // Intermediate parts - create if needed
        if (part.index !== undefined) {
          currentPath += `[${part.index}]`;
          if (!hasOwn(current, part.key) || !current[part.key]) {
            current[part.key] = [];
          }
          if (!current[part.key][part.index]) {
            current[part.key][part.index] = {};
          }
          current = current[part.key][part.index];
        } else {
          if (
            !hasOwn(current, part.key) ||
            !current[part.key] ||
            typeof current[part.key] !== 'object' ||
            Array.isArray(current[part.key])
          ) {
            current[part.key] = {};
          }
          current = current[part.key];
        }
      }
    }
  }

  private updateMergeMap(
    path: string,
    value: any,
    location: MetadataLocation,
    mergeMap: Map<string, MergedMetadataEntry>,
  ) {
    const existing = mergeMap.get(path);
    if (existing) {
      existing.sources.push(location);
      existing.value = value;
      existing.finalSource = location;
    } else {
      mergeMap.set(path, {
        path,
        value,
        sources: [location],
        finalSource: location,
      });
    }
  }
}
