<!-- Copyright (c) 2026 CoLLMate, Inc. -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Generated from schema/ by schemadocs-generator/generate.py. Do not edit; change the schema and regenerate. -->

# 拡張SRS ドメインモデル（DDD）活用ガイド

本ガイドの AI 活用・自動化は、利用側のエージェントや実行環境で行う設計・運用例を含む。公式実装の提供範囲は [core](../../extended-srs-core/README.md) と [MCP サーバー](../../mcp-server/README.md) を参照する。

## 1. ドメインモデルとは
### 1.1 定義と目的
ドメインモデルは、ビジネスドメイン全体の概念、ルール、プロセスを構造化して表現したものである。システム化の有無に関わらず、事業やユーザー利用環境の全体像を捉えることを目的とする。
### 1.2 ユースケースとの違い
| 観点 | ドメインモデル | ユースケース |
|------|--------------|-------------|
| **対象範囲** | ビジネス全体（システム化しない部分も含む） | システム化する部分のみ |
| **視点** | ビジネス概念とルールの構造化 | アクターとシステムの相互作用 |
| **抽象度** | 高い（概念レベル） | 具体的（機能レベル） |
| **変更頻度** | 低い（ビジネスの本質は安定） | 中程度（要求により変化） |
### 1.3 DDD（ドメイン駆動設計）との関係
拡張SRSのドメインモデルは、Eric EvansのDDD概念を直接サポートする：
- 境界づけられたコンテキスト（Bounded Context）
- 集約（Aggregate）
- エンティティ（Entity）
- 値オブジェクト（Value Object）
- ドメインイベント（Domain Event）
- ユビキタス言語（Ubiquitous Language）

## YAML構造

以下は型と構造を示す擬似表記。`✅` は必須項目、`/`・`|` は選択肢を示す。文書に貼り付ける際は具体的な値と `<!--@srs … @srs-->` の記法を使用する。省略した制約や拡張条件は JSON Schema を参照する。

