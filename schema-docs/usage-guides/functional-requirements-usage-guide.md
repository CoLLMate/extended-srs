<!-- Copyright (c) 2026 CoLLMate, Inc. -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Generated from schema/ by schemadocs-generator/generate.py. Do not edit; change the schema and regenerate. -->

# 拡張SRS 機能要件活用ガイド

本ガイドの AI 活用・自動化は、利用側のエージェントや実行環境で行う設計・運用例を含む。公式実装の提供範囲は [core](../../extended-srs-core/README.md) と [MCP サーバー](../../mcp-server/README.md) を参照する。

## 1. 機能要件とは
### 1.1 定義と目的
機能要件（Functional Requirements）は、システムが提供すべき具体的な機能と振る舞いを詳細に定義したものである。ユースケースで定義された「何を作るか（WHAT）」を、「どう実現するか（HOW）」の観点で具体化する。
### 1.2 機能要件の本質
- **具体性**: 実装可能なレベルまで詳細化された仕様
- **包括性**: ビジネス要件から技術仕様まで網羅
- **トレーサビリティ**: ユースケースから実装まで追跡可能
- **検証可能性**: 明確な受け入れ条件を持つ
- **データの一元管理**: システム全体で共有されるデータを統合的に管理
- **AI制御メタデータ**: status（11段階ライフサイクル）/ tags / depends_on（型付き依存関係対応）/ blocks（逆依存）により、AIエージェントが作業スコープと実装順序を自律的に判断可能
### 1.3 他要素との関係
```
ユースケース（アクターとシステムの相互作用）
    ↓ 実現
機能要件（具体的な機能仕様）
    ↓ 実装
システム設計（技術的な実現方法）
```
### 1.4 データモデルの一元管理
機能要件では、システム全体で共有されるデータを`data_models`セクションで一元管理する。個別の機能要件からは`used_data`で参照のみを行い、データの重複定義を避ける。参照先の存在と意味的な整合性は別途確認する。

## YAML構造

以下は型と構造を示す擬似表記。`✅` は必須項目、`/`・`|` は選択肢を示す。文書に貼り付ける際は具体的な値と `<!--@srs … @srs-->` の記法を使用する。省略した制約や拡張条件は JSON Schema を参照する。

