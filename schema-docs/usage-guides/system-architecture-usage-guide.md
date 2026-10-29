<!-- Copyright (c) 2026 CoLLMate, Inc. -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Generated from schema/ by schemadocs-generator/generate.py. Do not edit; change the schema and regenerate. -->

# 拡張SRS システムアーキテクチャ活用ガイド

本ガイドの AI 活用・自動化は、利用側のエージェントや実行環境で行う設計・運用例を含む。公式実装の提供範囲は [core](../../extended-srs-core/README.md) と [MCP サーバー](../../mcp-server/README.md) を参照する。

## 1. システムアーキテクチャとは

### 1.1 定義と目的
system-architectureは、開発開始前に決定すべき技術基盤と設計方針を定義する。これらは後から変更すると影響が大きい基盤部分であり、プロジェクト全体の技術的な方向性を決定する。

### 1.2 本質的な価値
- **技術基盤の確立**: プロジェクト全体の技術的な土台を提供
- **開発効率の向上**: 明確な方針により迷いのない開発を実現
- **品質の保証**: 横断的関心事の統一により一貫した品質を確保
- **変更リスクの低減**: 早期の決定により後戻りコストを最小化
- **AI Agent開発支援**: 大規模システムでもAI Agentが自律的に開発できる構造を提供
- **開発単位の明確化**: モジュール単位での開発タスクと依存関係を定義

### 1.3 他のスキーマとの関係
```
functional-requirements（ビジネス要件）
    ↓ 技術基盤の提供
system-architecture（技術基盤・設計方針・開発単位）
    ↓ 補足情報の提供
development-implementation（マイルストーン・デプロイ詳細）
```
system-architectureは、機能要件を技術的に実現するための安定した基盤を提供し、モジュール単位での開発作業を定義する。development-implementationは補足的な情報のみを扱う。

### 1.4 モジュールのステータスと依存関係
モジュール定義（moduleDefinition）には以下のフィールドが用意されている：
- **`status`**: 共通定義の11段階ステータス（draft → verified）。モジュール実装の進捗をトラッキング
- **`depends_on`**: 他モジュールや外部サービスへの依存。文字列IDまたは型付きオブジェクト（ref_id + ref_type + dependency_type）
- **`blocks`**: 逆依存（`depends_on` から導出。文書への保存は利用側で行う）
- **`nfr_references`**: このモジュールに適用される非機能要件IDリスト。non-functional-requirements.list[].traceability.modules との双方向参照を実現

これによりモジュール間の依存グラフが明示され、AIエージェントがビルド順序やパラレル実装可能範囲を自動判定できる。

## YAML構造

以下は型と構造を示す擬似表記。`✅` は必須項目、`/`・`|` は選択肢を示す。文書に貼り付ける際は具体的な値と `<!--@srs … @srs-->` の記法を使用する。省略した制約や拡張条件は JSON Schema を参照する。

