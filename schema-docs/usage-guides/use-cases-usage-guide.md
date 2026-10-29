<!-- Copyright (c) 2026 CoLLMate, Inc. -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Generated from schema/ by schemadocs-generator/generate.py. Do not edit; change the schema and regenerate. -->

# 拡張SRS ユースケース活用ガイド

本ガイドの AI 活用・自動化は、利用側のエージェントや実行環境で行う設計・運用例を含む。公式実装の提供範囲は [core](../../extended-srs-core/README.md) と [MCP サーバー](../../mcp-server/README.md) を参照する。

## 1. ユースケースとは（有向グラフモデル版）
### 1.1 定義と本質的目的
ユースケースは、アクター（ユーザーや外部システム）がシステムを使って達成したい目標と、その達成プロセスを**有向グラフ**として記述したものである。各ステップが頂点、遷移条件付きの次ステップ参照が辺となり、複雑な分岐や合流を自然に表現できる。
### 1.2 有向グラフモデルの利点
| 利点 | 説明 | 効果 |
|------|------|------|
| **柔軟な制御フロー** | 並行処理、条件分岐、ループを自然に表現 | 実際の業務フローを正確にモデル化 |
| **再利用性** | 共通ステップを複数箇所から参照可能 | 重複記述の削減 |
| **検証可能性** | グラフ理論に基づく到達可能性や循環の検出 | 品質保証の自動化 |
| **実装との対応** | ステートマシンやワークフローエンジンと直接対応 | 設計と実装のギャップ最小化 |
### 1.3 軽量なユースケース定義
`processing_details`（処理詳細）はオプションである。すべてのユースケースに詳細な処理フローが必要なわけではなく、必須の `uc_id`・`name`・`description`・`actors` と、任意の `business_rules`で意図（Intent）と制約（Constraint）を表現する軽量な定義も有効である。初期段階や高レベルの要件整理では、まず軽量な形式でユースケースを列挙し、必要に応じて `processing_details` を追加して段階的に詳細化するアプローチを推奨する。
### 1.4 ビジネスルールの明示的管理
`business_rules` フィールドにより、各ユースケースに適用されるビジネスルールや制約を文字列の配列として明示的に記述する。
### 1.5 機能要件との整合性
```
ユースケース（ビジネスレベルの相互作用）
    ↓ 同じ有向グラフモデルで詳細化
機能要件（システムレベルの処理フロー）
    ↓ 実装
ステートマシン/ワークフロー実装
```
ユースケースと機能要件が同じモデルを採用することで、シームレスな詳細化と追跡可能性を実現する。

## YAML構造

以下は型と構造を示す擬似表記。`✅` は必須項目、`/`・`|` は選択肢を示す。文書に貼り付ける際は具体的な値と `<!--@srs … @srs-->` の記法を使用する。省略した制約や拡張条件は JSON Schema を参照する。