```text
@srs:
  functional-requirements:  # 機能要件：システムが提供する機能の詳細定義
    data_models:  # データモデル：システムで使用するデータの定義
      - #
        data_id: "string"  # ✅ データID：データモデルの一意識別子。推奨：意味のある名前（例：user-profile、order-items）
        name: "string"  # ✅ データ名：データモデルの名称（ビジネス名）
        system_name: "string"  # システム名：システム実装時の名称（オプション）
        type: "master"/"transaction"/"reference"/"log"  # ✅ タイプ：master/transaction/reference/log
        attributes:  # ✅ 属性：データ項目の定義
          - #
            name: "string"  # ✅ 属性名：項目の識別名（ビジネス名）
            system_name: "string"  # システム名：実装時の名称（オプション）
            type: "string"/"number"/"boolean"/"date"/"datetime"/"uuid"/"id"/"integer"/"decimal"/"float"/"enum"/"json"/"array"  # ✅ データ型：データ型定義
            required: boolean  # ✅ 必須：true/false
            description: "string"  # ✅ 説明：属性の意味
            max_length: number  # 最大長：文字列型の場合
            precision: number  # 精度：decimal型の場合の全体桁数
            scale: number  # スケール：decimal型の場合の小数点以下桁数
            values:  # 値リスト：enum型の場合の選択肢
              - "string"  #
            default: "any"  # デフォルト値：初期値
            conversion: "string"  # 変換：データ変換ルール（オプション）
            constraints:  # 制約：データ制約条件
              - "string"  # 制約条件（primary_key/unique/not_null/foreign_key等）
        characteristics:  # データ特性：データの運用特性
          update_frequency: "string"  # 更新頻度：更新タイミング
          volume: "string"  # データ量：想定件数や容量
          retention: "string"  # 保存期間：データ保管期間
          partitioning: "string"  # パーティション：分割方法
    requirements:  # 個別の機能要件リスト
      - #
        req_id: "string"  # ✅ 要件ID：機能要件の一意識別子。推奨：機能を表す意味のある名前（例：user-registration、product-search）
        name: "string"  # ✅ 要件名：機能の名称
        priority: "must"/"should"/"could"/"wont"/"high"/"medium"/"low"  # ✅ 優先度：high/medium/low
        actors:  # アクター：この機能に関わるアクター名のリスト
          - "string"  #
        used_data:  # 使用データ：この機能で使用するデータIDの参照
          - "string"  #
        processing_details:  # 処理詳細：処理の詳細仕様
          preconditions:  # 事前条件：ステップ実行前に満たすべき条件
            required_steps:  # 必須先行ステップ：このステップ実行前に完了している必要があるステップIDのリスト（Join操作）
              - "string"  #
            conditions:  # 条件：ビジネスルールやシステム状態に関する条件のリスト
              - "string"  #
          postconditions:  # 事後条件：実行後に保証される状態のリスト
            - "string"  #
          steps:  # ステップ定義：すべての処理ステップを統一的に定義
            - #
              id: "string"  # ✅ ステップID：処理ステップの一意識別子。推奨：処理内容を表す名前（例：validate-input、call-api、show-results）
              actor: "string"  # ✅ アクター：実行主体（事前定義されたアクター名）
              description: "string"  # ✅ 説明：アクションや処理の内容
              preconditions:  # 事前条件：ステップ実行前に満たすべき条件
                required_steps:  # 必須先行ステップ：このステップ実行前に完了している必要があるステップIDのリスト（Join操作）
                  - "string"  #
                conditions:  # 条件：ビジネスルールやシステム状態に関する条件のリスト
                  - "string"  #
              screen_ui:  # UI関連：UI画面に関する情報（オプション）
                screen: "string"  # 画面参照：関連する画面のID
                state: "string"  # UI状態：画面の状態ID
              api_reference: "string"  # API参照：関連するAPIのID
              validations:  # 検証ルール：このステップで実行される検証
                - #
                  validation_id: "string"  # ✅ 検証ID：検証ルールの識別子。推奨：検証内容を表す名前（例：email-format、required-field）
                  target: "string"  # ✅ 対象：検証対象の項目
                  condition: "string"  # ✅ 条件：検証条件の論理式
                  error_message: "string"  # ✅ エラーメッセージ：検証失敗時の表示
              external_service:  # 外部サービス連携：外部APIの呼び出し
                name: "string"  # ✅ サービス名：外部サービスの名称
                operation: "string"  # ✅ 操作：実行する操作の内容
                timeout: number  # タイムアウト：ミリ秒単位
                retry: number  # リトライ回数：再試行回数
                async: boolean  # 非同期フラグ：非同期実行の場合true
              business_errors:  # ビジネスエラー：このステップで発生する可能性のあるビジネスエラーと対処
                - #
                  error_code: "string"  # ✅ エラーコード：ビジネスエラーの識別コード（例：INSUFFICIENT_BALANCE、INVALID_COUPON）
                  message: "string"  # ✅ メッセージ：ユーザーに表示するエラーメッセージ
                  user_action: "string"  # ユーザーアクション：ユーザーが取るべき対処法
              next:  # ✅ 次のステップ：遷移先の定義（エラー時の遷移も含む）
                - #
                  step: "string"  # ✅ ステップID：遷移先のステップID（処理ステップのIDまたは'END'）
                  condition:  # ✅ 遷移条件：ステップ遷移の条件定義
                    type: "always"/"success"/"error"/"business_error"/"validation_error"/"ui_event"/"external_event"/"timeout"  # ✅ 条件タイプ：遷移条件の種類
                    value: "string"  # 条件値：条件タイプに応じた具体的な値（エラーコード、イベント名、フィールドIDなど）
                    description: "string"  # 説明：条件の詳細説明（オプション）
          flows:  # フロー分類：テストシナリオ用のステップ分類
            main_flow:  # 主要フロー：正常系のステップIDリスト
              - "string"  #
            alternative_flows:  # 代替フロー：分岐処理のグループ
              - #
                name: "string"  # ✅ フロー名：フローの名称
                steps:  # ✅ ステップリスト：含まれるステップID
                  - "string"  #
            exception_flows:  # 例外フロー：エラー処理のグループ
              - #
                name: "string"  # ✅ フロー名：フローの名称
                steps:  # ✅ ステップリスト：含まれるステップID
                  - "string"  #
        ui_specifications:  # UI仕様：ユーザーインターフェースの定義
          - #
            ui_id: "string"  # ✅ UI ID：UI要素の一意識別子。推奨：画面や機能を表す名前（例：login-form、product-list、order-confirmation）
            name: "string"  # ✅ UI名：UIの名称
            type: "web"/"mobile"/"api"/"report"  # ✅ タイプ：web/mobile/api/report
            states:  # UI状態：UIの取りうる状態の定義
              - #
                state_id: "string"  # ✅ 状態ID：UI状態の識別子。推奨：状態を表す名前（例：loading、error、success、editing）
                name: "string"  # ✅ 状態名：状態の名称
                description: "string"  # 説明：状態の詳細説明
            screen_design:  # 画面設計：画面要素の定義
              sections:  # セクション：画面の区分
                - #
                  section_id: "string"  # ✅ セクションID：画面セクションの識別子。推奨：セクションの役割を表す名前（例：header、search-filters、results-list）
                  title: "string"  # ✅ タイトル：セクションの見出し
                  display_items:  # 表示項目：セクション内の項目リスト
                    - "string"  #
                  display_condition: "string"  # 表示条件：条件付き表示の論理式
              field_specifications:  # フィールド仕様：入力項目の定義
                - #
                  field_id: "string"  # ✅ フィールドID：入力フィールドの識別子。推奨：フィールドの用途を表す名前（例：email-input、password-field、search-keyword）
                  label: "string"  # ✅ ラベル：表示名
                  type: "text"/"password"/"email"/"number"/"date"/"datetime"/"select"/"radio"/"checkbox"/"textarea"/"button"/"file"  # フィールドタイプ：フィールドの種類
                  required: boolean  # 必須フラグ：true/false
                  help_text: "string"  # ヘルプ：説明文
                  validation:  # 検証：検証ルールのリスト
                    - "string"  #
              state_variations:  # 状態バリエーション：状態ごとの画面変更定義
                - #
                  state_ref: "string"  # ✅ 状態参照：対象のUI状態ID
                  sections:  # セクション変更：この状態でのセクション定義
                    - #
                      section_id: "string"  # セクションID：変更対象のセクションID
                      modifications:  # 変更内容：セクション内の変更
                        - #
                          field_ref: "string"  # フィールド参照：対象フィールドID（特定のフィールドIDまたは'*'で全フィールド）
                          property: "string"  # プロパティ：変更する属性名
                          value: "any"  # 値：変更後の値
                      additional_items:  # 追加項目：この状態で追加される項目
                        - "string"  #
                  field_modifications:  # フィールド変更：フィールドレベルの変更
                    - #
                      field_ref: "string"  # フィールド参照：対象フィールドID
                      properties:  # プロパティ：変更する属性リスト
                        - #
                          name: "string"  # ✅ 属性名：変更する属性
                          value: "any"  # ✅ 値：変更後の値
                  additional_sections:  # 追加セクション：この状態で追加されるセクション
                    - #
                      section_id: "string"  # ✅ セクションID：画面セクションの識別子。推奨：セクションの役割を表す名前（例：header、search-filters、results-list）
                      title: "string"  # ✅ タイトル：セクションの見出し
                      display_items:  # 表示項目：セクション内の項目リスト
                        - "string"  #
                      display_condition: "string"  # 表示条件：条件付き表示の論理式
              mockup:  # モックアップ：UIイメージ
                type: "ascii-art"/"image-base64"/"image-url"/"figma-url"  # ✅ タイプ：ascii-art/image-base64/image-url/figma-url
                content: "string"  # ✅ コンテンツ：タイプに応じた内容
            api_specs:  # API仕様：APIの定義
              endpoint: "string"  # エンドポイント：APIパス
              method: "GET"/"POST"/"PUT"/"DELETE"/"PATCH"  # メソッド：HTTPメソッド
              request_format: "JSON"/"XML"/"form-data"/"x-www-form-urlencoded"  # リクエスト形式：リクエストのコンテンツタイプ
              response_format: "JSON"/"XML"/"HTML"/"text"/"binary"  # レスポンス形式：レスポンスのコンテンツタイプ
            report_settings:  # レポート設定：帳票の定義
              purpose: "string"  # 目的：レポートの用途
              format: "PDF"/"Excel"/"CSV"/"HTML"  # 形式：出力形式
              distribution: "string"  # 配布：配布方法とタイミング
            technical_design:  # 技術設計：技術観点の設計要素
              framework: "string"  # フレームワーク：使用フレームワーク
              responsive: "string"  # レスポンシブ：対応方針
              accessibility: "string"  # アクセシビリティ：対応レベル
        acceptance_criteria:  # ✅ 受け入れ条件：機能の完成基準（GWT形式）
          - #
            scenario: "string"  # シナリオ名：シナリオ名（オプション）
            given:  # ✅ 前提条件
              - "string"  #
            when:  # ✅ 実行アクション
              - "string"  #
            then:  # ✅ 期待結果
              - "string"  #
        status: "draft"/"tentative"/"approved"/"in_progress"/"blocked"/"in_review"/"rejected"/"implemented"/"verified"/"deferred"/"dropped"  # ステータス：要素のライフサイクル状態
        tags:  # タグ
          - "string"  #
        depends_on:  # 依存先
          - "string" | object  #
        blocks:  # 逆依存：depends_on から導出する、この要素がブロックしている他要素の ID リスト。省略可能。文書への保存・更新は利用側で行う
          - "string"  #
        traceability:  # トレーサビリティ：追跡可能性
          use_cases:  # 関連ユースケース：対応するユースケースIDのリスト
            - "string"  #
          domain_entities:  # 関連ドメインエンティティ：関連するエンティティ名のリスト
            - "string"  #
          non_functional_requirements:  # 関連非機能要件：参照する非機能要件IDのリスト
            - "string"  #
```