```text
@srs:
  system-architecture:  # システムアーキテクチャ：開発開始前に決定すべき技術基盤と設計方針
    architecture:  # ✅ アーキテクチャ：システムの基本構造
      key_components:  # ✅ 主要コンポーネント構成：システムの全体構造定義。AI Agentが大規模システム開発時に「現在どの部分を開発しているか」を常に把握できるナビゲーションマップとして機能
        components:  # ✅ コンポーネント定義：システムを構成する全コンポーネントの定義。各コンポーネントは一意のIDを持ち、技術スタックを個別に定義
          - # コンポーネント定義
            component_id: "string"  # ✅ コンポーネントID：コンポーネントの一意識別子。MermaidグラフのノードIDと一致させること
            name: "string"  # ✅ コンポーネント名：コンポーネントの表示名
            type: "frontend"/"backend"/"api-gateway"/"worker"/"database"/"cache"/"queue"/"external"/"shared"  # ✅ コンポーネントタイプ：frontend: ユーザーインターフェース（Web、モバイルアプリ等）, backend: APIサーバー・アプリケーションサーバー, api-gateway: APIゲートウェイ・リバースプロキシ, worker: バックグラウンド処理・バッチ処理, database: データストア, cache: キャッシュストア, queue: メッセージキュー・イベントバス, external: 外部サービス・SaaS, shared: 複数コンポーネントで共有されるコード（ドメインモデル等）
            purpose: "string"  # 目的：このコンポーネントの役割と責任
            component_path: "string"  # コンポーネントパス：コンポーネントのルートディレクトリ。プロジェクトルートからの相対パス（例：'frontend-web'、'backend-api'）
            tech_stack:  # ✅ コンポーネント技術スタック：個々のコンポーネントで使用する技術要素
              language:
                name: "string"  # ✅ 言語名
                version: "string"  # ✅ バージョン
                purpose: "string"  # 用途：この言語を使用する目的
              framework:
                name: "string"  # ✅ フレームワーク名
                version: "string"  # ✅ バージョン
                language: "string"  # ✅ 対象言語
                purpose: "string"  # 用途
              database:
                type: "relational"/"document"/"key-value"/"graph"/"time-series"  # ✅ データベース種別
                name: "string"  # ✅ 製品名
                version: "string"  # バージョン
                purpose: "string"  # 用途
              runtime: "string"  # ランタイム環境：Node.js、JVM、.NET Core等
              libraries:  # 主要ライブラリ
                - #
                  name: "string"  # ライブラリ名
                  version: "string"  # バージョン指定（例：'^1.0.0'、'~2.3.0'、'3.1.4'）
                  purpose: "string"  # このライブラリを使用する目的
              deployment:  # デプロイメント設定
                containerized: boolean  # コンテナ化されているかどうか
                platform: "string"  # デプロイメントプラットフォーム（K8s、ECS、Lambda、Cloud Run、Heroku等）
            scaling_requirements:  # スケーリング要件
              scalability: "horizontal"/"vertical"/"both"/"none"  # スケーリング方式。horizontal: 水平スケーリング（インスタンス数増加）、vertical: 垂直スケーリング（リソース増強）、both: 両方可能、none: スケーリング不要
              expected_load: "string"  # 想定負荷の説明（例：'1000req/sec'、'100万ユーザー'、'10TB/月のデータ処理'）
            modules:  # モジュール構成：このコンポーネント内のモジュール分割。空配列の場合はモジュール分割なし（データベース等）
              - # モジュール定義
                module_id: "string"  # ✅ モジュールID：モジュールの識別子。同一コンポーネント内で一意
                name: "string"  # ✅ モジュール名：モジュールの表示名。ビジネス的な意味が分かる名前を使用
                layer: "presentation"/"application"/"domain"/"infrastructure"/"shared"  # ✅ レイヤー：レイヤードアーキテクチャにおける位置。presentation: UI/API層、application: ユースケース層、domain: ビジネスロジック層、infrastructure: 技術詳細層、shared: 共通ユーティリティ層
                purpose: "string"  # 目的：モジュールの責任範囲と役割の詳細説明
                module_relative_path: "string"  # ✅ モジュール相対パス：コンポーネントルートからの相対パス（例：'src/modules/auth'、'src/main/java/com/example/auth'）
                functional_requirements:  # 実装する機能要件：このモジュールが実装するfunctional-requirements.requirements.req_idのリスト。AI Agentはこのリストを元に実装すべき機能を把握
                  - "string"  #
                provided_interfaces:  # 提供インターフェース：このモジュールが提供する詳細なインターフェース定義
                  - # インターフェース契約
                    interface_id: "string"  # ✅ インターフェースID：インターフェースの識別子。同一モジュール内で一意
                    name: "string"  # インターフェース名
                    version: "string"  # ✅ バージョン
                    interface_type: "http-api"/"grpc"/"graphql"/"event"/"message-queue"/"database-access"/"file-io"/"library-api"  # ✅ インターフェースタイプ：http-api: REST API, grpc: gRPC, graphql: GraphQL, event: イベント, message-queue: メッセージキュー, database-access: DB操作インターフェース, file-io: ファイル入出力, library-api: プログラム内部API（クラス、関数等）。definition.type と必ず一致すること。
                    definition: object  # ✅ インターフェース定義：プロトコル固有の詳細定義
                consumed_interfaces:  # 利用インターフェース：このモジュールが利用する他モジュールのインターフェース参照
                  - #
                    component_id: "string"  # ✅ 提供元コンポーネントID
                    module_id: "string"  # ✅ 提供元モジュールID
                    interface_id: "string"  # ✅ 利用するインターフェースID
                nfr_references:  # 適用される非機能要件：このモジュールに適用される non-functional-requirements.list[].req_id のリスト。NFR 側の traceability.modules との双方向参照
                  - "string"  #
                status: "draft"/"tentative"/"approved"/"in_progress"/"blocked"/"in_review"/"rejected"/"implemented"/"verified"/"deferred"/"dropped"  # ステータス：要素のライフサイクル状態
                depends_on:  # 依存先
                  - "string" | object  #
                blocks:  # 逆依存：depends_on から導出する、この要素がブロックしている他要素の ID リスト。省略可能。文書への保存・更新は利用側で行う
                  - "string"  #
        architecture_graph: "string"  # ✅ アーキテクチャ構成図：Mermaid形式のグラフ定義。全ノードはcomponentsに登録済みのcomponent_idを使用すること
      design_principles:  # ✅ 設計原則：アーキテクチャ設計の指針。architecture_graphが実際の構造を定義し、これらの原則は理想的な方向性を示す。現実的な制約により例外は許容される
        - "string"  #
    tech_stack:  # 技術スタック：プロジェクト全体で共通使用する開発ツールと品質基準
      development_tools:  # 開発ツール：プロジェクト全体で使用するツール
        version_control:
          system: "string"  # バージョン管理システムの種類（git、svn等）
          platform: "string"  # ホスティングプラットフォーム（GitHub、GitLab、Bitbucket等）
        ci_cd:
          platform: "string"  # CI/CDプラットフォーム（GitHub Actions、Jenkins、CircleCI等）
          build_tools:
            - "string"  #
        code_quality:
          linters:
          formatters:
          static_analysis:
            - "string"  #
        testing:
          test_frameworks:
          coverage_tools:
            - "string"  #
          coverage_targets:
            unit: number
            integration: number
            e2e: number
        documentation:
          api_docs: "string"  # API仕様書の形式（OpenAPI/Swagger、GraphQL Schema等）
          code_docs: "string"  # コードドキュメントの形式（JSDoc、JavaDoc、Sphinx等）
      dependency_management:  # 依存関係管理
        update_policy: "conservative"/"moderate"/"aggressive"  # 依存関係の更新方針。conservative: 安定版のみ使用、moderate: マイナーバージョンまで自動更新、aggressive: 最新版を積極的に採用
        security_scanning: boolean  # セキュリティ脆弱性の自動スキャン有効化
        license_check: boolean  # ライセンス互換性の自動チェック有効化
    data_models:  # データモデル：functional-requirements のdata_modelsに対する技術実装仕様。AI Agentがデータ永続化層を実装するための物理設計情報
      entities:  # ✅ エンティティ定義：データエンティティの技術仕様
        - #
          entity_id: "string"  # ✅ エンティティID：エンティティの一意識別子
          data_id: "string"  # ✅ 機能要件データ参照：functional-requirements.data_models.data_idへの参照
          component_id: "string"  # ✅ コンポーネントID：このエンティティを格納するデータベースコンポーネントのID（key_components.components.component_idへの参照）
          table_name: "string"  # ✅ 物理テーブル名：実際のDBテーブル名
          schema_name: "string"  # スキーマ名：データベーススキーマ名（オプション）
          columns:  # ✅ カラム定義：物理カラムと機能要件の属性のマッピング
            - # カラムマッピング
              attribute_name: "string"  # ✅ 属性名：functional-requirements.data_models.attributes.nameへの参照
              column_name: "string"  # ✅ 物理カラム名：データベースの実際のカラム名
              data_type_override: "string"  # データ型オーバーライド：DBMSごとの具体的なデータ型（例：VARCHAR(255)、DECIMAL(10,2)）
              additional_constraints:  # 追加制約：技術的な追加制約（CHECK制約など）
                - "string"  #
          constraints:  # テーブル制約
            primary_key:  # 主キー：主キーカラム名のリスト
              - "string"  #
            unique_constraints:  # ユニーク制約
              - #
                name: "string"  # 制約名：ユニーク制約の名前
                columns:  # 対象カラム：ユニーク制約の対象となるカラム名のリスト
                  - "string"  #
            foreign_keys:  # 外部キー
              - #
                name: "string"  # 制約名：外部キー制約の名前
                column: "string"  # カラム名：外部キーとなるカラム名
                references:  # 参照先
                  entity_id: "string"  # 参照先エンティティID：参照先のentity_id
                  column: "string"  # 参照先カラム名：参照先テーブルのカラム名
                on_delete: "CASCADE"/"SET NULL"/"RESTRICT"  # 削除時動作：参照先レコード削除時の動作。CASCADE: 連鎖削除、SET NULL: NULL設定、RESTRICT: 削除禁止
          indexes:  # インデックス：パフォーマンス最適化のための基本的なインデックス定義
            - #
              name: "string"  # インデックス名
              columns:  # ✅ 対象カラム
                - "string"  #
              type: "btree"/"hash"/"gin"/"gist"/"spatial"  # インデックスタイプ
              unique: boolean  # ユニーク制約
          partitioning:  # パーティショニング：大規模データの場合のみ事前定義
            strategy: "range"/"hash"/"list"  # 分割戦略
            key: "string"  # パーティションキー
          implementation_hints:  # 実装ヒント：AI Agentへの追加指示（詳細な最適化は開発中に決定）
            expected_volume: "string"  # 想定データ量：想定データ量の目安（例：'初期100万件、月10万件増加'、'1レコード1KB、総容量10GB'）
            access_patterns:  # アクセスパターン：主なアクセスパターン（例：'IDによる単一検索が90%'、'日付範囲での集計が主'、'全件スキャンは夜間バッチのみ'）
              - "string"  #
            performance_critical: boolean  # パフォーマンスクリティカル：パフォーマンスクリティカルなテーブルかどうか。trueの場合、AI Agentは特に慎重に最適化を検討
      implementation_notes:  # 実装ノート：AI Agentへのデータ層実装に関する追加指示
        - "string"  #
    common_technical_policies:  # 共通技術方針：システム全体で統一的に適用される技術実装方針（横断的関心事）。すべてのモジュール・コンポーネントで遵守すべき共通ルール
      security:  # セキュリティ方針：システム全体に適用されるセキュリティ実装方針
        authentication:
          provider: "string"  # 認証プロバイダー（Auth0、AWS Cognito、Firebase Auth、Keycloak、Custom等）
          token_type: "JWT"/"OAuth2"/"SAML"  # 認証トークンの種類。JWT: JSON Web Token、OAuth2: OAuth 2.0、SAML: Security Assertion Markup Language
          session_management:
            storage: "redis"/"in-memory"/"database"  # セッションストレージの種類。redis: Redis使用、in-memory: メモリ内保存、database: DBに永続化
            expiry_seconds: number  # セッションの有効期限（秒）
        authorization:
          model: "RBAC"/"ABAC"/"ReBAC"  # 認可モデル。RBAC: Role-Based Access Control、ABAC: Attribute-Based Access Control、ReBAC: Relationship-Based Access Control
          default_policies:  # デフォルトのアクセス制御ポリシー
            - "string"  #
        encryption:
          at_rest:
            algorithm: "string"  # 暗号化アルゴリズム（例：AES-256、RSA-2048）
            key_management: "AWS-KMS"/"HashiCorp-Vault"/"Local-HSM"  # 鍵管理システム。AWS-KMS: AWS Key Management Service、HashiCorp-Vault: Vault、Local-HSM: Hardware Security Module
          in_transit:
            tls_version: "1.2"/"1.3"  # 使用するTLSバージョン
            enforce_https: boolean  # HTTPS通信の強制
        security_headers:  # セキュリティヘッダーの設定
          csp: "string"  # Content Security Policyの設定
          hsts: boolean  # HTTP Strict Transport Securityの有効化
          x_frame_options: "string"  # X-Frame-Optionsヘッダーの値（例：DENY、SAMEORIGIN）
      performance:  # パフォーマンス方針：システム全体に適用されるパフォーマンス最適化方針
        caching_strategy:
          default_ttl: number  # デフォルトのキャッシュ有効期限（秒）
          cache_headers:  # HTTPキャッシュヘッダー名と文字列値の対応（例：Cache-Control: no-store）
        response_optimization:
          compression: boolean  # レスポンス圧縮の有効化
          minification: boolean  # リソースの最小化
        resource_pooling:
          connection_pool_size: number  # デフォルトのコネクションプールサイズ
          thread_pool_size: number  # スレッドプールサイズ
        monitoring_thresholds:
          response_time_warn_ms: number
          response_time_error_ms: number
          error_rate_threshold: number
      logging:  # ロギング方針
        structured_logging: boolean  # 構造化ログ（JSON形式等）の使用
        log_levels:
          default: "debug"/"info"/"warn"/"error"  # 開発環境でのデフォルトログレベル
          production: "info"/"warn"/"error"  # 本番環境でのログレベル
        correlation_id_strategy: "string"  # リクエスト追跡のための相関ID戦略（例：UUID生成、X-Request-IDヘッダー使用）
        sensitive_data_handling: "string"  # 機密データのマスキング方針（例：パスワード、クレジットカード番号、個人情報の扱い）
      error_handling:  # エラーハンドリング方針
        global_error_handler: boolean  # グローバルエラーハンドラーの実装有無
        error_response_format: object | boolean  # 統一的なエラーレスポンスのデータ構造（エラーコード、メッセージ、詳細情報など）。JSON Schema Draft 7 で型を直接記述する。
        error_classification:
          - #
            category: "string"  # エラーカテゴリ（例：validation、business、system）
            http_status_mapping: number  # 対応するHTTPステータスコード
            retry_allowed: boolean  # リトライ可能なエラーかどうか
      transaction_management:  # トランザクション管理方針
        default_isolation_level: "READ_UNCOMMITTED"/"READ_COMMITTED"/"REPEATABLE_READ"/"SERIALIZABLE"  # デフォルトのトランザクション分離レベル
        distributed_transaction_strategy: "2PC"/"saga"/"eventual-consistency"  # 分散トランザクション戦略。2PC: 2フェーズコミット、saga: Sagaパターン、eventual-consistency: 結果整合性
      validation:  # 検証方針
        validation_library: "string"  # 使用する検証ライブラリ
        validation_timing: "client-side"/"server-side"/"both"  # 検証実行タイミング。client-side: クライアント側のみ、server-side: サーバー側のみ、both: 両方で実行
        custom_validators:
          - #
            name: "string"  # バリデーター名
            purpose: "string"  # バリデーターの用途
            implementation_hint: "string"  # 実装のヒント
    deployment_strategy:  # デプロイ戦略：デプロイメントの基本方針
      environments:  # 環境構成
        - #
          name: "string"  # 環境名（例：dev、stg、prod）
          type: "development"/"staging"/"production"  # 環境タイプ
          purpose: "string"  # 環境の用途（例：開発、テスト、本番）
      deployment_method: "blue-green"/"canary"/"rolling"/"recreate"  # デプロイ方式
      infrastructure_as_code:
        tool: "terraform"/"cloudformation"/"pulumi"/"cdk"  # Infrastructure as Codeツール
      containerization:
        enabled: boolean  # コンテナ化の有効化
        registry: "string"  # コンテナレジストリのURL（Docker Hub、ECR、GCR等）
    development_principles:  # 開発原則：開発プロセスの基本方針
      milestone_strategy:  # マイルストーン戦略
        approach: "iterative"/"incremental"/"big-bang"  # 開発アプローチ。iterative: 反復型、incremental: 増分型、big-bang: 一括リリース型
        milestone_duration: "string"  # 標準的なマイルストーン期間（例：'2週間'、'1ヶ月'、'3スプリント'）
      quality_gates:  # 品質ゲート方針
        mandatory_gates:  # 必須の品質ゲート（例：'単体テスト通過'、'コードレビュー承認'、'セキュリティスキャン合格'）
          - "string"  #
        automation_level: "full"/"partial"/"manual"  # 自動化レベル。full: 完全自動化、partial: 部分的自動化、manual: 手動確認
      review_process:  # レビュープロセス
        code_review_required: boolean  # コードレビューの必須化
        architecture_review_triggers:  # アーキテクチャレビューのトリガー条件（例：'新規コンポーネント追加'、'外部API統合'、'データモデル変更'）
          - "string"  #
      parallel_development:  # 並列開発方針
        strategy: "feature-branch"/"trunk-based"/"git-flow"  # ブランチ戦略。feature-branch: 機能ブランチ、trunk-based: トランクベース開発、git-flow: Git Flow
        integration_frequency: "string"  # 統合頻度（例：'1日複数回'、'デイリー'、'週次'）
```

