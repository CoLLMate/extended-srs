<!-- Copyright (c) 2026 CoLLMate, Inc. -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Generated from schema/ by schemadocs-generator/generate.py. Do not edit; change the schema and regenerate. -->

# 拡張SRS ワークフロー設定活用ガイド

本ガイドの AI 活用・自動化は、利用側のエージェントや実行環境で行う設計・運用例を含む。公式実装の提供範囲は [core](../../extended-srs-core/README.md) と [MCP サーバー](../../mcp-server/README.md) を参照する。

## 1. ワークフロー設定とは
### 1.1 定義と本質的目的
ワークフロー設定は、Human-Agent協調開発における**自律度ポリシー**、**承認ゲート**、**整合性チェック**、および**意思決定記録**を管理するセクションである。エージェントがどの操作を自律的に行えるか、どの操作に人間の承認が必要かを宣言的に定義する。
### 1.2 3つの構成要素
| 構成要素 | 目的 | 効果 |
|---------|------|------|
| **autonomy_policy** | 操作種別ごとのエージェント自律度レベルを定義 | 人間の意図に沿った自動化範囲の制御 |
| **approval_gates** | ステータス遷移やコンテンツ変更の承認ポイントを設定 | 品質保証と人間のコントロール維持 |
| **consistency_check** | YAML↔Markdown間の整合性チェック設定 | 整合性確認の対象と実行方針の共有 |
### 1.3 自律度ポリシー
| `gate` | 宣言する方針 | 適用 |
|--------|------|--------|
| `false` | 人間承認を要求しない | 実行可否は状態・依存条件なども含めて判定する |
| `true` | 人間の承認を要求する | 公式 core / MCP は対応する状態遷移・レビューで判定する |
設定したすべての操作を公式 MCP が実行・制御するわけではない。実行者の認証と役割の確認は利用側が行う。条件式の評価、自動チェックの実行、コミット時の整合性チェックには利用側の連携が必要。
### 1.4 意思決定記録
プロジェクトレベルの決定事項（`decisions`）と未解決の意思決定（`pending_decisions`）を構造化して管理する。これにより決定の経緯と根拠をトレーサブルに保持し、AI/人間どちらが後から参照しても意図を正確に理解できる。

## YAML構造

以下は型と構造を示す擬似表記。`✅` は必須項目、`/`・`|` は選択肢を示す。文書に貼り付ける際は具体的な値と `<!--@srs … @srs-->` の記法を使用する。省略した制約や拡張条件は JSON Schema を参照する。

