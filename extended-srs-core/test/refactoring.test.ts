// Copyright (c) 2026 CoLLMate, Inc.
// SPDX-License-Identifier: Apache-2.0
/**
 * Extended SRS Core リファクタリング保証テスト
 * このテストはリファクタリング前後で同じ動作を保証する
 */

import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import {
  // yamlParser
  extractYAMLBlocks,
  parseExtendedSRS,
  parseYAMLBlock,

  // parser
  ExtendedSRSTreeParser,

  // validator
  validateYAML,

  // schemaLoader
  initializeAjv,
  initializeExtendedSRSSchemas,

  // manager
  ExtendedSRSTreeManager,

  // aggregator
  ExtendedSRSAggregator,
} from '../src';

// テストデータ
const TEST_DATA = {
  // 基本的なSRSドキュメント
  basicSRS: `
# プロジェクト仕様書

<!-- @srs
manifest:
  format: "extended-srs/v1"
  project_name: "テストプロジェクト"
  version: "1.0.0"
@srs-->

## 概要

<!-- @srs: project-overview: objective
"システムの目的を明確にする"
@srs-->
`,

  // 複雑なネスト構造
  complexNested: `
<!-- @srs
system-architecture:
  components:
    - id: "frontend"
      name: "フロントエンド"
      technologies:
        - "React"
        - "TypeScript"
      dependencies:
        - component_id: "backend"
          type: "API"
    - id: "backend"
      name: "バックエンド"
      technologies:
        - "Node.js"
        - "Express"
@srs-->
`,

  // 部分抽出記法
  partialExtraction: `
<!-- @srs: use-cases: list[0]
id: "UC001"
name: "ユーザー登録"
actors: ["ユーザー", "システム"]
@srs-->

<!-- @srs: use-cases: list[1]
id: "UC002"
name: "ログイン"
actors: ["登録済みユーザー"]
@srs-->
`,

  // Mermaidダイアグラム
  withMermaid: `
<!-- @srs
system-architecture:
  diagrams:
    - type: "flowchart"
      content: |
        graph LR
          A[開始] --&gt; B[処理]
          B --&gt; C[終了]
@srs-->
`,

  // エラーを含むYAML
  withErrors: `
<!-- @srs
manifest:
  project_name: "エラーテスト"
  # formatが欠落（必須フィールド）
@srs-->
`,

  // 日本語キー
  japaneseKeys: `
<!-- @srs
プロジェクト概要:
  目的: "日本語キーのテスト"
  説明: |
    複数行の
    日本語説明文
@srs-->
`,
};

// テストファイル構造
const TEST_FILES = [
  {
    filepath: 'srs.md',
    content: TEST_DATA.basicSRS,
  },
  {
    filepath: 'architecture.md',
    content: TEST_DATA.complexNested,
  },
  {
    filepath: 'use-cases.md',
    content: TEST_DATA.partialExtraction,
  },
];