## 2. 主要コンポーネント

### 2.1 技術基盤コンポーネント
**アーキテクチャ（architecture）**
- 主要コンポーネント構成（key_components）：
  - 各コンポーネントの一意ID、名称、タイプ、技術スタック
  - Mermaid形式のアーキテクチャ図（AI Agentの「ナビゲーションマップ」）
- 設計原則（design_principles）：
  - アーキテクチャパターンの方針（マイクロサービス、モノリシック等）
  - 理想的な設計方向性を示すが、architecture_graphの実装を優先
  - 現実的な制約による例外を許容

**技術スタック（tech_stack）**
- プロジェクト全体の開発ツール（VCS、CI/CD、品質管理）
- テストフレームワークとカバレッジ目標
- ドキュメント生成ツール
- 依存関係管理ポリシー

**データモデル（data_models）**
- functional-requirements のデータ定義に対する物理実装仕様
- テーブル設計、インデックス戦略
- パーティショニング、キャッシュ戦略
- リレーション実装とフェッチ戦略

### 2.2 構造定義コンポーネント
**コンポーネント内モジュール構造**
- 各コンポーネントの`modules`配列で定義
- コンポーネントとモジュールの関係:
  - コンポーネント：デプロイ単位、技術スタックの境界
  - モジュール：開発単位、責任範囲の境界
