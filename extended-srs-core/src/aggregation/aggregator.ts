// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
import { parseExtendedSRS, type YAMLBlock, type ContentSection } from '../parsing/yamlParser';
import { FileInfo } from '../types';
import { ExtendedSRSTreeManager } from '../tree/manager';
import { validateExtendedSRS, type FieldLocation } from '../validation/validator';
// ExtendedSRS type removed - using dynamic structure

/**
 * ファイルからの寄与情報
 */
export interface ExtendedSRSContribution {
  srsData?: any;
  overrides?: string[];
  partialPaths?: string[];
  yamlContent?: string; // YAMLコンテンツ（バリデーション用）
  startLine?: number; // YAML開始行（0-based）
  yamlBlocks?: YAMLBlock[]; // すべてのYAMLブロック情報
  contentSections?: ContentSection[]; // コンテンツセクション情報
}

/**
 * バリデーションエラー
 * ValidationResult互換の構造を持つ
 */
export interface ExtendedSRSValidationError {
  level: 'error';
  message: string;
  path: string; // ソースファイルパス（ValidationResultのpathに対応）
  line?: number;
  column?: number;
  field?: string; // Extended SRS固有: 関連するフィールドパス
}

/**
 * バリデーション警告
 * ValidationResult互換の構造を持つ
 */
export interface ExtendedSRSValidationWarning {
  level: 'warning';
  message: string;
  path: string; // ソースファイルパス（ValidationResultのpathに対応）
  line?: number;
  column?: number;
  field?: string; // Extended SRS固有: 関連するフィールドパス
}

/**
 * フィールドの競合情報
 */
export interface ExtendedSRSConflict {
  field: string;
  files: string[];
}

/**
 * 集約された拡張SRSデータ
 */
export interface AggregatedExtendedSRS {
  // 統合されたSRSオブジェクト全体
  srs: any;
  // 各ファイルからの寄与情報
  contributions: {
    [filePath: string]: ExtendedSRSContribution;
  };
  // バリデーション結果
  validation: {
    isComplete: boolean;
    missingFields: string[];
    errors: ExtendedSRSValidationError[];
    warnings: ExtendedSRSValidationWarning[];
    conflicts: ExtendedSRSConflict[];
  };
  // フィールドのソースファイル情報（上書き履歴を保持）
  fieldSources?: {
    [fieldPath: string]: string[]; // fieldPath -> [filePath1, filePath2, ...] 後ろが最新
  };
}

/**
 * manifest.files の値を aggregator が扱う相対パスへ正規化する。
 * 読み取り側もこの関数を使い、取得時と集約時の解決規則を一致させる。
 */
export function normalizeManifestFilePath(path: unknown): string | null {
  if (typeof path !== 'string') {
    return null;
  }

  let normalized = path;
  while (normalized.startsWith('./')) {
    normalized = normalized.slice(2);
  }
  normalized = normalized.replace(/\/+/g, '/');

  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    normalized.includes('\\') ||
    normalized.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    return null;
  }

  return normalized;
}

/**
 * プロジェクト内のすべてのマークダウンファイルから拡張SRSメタデータを集約
 * Now uses ExtendedSRSTreeManager internally for better separation of concerns
 */
export class ExtendedSRSAggregator {
  private fileContents: Map<string, { content: string }>;
  private projectFiles: FileInfo[];
  private treeManager: ExtendedSRSTreeManager;

  constructor(fileContents: Map<string, { content: string }>, projectFiles: FileInfo[]) {
    this.fileContents = fileContents;
    this.projectFiles = projectFiles;
    this.treeManager = new ExtendedSRSTreeManager();
  }

  /**
   * Update aggregator data with new file contents and project files
   */
  updateData(fileContents: Map<string, { content: string }>, projectFiles: FileInfo[]) {
    this.fileContents = fileContents;
    this.projectFiles = projectFiles;
    this.treeManager = new ExtendedSRSTreeManager(); // Reset tree manager with new data
  }