```text
@srs:
  workflow:  # ワークフロー設定：Human-Agent 協調ワークフローの設定と意思決定記録
    config:  # ワークフロー構成
      autonomy_policy:  # 自律度ポリシー：操作種別ごとのエージェント自律度レベル定義
        default_gate: boolean  # false=人間承認を要求しない方針 / true=人間承認を要求する方針。適用する操作と認証は利用側の実装に従う
        operations:
          metadata_update:
            gate: boolean  # ✅ true=人間承認を要求する方針 / false=人間承認を要求しない方針
            conditions:  # gate をオーバーライドする条件式
              - "string"  #
            approver_role: "string"  # 承認者の役割（gate: true 時に使用）
          status_draft_to_tentative:
            gate: boolean  # ✅ true=人間承認を要求する方針 / false=人間承認を要求しない方針
            conditions:  # gate をオーバーライドする条件式
              - "string"  #
            approver_role: "string"  # 承認者の役割（gate: true 時に使用）
          status_tentative_to_approved:
            gate: boolean  # ✅ true=人間承認を要求する方針 / false=人間承認を要求しない方針
            conditions:  # gate をオーバーライドする条件式
              - "string"  #
            approver_role: "string"  # 承認者の役割（gate: true 時に使用）
          status_approved_to_in_progress:
            gate: boolean  # ✅ true=人間承認を要求する方針 / false=人間承認を要求しない方針
            conditions:  # gate をオーバーライドする条件式
              - "string"  #
            approver_role: "string"  # 承認者の役割（gate: true 時に使用）
          status_in_progress_to_in_review:
            gate: boolean  # ✅ true=人間承認を要求する方針 / false=人間承認を要求しない方針
            conditions:  # gate をオーバーライドする条件式
              - "string"  #
            approver_role: "string"  # 承認者の役割（gate: true 時に使用）
          status_in_review_to_implemented:
            gate: boolean  # ✅ true=人間承認を要求する方針 / false=人間承認を要求しない方針
            conditions:  # gate をオーバーライドする条件式
              - "string"  #
            approver_role: "string"  # 承認者の役割（gate: true 時に使用）
          status_implemented_to_verified:
            gate: boolean  # ✅ true=人間承認を要求する方針 / false=人間承認を要求しない方針
            conditions:  # gate をオーバーライドする条件式
              - "string"  #
            approver_role: "string"  # 承認者の役割（gate: true 時に使用）
          status_in_progress_to_blocked:
            gate: boolean  # ✅ true=人間承認を要求する方針 / false=人間承認を要求しない方針
            conditions:  # gate をオーバーライドする条件式
              - "string"  #
            approver_role: "string"  # 承認者の役割（gate: true 時に使用）
          status_blocked_to_in_progress:
            gate: boolean  # ✅ true=人間承認を要求する方針 / false=人間承認を要求しない方針
            conditions:  # gate をオーバーライドする条件式
              - "string"  #
            approver_role: "string"  # 承認者の役割（gate: true 時に使用）
          status_rejected_to_draft:
            gate: boolean  # ✅ true=人間承認を要求する方針 / false=人間承認を要求しない方針
            conditions:  # gate をオーバーライドする条件式
              - "string"  #
            approver_role: "string"  # 承認者の役割（gate: true 時に使用）
          content_change_draft:
            gate: boolean  # ✅ true=人間承認を要求する方針 / false=人間承認を要求しない方針
            conditions:  # gate をオーバーライドする条件式
              - "string"  #
            approver_role: "string"  # 承認者の役割（gate: true 時に使用）
          content_change_approved:
            gate: boolean  # ✅ true=人間承認を要求する方針 / false=人間承認を要求しない方針
            conditions:  # gate をオーバーライドする条件式
              - "string"  #
            approver_role: "string"  # 承認者の役割（gate: true 時に使用）
          new_requirement:
            gate: boolean  # ✅ true=人間承認を要求する方針 / false=人間承認を要求しない方針
            conditions:  # gate をオーバーライドする条件式
              - "string"  #
            approver_role: "string"  # 承認者の役割（gate: true 時に使用）
          delete_requirement:
            gate: boolean  # ✅ true=人間承認を要求する方針 / false=人間承認を要求しない方針
            conditions:  # gate をオーバーライドする条件式
              - "string"  #
            approver_role: "string"  # 承認者の役割（gate: true 時に使用）
          architecture_change:
            gate: boolean  # ✅ true=人間承認を要求する方針 / false=人間承認を要求しない方針
            conditions:  # gate をオーバーライドする条件式
              - "string"  #
            approver_role: "string"  # 承認者の役割（gate: true 時に使用）
          dependency_addition:
            gate: boolean  # ✅ true=人間承認を要求する方針 / false=人間承認を要求しない方針
            conditions:  # gate をオーバーライドする条件式
              - "string"  #
            approver_role: "string"  # 承認者の役割（gate: true 時に使用）
          test_generation:
            gate: boolean  # ✅ true=人間承認を要求する方針 / false=人間承認を要求しない方針
            conditions:  # gate をオーバーライドする条件式
              - "string"  #
            approver_role: "string"  # 承認者の役割（gate: true 時に使用）
          implementation_within_scope:
            gate: boolean  # ✅ true=人間承認を要求する方針 / false=人間承認を要求しない方針
            conditions:  # gate をオーバーライドする条件式
              - "string"  #
            approver_role: "string"  # 承認者の役割（gate: true 時に使用）
          priority_change:
            gate: boolean  # ✅ true=人間承認を要求する方針 / false=人間承認を要求しない方針
            conditions:  # gate をオーバーライドする条件式
              - "string"  #
            approver_role: "string"  # 承認者の役割（gate: true 時に使用）
          scope_change:
            gate: boolean  # ✅ true=人間承認を要求する方針 / false=人間承認を要求しない方針
            conditions:  # gate をオーバーライドする条件式
              - "string"  #
            approver_role: "string"  # 承認者の役割（gate: true 時に使用）
      approval_gates:
        - # 承認ゲート設定
          gate_id: "string"  # ✅
          gate_type: "content"/"implementation"/"verification"/"architecture"  # ✅
          required_for:
            - "string"  #
          approver_role: "string"
          auto_approve_conditions:
            - "string"  #
          automated_checks:
            - "string"  #
          blocking: boolean
          on_approval_status_transition: "approved"/"in_progress"/"implemented"/"verified"  # ゲート承認時に遷移する SRS ステータス値（例: content ゲート承認 → approved、implementation ゲート承認 → implemented）
      consistency_check:  # 整合性チェック設定：YAML ↔ Markdown 双方向整合性チェックの設定
        enabled: boolean
        check_on_commit: boolean  # commit 時に自動チェックを要求する方針。実行には利用側での連携が必要で、公式 MCP は自動実行しない
        check_fields:  # チェック対象の YAML フィールド名リスト
          - "string"  #
        strict_mode: boolean  # 矛盾がある場合に commit をブロックする方針。検出・ブロック処理は利用側で実装する
    decisions:  # プロジェクトレベル決定記録
      - # 決定記録
        decision_id: "string"  # ✅
        decided_by: "string"  # ✅
        decision: "string"  # ✅
        rationale: "string"  # ✅
        alternatives_considered:
          - #
            option: "string"
            pros:
              - "string"  #
            cons:
              - "string"  #
            rejected_reason: "string"
        affected_elements:
          - "string"  #
        reversibility: "reversible"/"costly_to_reverse"/"irreversible"
    pending_decisions:  # 未解決の意思決定事項
      - # 未解決の意思決定
        question: "string"  # ✅
        raised_by: "string"
        impact:  # ✅
          - "string"  #
        default_assumption: "string"
        urgency: "blocking"/"important"/"nice_to_know"
        options:
          - #
            option: "string"
            implication: "string"
        resolution:
          decided_by: "string"
          answer: "string"
          rationale: "string"
```