```text
@srs:
  domain-model:  # ドメインモデル（DDD）：ビジネスドメインの概念モデル
    bounded_contexts:  # 境界づけられたコンテキスト：ドメインの論理的境界
      - #
        context_id: "string"  # ✅ コンテキストID：コンテキストの一意識別子
        name: "string"  # ✅ コンテキスト名：ビジネス上の名称
        description: "string"  # 説明：コンテキストの役割と責務
        aggregates:  # 集約：コンテキスト内の集約リスト
          - #
            aggregate_id: "string"  # 集約ID：集約の一意識別子
            name: "string"  # ✅ 集約名：ビジネス用語での名称
            description: "string"  # 説明：集約の役割と責務
            root_entity: "string"  # ✅ ルートエンティティ：集約の起点となるエンティティ名
            entities:  # ✅ エンティティ：集約内のエンティティ定義
              - #
                name: "string"  # ✅ エンティティ名：エンティティの識別名
                attributes:  # ✅ 属性：エンティティの属性リスト（詳細形式のみ）
                  - #
                    name: "string"  # ✅ 属性名：属性の識別名
                    type: "string"  # ✅ 型：データ型の定義
                    required: boolean  # 必須フラグ：true/false
                    description: "string"  # 説明：属性の意味
                    constraints:  # 制約：属性に対する制約条件
                      - "string"  # 制約条件の記述
                behaviors:  # 振る舞い：エンティティのメソッド
                  - "string"  # メソッドシグネチャ
                constraints:  # 制約：エンティティレベルの制約
                  - "string"  # 制約条件の記述
            value_objects:  # 値オブジェクト：集約内の値オブジェクト定義
              - #
                name: "string"  # ✅ 値オブジェクト名：識別名
                type: "identifier"/"measurement"/"description"/"range"/"specification"/"composite"  # 種類：identifier/measurement/description/range/specification/composite
                attributes:  # ✅ 構成要素：値オブジェクトの属性（詳細形式のみ）
                  - #
                    name: "string"  # ✅ 属性名
                    type: "string"  # ✅ 型
                    validation: "string"  # 検証ルール
                validation_rules:  # 検証ルール：値の妥当性検証
                  - "string"  # 検証ルールの記述
                behaviors:  # 振る舞い：値オブジェクトのメソッド
                  - "string"  # メソッドシグネチャ
                equality: "string"  # 等価性：等価判定の定義
            invariants:  # 不変条件：ビジネス不変条件
              - #
                inv_id: "string"  # 不変条件ID：識別子
                name: "string"  # 不変条件名：条件の名称
                description: "string"  # ✅ 説明：条件の詳細説明
                rule: "string"  # ✅ ルール：条件の形式的表現
                error_message: "string"  # エラーメッセージ：違反時の表示
                severity: "error"/"warning"  # 深刻度：error/warning
            domain_events:  # ドメインイベント：発生するイベント定義
              - #
                event_id: "string"  # イベントID：識別子
                name: "string"  # ✅ イベント名：過去形で記述
                description: "string"  # 説明：イベントの発生条件
                payload:  # ✅ ペイロード：イベントデータ（詳細形式のみ）
                  - #
                    name: "string"  # ✅ データ項目名
                    type: "string"  # ✅ データ型
                    description: "string"  # 説明
                    required: boolean  # 必須フラグ
                triggers:  # トリガー：発生条件
                  - "string"  # 発生条件の記述
                subscribers:  # 購読者：想定される購読サービス
                  - "string"  # サービス名
            repository_interface:
              repo_id: "string"  # リポジトリID：識別子
              name: "string"  # リポジトリ名：インターフェース名
              description: "string"  # 説明：リポジトリの役割
              aggregate: "string"  # 対象集約：管理する集約名
              methods:  # メソッド：リポジトリメソッド定義
                - #
                  name: "string"  # ✅ メソッド名：メソッドの識別名
                  description: "string"  # 説明：メソッドの機能
                  params:  # パラメータ：引数定義（詳細形式のみ）
                    - #
                      name: "string"  # ✅ パラメータ名
                      type: "string"  # ✅ 型
                      required: boolean  # 必須フラグ
                      default: "any"  # デフォルト値
                  returns: "string"  # ✅ 戻り値：戻り値の型
                  async: boolean  # 非同期フラグ：true/false
                  throws:  # 例外：スローする例外
                    - "string"  # 例外クラス名
              specifications:  # 仕様：検索仕様パターン
                - #
                  name: "string"  # ✅ 仕様名：仕様の識別名
                  description: "string"  # 説明：仕様の内容
                  criteria: "string"  # ✅ 条件：検索条件の定義
                  params:  # パラメータ：検索パラメータ
                    - "string"  # パラメータ定義
              query_methods:  # クエリメソッド：検索メソッド定義
                - #
                  name: "string"  # ✅ クエリメソッド名：メソッドの識別名
                  query: "string"  # クエリ：クエリ定義（実装ヒント）
                  params:  # ✅ パラメータ：検索パラメータ
                    - "string"  # パラメータ定義
                  returns: "string"  # ✅ 戻り値：戻り値の型
                  pagination: boolean  # ページング：ページング対応フラグ
              custom_operations:  # カスタム操作：特殊な操作定義
                - #
                  name: "string"  # ✅ 操作名：操作の識別名
                  description: "string"  # 説明：操作の内容
                  params:  # ✅ パラメータ：操作パラメータ
                    - "string"  # パラメータ定義
                  returns: "string"  # ✅ 戻り値：戻り値の型
                  transactional: boolean  # トランザクション：トランザクション要否
        ubiquitous_language:  # ユビキタス言語：用語定義
          - #
            term: "string"  # ✅ 用語：定義する用語
            definition: "string"  # ✅ 定義：用語の意味
            context: "string"  # コンテキスト：適用される文脈
            category: "entity"/"value_object"/"action"/"state"/"role"/"event"/"rule"/"metric"  # カテゴリ：entity/value_object/action/state/role/event/rule/metric
            synonyms:  # 同義語：同じ意味の用語
              - "string"  # 同義語
            related_terms:  # 関連用語：関連する用語
              - "string"  # 関連用語
            examples:  # 使用例：用語の使用例文
              - "string"  # 例文
            notes: "string"  # 備考：補足説明
            abbreviation: "string"  # 略語：省略形
    domain_services:  # ドメインサービス：コンテキストを跨ぐサービス定義
      - #
        service_id: "string"  # ✅ サービスID：識別子
        name: "string"  # ✅ サービス名：サービスの名称
        description: "string"  # 説明：サービスの役割
        operations:  # 操作：提供する操作
          - #
            name: "string"  # ✅ 操作名：操作の識別名
            description: "string"  # 説明：操作の内容
            params:  # パラメータ：操作の引数
              - "string"  # パラメータ定義
            returns: "string"  # 戻り値：戻り値の型
            business_rules:  # ビジネスルール：適用されるルール
              - "string"  # ルールの記述
        dependencies:  # 依存関係：依存する集約やサービス
          - "string"  # 依存先の識別子
```