## 2. 主要コンポーネントの概念整理
### 2.1 処理フローの有向グラフ表現
処理詳細（processing_details）の`steps`は、各ステップを頂点、`next`による遷移を辺とする有向グラフを形成する：
- **頂点（ステップ）**: 一意のIDを持つ処理単位
- **辺（遷移）**: 構造化された条件付きの次ステップへの参照
- **並行処理**: 1つのステップから複数の`next`（Fork）
- **同期**: `preconditions.required_steps`による合流（Join）

### 2.2 統一的な遷移条件モデル
すべての遷移を`transitionCondition`で統一的に表現：
- **always**: 無条件遷移
- **success/error**: 処理結果による分岐
- **business_error**: ビジネスエラーコードによる分岐
- **ui_event**: UIイベント（クリック、入力等）による遷移
- **validation_error**: 検証エラーによる分岐

### 2.3 UI状態管理モデル
UIの動的な振る舞いを `states` と `screen_design.state_variations` で管理：
- **基本状態**: 初期状態でのUI構成
- **状態遷移**: 処理の進行に応じたUI変化
- **動的変更**: フィールドの有効/無効化、表示/非表示
- **追加要素**: エラー時のメッセージ表示など

### 2.4 GWT形式の受け入れ条件
受け入れ条件（acceptance_criteria）は、Given-When-Then形式で構造化：
- **Given（前提条件）**: テスト開始時のシステム状態
- **When（実行アクション）**: 実行する操作
- **Then（期待結果）**: 期待される結果
- **統一的な基準**: 機能とビジネスルールを区別せず、すべて受け入れ条件として記述