  /**
   * プロジェクト全体の拡張SRSメタデータを集約
   * Now uses ExtendedSRSTreeManager for document management
   */
  async aggregate(): Promise<AggregatedExtendedSRS> {
    const result: AggregatedExtendedSRS = {
      srs: {},
      contributions: {},
      validation: {
        isComplete: false,
        missingFields: [],
        errors: [],
        warnings: [],
        conflicts: [],
      },
      fieldSources: {},
    };

    // 最初にエントリーポイントとなるファイルを探す（srs.md必須）
    const entryFile = await this.findEntryFile();
    if (!entryFile) {
      result.validation.errors.push({
        level: 'error',
        message:
          'エントリーファイル(srs.md)が見つかりません。Extended SRS v1.0.4仕様により、プロジェクトルートにsrs.mdが必須です。',
        path: '',
        field: 'manifest',
      });
      return result;
    }

    // Load all relevant documents into the tree manager
    const processedFiles = new Set<string>();
    const documentsToLoad: Array<{ filepath: string; content: string }> = [];

    // Process entry file first
    await this.collectDocumentForTreeManager(entryFile, documentsToLoad, result, processedFiles);

    // Load entry file to get manifest
    if (documentsToLoad.length > 0) {
      this.treeManager.loadDocuments(documentsToLoad);
      const tree = this.treeManager.getTree();
      result.srs = tree.data;

      // Process additional files from manifest
      if (result.srs.manifest?.files) {
        const additionalDocs: Array<{ filepath: string; content: string }> = [];

        for (const filePath of result.srs.manifest.files) {
          if (typeof filePath !== 'string') {
            result.validation.warnings.push({
              level: 'warning',
              message: `manifest.files の値が文字列ではありません: ${String(filePath)}`,
              path: entryFile.path,
              field: 'manifest.files',
            });
            continue;
          }

          const normalizedPath = normalizeManifestFilePath(filePath);
          if (normalizedPath === null) {
            result.validation.warnings.push({
              level: 'warning',
              message: `manifest.files のパスが不正です: ${filePath}`,
              path: entryFile.path,
              field: 'manifest.files',
            });
            continue;
          }

          const file = this.projectFiles.find((f) => f.path === normalizedPath);
          if (file && !processedFiles.has(file.path)) {
            await this.collectDocumentForTreeManager(file, additionalDocs, result, processedFiles);
          } else if (!file) {
            result.validation.warnings.push({
              level: 'warning',
              message: `対象ファイルが見つかりません: ${filePath}`,
              path: entryFile.path,
              field: 'manifest.files',
            });
          }
        }

        // Load additional documents
        if (additionalDocs.length > 0) {
          this.treeManager.loadDocuments(additionalDocs);
        }
      }
    }

    // Get final merged tree
    const finalTree = this.treeManager.getTree();
    result.srs = finalTree.data;

    // Copy parse errors from tree (YAML parse errors)
    for (const error of finalTree.validationErrors) {
      // Get source file from locations if available
      const sourceFile =
        error.locations && error.locations.length > 0 ? error.locations[0].filepath : undefined;

      if (error.severity === 'error') {
        result.validation.errors.push({
          level: 'error',
          message: error.message,
          path: sourceFile || '',
          field: error.path,
        });
      } else {
        result.validation.warnings.push({
          level: 'warning',
          message: error.message,
          path: sourceFile || '',
          field: error.path,
        });
      }
    }

    // Build contributions from metadata blocks if not already set
    for (const block of finalTree.metadataBlocks) {
      const filepath = block.location.filepath;
      if (!result.contributions[filepath]) {
        result.contributions[filepath] = {
          srsData: block.yamlContent,
          overrides: [],
          partialPaths: block.path ? [block.path] : [],
        };
      }
    }

    // Build field sources and field locations from merge map
    const fieldLocations: { [fieldPath: string]: FieldLocation[] } = {};
    for (const [path, entry] of finalTree.mergeMap) {
      result.fieldSources![path] = entry.sources.map((s) => s.filepath);
      fieldLocations[path] = entry.sources.map((s) => ({
        filepath: s.filepath,
        lineStart: s.lineStart,
        lineEnd: s.lineEnd,
      }));

      // Detect conflicts
      if (entry.sources.length > 1) {
        const uniqueSources = Array.from(new Set(entry.sources.map((s) => s.filepath)));
        if (uniqueSources.length > 1) {
          result.validation.conflicts.push({
            field: path,
            files: uniqueSources,
          });
        }
      }
    }

    // Add root path entry for entry file fallback (for root-level required errors)
    if (entryFile) {
      result.fieldSources![''] = [entryFile.path];
      fieldLocations[''] = [{ filepath: entryFile.path, lineStart: 0, lineEnd: 0 }];
    }

    // Refine field locations: find actual YAML key line numbers within file contents
    // The mergeMap tracks block-level locations, but we want per-key line numbers
    this.refineFieldLocations(fieldLocations);

    // Run universal Extended SRS validation with field locations
    const validationResult = await validateExtendedSRS(
      result.srs,
      result.fieldSources || {},
      fieldLocations,
    );

    // Add schema validation errors and warnings
    for (const error of validationResult.errors) {
      // Check for duplicates from parse errors
      const isDuplicate = result.validation.errors.some(
        (e) => e.message === error.message && e.field === error.path,
      );
      if (!isDuplicate) {
        const sourceFile = error.sourceFile || entryFile?.path || '';
        // Refine line number: if missing, search for the field in the source file content
        let line = error.line;
        if (!line && error.path && sourceFile) {
          const refinedLine = this.findFieldLineInContent(sourceFile, error.path);
          if (refinedLine !== undefined) {
            line = refinedLine + 1; // Convert 0-based to 1-based
          }
        }

        result.validation.errors.push({
          level: 'error',
          message: error.message,
          path: sourceFile,
          line,
          field: error.path,
        });
      }
    }

    for (const warning of validationResult.warnings) {
      const sourceFile = warning.sourceFile || entryFile?.path || '';
      let line = warning.line;
      if (!line && warning.path && sourceFile) {
        const refinedLine = this.findFieldLineInContent(sourceFile, warning.path);
        if (refinedLine !== undefined) {
          line = refinedLine + 1;
        }
      }

      result.validation.warnings.push({
        level: 'warning',
        message: warning.message,
        path: sourceFile,
        line,
        field: warning.path,
      });
    }

    // Check completeness
    result.validation.isComplete = result.validation.errors.length === 0;

    return result;
  }

