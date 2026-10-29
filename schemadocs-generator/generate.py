#!/usr/bin/env python3
# Copyright (c) 2026 CoLLMate, Inc.
# SPDX-License-Identifier: Apache-2.0
"""
JSON Schemaから拡張SRS関連成果物を生成
- 仕様書（extended-srs-spec.md）
- 使用ガイドライン（usage-guides/*.md）

スキーマ内の情報のみを使用して自動生成
"""

import json
from pathlib import Path
from typing import Dict, List

class ExtendedSRSGenerator:
    def __init__(self, schema_path: str):
        self.schema_path = Path(schema_path)
        self.schema_dir = self.schema_path.parent
        
        with open(schema_path, 'r', encoding='utf-8') as f:
            self.schema = json.load(f)
        self.schema_files = {self.schema.get('$id'): self.schema_path}
        self.external_schemas = {}
        self.definitions = self._load_definitions()
    
    def _load_definitions(self) -> Dict:
        """スキーマファイルから定義を読み込み"""
        definitions = {}
        
        # メインスキーマのpropertiesから参照されているスキーマを読み込み
        for prop_key, prop_value in self.schema.get('properties', {}).items():
            if '$ref' in prop_value:
                ref_path = prop_value['$ref']
                # 相対パスを解決
                schema_file_path = self.schema_dir / ref_path
                
                try:
                    with open(schema_file_path, 'r', encoding='utf-8') as f:
                        ref_schema = json.load(f)
                        self.schema_files[ref_schema.get('$id')] = schema_file_path
                        # ファイル名から定義名を生成
                        def_name = schema_file_path.stem.replace('-schema', '')
                        definitions[def_name] = ref_schema
                except FileNotFoundError:
                    print(f"警告: 参照スキーマファイルが見つかりません: {schema_file_path}")
        
        return definitions
    
    def generate(self) -> str:
        """仕様書全体を生成（テンプレートベース）"""
        # テンプレート設定を取得
        template_config = self.schema.get('x-spec-template', {})
        contents = template_config.get('contents', [])
        
        # テンプレート変数を準備
        template_vars = {
            'top_level_yaml': self._generate_top_level(),
            'sections': self._generate_all_sections()
        }
        
        # テンプレートを展開
        output = []
        for line in contents:
            expanded_line = line.format(**template_vars)
            output.append(expanded_line)
        
        return '\n'.join(output)
    
    def generate_usage_guide_for_schema(self, schema_key: str, definition: Dict) -> str:
        """特定のスキーマのガイドラインを生成"""
        if not definition or 'x-docs' not in definition:
            return ""
        
        # スキーマのタイトルを使用してガイドラインタイトルを生成
        schema_title = definition.get('title', schema_key)
        guide_title = (f"# 拡張SRS {schema_title}活用ガイド\n\n"
                       "本ガイドの AI 活用・自動化は、利用側のエージェントや実行環境で行う設計・運用例を含む。"
                       "公式実装の提供範囲は [core](../../extended-srs-core/README.md) と "
                       "[MCP サーバー](../../mcp-server/README.md) を参照する。\n\n")
        
        guide_content = self._generate_usage_guide_section(schema_key, definition, depth_level=0,
                                                           section_order=[
                                                               "definition",
                                                               "yaml",
                                                               "components",
                                                               "process", 
                                                               "best_practices", 
                                                               "ai_collaboration", 
                                                               "examples"
                                                           ])
        
        return guide_title + guide_content if guide_content else ""
    
    def generate_all_usage_guides(self) -> Dict[str, str]:
        """全スキーマのガイドラインを個別に生成"""
        guides = {}
        
        for prop_key, prop_value in self.schema.get('properties', {}).items():
            if '$ref' in prop_value:
                def_key = prop_key.replace('-', '_').replace('_', '-')
                definition = self.definitions.get(def_key, {})
                
                if not definition:
                    # フォールバックで他のキー形式も試す
                    alt_keys = [
                        prop_key.replace('-', '_'),
                        prop_key.replace('_', '-'),
                        prop_key.replace('-schema', ''),
                        prop_key.replace('_schema', '')
                    ]
                    for alt_key in alt_keys:
                        definition = self.definitions.get(alt_key, {})
                        if definition:
                            break
                
                # x-docsがあれば個別ガイドを生成
                if definition and 'x-docs' in definition:
                    guide_content = self.generate_usage_guide_for_schema(prop_key, definition)
                    if guide_content:
                        guides[prop_key] = guide_content
        
        return guides
    
    def _generate_all_sections(self) -> str:
        """全セクションを生成"""
        sections = []
        
        # 各セクション
        section_counter = 1
        for prop_key, prop_value in self.schema.get('properties', {}).items():
            if '$ref' in prop_value:
                def_key = prop_key.replace('-', '_').replace('_', '-')  # キー名の正規化
                definition = self.definitions.get(def_key, {})
                if definition:
                    sections.append(self._generate_section(prop_key, definition, section_counter))
                else:
                    # フォールバックとして他のキー形式も試す
                    alt_keys = [
                        prop_key.replace('-', '_'),
                        prop_key.replace('_', '-'),
                        prop_key.replace('-schema', ''),
                        prop_key.replace('_schema', '')
                    ]
                    for alt_key in alt_keys:
                        definition = self.definitions.get(alt_key, {})
                        if definition:
                            sections.append(self._generate_section(prop_key, definition, section_counter))
                            break
            section_counter += 1
        
        return '\n'.join(sections)
    
    def _generate_top_level(self) -> str:
        """トップレベルYAML構造"""
        lines = ["@srs:"]
        required = self.schema.get('required', [])
        
        for key, prop in self.schema.get('properties', {}).items():
            # 参照されているスキーマから情報を取得
            def_key = key.replace('-', '_').replace('_', '-')
            definition = self.definitions.get(def_key, {})
            
            # フォールバックで他のキー形式も試す
            if not definition:
                alt_keys = [
                    key.replace('-', '_'),
                    key.replace('_', '-'),
                    key.replace('-schema', ''),
                    key.replace('_schema', '')
                ]
                for alt_key in alt_keys:
                    definition = self.definitions.get(alt_key, {})
                    if definition:
                        break
            
            title = definition.get('title', key)
            desc = definition.get('description', '')
            
            # requiredマークの処理
            mark = ""
            if key in required:
                mark = "✅ "  # デフォルトの必須マーク
            
            comment = f"# {mark}{title}"
            if desc and desc != title:
                comment += f"： {desc}"
            
            padding = ' ' * max(1, 35 - len(key) - 2)
            lines.append(f"  {key}:{padding}{comment}")
        
        return '\n'.join(lines)
    
    def _generate_section(self, key: str, definition: Dict, section_counter: int) -> str:
        """個別セクション生成"""
        lines = []
        
        # セクション番号とタイトル
        section_num = f"IV.{section_counter}"
        title = definition.get('title', key)
        lines.append(f"\n### {section_num}. {title}: @srs: {key}\n")
        
        # x-docsセクションからガイドライン情報を追加
        if 'x-docs' in definition:
            lines.append('')
            guide_content = self._generate_usage_guide_section(key, 
                                                               definition, 
                                                               depth_level=2,
                                                               section_order=[
                                                                    "definition",
                                                                    "yaml",
                                                                    #"components",
                                                                    #"process", 
                                                                    #"best_practices", 
                                                                    #"ai_collaboration", 
                                                                    #"examples"
                                                                ])
            if guide_content:
                lines.append(guide_content)
        
        return '\n'.join(lines)
    
    def _generate_yaml_structure(self, key: str, schema: Dict, level: int) -> str:
        """YAML構造を再帰的に生成（改良版）"""
        lines = []
        indent = "  " * level
        
        # スキーマの型に応じた処理
        if schema.get('type') == 'array':
            # 配列の場合
            title = schema.get('title', '')
            desc = schema.get('description', '')
            comment = f"  # {title}：{desc}" if title else ""
            lines.append(f"{indent}{key}:{comment}")
            
            items = schema.get('items', {})
            if '$ref' in items:
                # 配列内の参照を解決
                resolved_items = self._resolve_ref(items, schema)
                if resolved_items:
                    if resolved_items.get('type') == 'object':
                        # オブジェクト型の場合、プロパティを展開
                        title = resolved_items.get('title', '')
                        properties = resolved_items.get('properties', {})
                        required = resolved_items.get('required', [])
                        
                        # 常に - # 形式で開始（構造の正確性を保つため）
                        lines.append(f"{indent}  - # {title}" if title else f"{indent}  - # ")
                        
                        for prop_key, prop_value in properties.items():
                            is_required = prop_key in required
                            prop_lines = self._format_property(prop_key, prop_value, level + 2, is_required, resolved_items)
                            lines.extend(prop_lines)
                    else:
                        # プリミティブ型の場合
                        type_str = self._get_type_string(resolved_items)
                        lines.append(f"{indent}  - {type_str}  # {resolved_items.get('description', '')}")
                else:
                    lines.append(f"{indent}  - # {items.get('description', '')}")
            elif items.get('type') == 'string':
                lines.append(f"{indent}  - \"string\"  # {items.get('description', '')}")
            elif items.get('type') == 'object':
                # 直接定義されたオブジェクト型またはすでに解決済みのオブジェクト型
                title = items.get('title', '')
                properties = items.get('properties', {})
                required = items.get('required', [])
                
                # 常に - # 形式で開始（構造の正確性を保つため）
                lines.append(f"{indent}  - # {title}" if title else f"{indent}  - # ")
                
                for prop_key, prop_value in properties.items():
                    is_required = prop_key in required
                    prop_lines = self._format_property(prop_key, prop_value, level + 2, is_required, items)
                    lines.extend(prop_lines)
            else:
                lines.append(f"{indent}  - # {items.get('description', '')}")
        else:
            # オブジェクトの場合
            title = schema.get('title', '')
            desc = schema.get('description', '')
            comment = f"  # {title}：{desc}" if title else ""
            lines.append(f"{indent}{key}:{comment}")
            
            # プロパティ展開
            properties = schema.get('properties', {})
            required = schema.get('required', [])
            
            for prop_key, prop_value in properties.items():
                is_required = prop_key in required
                prop_lines = self._format_property(prop_key, prop_value, level + 1, is_required, schema)
                lines.extend(prop_lines)
        
        return '\n'.join(lines)
    
    def _format_property(self, key: str, prop: Dict, level: int, is_required: bool, parent_schema: Dict = None) -> List[str]:
        """プロパティのフォーマット（改良版）"""
        if '$ref' in prop:
            resolved = self._resolve_ref(prop, parent_schema)
            prop = {**resolved, **{k: v for k, v in prop.items() if k != '$ref'}}
        lines = []
        indent = "  " * level
        
        # タイトルとマーク
        title = prop.get('title', '')
        desc = prop.get('description', '')
        mark = '✅' if is_required else ''
        
        comment = ""
        if title:
            comment = f"  # {mark} {title}" if mark else f"  # {title}"
            if desc and desc != title:
                comment += f"：{desc}"
        elif mark or desc:
            comment = "  # " + ' '.join(part for part in (mark, desc) if part)
        
        # 型に応じた処理
        if prop.get('type') == 'array':
            lines.append(f"{indent}{key}:{comment}")
            items = prop.get('items', {})
            
            if '$ref' in items:
                # 配列アイテムの参照を解決
                resolved_items = self._resolve_ref(items, parent_schema)
                if resolved_items:
                    if resolved_items.get('type') == 'object':
                        # オブジェクト型の場合、プロパティを展開
                        title = resolved_items.get('title', '')
                        properties = resolved_items.get('properties', {})
                        required = resolved_items.get('required', [])
                        
                        # 常に - # 形式で開始（構造の正確性を保つため）
                        lines.append(f"{indent}  - # {title}" if title else f"{indent}  - # ")
                        
                        for sub_key, sub_value in properties.items():
                            sub_required = sub_key in required
                            prop_lines = self._format_property(sub_key, sub_value, level + 2, sub_required, resolved_items)
                            lines.extend(prop_lines)
                    else:
                        # プリミティブ型の場合
                        type_str = self._get_type_string(resolved_items)
                        lines.append(f"{indent}  - {type_str}  # {resolved_items.get('description', '')}")
                else:
                    lines.append(f"{indent}  - # {items.get('description', '')}")
            elif items.get('type') == 'string':
                lines.append(f"{indent}  - \"string\"  # {items.get('description', '')}")
            elif items.get('type') == 'object':
                # 直接定義されたオブジェクト型またはすでに解決済みのオブジェクト型
                title = items.get('title', '')
                properties = items.get('properties', {})
                required = items.get('required', [])
                
                # 常に - # 形式で開始（構造の正確性を保つため）
                lines.append(f"{indent}  - # {title}" if title else f"{indent}  - # ")
                
                for prop_key, prop_value in properties.items():
                    is_required = prop_key in required
                    prop_lines = self._format_property(prop_key, prop_value, level + 2, is_required, items)
                    lines.extend(prop_lines)
            else:
                lines.append(f"{indent}  - {self._get_type_string(items)}  # {items.get('description', '')}")
        
        elif prop.get('type') == 'object':
            lines.append(f"{indent}{key}:{comment}")
            # ネストされたプロパティ
            for sub_key, sub_value in prop.get('properties', {}).items():
                sub_required = sub_key in prop.get('required', [])
                sub_lines = self._format_property(sub_key, sub_value, level + 1, sub_required, prop)
                lines.extend(sub_lines)
        
        else:
            # プリミティブ型
            type_str = self._get_type_string(prop)
            lines.append(f"{indent}{key}: {type_str}{comment}")
        
        return lines
    
    def _resolve_ref(self, ref_prop: Dict, parent_schema: Dict = None) -> Dict:
        """$ref参照を再帰的に解決"""
        resolved, document = self._reference_target(ref_prop.get('$ref', ''), parent_schema)
        return self._deep_copy_and_resolve_refs(resolved, document, set())

    def _reference_target(self, ref: str, parent_schema: Dict = None):
        """参照元ファイルを基準に、ローカルファイルと JSON Pointer を解決する。"""
        filename, _, fragment = ref.partition('#')
        document = parent_schema or {}
        if filename:
            parent_path = self.schema_files.get(document.get('$id'), self.schema_path)
            target = (parent_path.parent / filename).resolve()
            if target not in self.external_schemas:
                with target.open(encoding='utf-8') as source:
                    self.external_schemas[target] = json.load(source)
            document = self.external_schemas[target]
            self.schema_files[document.get('$id')] = target
        node = document
        for part in fragment.lstrip('/').split('/') if fragment else []:
            node = node.get(part.replace('~1', '/').replace('~0', '~'), {})
        return node, document
    
    def _deep_copy_and_resolve_refs(self, schema: Dict, parent_schema: Dict, visited_refs: set) -> Dict:
        """スキーマを深くコピーし、内部の$ref参照も再帰的に解決"""
        if not isinstance(schema, dict):
            return schema
        
        result = {}
        for key, value in schema.items():
            if key == '$ref' and isinstance(value, str):
                # The standard recursive meta-schema describes user-defined types,
                # not additional SRS fields to enumerate in the generated guide.
                if value == 'http://json-schema.org/draft-07/schema#':
                    result[key] = value
                    continue
                resolved, document = self._reference_target(value, parent_schema)
                ref_key = (document.get('$id'), value.partition('#')[2])
                # 循環参照チェック
                if ref_key in visited_refs:
                    # 循環参照の場合は、基本的な型情報のみ返す
                    return {'type': 'object', 'title': '循環参照', 'description': f'参照: {value}'}
                
                result.update(self._deep_copy_and_resolve_refs(
                    resolved, document, visited_refs | {ref_key}))
            elif isinstance(value, dict):
                result[key] = self._deep_copy_and_resolve_refs(value, parent_schema, visited_refs.copy())
            elif isinstance(value, list):
                result[key] = [
                    self._deep_copy_and_resolve_refs(item, parent_schema, visited_refs.copy()) 
                    if isinstance(item, dict) else item 
                    for item in value
                ]
            else:
                result[key] = value
        
        return result
    
    def _get_type_string(self, prop: Dict) -> str:
        """型文字列の取得"""
        if isinstance(prop.get('type'), list):
            return ' | '.join(self._get_type_string({'type': item}) for item in prop['type'])
        if 'oneOf' in prop or 'anyOf' in prop:
            variants = prop.get('oneOf', prop.get('anyOf', []))
            return ' | '.join(dict.fromkeys(self._get_type_string(item) for item in variants))
        if 'enum' in prop:
            return '/'.join(f'"{v}"' for v in prop['enum'])
        if 'const' in prop:
            return f'"{prop["const"]}"'
        
        type_map = {
            'string': '"string"',
            'number': 'number',
            'integer': 'number',
            'boolean': 'boolean',
            'object': 'object',
            'array': 'array'
        }
        return type_map.get(prop.get('type', 'any'), '"any"')
    
    def _generate_usage_guide_section(self, key: str, definition: Dict, depth_level: int = 0, section_order: List[str] = None) -> str:
        """個別ガイドラインセクション生成"""
        docs_config = definition.get('x-docs', {})
        
        if not docs_config and 'yaml' not in (section_order or []):
            return ""
        
        # デフォルトのセクション順序
        if section_order is None:
            section_order = ['definition', 'components', 'process', 'best_practices', 'ai_collaboration', 'examples']
        
        # ガイドライン用のテンプレート変数（将来拡張可能）
        template_vars = {
            'section_key': key,
            'section_title': definition.get('title', key),
            'section_description': definition.get('description', '')
        }
        
        output = []
        
        for section_name in section_order:
            if section_name == 'yaml':
                # 特別なYAMLセクションの処理
                depth_prefix = '#' * depth_level
                output.append(f"{depth_prefix}## YAML構造")
                output.append("")
                output.append("以下は型と構造を示す擬似表記。`✅` は必須項目、`/`・`|` は選択肢を示す。"
                              "文書に貼り付ける際は具体的な値と `<!--@srs … @srs-->` の記法を使用する。"
                              "省略した制約や拡張条件は JSON Schema を参照する。")
                output.append("")
                output.append("```text")
                output.append("@srs:")
                yaml_content = self._generate_yaml_structure(key, definition, 1)
                output.append(yaml_content)
                output.append("```")
                output.append("")  # セクション間に空行を追加
            elif section_name in docs_config:
                section_contents = docs_config[section_name]
                if section_contents:
                    # テンプレートを展開
                    for line in section_contents:
                        try:
                            expanded_line = line.format(**template_vars)
                            
                            # 見出し行（#で始まる）の場合、depth_levelに応じて#を追加
                            if expanded_line.strip().startswith('#'):
                                # 元の#の数を保持したまま、depth_level分を先頭に追加
                                depth_prefix = '#' * depth_level
                                expanded_line = depth_prefix + expanded_line
                            
                            output.append(expanded_line)
                        except (KeyError, ValueError):
                            # プレースホルダーが見つからない場合やフォーマットエラーの場合はそのまま追加
                            processed_line = line
                            # 見出し行の場合は同様に処理
                            if processed_line.strip().startswith('#'):
                                depth_prefix = '#' * depth_level
                                processed_line = depth_prefix + processed_line
                            output.append(processed_line)
                    output.append("")  # セクション間に空行を追加
        
        return '\n'.join(output)