## 2. ドメインモデルの構成要素
### 2.1 境界づけられたコンテキスト（Bounded Context）
#### 概念
同じ言葉が同じ意味を持つ、明確な境界を持った領域。大規模システムを論理的に分割する最上位の単位。
#### 記述例
```markdown
<!--@srs: domain-model: bounded_contexts[0]
context_id: "sales_context"
name: "販売コンテキスト"
description: |
  顧客への商品販売に関わる全ての業務を管理する。
  注文受付から出荷、請求までのプロセスを含む。
@srs-->
```
#### 設計指針
- **独立性**: 各コンテキストは独立して進化可能
- **明確な境界**: コンテキスト間の依存は最小限に
- **言語の統一**: コンテキスト内では同じ用語を一貫して使用
### 2.2 集約（Aggregate）
#### 概念
データ変更の単位となる、関連するエンティティと値オブジェクトのクラスター。必ず1つのルートエンティティを持つ。
#### 設計原則
- **トランザクション境界**: 集約は一貫性境界
- **外部参照**: 他の集約はIDでのみ参照
- **サイズ**: できるだけ小さく保つ
### 2.3 エンティティ（Entity）
#### 概念
一意の識別子を持ち、ライフサイクルを通じて同一性が保たれるオブジェクト。
### 2.4 値オブジェクト（Value Object）
#### 概念
識別子を持たず、属性の組み合わせで特徴づけられる不変オブジェクト。
#### 値オブジェクトの種類
- **identifier**: 識別子（OrderId、CustomerId等）
- **measurement**: 測定値（Money、Temperature等）
- **description**: 説明（ProductDescription、Address等）
- **range**: 範囲（DateRange、PriceRange等）
- **specification**: 仕様（ProductSpecification等）
- **composite**: 複合（Name、Address等）
### 2.5 ドメインイベント（Domain Event）
#### 概念
ドメイン内で発生した重要な出来事。過去形で命名し、不変である。
### 2.6 ユビキタス言語（Ubiquitous Language）
#### 概念
ドメインエキスパートと開発者が共通して使用する言語。コンテキスト内で一貫して使用される。

## 3. ドメインモデルの作成プロセス
### 3.1 ステップ1: ドメインエキスパートとの対話
1. **ビジネスプロセスの理解**
   - 現状の業務フローを詳細にヒアリング
   - システム化しない部分も含めて全体像を把握
2. **用語の収集と定義**
   - 業務で使われる専門用語を収集
   - 曖昧な用語は明確に定義
### 3.2 ステップ2: コンテキストの識別
1. **境界の発見**
   - 同じ用語が異なる意味で使われる箇所を特定
   - 組織構造やチーム構成も参考に
2. **コンテキストマップの作成**
   - コンテキスト間の関係を図示
   - 上流・下流の関係を明確化
### 3.3 ステップ3: 集約の設計
1. **不変条件の識別**
   - ビジネスルールから不変条件を抽出
   - トランザクション境界を決定
2. **ルートエンティティの選定**
   - 集約へのアクセスポイントを決定
   - 外部からの参照方法を定義