- レイヤー構造（presentation/application/domain/infrastructure/shared）
- モジュール間の依存関係は`depends_on` 配列で表現
- 各モジュールが実装する機能要件の明確化

### 2.3 方針定義コンポーネント
**共通技術方針（common_technical_policies）**
- セキュリティ：認証・認可、暗号化、セキュリティヘッダー
- パフォーマンス：キャッシュ、リソースプーリング、監視閾値
- ロギング：構造化ログ、ログレベル、相関ID戦略
- エラーハンドリング：統一的なエラー処理方式
- トランザクション管理：分離レベル、分散トランザクション戦略
- 検証：バリデーションライブラリ、タイミング

**デプロイ戦略（deployment_strategy）**
- 環境構成（開発、ステージング、本番）
- デプロイ方式（Blue-Green、カナリア等）
- Infrastructure as Codeツール
- コンテナ化の方針

**開発原則（development_principles）**
- マイルストーン戦略
- 品質ゲートの設定
- レビュープロセス
- 並列開発の方針

### 2.4 利用者が定義するデータ型

`request_schema`、`response_schema`、`payload_schema`、`message_schema`、ファイル入出力の `schema`、`error_response_format` は、JSON Schema Draft 7 でデータ型を直接記述する欄である。フィールド名、型、必須項目、配列要素などを利用者が定義する。