### 2.5 AI制御メタデータ
各機能要件に以下のメタデータを付与可能：
- **status**: ライフサイクル状態（draft → tentative → approved → in_progress → in_review → implemented → verified。blocked / rejected / deferred / dropped も使用可能）
- **tags**: 横断的分類ラベル（例：["MVP", "auth", "phase-1"]）
- **depends_on**: 依存先要件ID（トポロジカルソートによる実装順序決定に使用）
- **priority**: MoSCoW方式を推奨（must / should / could / wont）。high / medium / low も使用可

### 2.6 拡張プロパティ（x-プレフィクス）
すべての定義で `x-` プレフィクス付きプロパティが使用可能：
```markdown
<!--@srs: functional-requirements: requirements[0]
req_id: "user-registration"
name: "ユーザー登録"
priority: "must"
acceptance_criteria:
  - given: ["未登録の利用者"]
    when: ["登録フォームを送信する"]
    then: ["アカウントが作成される"]
x-implementation-notes: "Supabase Auth の signUp() を使用"
x-generated-files:
  - "src/features/auth/register.ts"
  - "src/features/auth/register.test.ts"
@srs-->
```

## 3. ベストプラクティス
### 3.1 データモデルの設計原則
1. **一元管理の徹底**
   - すべてのデータモデルを`data_models`セクションで定義
   - 個別機能からは`used_data`で参照のみ
   - データの重複定義を絶対に避ける