### 3.4 ステップ4: 詳細モデリング
1. **エンティティと値オブジェクトの区別**
   - 識別子の必要性で判断
   - ライフサイクルの有無を考慮
2. **ドメインイベントの抽出**
   - 状態変化の重要なタイミングを特定
   - イベントストーミングの活用

## 4. ベストプラクティス
### 4.1 モデリングの原則
1. **ビジネス言語の使用**
   - 技術用語ではなくビジネス用語を使用
   - ドメインエキスパートが理解できる表現
2. **シンプルさの追求**
   - 過度に複雑なモデルは避ける
   - 必要最小限の概念で表現
3. **進化的設計**
   - 完璧を求めず、段階的に改善
   - フィードバックを基に継続的に洗練
### 4.2 よくある落とし穴
1. **技術的関心事の混入**
   - データベース設計をドメインモデルに持ち込まない
   - UIの都合でモデルを歪めない
2. **貧血ドメインモデル**
   - 振る舞いのないデータ構造にしない
   - ビジネスロジックを適切に配置
3. **過度な分割**
   - コンテキストを細かく分けすぎない
   - 集約を小さくしすぎない
### 4.3 実装への橋渡し
1. **ユースケースとの連携**
   - ドメインモデルで定義された概念をユースケースで具体的な機能として実現
2. **機能要件での詳細化**
   - ドメインモデルのビジネスルールを機能要件で具体的な検証処理として実装
3. **システム設計での実装**
   - ドメインモデルの構造をシステム設計で技術的に実現

## 5. AIエージェントとの協働
### 5.1 ドメインモデルからの自動生成
AIエージェントは、定義されたドメインモデルから以下を自動生成できる：
1. **ユースケースの導出**
   - エンティティの振る舞いからユースケースを推測
   - ドメインイベントから業務フローを構築
2. **実装コードの生成**
   - エンティティクラスの骨格
   - リポジトリインターフェースの実装
   - 値オブジェクトの完全な実装
3. **テストケースの作成**
   - 不変条件のテスト
   - ドメインイベントの発生確認
### 5.2 整合性チェック
AIエージェントによる自動チェック：
1. **用語の一貫性**
   - ユビキタス言語の統一的な使用
   - コンテキスト間での用語の衝突検出
2. **設計の妥当性**
   - 集約の境界の適切性
   - 循環参照の検出
3. **実装との乖離**
   - ドメインモデルとコードの差異
   - 未実装のビジネスルール

## 6. 実例：ECサイトのドメインモデル
部分抽出のパスは配置例。既存要素に追記する例では、配列の添字を対象文書に合わせる。
### 6.1 コンテキストの分割
```markdown
<!--@srs: domain-model
bounded_contexts:
  - context_id: "catalog"
    name: "商品カタログ"
    description: "商品情報の管理"

  - context_id: "sales"
    name: "販売"
    description: "注文処理と顧客管理"

  - context_id: "fulfillment"
    name: "フルフィルメント"
    description: "在庫管理と配送"

  - context_id: "billing"
    name: "請求"
    description: "支払いと請求処理"
@srs-->
```
### 6.2 販売コンテキストの詳細
```markdown
<!--@srs: domain-model: bounded_contexts[1]: aggregates
- aggregate_id: "customer"
  name: "顧客"
  root_entity: "Customer"
  entities:
    - name: "Customer"
      attributes:
        - name: "customerId"
          type: "CustomerId"
          required: true
        - name: "email"
          type: "Email"
          required: true

- aggregate_id: "order"
  name: "注文"
  root_entity: "Order"
  entities:
    - name: "Order"
      attributes:
        - name: "orderId"
          type: "OrderId"
          required: true
        - name: "customerId"
          type: "CustomerId"
          required: true
      behaviors:
        - "addItem(product: Product, quantity: Quantity): void"
        - "cancel(): void"
        - "ship(): void"
      constraints:
        - "注文確定後は顧客を変更できない"
        - "キャンセル済みの注文には商品を追加できない"
@srs-->
```