```text
@srs:
  use-cases:  # ユースケース：システムとアクターの相互作用定義
    list:  # ユースケースリスト：ユースケースの一覧
      - #
        uc_id: "string"  # ✅ ユースケースID：ユースケースの一意識別子
        name: "string"  # ✅ ユースケース名：アクターが達成したい具体的な目標を表す名称。「動詞＋目的語」形式推奨（例：商品注文、在庫調整）。1回のセッションで完結する適切な粒度に設定
        priority: "must"/"should"/"could"/"wont"/"high"/"medium"/"low"  # 優先度：開発優先度。ビジネス価値、技術的依存関係、リスクを総合的に評価して設定。MVPに含めるものはhighを推奨
        actors:  # ✅ アクター：主アクター（ユースケース開始者）を最初に記載。副アクター（外部システム、サービス）、時間アクター（定期実行トリガー）も含む。具体的な役割名で記述（「ユーザー」は避け「顧客」「管理者」等を使用）
          - "string"  # アクター名（具体的な役割を表す名称）
        description: "string"  # ✅ 概要：ユースケースで達成される価値と概要説明。関連するドメインモデル要素（集約、エンティティ等）への言及可。ビジネス用語を使用し、技術的詳細は避ける（複数行可）
        processing_details:  # 処理詳細：ユースケースの詳細な処理フロー
          preconditions:  # 事前条件：ステップ実行前に満たすべき条件
            required_steps:  # 必須先行ステップ：このステップ実行前に完了している必要があるステップIDのリスト（Join操作）
              - "string"  #
            system_state:  # システム状態：必要なシステム状態の条件
              - "string"  #
            actor_state:  # アクター状態：アクターが満たすべき条件
              - "string"  #
            data_state:  # データ状態：データが満たすべき条件
              - "string"  #
          postconditions:  # 事後条件：実行後に保証される状態のリスト
            - "string"  #
          steps:  # ✅ ステップ定義：すべての処理ステップを統一的に定義（有向グラフの頂点）
            - #
              id: "string"  # ✅ ステップID：処理ステップの一意識別子。推奨：処理内容を表す名前（例：select-product、validate-stock、process-payment）
              actor: "string"  # ✅ アクター：実行主体（事前定義されたアクター名）
              action_type: "input"/"display"/"validate"/"process"/"decision"/"external_call"/"notify"  # アクション種別：ステップの種類（input/display/validate/process/decision/external_call/notify）
              description: "string"  # ✅ 説明：アクションや処理の内容
              preconditions:  # 事前条件：ステップ実行前に満たすべき条件
                required_steps:  # 必須先行ステップ：このステップ実行前に完了している必要があるステップIDのリスト（Join操作）
                  - "string"  #
                system_state:  # システム状態：必要なシステム状態の条件
                  - "string"  #
                actor_state:  # アクター状態：アクターが満たすべき条件
                  - "string"  #
                data_state:  # データ状態：データが満たすべき条件
                  - "string"  #
              data_operations:  # データ操作：このステップで行うデータ操作
                - #
                  operation: "read"/"create"/"update"/"delete"/"check"  # ✅ 操作種別：データ操作の種類
                  target: "string"  # ✅ 対象：操作対象のデータエンティティやリソース
                  condition: "string"  # 条件：操作の条件（オプション）
              validations:  # 検証ルール：このステップで実行される検証
                - #
                  validation_id: "string"  # ✅ 検証ID：検証ルールの識別子
                  target: "string"  # ✅ 対象：検証対象の項目
                  rule: "string"  # ✅ ルール：検証ルールの論理式または説明
                  error_message: "string"  # ✅ エラーメッセージ：検証失敗時の表示メッセージ
              next:  # ✅ 次のステップ：遷移先の定義（有向グラフの辺）
                - #
                  step: "string"  # ✅ ステップID：遷移先のステップID（処理ステップのIDまたは'END'）
                  condition:  # ✅ 遷移条件：ステップ遷移の条件定義
                    type: "always"/"success"/"error"/"business_rule"/"user_choice"/"data_condition"/"external_event"/"timeout"  # ✅ 条件タイプ：遷移条件の種類
                    value: "string"  # 条件値：条件タイプに応じた具体的な値（ルール名、選択肢、条件式など）
                    description: "string"  # 説明：条件の詳細説明
          flows:  # フロー分類：テストシナリオ用のステップ分類
            main_flow:  # 主要フロー：正常系のステップIDリスト（ハッピーパス）
              - "string"  #
            alternative_flows:  # 代替フロー：正常系のバリエーション
              - #
                name: "string"  # ✅ フロー名：フローの名称
                trigger_step: "string"  # トリガーステップ：このフローが開始されるステップID
                steps:  # ✅ ステップリスト：含まれるステップID
                  - "string"  #
                description: "string"  # 説明：フローの目的や発生条件
            exception_flows:  # 例外フロー：エラー処理フロー
              - #
                name: "string"  # ✅ フロー名：フローの名称
                trigger_step: "string"  # トリガーステップ：このフローが開始されるステップID
                steps:  # ✅ ステップリスト：含まれるステップID
                  - "string"  #
                description: "string"  # 説明：フローの目的や発生条件
        acceptance_criteria:  # 受け入れ条件：Given-When-Then形式でユースケースの検証条件を構造化記述。各シナリオは独立して実行可能に設計。自動テスト生成の基礎となるため、具体的な値を含めて記述
          - #
            scenario: "string"  # シナリオ名：テストシナリオを識別する簡潔な名称
            flow_path:  # フローパス：このシナリオで通るステップIDの順序
              - "string"  #
            given:  # ✅ 前提条件：テスト実行前の初期状態。具体的な値を含めて記述
              - "string"  # 検証可能な前提条件
            when:  # ✅ 実行アクション：テストで実行する操作。ユーザーの具体的なアクションを記述
              - "string"  # 実行する操作
            then:  # ✅ 期待結果：アクション実行後の期待される結果。測定可能な状態変化を記述
              - "string"  # 検証可能な期待結果
        business_rules:  # ビジネスルール：このユースケースに適用されるビジネスルール・制約の一覧
          - "string"  #
        status: "draft"/"tentative"/"approved"/"in_progress"/"blocked"/"in_review"/"rejected"/"implemented"/"verified"/"deferred"/"dropped"  # ステータス：要素のライフサイクル状態
        tags:  # タグ
          - "string"  #
        depends_on:  # 依存先
          - "string" | object  #
        blocks:  # 逆依存：depends_on から導出する、この要素がブロックしている他要素の ID リスト。省略可能。文書への保存・更新は利用側で行う
          - "string"  #
        implemented_by:  # 実装先機能要件：このユースケースを実装する機能要件の ID リスト
          - "string"  #
```