共通定義は固定の Draft 7 メタスキーマを参照する。core は AJV に同梱されたメタスキーマを使用し、検証時に外部スキーマを取得しない。`$schema` を記載する場合も Draft 7 を指定する。

- メタスキーマは標準キーワードの値の型や構造を検証する。実際のリクエストやレスポンスを、その型定義に適合するか検証する処理は利用側で行う。
- `{}` と `true` は任意の値を許可し、`false` はすべての値を拒否する型定義として有効。
- 未知のキーワードはデータに保持し、core は警告で知らせる。`x-*` は拡張注釈として保持し、未知キーワードの警告対象にしない。拡張注釈を追加しても、新しい検証規則としては実行されない。
- 型定義中の `$ref` は参照文字列として保持する。参照先の解決・存在・適合性はこの検証では確認せず、その旨を警告する。参照を利用するアプリケーションが解決と検証を行う。
- フォームで型定義を編集する場合は、利用側で JSON／YAML 編集部品などを用意する。メタスキーマを指定するだけで型定義の編集 UI が自動生成されるわけではない。

`headers` と `cache_headers` はヘッダー名から文字列値へのマップである。型定義を格納する欄とは区別する。

### 2.5 インターフェース種別の一致

`interfaceContract.interface_type` と `definition.type` は必ず一致する。例えば、`interface_type: http-api` と `definition.type: grpc` の組み合わせは Schema 検証エラーとなる。

