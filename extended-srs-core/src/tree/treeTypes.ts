// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
/**
 * Extended SRS Tree Structure Types
 * Based on extended-srs-spec.md II. 基本構造
 */

export interface MetadataLocation {
  filepath: string;
  commitId?: string;
  lineStart: number;
  lineEnd: number;
  timestamp: number;
}

export interface MetadataBlock {
  content: string; // Raw YAML content (without comment markers)
  yamlContent: any; // Parsed YAML object
  location: MetadataLocation;
  type: 'full' | 'partial';
  path?: string; // For partial extraction notation like @srs: project-overview: objective
}

export interface MergedMetadataEntry {
  path: string;
  value: any;
  sources: MetadataLocation[]; // Array of locations where this value is defined, in order
  finalSource: MetadataLocation; // The location that provides the final value
}

export interface ExtendedSRSTree {
  // Complete merged SRS data
  data: any;

  // Metadata tracking
  metadataBlocks: MetadataBlock[];

  // Merge results for each path
  mergeMap: Map<string, MergedMetadataEntry>;

  // Validation results
  validationErrors: TreeValidationError[];
}

export interface TreeValidationError {
  path: string;
  message: string;
  locations: MetadataLocation[];
  severity: 'error' | 'warning';
}

export interface SRSTreeParser {
  parseDocument(
    content: string,
    filepath: string,
    commitId?: string,
  ): {
    blocks: MetadataBlock[];
    parseErrors: TreeValidationError[];
  };
  mergeMetadataBlocks(
    blocks: MetadataBlock[],
    parseErrors?: TreeValidationError[],
  ): ExtendedSRSTree;
  // REMOVED: validateTree - validation should be done in validator.ts, not in parser
}

export interface SRSTreeManager {
  // Load and parse documents
  loadDocument(filepath: string, content: string, commitId?: string): void;
  loadDocuments(documents: Array<{ filepath: string; content: string; commitId?: string }>): void;

  // Get merged tree
  getTree(): ExtendedSRSTree;

  // Query specific paths
  getValueAt(path: string): any;
  getSourcesFor(path: string): MetadataLocation[];

  // Modification
  updateMetadataBlock(location: MetadataLocation, newContent: string): void;
  addMetadataBlock(
    filepath: string,
    lineNumber: number,
    content: string,
    type: 'full' | 'partial',
    path?: string,
  ): void;

  // Export
  exportToMarkdown(): Map<string, string>; // filepath -> content
}