## 2. 有向グラフモデルの構成要素
### 2.1 ステップ（頂点）の設計
#### ステップの種類（action_type）
| 種類 | 説明 | アクター | 例 |
|------|------|---------|-----|
| **input** | ユーザー入力 | 人間アクター | 商品選択、数量入力 |
| **display** | 情報表示 | システム | 検索結果表示、エラー表示 |
| **validate** | 検証処理 | システム | 在庫確認、権限チェック |
| **process** | ビジネス処理 | システム | 注文作成、決済処理 |
| **decision** | 分岐判定 | システム/人間 | 承認判断、経路選択 |
| **external_call** | 外部連携 | システム | API呼び出し、サービス連携 |
| **notify** | 通知 | システム | メール送信、アラート |
### 2.2 遷移（辺）の設計
#### 遷移条件の種類
| 条件タイプ | 説明 | 使用例 |
|------------|------|--------|
| **always** | 無条件遷移 | 次のステップへ自動的に進む |
| **success** | 成功時 | 処理が正常完了した場合 |
| **error** | エラー時 | 処理が失敗した場合 |
| **business_rule** | ビジネスルール | 在庫充足、与信OK等 |
| **user_choice** | ユーザー選択 | ボタンクリック、オプション選択 |
| **data_condition** | データ条件 | 金額閾値、ステータス値等 |
| **external_event** | 外部イベント | Webhook受信、タイマー発火 |
| **timeout** | タイムアウト | 一定時間経過 |
### 2.3 フロー分類
#### 有向グラフ内でのフローの識別
- **main_flow**: 最も一般的な成功パス（ハッピーパス）
- **alternative_flows**: 正常系のバリエーション（オプション機能等）
- **exception_flows**: エラー処理パス

`processing_details.flows` の `main_flow`・`alternative_flows`・`exception_flows` にステップ ID の列を記述して、フローを識別する。
### 2.4 並行処理と同期
#### Fork（分岐）とJoin（合流）
以下は遷移と前提条件の抜粋。`actor`・`description` 等の必須フィールドと参照先のステップは省略している。
```yaml
# Fork: 1つのステップから複数への並行遷移
- id: "initiate-validation"
  next:
    - step: "validate-inventory"
      condition: { type: "always" }
    - step: "validate-credit"
      condition: { type: "always" }
    - step: "check-fraud"
      condition: { type: "always" }

# Join: 複数ステップの完了を待つ
- id: "process-order"
  preconditions:
    required_steps:
      - "validate-inventory"
      - "validate-credit"
      - "check-fraud"
```

## 3. ユースケース作成プロセス（有向グラフ版）
### 3.1 ステップ1：アクターとゴールの明確化
アクターの識別と達成したい目標を定義する。
### 3.2 ステップ2：主要ステップの洗い出し
1. **ステップの識別**
   - アクターのアクションをステップとして抽出
   - システムの応答を別ステップとして定義
   - 各ステップに意味のあるIDを付与

2. **ステップ粒度の決定**
   - 1ステップ = 1つの明確なアクション/処理
   - アクターが変わる場合は必ず分割
   - 分岐が発生する場合は分割を検討
### 3.3 ステップ3：遷移条件の定義
1. **基本的な遷移**
   - 各ステップから次のステップへの遷移を定義
   - 無条件遷移では `condition.type: always` を明記する

2. **条件分岐の追加**
   - ビジネスルールによる分岐
   - ユーザー選択による分岐
   - エラーハンドリング

3. **並行処理の設計**
   - 独立して実行可能な処理の識別
   - Fork/Joinパターンの適用
### 3.4 ステップ4：フローの分類と検証
1. **フローパスの抽出**
   - main_flow: 開始から正常終了までの主要パス
   - alternative_flows: 代替成功パス
   - exception_flows: エラー処理パス

2. **グラフ検証**
   - すべてのステップが到達可能か
   - 無限ループが存在しないか
   - デッドエンドがないか

