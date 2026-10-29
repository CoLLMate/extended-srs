<!-- Copyright (c) 2026 CoLLMate, Inc. -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Generated from schema/ by schemadocs-generator/generate.py. Do not edit; change the schema and regenerate. -->

# 拡張SRS 開発実装詳細活用ガイド

本ガイドの AI 活用・自動化は、利用側のエージェントや実行環境で行う設計・運用例を含む。公式実装の提供範囲は [core](../../extended-srs-core/README.md) と [MCP サーバー](../../mcp-server/README.md) を参照する。

## 1. 開発実装詳細とは

### 1.1 定義と目的
development-implementationは、開発マイルストーンの管理とデプロイメント設定に特化したスキーマである。

### 1.2 本質的な価値
- **進捗管理**: マイルストーンによる開発進捗の同期ポイント定義
- **品質保証**: 統合テストと品質ゲートの設定
- **デプロイ管理**: 環境別の詳細なデプロイメント設定

### 1.3 他のスキーマとの関係
```
functional-requirements（ビジネス要件）
    ↓
system-architecture（技術基盤・モジュール定義・開発単位）
    ↓
development-implementation（マイルストーン・デプロイ詳細）
```

### 1.4 スコープ
- **開発タスク**: system-architectureのモジュール定義を使用
- **マイルストーン**: 進捗管理と品質チェックポイント
- **デプロイメント**: 環境別の設定とパイプライン定義

### 1.5 マイルストーンのステータスと依存関係
マイルストーン（milestone）には以下のフィールドが用意されている：
- **`status`**: 共通定義の11段階ステータス（draft → verified）。マイルストーン達成の進捗管理
- **`depends_on`**: 先行マイルストーンや前提モジュールへの依存。文字列IDまたは型付きオブジェクト
- **`blocks`**: 逆依存（`depends_on` から導出。文書への保存は利用側で行う）

これによりマイルストーン間の依存グラフが明示され、クリティカルパスの自動計算や並行作業可能範囲の判定が可能になる。

## YAML構造

以下は型と構造を示す擬似表記。`✅` は必須項目、`/`・`|` は選択肢を示す。文書に貼り付ける際は具体的な値と `<!--@srs … @srs-->` の記法を使用する。省略した制約や拡張条件は JSON Schema を参照する。

```text
@srs:
  development-implementation:  # 開発実装詳細：開発マイルストーンの管理とデプロイメント設定に特化したスキーマ
    development_milestones:  # 開発マイルストーン：開発進捗の同期ポイント
      milestones:  # ✅ マイルストーンリスト
        - #
          milestone_id: "string"  # ✅ マイルストーンID
          name: "string"  # ✅ マイルストーン名
          description: "string"  # 説明
          target_modules:  # ✅ 対象モジュール：このマイルストーンで完了すべきモジュールのリスト
            - #
              component_id: "string"  # ✅ コンポーネントID：system-architecture.architecture.key_components.components.component_idへの参照
              module_ids:  # ✅ モジュールIDリスト：このコンポーネント内の対象モジュールIDのリスト
                - "string"  # system-architecture.architecture.key_components.components.modules.module_idへの参照
          cross_cutting_tasks:  # 横断的タスク：このマイルストーンで完了すべき横断的作業（統合、移行など）
            - #
              name: "string"
              type: "integration"/"migration"/"performance-tuning"/"security-audit"
              description: "string"
          integration_tests:  # 統合テスト：マイルストーンで実行する統合テスト
            - #
              test_name: "string"  # ✅ テスト名
              test_scope: "intra-component"/"inter-component"/"end-to-end"/"contract"  # ✅ テストスコープ：intra-component: コンポーネント内, inter-component: コンポーネント間, end-to-end: 全体, contract: 契約
              target_interfaces:  # 対象インターフェース：テスト対象のインターフェースID（system-architectureで定義）
                - "string"  #
              test_scenarios:  # テストシナリオ
                - #
                  scenario: "string"
                  expected_result: "string"
          quality_gates:  # 品質ゲート
            - #
              gate_name: "string"  # ✅ ゲート名
              criteria:  # ✅ 基準
                - #
                  metric: "string"  # ✅ メトリクス：例：test-coverage, code-complexity, performance-benchmark
                  threshold: number  # ✅ 閾値
                  comparison: "gt"/"gte"/"lt"/"lte"/"eq"  # ✅ 比較演算子
              automated_checks:  # 自動チェック
                - "string"  #
              failure_action: "block"/"warn"/"request-review"  # 失敗時アクション
          human_review_points:  # 人間レビューポイント
            - #
              review_type: "architecture"/"security"/"performance"/"ux"/"code-quality"/"business-logic"  # ✅ レビュータイプ
              reviewer_role: "string"  # ✅ レビュアー役割：レビューを行う人の役割（例：lead-engineer, architect, security-expert）
              review_criteria:  # レビュー基準
                - "string"  #
              required_documents:  # 必要なドキュメント：レビューに必要な資料
                - "string"  #
              blocking: boolean  # ブロッキング：承認がないと次に進めないか
          deliverables:  # 成果物：マイルストーンの成果物
            - #
              name: "string"
              type: "working-software"/"documentation"/"deployment-package"/"test-report"
              description: "string"
          status: "draft"/"tentative"/"approved"/"in_progress"/"blocked"/"in_review"/"rejected"/"implemented"/"verified"/"deferred"/"dropped"  # ステータス：要素のライフサイクル状態
          depends_on:  # 依存先
            - "string" | object  #
          blocks:  # 逆依存：depends_on から導出する、この要素がブロックしている他要素の ID リスト。省略可能。文書への保存・更新は利用側で行う
            - "string"  #
    deployment_details:  # デプロイメント詳細：環境ごとの具体的なデプロイ設定
      environments:  # 環境設定
        - #
          name: "string"  # ✅ 環境名
          type: "development"/"staging"/"production"  # ✅ 環境タイプ
          url: "string"  # 環境URL
          deployment_target:  # デプロイ先
            platform: "string"  # 例：kubernetes, ecs, lambda, heroku
            region: "string"  # リージョン/ゾーン
            cluster: "string"  # クラスター名（該当する場合）
          scaling_config:  # スケーリング設定
            min_instances: number
            max_instances: number
            target_cpu_utilization: number
            target_memory_utilization: number
          monitoring_config:  # 監視設定
            health_check_path: "string"
            metrics_endpoint: "string"
            log_aggregation:
              provider: "string"
              log_group: "string"
            alerts:
              - #
                name: "string"
                metric: "string"
                threshold: number
                action: "string"
          environment_variables:  # 環境変数：環境固有の設定値（秘密情報は参照のみ）
          feature_flags:  # 機能フラグ
      deployment_pipelines:  # デプロイパイプライン
        - # デプロイパイプライン
          pipeline_id: "string"  # ✅ パイプラインID
          name: "string"  # ✅ パイプライン名
          trigger:
            type: "manual"/"commit"/"tag"/"schedule"/"api"  # トリガータイプ
            conditions:  # トリガー条件
              - "string"  #
          stages:  # ✅ ステージ
            - #
              name: "string"  # ✅
              environment: "string"
              approval_required: boolean
              steps:  # ✅
                - #
                  name: "string"
                  type: "build"/"test"/"deploy"/"verify"/"rollback"
                  script: "string"
                  timeout_minutes: number
          rollback_strategy:  # ロールバック戦略
            automatic: boolean
            conditions:
              - "string"  #
      infrastructure_templates:  # インフラストラクチャテンプレート：IaCテンプレートへの参照
        template_repository: "string"  # テンプレートリポジトリ：IaCテンプレートが格納されているリポジトリ
        template_engine: "terraform"/"cloudformation"/"pulumi"/"cdk"/"helm"  # テンプレートエンジン
        environment_overrides:  # 環境別オーバーライド：環境名をキー、テンプレート固有の設定オブジェクトを値とする。設定名と値の構造は参照する IaC テンプレートに従い、テンプレートとの適合性は利用側で検証する。
```