APACHE_HEADER = ("<!-- Copyright (c) 2026 CoLLMate, Inc. -->\n<!-- SPDX-License-Identifier: Apache-2.0 -->\n"
                 "<!-- Generated from schema/ by schemadocs-generator/generate.py. Do not edit; change the schema and regenerate. -->\n\n")


def specification_document(content: str) -> str:
    return APACHE_HEADER + '\n'.join(line.rstrip() for line in content.splitlines()) + '\n'


def typescript_specification(spec: str) -> str:
    escaped = spec.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")
    return ("// Copyright (c) 2026 CoLLMate, Inc.\n"
            "// SPDX-License-Identifier: Apache-2.0\n"
            "// Generated by schemadocs-generator/generate.py.\n"
            f"export const EXTENDED_SRS_SPECIFICATION = `{escaped}`;\n\n"
            "export function getExtendedSRSSpecification(): string {\n"
            "  return EXTENDED_SRS_SPECIFICATION;\n}\n")


def main() -> int:
    import argparse
    repository = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--schema', type=Path, default=repository / 'schema/extended-srs-schema.json')
    parser.add_argument('--docs-dir', type=Path, default=repository / 'schema-docs')
    parser.add_argument('--check', action='store_true', help='Check generated files without writing')
    parser.add_argument('--typescript-spec', type=Path, help='Also write/check an embedded specification for a consumer')
    args = parser.parse_args()
    generator = ExtendedSRSGenerator(str(args.schema.resolve()))
    spec = specification_document(generator.generate())
    outputs = {args.docs_dir / 'extended-srs-spec.md': spec}
    for key, content in generator.generate_all_usage_guides().items():
        outputs[args.docs_dir / 'usage-guides' / f"{key.replace('_', '-')}-usage-guide.md"] = specification_document(content)
    if args.typescript_spec:
        outputs[args.typescript_spec] = typescript_specification(spec)
    mismatches = []
    for path, content in outputs.items():
        if args.check:
            if not path.is_file() or path.read_text(encoding='utf-8') != content:
                mismatches.append(str(path))
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding='utf-8')
    if mismatches:
        print('Generated files differ:\n' + '\n'.join(mismatches))
        return 1
    print(f"{'Checked' if args.check else 'Generated'} {len(outputs)} files")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