3. **受け入れ条件との対応**
   - 各シナリオのflow_pathを明示
   - ステップ遷移と期待結果の整合性確認

## 4. ベストプラクティス
以下の YAML は注目するフィールドのみの抜粋で、必須フィールドを省略している。完全な記述例は「6. 実例」を参照する。（有向グラフ版）
### 4.1 効果的なステップ設計
#### 1. **ステップIDの命名規則**
```yaml
# 良い例：動作を表す動詞-名詞形式
- id: "select-product"
- id: "validate-inventory"
- id: "process-payment"

# 悪い例：番号や曖昧な名前
- id: "step1"
- id: "check"
- id: "do-something"
```
#### 2. **アクター責任の明確化**
各ステップは単一のアクターが実行する：
```yaml
# 良い例：アクターが明確
- id: "enter-payment-info"
  actor: "顧客"
  description: "支払い情報を入力する"

# 悪い例：複数アクターが混在
- id: "payment-process"
  actor: "顧客/システム"  # NG: 分割すべき
```
#### 3. **条件の明示的記述**
```yaml
# 良い例：条件が明確
next:
  - step: "show-discount-options"
    condition:
      type: "business_rule"
      value: "total_amount >= 10000"
      description: "購入金額が1万円以上の場合"

```

```yaml
# 悪い例：条件が不明確
next:
  - step: "maybe-discount"
    condition:
      type: "business_rule"
      value: "special"  # 何が特別？
```
### 4.2 グラフ構造のパターン
#### 1. **シーケンシャルパターン**
```yaml
# 単純な順次実行
steps:
  - id: "A"
    next: [{step: "B", condition: {type: "always"}}]
  - id: "B"
    next: [{step: "C", condition: {type: "always"}}]
  - id: "C"
    next: [{step: "END", condition: {type: "always"}}]
```
#### 2. **条件分岐パターン**
```yaml
# if-then-else構造
- id: "check-stock"
  next:
    - step: "reserve-stock"
      condition:
        type: "business_rule"
        value: "stock >= requested_quantity"
    - step: "show-out-of-stock"
      condition:
        type: "business_rule"
        value: "stock < requested_quantity"
```
#### 3. **ループパターン**
```yaml
# 再試行ループ
- id: "enter-password"
  next:
    - step: "verify-password"
      condition: {type: "always"}
- id: "verify-password"
  next:
    - step: "grant-access"
      condition: {type: "success"}
    - step: "enter-password"  # ループバック
      condition:
        type: "business_rule"
        value: "retry_count < 3"
    - step: "lock-account"
      condition:
        type: "business_rule"
        value: "retry_count >= 3"
```
### 4.3 検証とメンテナンス
#### 1. **到達可能性の確認**
- すべてのステップが開始点から到達可能
- すべてのステップから終了点へ到達可能
- 孤立したステップがない
#### 2. **循環の管理**
- 意図的なループには終了条件を明示
- 無限ループの可能性を排除
- 最大繰り返し回数を設定
#### 3. **複雑度の管理**
- 1つのユースケースのステップ数は20以下を推奨
- 過度に複雑な場合はサブユースケースに分割
- 共通処理は別ユースケースとして抽出

