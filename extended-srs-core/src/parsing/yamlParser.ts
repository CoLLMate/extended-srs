// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
/**
 * Extended SRS YAML Parser (Core)
 * Monaco-independent YAML parsing and metadata extraction
 */

import { parseYamlDocument } from './yamlDocument';
import { hasOwn, isUnsafeKey } from '../safeKeys';
import { parsePath } from '../aggregation/mergeUtils';
import { assertSafeParsedData } from './inputSafety';

export interface YAMLBlock {
  content: string;
  startLine: number;
  endLine: number;
  yamlStartLine: number;
  yamlEndLine: number;
  isPartial?: boolean;
  path?: string[];
}

export interface ParsedYAMLBlock extends YAMLBlock {
  data?: any;
  error?: string;
}

export interface ExtendedSRSSection {
  level: number;
  title: string;
  line: number;
}

export interface ParsedExtendedSRS {
  srsData?: any;
  sections: ExtendedSRSSection[];
  partialPaths?: string[];
  raw: string;
  yamlContent?: string;
  yamlBlocks?: ParsedYAMLBlock[];
  contentSections?: ContentSection[]; // 追加: コンテンツセクション
  startLine?: number;
  isPartial?: boolean;
  path?: string[];
}

export interface ContentSection {
  sections: string[]; // Related top-level sections from YAML
  headings: string[]; // Top-level headings in the content
  startLine: number;
  endLine: number;
  content: string;
}

/**
 * Extract all YAML blocks from markdown content
 */
export function extractYAMLBlocks(content: string): YAMLBlock[] {
  const blocks: YAMLBlock[] = [];
  // const lines = content.split('\n');

  // Full notation. The specification fixes the delimiters as `<!--@srs` and `@srs-->`
  // with no whitespace; the optional whitespace below is a deliberate tolerance for
  // hand-written documents, not an alternative form.
  const fullSrsRegex = /<!--\s*@srs\s*\n([\s\S]*?)\s*@srs-->/g;

  let match;
  while ((match = fullSrsRegex.exec(content)) !== null) {
    const fullMatch = match[0];
    const yamlContent = match[1] || ''; // Handle empty content

    // Calculate line numbers (0-based for internal use)
    const beforeMatch = content.substring(0, match.index);
    const startLine = beforeMatch.split('\n').length - 1; // 0-based line number
    const matchLines = fullMatch.split('\n').length;

    blocks.push({
      content: yamlContent === '' ? '\n' : yamlContent, // Preserve newline for empty blocks
      startLine,
      endLine: startLine + matchLines - 1,
      yamlStartLine: startLine + 1,
      yamlEndLine: startLine + matchLines - 2,
      isPartial: false,
    });
  }

  // Partial notation: `<!--@srs: path` ... `@srs-->` (same deliberate whitespace tolerance).
  const partialSrsRegex = /<!--\s*@srs\s*:\s*([^\n]+)\n([\s\S]*?)\s*@srs-->/g;

  while ((match = partialSrsRegex.exec(content)) !== null) {
    const pathStr = match[1].trim();
    const yamlContent = match[2];
    const fullMatch = match[0];

    // Calculate line numbers (0-based for internal use)
    const beforeMatch = content.substring(0, match.index);
    const startLine = beforeMatch.split('\n').length - 1; // 0-based line number
    const matchLines = fullMatch.split('\n').length;

    blocks.push({
      content: yamlContent,
      startLine,
      endLine: startLine + matchLines - 1,
      yamlStartLine: startLine + 1,
      yamlEndLine: startLine + matchLines - 2,
      isPartial: true,
      path: parsePartialPath(pathStr),
    });
  }

  return blocks;
}

/**
 * Parse a YAML block
 */
export function parseYAMLBlock(block: YAMLBlock): ParsedYAMLBlock {
  const result: ParsedYAMLBlock = { ...block };

  try {
    if (block.path) {
      parsePath(block.path.join(':'));
    }
    // Handle empty blocks
    if (!block.content || block.content.trim() === '') {
      result.data = {};
      return result;
    }

    const doc = parseYamlDocument(block.content);

    if (doc.errors && doc.errors.length > 0) {
      result.error = doc.errors[0].message;
    } else {
      const data = doc.toJSON();
      assertSafeParsedData(data);
      result.data = data;
    }
  } catch (e: any) {
    result.error = e.message || 'Failed to parse YAML';
  }

  return result;
}