  /**
   * Refine field locations to point to actual YAML key lines instead of block start lines.
   * The mergeMap tracks block-level locations (lineStart = start of <!-- @srs block),
   * but for accurate error reporting we need the line where each key actually appears.
   */
  private refineFieldLocations(fieldLocations: { [fieldPath: string]: FieldLocation[] }): void {
    for (const [path, locations] of Object.entries(fieldLocations)) {
      if (!path) {
        continue;
      } // Skip root path

      for (const loc of locations) {
        const refinedLine = this.findKeyLineInFile(loc.filepath, path, loc.lineStart, loc.lineEnd);
        if (refinedLine !== undefined) {
          loc.lineStart = refinedLine;
        }
      }
    }
  }

  /**
   * Find the 0-based line number of a YAML key within a file's content.
   * Searches within YAML blocks bounded by blockStart and blockEnd.
   */
  private findKeyLineInFile(
    filepath: string,
    fieldPath: string,
    blockStart: number,
    blockEnd: number,
  ): number | undefined {
    const fileContent = this.fileContents.get(filepath);
    if (!fileContent) {
      return undefined;
    }

    const lines = fileContent.content.split('\n');
    const pathParts = fieldPath.split('.');
    const searchKey = pathParts[pathParts.length - 1];

    // Skip numeric keys (array indices like "0", "1")
    if (/^\d+$/.test(searchKey)) {
      return undefined;
    }

    // Escape special regex characters in the key
    const escapedKey = searchKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const keyPattern = new RegExp(`^(\\s*)${escapedKey}\\s*:`);

    // Search within the block's line range for the key
    const searchEnd = Math.min(blockEnd, lines.length - 1);
    for (let i = blockStart; i <= searchEnd; i++) {
      if (keyPattern.test(lines[i])) {
        return i; // 0-based line number
      }
    }

    return undefined;
  }