## 5. AIエージェントとの協働（有向グラフ版）
### 5.1 グラフ分析による品質チェック
#### 1. **構造的な問題の検出**
- **デッドロック**: 相互に待機する循環
- **到達不能ステップ**: どこからも遷移されないステップ
- **無限ループ**: 終了条件のないループ
- **欠落した例外処理**: error条件がないステップ
#### 2. **複雑度メトリクス**
```yaml
metrics:
  total_steps: 15
  total_transitions: 23
  cyclomatic_complexity: 10  # 単一連結成分の場合: 23 - 15 + 2
  max_path_length: 12
  parallel_branches: 3
```
### 5.2 インパクト分析の高度化
#### グラフベースの影響範囲分析
```yaml
変更ステップ: "validate-payment"
影響分析:
  直接影響:
    前方依存: ["enter-payment-info"]
    後方依存: ["process-payment", "show-payment-error"]
  間接影響:
    影響を受けるフロー:
      - main_flow
      - exception_flow_payment
    影響を受けるテストケース: 5件
  推奨アクション:
    - "payment-service の単体テスト更新"
    - 決済フローのE2Eテスト再実行
```
### 5.3 AIコントロールメタデータ
各ユースケースには、AIエージェント間の協調を支援するメタデータフィールドが用意されている。
#### 1. **`status`（ライフサイクル状態）**
共通定義の11段階ステータスを使用：`draft` / `tentative` / `approved` / `in_progress` / `blocked` / `in_review` / `rejected` / `implemented` / `verified` / `deferred` / `dropped`。省略時は `draft` として扱われる。AIエージェントはこの値を参照して作業対象をスコープできる（例：`approved` のユースケースのみを実装対象とする）。
#### 2. **`tags`（ラベル配列）**
横断的な分類用のラベルを文字列配列で付与する。AIエージェントは `tags` を使って関連する要素をグルーピングし、バッチ処理できる（例：`["payment", "mvp"]` タグを持つユースケースを一括でコード生成する）。
#### 3. **`depends_on`（型付き依存関係）**
文字列IDに加え、型付きオブジェクト（`ref_id` + `ref_type` + `dependency_type`）も使用可能。`dependency_type` で hard（完了必須）/ soft（モック可）/ interface（契約のみ）を区別。AIエージェントは有向グラフからトポロジカルソートを実行し、実装順序を自動決定できる。
#### 4. **`blocks`（逆依存）**
この要素が何をブロックしているかを示すID配列。`depends_on` から導出する省略可能なフィールド。公式 core は状態取得時に逆依存を計算するが、文書の `blocks` は自動更新しない。
#### 5. **`implemented_by`（実装参照）**
このユースケースを実装する機能要件やモジュールへの参照ID配列。トレーサビリティ確保のため、実装完了時に利用側で記録する。公式 MCP が自動設定するものではない。
#### 6. **`x-` プレフィックス拡張プロパティ**
すべての定義に `x-` プレフィックスの拡張プロパティを追加可能である（`patternProperties` による対応）。AIエージェントは実装メモ、生成コードへの参照、品質メトリクス等を `x-` プロパティに書き戻すことで、スキーマを壊さずにメタ情報を蓄積できる。
```markdown
<!--@srs: use-cases: list
- uc_id: "UC_C001"
  name: "商品注文"
  actors: ["顧客"]
  description: "顧客が商品を注文する。"
  x-implementation-notes: "決済サービスはStripe APIを使用"
  x-generated-tests: 12
  x-complexity-score: 8.5
@srs-->
```

## 6. 実例：商品注文ユースケース
### 6.1 ECサイトの商品注文（簡易版）
以下はスキーマ構造を示すための簡易的な例である。実際のプロジェクトでは、必要に応じて `processing_details` で詳細なステップを定義する。
```markdown
<!--@srs: use-cases
list:
  - uc_id: "UC_C001"
    name: "商品注文"
    priority: "must"
    status: "approved"
    tags:
      - "ec-core"
      - "mvp"
    business_rules:
      - "注文金額が0円以上であること"
      - "在庫数以上の数量は注文不可"
      - "未ログインユーザーはチェックアウト不可"
    actors:
      - "顧客"
      - "決済サービス"
    description: |
      顧客が商品を選択し、注文を完了する。
    processing_details:
      preconditions:
        actor_state:
          - "顧客がログイン済み"
      postconditions:
        - "注文が作成されている"
        - "決済が処理されている"
      steps:
        - id: "select-product"
          actor: "顧客"
          action_type: "input"
          description: "商品を選択する"
          next:
            - step: "validate-stock"
              condition: {type: "always"}
        - id: "validate-stock"
          actor: "システム"
          action_type: "validate"
          description: "在庫を確認する"
          next:
            - step: "process-payment"
              condition:
                type: "business_rule"
                value: "stock_sufficient"
            - step: "END"
              condition:
                type: "business_rule"
                value: "stock_insufficient"
        - id: "process-payment"
          actor: "決済サービス"
          action_type: "external_call"
          description: "決済を処理する"
          next:
            - step: "create-order"
              condition: {type: "success"}
            - step: "END"
              condition: {type: "error"}
        - id: "create-order"
          actor: "システム"
          action_type: "process"
          description: "注文を作成する"
          data_operations:
            - operation: "create"
              target: "注文"
          next:
            - step: "END"
              condition: {type: "always"}
      flows:
        main_flow:
          - "select-product"
          - "validate-stock"
          - "process-payment"
          - "create-order"
    acceptance_criteria:
      - scenario: "正常な商品注文"
        given:
          - "顧客がログインしている"
          - "商品Aの在庫が10個ある"
        when:
          - "商品Aを選択し数量2個を指定"
          - "注文を確定"
        then:
          - "注文が作成される"
          - "商品Aの在庫が8個に減少"
          - "決済が完了"
@srs-->
```