/**
 * Parse Extended SRS content with integrated content section extraction
 */
export function parseExtendedSRS(content: string): ParsedExtendedSRS | null {
  if (!content) {
    return null;
  }

  const result: ParsedExtendedSRS = {
    sections: [],
    partialPaths: [],
    raw: content,
    yamlBlocks: [],
    contentSections: [], // Initialize content sections
  };

  // Extract all YAML blocks
  const blocks = extractYAMLBlocks(content);

  // Parse each block and build SRS data
  let srsData: any = {};
  const parsedBlocks: ParsedYAMLBlock[] = [];

  for (const block of blocks) {
    const parsed = parseYAMLBlock(block);
    parsedBlocks.push(parsed);

    if (parsed.data) {
      try {
        if (block.isPartial && block.path) {
          // Apply partial data
          applyPartialData(srsData, block.path, parsed.data);
          result.partialPaths!.push(block.path.join('.'));
        } else {
          // Merge full data
          srsData = { ...srsData, ...parsed.data };
        }
      } catch (e) {
        console.warn(
          `Failed to parse Extended SRS ${block.isPartial ? 'partial' : 'full'} notation:`,
          e,
        );
      }
    }
  }

  result.srsData = srsData;
  result.yamlBlocks = parsedBlocks;

  // Extract content sections for each YAML block
  if (blocks.length > 0) {
    const lines = content.split('\n');
    const sortedBlocks = [...blocks].sort((a, b) => a.startLine - b.startLine);

    for (let i = 0; i < sortedBlocks.length; i++) {
      const currentBlock = sortedBlocks[i];
      const nextBlock = sortedBlocks[i + 1];
      const parsedBlock = parsedBlocks[blocks.indexOf(currentBlock)];

      // Content starts after current block ends
      const contentStartLine = currentBlock.endLine + 1;
      // Content ends before next block starts (or at end of file)
      const contentEndLine = nextBlock ? nextBlock.startLine - 1 : lines.length - 1;

      if (contentStartLine <= contentEndLine) {
        // Extract content between blocks
        const contentLines = lines.slice(contentStartLine, contentEndLine + 1);
        const contentText = contentLines.join('\n');

        // Extract headings from content
        const headings: string[] = [];
        const headingRegex = /^#{1,6}\s+(.+)$/gm;
        let match;
        while ((match = headingRegex.exec(contentText)) !== null) {
          headings.push(match[1]);
        }

        // Determine sections from parsed YAML
        const sections: string[] = [];
        if (parsedBlock.data) {
          if (currentBlock.isPartial && currentBlock.path) {
            // For partial notation, use the path as section
            sections.push(currentBlock.path[0]);
          } else {
            // For full notation, get top-level keys
            sections.push(...Object.keys(parsedBlock.data));
          }
        }

        result.contentSections!.push({
          sections,
          headings,
          startLine: contentStartLine,
          endLine: contentEndLine,
          content: contentText,
        });
      }
    }
  }

  // Extract markdown sections (existing logic)
  const sectionRegex = /^(#{1,6})\s+(.+)$/gm;
  let sectionMatch;
  while ((sectionMatch = sectionRegex.exec(content)) !== null) {
    const beforeMatch = content.substring(0, sectionMatch.index);
    const line = beforeMatch.split('\n').length;

    result.sections.push({
      level: sectionMatch[1].length,
      title: sectionMatch[2],
      line,
    });
  }

  return result;
}

/**
 * Parse partial path notation
 */
export function parsePartialPath(pathStr: string): string[] {
  // Handle both colon and dot notation
  if (pathStr.includes(':')) {
    // Colon notation: "path: to: data" -> ["path", "to", "data"]
    return pathStr
      .split(':')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  } else {
    // Dot notation: "path.to.data" -> ["path", "to", "data"]
    return pathStr
      .split('.')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  }
}

/**
 * Apply partial data to target object
 */
export function applyPartialData(target: any, path: string[], data: any): void {
  if (!target || !path || path.length === 0) {
    return;
  }
  // The path comes from the document: never navigate into Object.prototype.
  if (path.some(isUnsafeKey)) {
    return;
  }

  let current = target;

  // Navigate to parent, creating own properties only
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (!hasOwn(current, key) || !current[key] || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key];
  }

  // Set value at final key
  const finalKey = path[path.length - 1];
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    // Merge objects
    const existing = hasOwn(current, finalKey) ? current[finalKey] : undefined;
    current[finalKey] = { ...existing, ...data };
  } else {
    // Replace value
    current[finalKey] = data;
  }
}