## 2. ベストプラクティス
### 2.1 自律度ポリシーの設計
1. **デフォルトは gate: false で開始**
   - `default_gate: false` を推奨初期値とする
   - 人間の承認が必要な操作のみ明示的に `gate: true` に設定
2. **操作種別ごとの適切な設定**
   - `metadata_update`: 低リスク → `gate: false`
   - `content_change_approved`: 承認済みコンテンツの変更 → `gate: true`
   - `architecture_change`: アーキテクチャ変更 → `gate: true`
   - `status_tentative_to_approved`: 意思決定 → `gate: true`
   - `status_blocked_to_in_progress`: ブロック解除 → `gate: false`
   - `status_rejected_to_draft`: 差し戻し修正 → `gate: false`
3. **条件付きオーバーライドの活用**
   - `conditions` に切替条件を記述し、利用側で評価処理を用意する
   - 例: priority が must の要素のみ `gate: true` にする
### 2.2 承認ゲートの設計
1. **必要最小限のゲート設定**
   - 全てにゲートを設けず、重要な遷移のみに設定
   - `auto_approve_conditions` に自動承認の条件を記述する。公式 MCP には条件式の評価器はない
   - `on_approval_status_transition` でゲート承認後の status 遷移先を明示
2. **自動化チェックの活用**
   - `automated_checks` に必要なチェックを列挙する。呼び出し側で実行・確認した結果を公式 MCP に渡す
   - 自動チェック合格時の `auto_approve_conditions` と組み合わせて効率化
### 2.3 整合性チェックの運用
1. **段階的な厳格化**
   - 利用側に整合性チェックを実装する場合、初期は `strict_mode: false` で警告に留める方針を設定
   - プロジェクト安定後に `strict_mode: true` に移行
2. **チェック対象の選定**
   - `check_fields` で重要なフィールドのみを対象に
   - `check_on_commit: true` はコミット時の自動検証を要求する設定。Git フック等の実行処理は別途用意する。公式 MCP の `check_consistency` は本文と YAML の組を返し、意味的な合否は判定しない

## 3. 実例
### 3.1 推奨デフォルト設定
```markdown
<!--@srs: workflow
config:
  autonomy_policy:
    default_gate: false
    operations:
      status_tentative_to_approved:
        gate: true
        approver_role: "product_owner"
      status_in_review_to_implemented:
        gate: true
      status_implemented_to_verified:
        gate: true
      content_change_approved:
        gate: true
      architecture_change:
        gate: true
        approver_role: "architect"
      delete_requirement:
        gate: true
      priority_change:
        gate: true
      scope_change:
        gate: true
  approval_gates:
    - gate_id: "req-approval"
      gate_type: "content"
      required_for: ["tentative_to_approved"]
      approver_role: "product_owner"
      on_approval_status_transition: "approved"
      automated_checks:
        - "acceptance_tests_pass"
    - gate_id: "impl-verification"
      gate_type: "verification"
      required_for: ["implemented_to_verified"]
      on_approval_status_transition: "verified"
      automated_checks:
        - "acceptance_tests_pass"
        - "type_check_pass"
        - "coverage_threshold_met"
  consistency_check:
    enabled: true
    check_on_commit: true
    strict_mode: false
@srs-->
```
### 3.2 意思決定記録の例
```markdown
<!--@srs: workflow
decisions:
  - decision_id: "DEC-001"
    decided_by: "architect"
    decision: "マイクロサービスアーキテクチャを採用"
    rationale: "スケーラビリティと独立デプロイの要件を満たすため"
    alternatives_considered:
      - option: "モノリシック"
        pros: ["シンプル", "初期開発が速い"]
        cons: ["スケーラビリティに制約"]
        rejected_reason: "将来のスケール要件を満たせない"
    affected_elements: ["SA-001", "SA-002"]
    reversibility: "costly_to_reverse"
pending_decisions:
  - question: "認証方式をOAuth2とSAMLのどちらにするか"
    raised_by: "security_lead"
    impact: ["NFR-SEC-001", "SA-003"]
    urgency: "blocking"
    options:
      - option: "OAuth2"
        implication: "モバイル対応が容易、SPA向き"
      - option: "SAML"
        implication: "エンタープライズSSO統合に強い"
@srs-->
```