## 2. 主要コンポーネント

### 2.1 開発マイルストーン（development_milestones）
**マイルストーン定義**
- 対象モジュールのグルーピング（component_idとmodule_idsで指定）
- 統合テストの実行ポイント
- 品質ゲート（自動チェック基準）
- 人間レビューポイント

### 2.2 デプロイメント詳細（deployment_details）
**環境設定（environments）**
- 開発、ステージング、本番環境の設定
- スケーリング設定
- 監視・アラート設定

**デプロイパイプライン（deployment_pipelines）**
- ビルド、テスト、デプロイのステージ定義
- トリガー条件
- ロールバック戦略

## 3. 利用プロセス

### 3.1 AI Agentによる開発フロー
**計画を担当するエージェントの運用例**
```
1. system-architectureからモジュールと依存関係を読み込み
2. development_milestones から次のマイルストーンを特定
3. target_modules のcomponent_idとmodule_idsに基づいてモジュール開発を並列実行
4. マイルストーン到達時に統合テストと品質ゲートを実行
5. human_review_pointsで必要に応じて人間の判断を仰ぐ
```

**開発を担当するエージェントの運用例**
```
1. 割り当てられたモジュールをsystem-architectureから取得
   - component_idでコンポーネントを特定
   - module_idでモジュールを特定
2. モジュールの実装とテストを実行
3. 成果物を生成
```

### 3.2 マイルストーン管理
**統合テストの実行**
- intra-component: コンポーネント内のモジュール間テスト
- inter-component: 異なるコンポーネント間の連携テスト
- end-to-end: システム全体を通したテスト

**品質ゲートの評価**
- 自動チェックによる品質基準の確認
- 閾値未達の場合のアクション（block/warn/request-review）

**人間レビューの実施**
- アーキテクチャ、セキュリティ、パフォーマンスなどの観点
- blocking=trueの場合は承認待ち

### 3.3 デプロイメント実行
**環境別デプロイ**
- 各環境の設定に基づいたデプロイ実行
- feature flagsによる機能の段階的リリース

**パイプライン実行**
- トリガー条件に基づく自動実行
- ステージごとの承認フロー
- 失敗時の自動ロールバック

## 4. 使用例

### 4.1 target_modulesの記述例
```markdown
<!--@srs: development-implementation: development_milestones: milestones[0]
{
  "milestone_id": "m1-core-backend",
  "name": "コアバックエンド機能実装",
  "target_modules": [
    {
      "component_id": "backend-api",
      "module_ids": ["auth-module", "user-module", "profile-module"]
    },
    {
      "component_id": "shared-lib",
      "module_ids": ["domain-models", "utils"]
    },
    {
      "component_id": "worker-service",
      "module_ids": ["email-sender"]
    }
  ]
}
@srs-->
```

この例では、3つのコンポーネントにまたがる6つのモジュールが
このマイルストーンで完了すべき対象として指定されています：
- backend-api: auth-module, user-module, profile-module
- shared-lib: domain-models, utils
- worker-service: email-sender

### 4.2 環境別のテンプレート設定

`deployment_details.infrastructure_templates` の例。環境ごとの値はオブジェクトとし、内部の設定名・値は参照するテンプレートに従う。ここでは設定を保持し、IaC テンプレートとの適合性は利用側で検証する。

```yaml
template_engine: helm
environment_overrides:
  production:
    replicas: 3
    feature_enabled: true
    labels:
      tier: backend
  development:
    replicas: 1
```