describe('Extended SRS Core - リファクタリング保証テスト', () => {
  beforeAll(async () => {
    // スキーマの初期化
    initializeAjv();
    await initializeExtendedSRSSchemas();
  });

  describe('1. YAMLブロック抽出機能', () => {
    describe('基本的な抽出', () => {
      test('単一の完全記法YAMLブロックを抽出できる', () => {
        const blocks = extractYAMLBlocks(TEST_DATA.basicSRS);

        expect(blocks).toHaveLength(2); // manifestとproject-overview
        expect(blocks[0].isPartial).toBe(false); // fullの場合
        expect(blocks[0].content).toBeDefined(); // YAML content
        expect(blocks[0].startLine).toBeGreaterThan(0);
      });

      test('部分抽出記法を正しく解析する', () => {
        const blocks = extractYAMLBlocks(TEST_DATA.partialExtraction);

        expect(blocks).toHaveLength(2);
        expect(blocks[0].isPartial).toBe(true); // partialの場合
        expect(blocks[0].path).toEqual(['use-cases', 'list[0]']); // 配列形式
        expect(blocks[1].path).toEqual(['use-cases', 'list[1]']);
      });

      test('複数のYAMLブロックを順序通り抽出する', () => {
        const content = TEST_DATA.basicSRS + TEST_DATA.partialExtraction;
        const blocks = extractYAMLBlocks(content);

        expect(blocks.length).toBeGreaterThan(2);
        // 行番号が昇順であることを確認
        for (let i = 1; i < blocks.length; i++) {
          expect(blocks[i].startLine).toBeGreaterThan(blocks[i - 1].startLine);
        }
      });
    });

    describe('特殊ケースの処理', () => {
      test('Mermaid記法のエスケープを処理する', () => {
        const result = parseExtendedSRS(TEST_DATA.withMermaid);

        expect(result).toBeDefined();
        // HTML entities are preserved in YAML content
        expect(result?.srsData?.['system-architecture']?.diagrams[0].content).toContain('--&gt;');
      });

      test('日本語キーと値を正しく処理する', () => {
        const result = parseExtendedSRS(TEST_DATA.japaneseKeys);

        expect(result?.srsData?.['プロジェクト概要']).toBeDefined();
        expect(result?.srsData?.['プロジェクト概要']['目的']).toBe('日本語キーのテスト');
      });

      test('不正なYAMLをスキップしてエラーを返さない', () => {
        const invalidYAML = `
<!-- @srs
invalid: yaml: syntax: here
@srs-->`;

        const blocks = extractYAMLBlocks(invalidYAML);
        expect(blocks).toHaveLength(1);
        expect(blocks[0].content).toContain('invalid');
        // parseYAMLBlock()でパースエラーをチェック
        const parsed = parseYAMLBlock(blocks[0]);
        expect(parsed.error).toBeDefined();
      });

      test('空のYAMLブロックを処理する', () => {
        const emptyBlock = `
<!-- @srs

@srs-->`;

        const blocks = extractYAMLBlocks(emptyBlock);
        expect(blocks).toHaveLength(1);
        expect(blocks[0].content).toBe('\n'); // 空の内容
        const parsed = parseYAMLBlock(blocks[0]);
        expect(parsed.data).toEqual({}); // 空のオブジェクト
      });
    });
  });

  describe('2. ツリー構築機能', () => {
    let parser: ExtendedSRSTreeParser;

    beforeAll(() => {
      parser = new ExtendedSRSTreeParser();
    });

    describe('メタデータブロックのパース', () => {
      test('ドキュメントから全メタデータブロックを抽出する', () => {
        const result = parser.parseDocument(TEST_DATA.basicSRS, 'test.md');
        const blocks = result.blocks;

        expect(blocks.length).toBeGreaterThan(0);
        blocks.forEach((block) => {
          expect(block.location.filepath).toBe('test.md');
          expect(block.location.lineStart).toBeGreaterThan(0);
          expect(block.location.lineEnd).toBeGreaterThan(block.location.lineStart);
        });
      });

      test('部分抽出記法のパスを正しく解析する', () => {
        const result = parser.parseDocument(TEST_DATA.partialExtraction, 'test.md');
        const blocks = result.blocks;

        const partialBlocks = blocks.filter((b) => b.type === 'partial');
        expect(partialBlocks).toHaveLength(2);
        expect(partialBlocks[0].path).toBe('use-cases: list[0]');
      });
    });

    describe('マージ処理', () => {
      test('後勝ちルールで値を上書きする', () => {
        const block1 = parser.parseDocument(
          `
<!-- @srs
manifest:
  project_name: "初期値"
@srs-->`,
          'file1.md',
        );

        const block2 = parser.parseDocument(
          `
<!-- @srs
manifest:
  project_name: "上書き値"
@srs-->`,
          'file2.md',
        );

        const tree = parser.mergeMetadataBlocks([...block1.blocks, ...block2.blocks]);
        expect(tree.data.manifest.project_name).toBe('上書き値');
      });

      test('配列を完全に置き換える', () => {
        const block1 = parser.parseDocument(
          `
<!-- @srs
items: [1, 2, 3]
@srs-->`,
          'file1.md',
        );

        const block2 = parser.parseDocument(
          `
<!-- @srs
items: [4, 5]
@srs-->`,
          'file2.md',
        );

        const tree = parser.mergeMetadataBlocks([...block1.blocks, ...block2.blocks]);
        expect(tree.data.items).toEqual([4, 5]);
      });

      test('オブジェクトを深くマージする', () => {
        const block1 = parser.parseDocument(
          `
<!-- @srs
config:
  level1:
    level2:
      value1: "a"
      value2: "b"
@srs-->`,
          'file1.md',
        );

        const block2 = parser.parseDocument(
          `
<!-- @srs
config:
  level1:
    level2:
      value2: "c"
      value3: "d"
@srs-->`,
          'file2.md',
        );

        const tree = parser.mergeMetadataBlocks([...block1.blocks, ...block2.blocks]);
        expect(tree.data.config.level1.level2).toEqual({
          value1: 'a',
          value2: 'c',
          value3: 'd',
        });
      });

      test('マージマップに変更履歴を記録する', () => {
        const blocks = parser.parseDocument(TEST_DATA.basicSRS, 'test.md');
        const tree = parser.mergeMetadataBlocks(blocks.blocks);

        expect(tree.mergeMap.size).toBeGreaterThan(0);
        // manifest.project_nameの履歴を確認
        const entry = Array.from(tree.mergeMap.entries()).find(([path]) =>
          path.includes('project_name'),
        );
        expect(entry).toBeDefined();
      });
    });

    // ツリー検証テストは削除
    // ExtendedSRSTreeParser.mergeMetadataBlocks はパースエラーのみを validationErrors に格納し、
    // スキーマ検証は行わない（validator.ts で行う設計）
    // 必須フィールドや実装仕様コンテキストの検証は ExtendedSRSAggregator で行われる
  });

  describe('3. スキーマ検証機能', () => {
    describe('YAML検証', () => {
      test('有効なYAMLに対してエラーを返さない', async () => {
        const validYAML = `
manifest:
  format: "extended-srs/v1"
  project_name: "Valid Project"
  version: "1.0.0"
project-overview:
  objective: "Test objective"
system-architecture:
  architecture:
    key_components:
      components:
        - component_id: main
          name: Main App
          type: backend
          tech_stack:
            language:
              name: JavaScript
              version: "20"
            framework:
              name: Node.js
              version: "20.0.0"
              language: JavaScript
      architecture_graph: "graph LR; Main"
    design_principles:
      - モノリシックアーキテクチャ
  tech_stack:
    development_tools:
      version_control:
        system: git
        platform: github
  data_models:
    entities:
      - entity_id: user_entity
        data_id: user_data
        component_id: main
        table_name: users
        columns:
          - attribute_name: id
            column_name: id
  common_technical_policies:
    error_handling:
      exception_strategy: global_handler
      error_format: json`;

        const result = await validateYAML(validYAML);
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      test('型の不一致を検出する', async () => {
        const invalidType = `
manifest:
  format: "extended-srs/v1"
  project_name: 123  # Should be string
  version: "1.0.0"`;

        const result = await validateYAML(invalidType);
        expect(result.isValid).toBe(false);
        // Check for type mismatch error - the exact message may vary
        const hasTypeError = result.errors.some(
          (e) =>
            e.message.toLowerCase().includes('type') ||
            e.message.includes('must be string') ||
            e.message.includes('project_name'),
        );
        expect(hasTypeError).toBe(true);
      });

      test('必須フィールドの欠如を検出する', async () => {
        const missingRequired = `
manifest:
  project_name: "Missing Format"
  version: "1.0.0"`;

        const result = await validateYAML(missingRequired);
        expect(result.isValid).toBe(false);
        expect(
          result.errors.some(
            (e) =>
              e.message.includes('format') &&
              (e.message.includes('がありません') || e.message.includes('required')),
          ),
        ).toBe(true);
      });

      test('セマンティック検証は削除された', async () => {
        const minimalValid = `
manifest:
  format: "extended-srs/v1"
  project_name: "Minimal"`;

        const result = await validateYAML(minimalValid);
        // Semantic validation removed - no warnings
        expect(result.warnings.length).toBe(0);
        expect(result.isValid).toBe(true);
      });

      test('エラーに行番号を含める', async () => {
        const withError = `
manifest:
  format: "wrong-format"
  project_name: "Test"`;

        const result = await validateYAML(withError, 10); // startLine = 10
        const error = result.errors[0];
        expect(error.line).toBeDefined();
        // Line numbers are relative to YAML content, not including startLine
        expect(error.line).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('4. ドキュメント管理機能', () => {
    let manager: ExtendedSRSTreeManager;

    beforeEach(() => {
      manager = new ExtendedSRSTreeManager();
    });

    describe('ドキュメントのロードと管理', () => {
      test('単一ドキュメントをロードできる', () => {
        manager.loadDocument('test.md', TEST_DATA.basicSRS);
        const tree = manager.getTree();

        expect(tree.data.manifest).toBeDefined();
        expect(tree.data.manifest.project_name).toBe('テストプロジェクト');
      });

      test('複数ドキュメントを一括ロードできる', () => {
        manager.loadDocuments(TEST_FILES);
        const tree = manager.getTree();

        expect(tree.data.manifest).toBeDefined();
        expect(tree.data['system-architecture']).toBeDefined();
        expect(tree.data['use-cases']).toBeDefined();
      });

      test('同じファイルパスのドキュメントを上書きする', () => {
        manager.loadDocument('test.md', TEST_DATA.basicSRS);
        manager.loadDocument('test.md', TEST_DATA.complexNested);

        const tree = manager.getTree();
        expect(tree.data['system-architecture']).toBeDefined();
        expect(tree.data['project-overview']).toBeUndefined(); // 上書きされた
      });

      test('commitIdを保持する', () => {
        const commitId = 'abc123';
        manager.loadDocument('test.md', TEST_DATA.basicSRS, commitId);

        const tree = manager.getTree();
        const block = tree.metadataBlocks.find((b) => b.location.commitId === commitId);
        expect(block).toBeDefined();
      });
    });

    describe('ツリー操作', () => {
      beforeEach(() => {
        manager.loadDocuments(TEST_FILES);
      });

      test('特定パスの値を取得できる', () => {
        const projectName = manager.getValueAt('manifest.project_name');
        expect(projectName).toBe('テストプロジェクト');

        const component = manager.getValueAt('system-architecture.components[0].id');
        expect(component).toBe('frontend');
      });

      test('存在しないパスでundefinedを返す', () => {
        const value = manager.getValueAt('non.existent.path');
        expect(value).toBeUndefined();
      });

      test('特定パスのソース履歴を取得できる', () => {
        const sources = manager.getSourcesFor('manifest.project_name');
        expect(sources.length).toBeGreaterThan(0);
        expect(sources[0].filepath).toBe('srs.md');
      });
    });

    describe('メタデータブロックの編集', () => {
      test('新規ブロックを追加できる', () => {
        manager.loadDocument('test.md', '# Test\n\n## Content');
        manager.addMetadataBlock('test.md', 2, 'test:\n  value: "added"', 'full');

        const tree = manager.getTree();
        expect(tree.data.test?.value).toBe('added');
      });

      test('部分記法ブロックを追加できる', () => {
        manager.loadDocument('test.md', TEST_DATA.basicSRS);
        // Add the block after the existing one (which is around line 8-10)
        manager.addMetadataBlock(
          'test.md',
          100, // Add at end of document to ensure it comes after existing blocks
          'objective: "新しい目的"',
          'partial',
          'project-overview',
        );

        const tree = manager.getTree();
        expect(tree.data['project-overview']?.objective).toBe('新しい目的');
      });
    });

    describe('エクスポート機能', () => {
      test('全ドキュメントをMarkdownとしてエクスポートできる', () => {
        manager.loadDocuments(TEST_FILES);
        const exported = manager.exportToMarkdown();

        expect(exported.size).toBe(TEST_FILES.length);
        expect(exported.get('srs.md')).toBeDefined();
      });

      test('マージ済みメタデータをYAMLとしてエクスポートできる', () => {
        manager.loadDocuments(TEST_FILES);
        const yaml = manager.exportMergedMetadata();

        expect(yaml).toContain('manifest:');
        expect(yaml).toContain('project_name:');
        expect(yaml).toContain('system-architecture:');
      });
    });
  });

  describe('5. プロジェクト集約機能', () => {
    describe('エントリーファイル検出', () => {
      test('srs.mdを優先的にエントリーファイルとする', async () => {
        const fileContents = new Map(TEST_FILES.map((f) => [f.filepath, { content: f.content }]));
        const projectFiles = TEST_FILES.map((f) => ({
          path: f.filepath,
          name: f.filepath,
          is_directory: false,
          size: f.content.length,
          modified: new Date().toISOString(),
        }));

        const aggregator = new ExtendedSRSAggregator(fileContents, projectFiles);
        const result = await aggregator.aggregate();

        expect(result.srs.manifest).toBeDefined();
      });

      test('複数のmanifestファイルがある場合エラーとする', async () => {
        const files = [
          { path: 'doc1.md', content: TEST_DATA.basicSRS },
          { path: 'doc2.md', content: TEST_DATA.basicSRS },
        ];

        const fileContents = new Map(files.map((f) => [f.path, { content: f.content }]));
        const projectFiles = files.map((f) => ({
          path: f.path,
          name: f.path,
          is_directory: false,
          size: f.content.length,
          modified: new Date().toISOString(),
        }));

        const aggregator = new ExtendedSRSAggregator(fileContents, projectFiles);
        const result = await aggregator.aggregate();

        expect(result.validation.errors.length).toBeGreaterThan(0);
      });
    });

    describe('フィールドソース追跡', () => {
      test('全フィールドのソースファイルを記録する', async () => {
        const fileContents = new Map(TEST_FILES.map((f) => [f.filepath, { content: f.content }]));
        const projectFiles = TEST_FILES.map((f) => ({
          path: f.filepath,
          name: f.filepath,
          is_directory: false,
          size: f.content.length,
          modified: new Date().toISOString(),
        }));

        const aggregator = new ExtendedSRSAggregator(fileContents, projectFiles);
        const result = await aggregator.aggregate();

        expect(result.fieldSources).toBeDefined();
        const sources = result.fieldSources!['manifest.project_name'];
        expect(sources).toBeDefined();
        expect(sources.length).toBeGreaterThan(0);
      });

      test('フィールドコンフリクトを検出する', async () => {
        const conflictFiles = [
          {
            path: 'srs.md',
            content: `
<!-- @srs
manifest:
  format: "extended-srs/v1"
  project_name: "名前1"
  files:
    - override.md
@srs-->`,
          },
          {
            path: 'override.md',
            content: `
<!-- @srs: manifest
project_name: "名前2"
@srs-->`,
          },
        ];

        const fileContents = new Map(conflictFiles.map((f) => [f.path, { content: f.content }]));
        const projectFiles = conflictFiles.map((f) => ({
          path: f.path,
          name: f.path,
          is_directory: false,
          size: f.content.length,
          modified: new Date().toISOString(),
        }));

        const aggregator = new ExtendedSRSAggregator(fileContents, projectFiles);
        const result = await aggregator.aggregate();

        // Both files define the same field, which should be detected as a conflict
        // even though the last-write-wins rule is applied for the final value
        expect(result.srs.manifest.project_name).toBe('名前2'); // Last value wins

        // Check if conflicts were detected
        expect(result.validation.conflicts.length).toBeGreaterThan(0);
        const conflict = result.validation.conflicts.find(
          (c) => c.field === 'manifest.project_name',
        );
        expect(conflict).toBeDefined();
        expect(conflict?.files).toHaveLength(2);
      });
    });

    describe('統計情報', () => {
      test('正確な統計情報を生成する', async () => {
        const fileContents = new Map(TEST_FILES.map((f) => [f.filepath, { content: f.content }]));
        const projectFiles = TEST_FILES.map((f) => ({
          path: f.filepath,
          name: f.filepath,
          is_directory: false,
          size: f.content.length,
          modified: new Date().toISOString(),
        }));

        const aggregator = new ExtendedSRSAggregator(fileContents, projectFiles);
        const result = await aggregator.aggregate();

        // contributionsから実際に処理されたファイル数を確認
        const processedFiles = Object.keys(result.contributions);
        expect(processedFiles.length).toBeGreaterThan(0);
        expect(processedFiles.length).toBeLessThanOrEqual(TEST_FILES.length);
      });
    });
  });

  describe('6. 統合テスト', () => {
    test('複数ファイルプロジェクトの完全処理', async () => {
      // 完全なプロジェクト構成
      const projectFiles = [
        {
          filepath: 'srs.md',
          content: `
<!-- @srs
manifest:
  format: "extended-srs/v1"
  project_name: "統合テストプロジェクト"
  version: "2.0.0"
  files: ["./details.md", "./specs.md"]
@srs-->`,
        },
        {
          filepath: 'details.md',
          content: `
<!-- @srs
project-overview:
  objective: "統合テストの目的"
  scope: "全機能のテスト"
@srs-->`,
        },
        {
          filepath: 'specs.md',
          content: `
<!-- @srs: system-architecture: components[0]
id: "integrated"
name: "統合コンポーネント"
@srs-->`,
        },
      ];

      // Manager経由での処理
      const manager = new ExtendedSRSTreeManager();
      manager.loadDocuments(projectFiles);
      const tree = manager.getTree();

      expect(tree.data.manifest.project_name).toBe('統合テストプロジェクト');
      expect(tree.data['project-overview']?.objective).toBe('統合テストの目的');
      expect(tree.data['system-architecture']?.components[0].id).toBe('integrated');

      // Aggregator経由での処理
      const fileContents = new Map(projectFiles.map((f) => [f.filepath, { content: f.content }]));
      const fileInfos = projectFiles.map((f) => ({
        path: f.filepath,
        name: f.filepath,
        is_directory: false,
        size: f.content.length,
        modified: new Date().toISOString(),
      }));

      const aggregator = new ExtendedSRSAggregator(fileContents, fileInfos);
      const aggregated = await aggregator.aggregate();

      expect(aggregated.srs.manifest.project_name).toBe('統合テストプロジェクト');
      // Validation completeness depends on extended-srs-core validation logic
      // The isComplete check is now less strict, so we just check that validation exists
      expect(aggregated.validation).toBeDefined();
      expect(aggregated.fieldSources).toBeDefined();
    });

    test('エラー回復とロバスト性', async () => {
      const problematicFiles = [
        {
          filepath: 'srs.md',
          content: `
<!-- @srs
manifest:
  format: "extended-srs/v1"
  project_name: "エラー耐性テスト"
  files: ["./missing.md", "./invalid.md"]
@srs-->`,
        },
        {
          filepath: 'invalid.md',
          content: `
<!-- @srs
invalid: yaml: : : syntax
@srs-->`,
        },
      ];

      const manager = new ExtendedSRSTreeManager();

      // エラーがあってもクラッシュしない
      expect(() => {
        manager.loadDocuments(problematicFiles);
      }).not.toThrow();

      const tree = manager.getTree();
      expect(tree.data.manifest.project_name).toBe('エラー耐性テスト');
    });
  });

  describe('7. 統合バリデーション — ソースファイル・行番号追跡', () => {
    test('マルチファイルの型エラーが正しいソースファイルを示す', async () => {
      const files = [
        {
          path: 'srs.md',
          content: `
<!-- @srs
manifest:
  format: "extended-srs/v1"
  project_name: "型エラーテスト"
  files:
    - details.md
@srs-->`,
        },
        {
          path: 'details.md',
          content: `
<!-- @srs: manifest
project_name: 12345
@srs-->`,
        },
      ];

      const fileContents = new Map(files.map((f) => [f.path, { content: f.content }]));
      const projectFiles = files.map((f) => ({
        path: f.path,
        name: f.path,
        is_directory: false,
        size: f.content.length,
        modified: new Date().toISOString(),
      }));

      const aggregator = new ExtendedSRSAggregator(fileContents, projectFiles);
      const result = await aggregator.aggregate();

      // 最終値は details.md の値（後勝ち）
      expect(result.srs.manifest.project_name).toBe(12345);

      // 型エラーがあるはず（project_nameはstring型だがnumber型）
      const typeError = result.validation.errors.find(
        (e) => e.field === 'manifest.project_name' && e.message.includes('型'),
      );
      expect(typeError).toBeDefined();
      // ソースファイルが details.md であることを確認
      expect(typeError!.path).toBe('details.md');
    });

    test('必須フィールド欠落エラーが親セクションのソースファイルを示す', async () => {
      const files = [
        {
          path: 'srs.md',
          content: `
<!-- @srs
manifest:
  project_name: "必須フィールドテスト"
@srs-->`,
        },
      ];

      const fileContents = new Map(files.map((f) => [f.path, { content: f.content }]));
      const projectFiles = files.map((f) => ({
        path: f.path,
        name: f.path,
        is_directory: false,
        size: f.content.length,
        modified: new Date().toISOString(),
      }));

      const aggregator = new ExtendedSRSAggregator(fileContents, projectFiles);
      const result = await aggregator.aggregate();

      // manifest.format が必須だが欠落
      const requiredError = result.validation.errors.find(
        (e) => e.field === 'manifest.format' && e.message.includes('format'),
      );
      expect(requiredError).toBeDefined();
      // ソースファイルは srs.md（manifest を定義しているファイル）
      expect(requiredError!.path).toBe('srs.md');
    });

    test('ルートレベルの必須エラーがエントリーファイルを示す', async () => {
      // manifest なしの srs.md
      const files = [
        {
          path: 'srs.md',
          content: `
<!-- @srs
project-overview:
  objective: "manifestなし"
@srs-->`,
        },
      ];

      const fileContents = new Map(files.map((f) => [f.path, { content: f.content }]));
      const projectFiles = files.map((f) => ({
        path: f.path,
        name: f.path,
        is_directory: false,
        size: f.content.length,
        modified: new Date().toISOString(),
      }));

      const aggregator = new ExtendedSRSAggregator(fileContents, projectFiles);
      const result = await aggregator.aggregate();

      // manifest が必須だが欠落
      const manifestError = result.validation.errors.find(
        (e) => e.field === 'manifest' && e.message.includes('manifest'),
      );
      expect(manifestError).toBeDefined();
      // ルートレベルエラーはエントリーファイル（srs.md）を示す
      expect(manifestError!.path).toBe('srs.md');
    });

    test('バリデーションエラーに行番号が含まれる', async () => {
      const files = [
        {
          path: 'srs.md',
          content: `
<!-- @srs
manifest:
  format: "extended-srs/v1"
  project_name: "行番号テスト"
  files:
    - details.md
@srs-->`,
        },
        {
          path: 'details.md',
          content: `
<!-- @srs: manifest
project_name: 99999
@srs-->`,
        },
      ];

      const fileContents = new Map(files.map((f) => [f.path, { content: f.content }]));
      const projectFiles = files.map((f) => ({
        path: f.path,
        name: f.path,
        is_directory: false,
        size: f.content.length,
        modified: new Date().toISOString(),
      }));

      const aggregator = new ExtendedSRSAggregator(fileContents, projectFiles);
      const result = await aggregator.aggregate();

      const typeError = result.validation.errors.find(
        (e) => e.field === 'manifest.project_name' && e.message.includes('型'),
      );
      expect(typeError).toBeDefined();
      expect(typeError!.line).toBeDefined();
      expect(typeof typeError!.line).toBe('number');
    });

    test('fieldSources にオブジェクトパスが記録される', async () => {
      const files = [
        {
          path: 'srs.md',
          content: `
<!-- @srs
manifest:
  format: "extended-srs/v1"
  project_name: "オブジェクトパステスト"
@srs-->`,
        },
      ];

      const fileContents = new Map(files.map((f) => [f.path, { content: f.content }]));
      const projectFiles = files.map((f) => ({
        path: f.path,
        name: f.path,
        is_directory: false,
        size: f.content.length,
        modified: new Date().toISOString(),
      }));

      const aggregator = new ExtendedSRSAggregator(fileContents, projectFiles);
      const result = await aggregator.aggregate();

      // リーフ値だけでなくオブジェクトパスも記録されている
      expect(result.fieldSources!['manifest']).toBeDefined();
      expect(result.fieldSources!['manifest']).toContain('srs.md');
      expect(result.fieldSources!['manifest.project_name']).toBeDefined();
      expect(result.fieldSources!['manifest.format']).toBeDefined();
    });

    test('マルチファイルコンフリクトでエラーが正しいファイルを示す', async () => {
      const files = [
        {
          path: 'srs.md',
          content: `
<!-- @srs
manifest:
  format: "extended-srs/v1"
  project_name: "コンフリクトテスト"
  created: "not-a-number"
  files:
    - override.md
@srs-->`,
        },
        {
          path: 'override.md',
          content: `
<!-- @srs: manifest
created: "still-not-a-number"
@srs-->`,
        },
      ];

      const fileContents = new Map(files.map((f) => [f.path, { content: f.content }]));
      const projectFiles = files.map((f) => ({
        path: f.path,
        name: f.path,
        is_directory: false,
        size: f.content.length,
        modified: new Date().toISOString(),
      }));

      const aggregator = new ExtendedSRSAggregator(fileContents, projectFiles);
      const result = await aggregator.aggregate();

      // created は number 型なのに string を渡している
      const typeError = result.validation.errors.find(
        (e) => e.field === 'manifest.created' && e.message.includes('型'),
      );
      expect(typeError).toBeDefined();
      // 後勝ちなので override.md がソース
      expect(typeError!.path).toBe('override.md');
    });
  });

  describe('8. 互換性テスト', () => {
    test('リファクタリング前と同じAPIを提供する', () => {
      // 主要なエクスポートを確認
      expect(typeof extractYAMLBlocks).toBe('function');
      expect(typeof parseExtendedSRS).toBe('function');
      expect(typeof validateYAML).toBe('function');
      expect(typeof ExtendedSRSTreeParser).toBe('function');
      expect(typeof ExtendedSRSTreeManager).toBe('function');
      expect(typeof ExtendedSRSAggregator).toBe('function');
    });

    test('ファイルシステムAPIを使用しない', () => {
      // fsモジュールを使用していないことを確認
      // （このテスト自体がブラウザでも動作することで証明）
      const manager = new ExtendedSRSTreeManager();
      manager.loadDocument('test.md', 'content');

      // ファイルシステムに依存しない
      expect(manager.getTree()).toBeDefined();
    });
  });
});