/**
 * Determine YAML path at line
 */
export function determineYamlPath(yamlLines: string[], lineIndex: number): string[] {
  const path: string[] = [];
  const indentStack: { indent: number; key: string }[] = [];

  for (let i = 0; i <= lineIndex && i < yamlLines.length; i++) {
    const line = yamlLines[i];
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    // const indent = line.length - line.trimStart().length;

    // Check if it's a key-value line (but not an array item)
    const keyMatch = line.match(/^(\s*)([^:]+):/);
    if (keyMatch && !line.trim().startsWith('-')) {
      const currentIndent = keyMatch[1].length;
      const key = keyMatch[2].trim();

      // Skip array item indicators
      if (key.startsWith('- ')) {
        continue;
      }

      // Pop items from stack with greater or equal indent
      while (
        indentStack.length > 0 &&
        indentStack[indentStack.length - 1].indent >= currentIndent
      ) {
        indentStack.pop();
      }

      // Add current key to stack
      indentStack.push({ indent: currentIndent, key });

      // Update path from stack
      path.length = 0;
      path.push(...indentStack.map((item) => item.key));
    }
  }

  return path;
}

/**
 * Extract sections with metadata
 */
export function extractSectionsWithMetadata(content: string): Map<string, any> {
  const sections = new Map<string, any>();
  const parsed = parseExtendedSRS(content);

  if (parsed?.srsData) {
    for (const key of Object.keys(parsed.srsData)) {
      sections.set(key, parsed.srsData[key]);
    }
  }

  return sections;
}

/**
 * Extract content sections for each YAML block
 * According to Extended SRS spec: content between metadata A and metadata B belongs to metadata A
 */
export function extractContentSections(content: string): ContentSection[] {
  const contentSections: ContentSection[] = [];
  const lines = content.split('\n');
  const yamlBlocks = extractYAMLBlocks(content);

  if (yamlBlocks.length === 0) {
    return [];
  }

  // Sort blocks by start line
  yamlBlocks.sort((a, b) => a.startLine - b.startLine);

  for (let i = 0; i < yamlBlocks.length; i++) {
    const currentBlock = yamlBlocks[i];
    const nextBlock = yamlBlocks[i + 1];

    // Content starts after current block ends
    const contentStartLine = currentBlock.endLine + 1;
    // Content ends before next block starts (or at end of file)
    const contentEndLine = nextBlock ? nextBlock.startLine - 1 : lines.length - 1;

    if (contentStartLine <= contentEndLine) {
      // Extract content between blocks
      const contentLines = lines.slice(contentStartLine, contentEndLine + 1);
      const contentText = contentLines.join('\n');

      // Extract headings from content (all heading levels)
      const headings: string[] = [];
      const headingRegex = /^#{1,6}\s+(.+)$/gm;
      let match;
      while ((match = headingRegex.exec(contentText)) !== null) {
        headings.push(match[1]);
      }

      // Parse the YAML block to get sections
      const parsedBlock = parseYAMLBlock(currentBlock);
      const sections: string[] = [];

      if (parsedBlock.data) {
        if (currentBlock.isPartial && currentBlock.path) {
          // For partial notation, use the path as section
          sections.push(currentBlock.path[0]);
        } else {
          // For full notation, get top-level keys
          sections.push(...Object.keys(parsedBlock.data));
        }
      }

      contentSections.push({
        sections,
        headings,
        startLine: contentStartLine,
        endLine: contentEndLine,
        content: contentText,
      });
    }
  }

  return contentSections;
}