## 3. 決定プロセス

### 3.1 プロジェクト開始時の決定事項
**ステップ1：基本アーキテクチャの選定**
1. ビジネス要件の特性を分析
2. 非機能要件（スケーラビリティ、可用性等）を考慮
3. 設計原則を策定（理想的なアーキテクチャパターンを含む）
4. 主要コンポーネントを識別し、key_componentsとして定義
5. architecture_graphで実際の構造を表現（原則からの逸脱も許容）

**ステップ2：技術スタックの選定**
1. 開発チームのスキルセットを考慮
2. エコシステムの成熟度を評価
3. ライセンスとコストを検討
4. 言語、フレームワーク、DBを決定

**ステップ3：共通方針の策定**
1. セキュリティ要件から認証・認可方式を決定
2. パフォーマンス目標からキャッシュ戦略を決定
3. 運用要件からロギング・監視方針を決定
4. 開発プロセスと品質基準を定義

### 3.2 要件定義後の詳細化
**ステップ4：データモデルの物理設計**
1. functional-requirements のデータモデルを分析
2. 物理テーブル設計とカラムマッピング
3. インデックス戦略の決定
4. パーティショニングとアーカイブ方針

**ステップ5：モジュール分割の確定**
1. 機能要件からモジュール境界を識別
2. 各モジュールの責任範囲を明確化
3. 各コンポーネント内でモジュール構造を設計：
   - レイヤー構造の決定
   - モジュールごとに実装する機能要件を割り当て
   - モジュール間の依存関係を定義