2. **ビジネス名とシステム名のマッピング**
   - `name`: ビジネス用語での名称
   - `system_name`: 実装時の物理名（オプション）
   - 両者の対応関係を明確に管理

3. **データ型と制約の明確化**
   - 適切なデータ型の選択（基本型、識別子型、数値型など）
   - 必要な制約条件の定義（キー制約、NULL制約、値制約など）

### 3.2 処理フローの記述指針
1. **ステップの粒度**
   - 1ステップ = 1つの明確なアクションまたは処理
   - アクターの切り替わりで必ずステップを分割
   - 検証処理は独立したステップとして定義

2. **遷移条件の明確化**
   - `always`: 無条件遷移
   - エラー条件: 「検証失敗」「タイムアウト」など
   - ユーザー操作: 「ボタンクリック」「リンククリック」など

3. **フロー分類の活用**
   - `main_flow`: 正常系の主要パス
   - `alternative_flows`: 正常系のバリエーション
   - `exception_flows`: エラー処理パス

### 3.3 UI仕様の構造化
1. **状態管理の設計**
   - 基本状態と各種バリエーション状態を定義
   - 状態遷移のトリガーを明確化
   - 各状態でのUI変更を`state_variations`で管理

2. **セクションとフィールドの体系化**
   - 論理的なセクション分割（SEC001形式）
   - フィールドの一意識別（FLD001形式）
   - 条件付き表示の論理式定義

### 3.4 命名規則の推奨事項
- **req_id**: 機能を表す意味のある名前（user-registration、product-search）
- **step_id**: 処理内容を表す名前（validate-input、call-api）
- **ui_id**: 画面や機能を表す名前（login-form、order-confirmation）
- **data_id**: エンティティを表す名前（user-profile、order-items）
- **field_id**: フィールドの用途を表す名前（email-input、search-keyword）
- **section_id**: セクションの役割を表す名前（header、results-list）
- **validation_id**: 検証内容を表す名前（email-format、required-field）
- **state_id**: 状態を表す名前（loading、error、success）

### 3.5 MoSCoW優先度の活用
- **must**: MVPに必須。これがなければプロダクトが成立しない
- **should**: 重要だが、初回リリースでは代替手段で凌げる
- **could**: あれば望ましいが、なくても大きな影響はない
- **wont**: 今回のスコープでは実装しないと明示的に決定

MoSCoWの`wont`は「何を作らないか」を明示する点で、AIエージェントのスコープ制御に特に有用である。

### 3.6 AIコントロールメタデータ
各機能要件には以下のフィールドが用意されている：
- **`status`**: 共通定義の11段階ステータス（draft / tentative / approved / in_progress / blocked / in_review / rejected / implemented / verified / deferred / dropped）。省略時はdraft
- **`depends_on`**: 文字列IDまたは型付きオブジェクト（ref_id + ref_type + dependency_type）の配列。dependency_type で hard / soft / interface を区別
- **`blocks`**: 逆依存（`depends_on` から導出。文書への保存は利用側で行う）
- **`tags`**: 横断的分類ラベル

## 4. 実例
部分抽出のパスは配置例。既存要素に追記する例では、配列の添字を対象文書に合わせる。
### 4.1 データモデルの定義例
```markdown
<!--@srs: functional-requirements
data_models:
  - data_id: "product"
    name: "商品"  # ビジネス名
    system_name: "products"  # 実装時のテーブル名
    type: "master"
    attributes:
      - name: "商品ID"
        system_name: "product_id"
        type: "uuid"
        required: true
        description: "商品の一意識別子"
        constraints:
          - "primary_key"
      - name: "価格"
        system_name: "price"
        type: "decimal"
        required: true
        precision: 10
        scale: 2
        description: "販売価格（税込）"
        constraints:
          - "min: 0"
    characteristics:
      update_frequency: "日次バッチ"
      retention: "無期限"
@srs-->
```

### 4.1.1 機能要件の定義例（AI制御メタデータ付き）
```markdown
<!--@srs: functional-requirements
requirements:
  - req_id: "product-search"
    name: "商品検索"
    priority: "must"
    status: "approved"
    tags: ["MVP", "search", "phase-1"]
    depends_on: ["product-master-import"]
    actors: ["顧客"]
    used_data: ["product"]
    acceptance_criteria:
      - given: ["商品マスタに商品が登録されている"]
        when: ["検索キーワードを入力して検索ボタンをクリック"]
        then: ["該当する商品が一覧表示される"]
@srs-->
```