  /**
   * Find the 0-based line number of a field in a source file by searching within YAML blocks.
   * This is a fallback when fieldLocations doesn't provide accurate line numbers.
   * Searches for both:
   * 1. YAML keys (e.g., `use-cases:`) within full blocks
   * 2. Partial block tags (e.g., `<!-- @srs: use-cases`) that define the path
   */
  private findFieldLineInContent(filepath: string, fieldPath: string): number | undefined {
    const fileContent = this.fileContents.get(filepath);
    if (!fileContent) {
      return undefined;
    }

    const lines = fileContent.content.split('\n');
    const pathParts = fieldPath.split('.');
    const searchKey = pathParts[pathParts.length - 1];

    // Skip numeric keys (array indices)
    if (/^\d+$/.test(searchKey)) {
      return undefined;
    }

    const escapedKey = searchKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const keyPattern = new RegExp(`^(\\s*)${escapedKey}\\s*:`);

    // Also build pattern for partial block tags: <!-- @srs: use-cases
    // Convert dot-separated path to colon-separated format used in tags
    const tagPath = fieldPath
      .split('.')
      .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('\\s*:\\s*');
    const partialTagPattern = new RegExp(`<!--\\s*@srs\\s*:\\s*${tagPath}\\s*$`);

    // Search line by line
    let inYamlBlock = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check for partial block tag that defines this path
      // e.g., <!-- @srs: use-cases or <!--@srs: use-cases
      if (partialTagPattern.test(line)) {
        return i; // 0-based
      }

      if (/<!--\s*@srs/.test(line)) {
        inYamlBlock = true;
        continue;
      }
      if (line.includes('@srs-->')) {
        inYamlBlock = false;
        continue;
      }

      // Search for YAML key within full blocks
      if (inYamlBlock && keyPattern.test(line)) {
        return i; // 0-based
      }
    }

    return undefined;
  }

  /**
   * Find the entry file for the project (srs.md is required)
   */
  public async findEntryFile(): Promise<FileInfo | null> {
    // srs.md is required per Extended SRS v1.0.4 spec
    const entryFile = this.projectFiles.find((f) => !f.is_directory && f.path === 'srs.md');
    return entryFile || null;
  }

  /**
   * Collect document content for tree manager
   */
  private async collectDocumentForTreeManager(
    file: FileInfo,
    documents: Array<{ filepath: string; content: string }>,
    result: AggregatedExtendedSRS,
    processedFiles: Set<string>,
  ): Promise<void> {
    if (processedFiles.has(file.path)) {
      return;
    }
    processedFiles.add(file.path);

    const content = this.fileContents.get(file.path);
    if (!content) {
      result.validation.warnings.push({
        level: 'warning',
        message: `ファイルコンテンツが見つかりません: ${file.path}`,
        path: file.path,
      });
      return;
    }

    try {
      const parsed = parseExtendedSRS(content.content);
      if (!parsed || !parsed.srsData) {
        return;
      }

      // Add document to load list
      documents.push({
        filepath: file.path,
        content: content.content,
      });

      // Store contribution info for compatibility
      result.contributions[file.path] = {
        srsData: parsed.srsData,
        overrides: [],
        partialPaths: parsed.partialPaths || [],
        yamlContent: parsed.yamlContent,
        startLine: parsed.startLine,
        yamlBlocks: parsed.yamlBlocks || [],
        contentSections: parsed.contentSections || [], // Add content sections
      };
    } catch (error) {
      result.validation.warnings.push({
        level: 'warning',
        message: `ファイルの解析に失敗しました ${file.path}: ${error}`,
        path: file.path,
      });
    }
  }
}