4. 公開インターフェースの概要を決定

### 3.3 継続的な見直しプロセス
**定期レビュー**
- 四半期ごとの技術スタック見直し
- セキュリティポリシーの更新
- パフォーマンスチューニング結果の反映

**変更管理**
- アーキテクチャ決定記録（ADR）の作成
- 影響分析の実施
- 段階的な移行計画の策定

## 4. AI Agentとの協調

### 4.1 key_componentsとmodule_structureの使い分け

**key_componentsの使い方**
AI Agentはkey_componentsを「システム全体地図」として使用：
1. **全体把握**: architecture_graphでシステム全体の構成を理解
2. **技術選択**: 各コンポーネントのtech_stackを確認
3. **デプロイ境界**: どの機能がどのコンポーネントで動作するか把握

**module_structureの使い方**
AI Agentは各コンポーネントの`modules`配列を「開発作業の単位」として使用：
1. **並列開発**: 依存関係のないモジュールを並列で開発
2. **責任範囲**: 各モジュールが実装すべき機能要件を確認
3. **インターフェース**: 公開すべき関数やクラスを把握

### 4.2 実際の開発フロー

**ステップ1：開発対象の特定**
```
例：「user-registration機能を実装せよ」
1. functional-requirements で req_id: "user-registration" を確認
2. 全コンポーネントのmodulesを走査し、functional_requirements に "user-registration" を含むモジュールを検索
3. 該当モジュール（例：api-application）を含むコンポーネント（例：backend-api）を特定
4. そのコンポーネントの技術スタックを確認
```