### 4.2 処理ステップの定義例
遷移記法を示す抜粋。ここに定義していない遷移先・画面は、実際の仕様で別途定義する。
```markdown
<!--@srs: functional-requirements: requirements[0]: processing_details
steps:
  # Fork: 1つのステップから複数へ（並行処理の開始）
  - id: "start-order-validation"
    actor: "システム"
    description: "注文検証プロセス開始"
    next:
      - step: "validate-customer"
        condition:
          type: "always"
      - step: "check-inventory"
        condition:
          type: "always"
      - step: "check-fraud"
        condition:
          type: "always"

  # UIイベントからの遷移
  - id: "input-payment-info"
    actor: "顧客"
    description: "支払情報入力"
    screen_ui:
      screen: "payment-form"
      state: "input-mode"
    next:
      - step: "validate-payment"
        condition:
          type: "ui_event"
          value: "submit-button"
          description: "送信ボタンクリック"
      - step: "cancel-order"
        condition:
          type: "ui_event"
          value: "cancel-link"
          description: "キャンセルリンククリック"

  # 検証ステップ
  - id: "validate-payment"
    actor: "システム"
    description: "支払情報検証"
    validations:
      - validation_id: "card-number-format"
        target: "カード番号"
        condition: "isValidCardNumber(cardNumber)"
        error_message: "カード番号が正しくありません"
    next:
      - step: "process-payment"
        condition:
          type: "success"
      - step: "show-validation-errors"
        condition:
          type: "validation_error"

  # ビジネスエラーの処理
  - id: "process-payment"
    actor: "システム"
    description: "決済処理"
    preconditions:
      required_steps: ["validate-customer", "check-inventory"]
    business_errors:
      - error_code: "INSUFFICIENT_BALANCE"
        message: "残高が不足しています"
        user_action: "別の支払方法を選択するか、チャージしてください"
      - error_code: "CARD_EXPIRED"
        message: "カードの有効期限が切れています"
        user_action: "カード情報を更新してください"
    next:
      - step: "send-confirmation"
        condition:
          type: "success"
      - step: "select-payment-method"
        condition:
          type: "business_error"
          value: "INSUFFICIENT_BALANCE"
      - step: "update-card-info"
        condition:
          type: "business_error"
          value: "CARD_EXPIRED"
      - step: "handle-system-error"
        condition:
          type: "error"
          description: "システムエラー発生時"
@srs-->
```

### 4.3 UI状態管理の例
```markdown
<!--@srs: functional-requirements: requirements[0]: ui_specifications
- ui_id: "order-confirmation"
  name: "注文確認画面"
  type: "web"
  states:
    - state_id: "initial"
      name: "初期状態"
    - state_id: "processing"
      name: "処理中"
    - state_id: "validation-error"
      name: "検証エラー"

  screen_design:
    state_variations:
      - state_ref: "processing"
        field_modifications:
          - field_ref: "confirm-button"
            properties:
              - name: "enabled"
                value: false
              - name: "label"
                value: "処理中..."
        additional_sections:
          - section_id: "progress-indicator"
            title: ""
            display_items:
              - "プログレスバー"
              - "処理ステップ表示"
@srs-->
```

### 4.4 受け入れ条件の例
```markdown
<!--@srs: functional-requirements: requirements[0]: acceptance_criteria
- scenario: "正常な商品検索"
  given:
    - "商品マスタに100件の商品が登録されている"
    - "商品Aの名前に'テスト'が含まれる"
  when:
    - "検索キーワードに'テスト'を入力"
    - "検索ボタンをクリック"
  then:
    - "商品Aが検索結果に表示される"
    - "検索結果が関連度順にソートされる"

- scenario: "在庫不足時の注文処理"
  given:
    - "商品Xの在庫が2個"
    - "顧客が商品Xを3個カートに入れている"
  when:
    - "注文確定ボタンをクリック"
  then:
    - "在庫不足エラーが表示される"
    - "購入可能な最大数（2個）が案内される"
    - "注文は確定されない"

- scenario: "最小注文金額の適用"
  given:
    - "最小注文金額が1000円に設定されている"
    - "カートの合計金額が800円"
  when:
    - "注文確定を試みる"
  then:
    - "最小注文金額エラーが表示される"
    - "不足金額（200円）が明示される"
@srs-->
```