**ステップ2：依存関係の確認**
```
1. 開発対象モジュールの depends_on と consumed_interfaces を確認
2. 依存先モジュールの provided_interfaces を確認
3. 異なるコンポーネントの場合、公開APIのみ使用可能
```

**ステップ3：並列開発の判断**
計画を担当するエージェントは、依存先の状態・契約を確認して並行作業の可否を判断する：
- 相互に依存関係がないモジュール
- 異なるコンポーネント間でも依存条件と共有資源の競合を満たすモジュール
- 同一コンポーネント内でも異なるレイヤーのモジュール（下位層が実装済みの場合）

**ステップ4：開発タスクの実行**
開発を担当するエージェントは各モジュールを一つの開発単位として：
1. provided_interfacesの実装
2. consumed_interfacesのモック利用
3. functional_requirementsの実現
4. コンポーネントの component_path とモジュールの module_relative_path で指定した場所へのコード生成

## 5. 記述例
部分抽出のパスは配置例。既存要素に追記する例では、配列の添字を対象文書に合わせる。

### 5.1 design_principlesの例
設計原則にアーキテクチャパターンを含めた記述例：

```markdown
<!--@srs: system-architecture: architecture: design_principles
- "マイクロサービスアーキテクチャを基本とするが、初期段階ではモジュラーモノリスから開始"
- "イベント駆動アーキテクチャを採用し、サービス間の疎結合を実現"
- "レイヤードアーキテクチャで責任を明確に分離"
- "ヘキサゴナルアーキテクチャによりビジネスロジックを保護"
- "各サービスは単一責任の原則に従い、明確な境界を持つ"
- "データの一貫性よりも可用性を優先（最終的整合性）"
- "障害の局所化のため、サーキットブレーカーパターンを適用"
@srs-->
```

これらの原則は理想的な方向性を示すが、architecture_graphで定義される実際の構造が優先される。

### 5.2 リクエストの型定義

以下は HTTP API の `definition` に記述する例。外側のインターフェース契約には `interface_id`、`version`、`interface_type: http-api` を指定する。

```yaml
type: http-api
path: /items
method: POST
headers:
  Content-Type: application/json
request_schema:
  type: object
  properties:
    name:
      type: string
    quantity:
      type: integer
      minimum: 1
  required: [name, quantity]
  additionalProperties: false
response_schema:
  type: object
  properties:
    id:
      type: string
  required: [id]
```
