<!-- SPDX-License-Identifier: Apache-2.0 -->

# extended-srs-mcp-server

Copyright (c) 2026 CoLLMate, Inc.

CoLLMate, Inc. が開発・提供する Extended SRS の公式 MCP サーバー。
AI エージェントに接続し、仕様書の検証・状態取得・レビュー・ライフサイクル操作に利用する。解析・集約・状態遷移・着手可否・承認条件の判定は core に委ね、このサーバーは MCP 通信、文書とレビューの保存、Git、通知を担当する。

Apache License 2.0。本文を `LICENSE` に同梱する。
現在は `private: true` とし、npm レジストリへの公開を無効にしている。

## ビルドとテスト

開発・テストには Node.js 24 LTS と npm を使用する。履歴参照や自動 commit には Git が必要。core を先にビルドしてから、このディレクトリで実行する。

```sh
npm --prefix ../extended-srs-core ci
npm --prefix ../extended-srs-core run build
npm ci
npm run build
npm test
npm run test:coverage
```

test の前処理でサーバーを再ビルドする。テストは、状態遷移・レビュー・履歴に加えて、stdio で起動したサーバーの 13 ツールの定義と SRS ルートの検証を確認する。

`test:coverage` のレポートは `coverage/` に出力する。

静的検査と整形はリポジトリ共通の ESLint / Prettier を使用する。リポジトリのルートで `npm ci` を実行し、`npm run check:style` でソース・テスト・補助スクリプトを確認する。修正時は `npm run lint:fix`、`npm run format` を使用する。

## ツール

現行の 13 ツールを提供する。

| 操作 | ツール |
| --- | --- |
| 文書の検証・集約 | `validate_extended_srs` |
| 要素の状態と着手可能な要素の取得 | `get_project_state`、`get_unblocked_elements` |
| 本文とメタデータの整合性を評価するための情報取得 | `check_consistency` |
| 状態・変更履歴の取得 | `get_status_history`、`get_change_log` |
| レビューの提出・履歴・承認・差戻し | `submit_for_review`、`get_review_history`、`approve_review`、`reject_review` |
| 要素の状態変更・承認・差戻し | `set_element_status`、`approve_element`、`reject_element` |

`check_consistency` は評価対象の本文とメタデータの組を返す。意味的な整合性の判定は、呼び出し側の AI エージェントや利用者が行う。入力パラメーターは [test/mcp-tools.json](test/mcp-tools.json) を参照する。

## ソースの責務

SRS の解釈は `extended-srs-core/api` の `CoreApiV1` を通して実行する。`tools/` は core の処理と I/O を組み合わせるハンドラーで、Schema のルールを再実装しない。

| ソース | 責務 |
| --- | --- |
| `tools/validate.ts` | 文書を取得し、core の検証結果を応答に整形する |
| `tools/project.ts` | core に状態一覧・着手可否を問い合わせ、必要なレビュー記録を渡す |
| `tools/consistency.ts` | 安全に文書を読み、core の YAML と本文の対応付けを返す |
| `tools/lifecycle.ts` | core が作成した変更案を競合確認付きで保存し、自動 commit を行う |
| `tools/review.ts` | core のレビュー判定と、採番・排他保存・状態更新・任意の通知を組み合わせる |
| `tools/history.ts` | Git の各時点の文書を core で集約し、有効な状態の変化と変更履歴を返す |
| `io/` | ファイル取得・保存、ディレクトリを固定した保存ワーカー、Git 操作、履歴の取得 |
| `protocol/` | MCP ツール定義、振り分け、応答とエラー形式の統一 |
| `integrations/reviewNotifications.ts` | 任意の外部通知サービスとの連携 |
| `index.ts` | stdio サーバーの起動と MCP ハンドラー登録 |

ツール操作が失敗した場合、JSON の `success: false` に加えて MCP の `isError: true` を返す。文書検証を実行できた場合は `success: true` とし、文書自体の問題を `result.errors` / `result.warnings` で返す。

## 起動と設定

`EXTENDED_SRS_ROOT` で指定したディレクトリを SRS ルートとして扱う。ここに入口の `srs.md` と関連文書を配置し、`node dist/index.js` で stdio サーバーを起動する。
文書とレビューのファイル操作は Linux / macOS を対象とする。文書の走査はルート以下のシンボリックリンクを除外し、直接指定されたファイルもルート外へのパスやリンクを経由したアクセスを拒否する。SRS ルート自体を選択するリンクは使用できる。
更新操作は読み取り開始時のルートディレクトリを開いたまま保持し、保存・自動 commit も同じディレクトリに限定する。操作途中でルートが差し替えられた場合は差し替え先へ追従しない。保存が完了しても自動 commit を安全に実行できない場合は `commit_sha: null` を返す。
Git 履歴の取得も、処理開始時のルートディレクトリを保持して各 Git 呼出し時に照合する。途中で差し替えられたディレクトリの履歴は読み取らず、エラーにする。

状態変更・レビュー提出・承認・差戻しは、SRS ルート内の `.srs-mutation.lock` による共通のプロセス間ロックを使う。読み取りと core の判定から、レビュー保存・状態更新・自動 commit までを排他する。別の更新中は競合エラーを返すため、現在の状態を確認して再実行する。新規レビュー提出は最大30秒待ってから最新状態を読み取り、採番する。同じルートの別名リンクも同じロックを共有し、別の SRS ルートの更新は妨げない。

ロックを保持する専用プロセスが独立して更新時刻を維持する。更新処理の I/O には操作全体で30秒の期限を設け、ロック保持プロセスの喪失・期限超過後は次の書込みを行わない。Git ワーカーがタイムアウト・異常終了した場合は、子プロセス群も停止してからロックを解放する。操作の正常終了・通常のエラーでは、処理完了後に明示的にロックを解放する。ロック保持プロセスへの終了シグナルや未処理例外では即座に解放せず、実行中の I/O を保護する。残った操作ロックは最終更新から120秒後に回収可能になる。外部通知はロックの解放後に行う。操作中のロックを手動で削除しない。

文書の保存では、同じファイルに対する MCP プロセス間ロックを取得してから、読み取り時点の内容との照合と原子的な置換を行う。同時更新の競合はエラーとして返し、変更を黙って上書きしない。競合した操作は現在の文書を確認して再実行する。異常終了で残ったロックは60秒で回収可能になる。ロックを使わない外部エディターの更新も置換直前の再読込で検出するが、その再読込後の書込みまで排他するものではない。

`mcpServers` 形式を使うクライアントでの設定例。パスは利用環境の絶対パスに置き換える。

```json
{
  "mcpServers": {
    "extended-srs": {
      "command": "node",
      "args": ["/absolute/path/to/extended-srs/mcp-server/dist/index.js"],
      "env": {
        "EXTENDED_SRS_ROOT": "/absolute/path/to/project/spec",
        "EXTSRS_AUTO_COMMIT": "false"
      }
    }
  }
}
```

`EXTSRS_AUTO_COMMIT=false` はファイル変更後の自動 commit を無効にする。更新系ツールによるファイルの変更は行われる。省略した場合は自動 commit が有効になるため、対象を Git 管理下に置き、commit に使う名前とメールアドレスを設定する。

レビュー記録の実行者は、次の任意の環境変数で指定できる。

| 環境変数 | 用途 | 要否 |
| --- | --- | --- |
| `USER_ID` | レビュー提出時の `submitted_by`、承認・差戻し時の `resolved_by` に記録する実行者 ID | 任意。未設定または空文字列の場合は `USER` を使用 |

`USER_ID` と `USER` の両方が未設定または空文字列の場合、提出時は `agent`、承認・差戻し時は引数の `reviewer_role`（省略時は `human`）を使用する。この設定は外部通知を利用しない場合も有効。

レビューの外部通知は、独自の通知サービスに接続するための任意の連携フック。利用する場合は、次の環境変数を設定する。

| 環境変数 | 用途 | 通知連携時の要否 |
| --- | --- | --- |
| `AGENT_COMMUNICATION_URL` | 通知サービスのベース URL | 必須 |
| `TEAM_ID` | 通知先のチーム ID | 必須 |
| `PROJECT_ID` | 通知先のプロジェクト ID | 必須 |
| `GIT_AUTH_TOKEN` | `X-Project-Token` ヘッダに渡す認証トークン | 必須 |
| `AGENT_WORKSPACE_ID` | 通知本文の `agentWorkspaceId` に渡すワークスペース ID | 任意。省略時は空文字列 |

通知先は `POST {AGENT_COMMUNICATION_URL}/api/{TEAM_ID}/{PROJECT_ID}/notifications`。必須の4変数が揃った場合のみ通知し、通知先の失敗はレビュー保存を失敗させない。認証トークンを別の宛先へ転送しないよう、HTTP リダイレクトには追従しない。通知連携を使わない場合、これらの環境変数は不要。

## ライフサイクルとレビュー

以下はこの公式 MCP の振る舞いの説明で、Extended SRS の文書形式に対応する他のツールに同じ操作を要求するものではない。
文書形式の共通ルールは [仕様書](../schema-docs/extended-srs-spec.md)を参照する。

ライフサイクル操作が受け入れる遷移は以下。同じ状態の再指定は変更なしとする。

| 元の状態 | 遷移先 |
| --- | --- |
| draft | tentative, approved, dropped |
| tentative | approved, rejected, dropped |
| approved | in_progress, deferred, dropped |
| in_progress | in_review, blocked |
| blocked | in_progress |
| in_review | implemented, rejected |
| rejected | draft |
| implemented | verified |
| verified | なし |
| deferred | draft, approved, dropped |
| dropped | なし |

`draft → approved` にも省略した `tentative` の承認条件を適用する。`rejected` への変更には理由が必要で、不正な現在状態からの強制遷移は受け付けない。

レビューの承認・差戻しと要素のライフサイクル操作は別のツール。`workflow.config.approval_gates` に `on_approval_status_transition` がある場合、レビュー承認後に指定の状態変更も行う。承認ゲートの役割と必須チェック、自律度ポリシーの人間承認を core が確認し、`set_element_status` / `approve_element` からの変更にも同じ条件を適用する。

同じ `gate_type` のゲートが複数ある場合、提出時に `gate_id` を指定する。承認時の `approver_role` は `product_owner` 等のプロジェクト上の役割で、`reviewer_role`（human / agent）とは別。必須の自動チェック結果は `checks` に渡す。MCP はチェックを実行せず、呼び出し側が実施・確認した結果を受け取る。条件式を評価する仕組みは MCP に組み込んでいないため、未評価の自動承認条件は人間レビューを必要とする。

実行者の認証と役割の確認は呼び出し側で行う。MCP は渡された `reviewer_role` / `approver_role` を承認条件と照合するが、その実行者の本人確認は行わない。

対象要素や workflow 設定が変わったレビューは再提出を要求する。複数ゲートの途中の承認は記録し、状態変更が待機している理由を `transition_pending` で返す。レビュー保存後に文書の競合・書込み失敗が起きた場合は `success: false, review_saved: true` を返し、状態変更の成功とは扱わない。現在の文書を確認して `set_element_status` を再実行できる。
状態変更は集約時の順序（入口文書、`manifest.files` の順）に従い、最終的に有効な定義を更新する。各文書内では全体記法を記載順に適用した後、部分抽出記法を記載順に適用する。更新内容を再集約して要求した状態になることを確認してから保存し、安全に更新対象を特定できない場合はエラーにする。
`get_unblocked_elements` の `work_type: "verify"` は、依存条件を満たす `implemented` の要素を返す。
仕様作成と検証作業は、その成果の承認より先に行うため、承認待ちでも対象一覧から除外しない。実装開始・再開では `in_progress` への遷移条件も確認する。
`hard` 依存は依存先の `implemented` / `verified` を必要とし、`approved` や `in_progress` では成立しない。`interface` 依存は契約の存在を確認する。外部依存の完了や契約を呼び出し側で確認した場合、`get_unblocked_elements` / `set_element_status` / `approve_element` の `dependency_evidence.completed` / `.interfaces` に ID を渡せる。未解決の参照を暗黙に完了扱いにしない。
レビュー記録は SRS ルート内の `reviews/<element_id>/NNNN.json` に保存する。
新規提出では使用済みの ID を上書きせず、別プロセスからの同時提出もそれぞれ異なる ID で保存する。
承認・差戻しは、同じレビューに対するプロセス間ロックと読み取り時点の記録の照合で競合を検出する。同時決定で両方を成功扱いにせず、競合側には再読込を要求する。異常終了で残ったロックは60秒で回収可能になる。保存後の自動 commit は、その操作で更新したファイルだけを対象とする。
`reviews/`、要素ごとのディレクトリ、レビュー JSON ファイルの検査でシンボリックリンクを検出した場合はエラーにする。
操作中にディレクトリが差し替えられても差し替え先には追従しない。保存は同じディレクトリ内で原子的に置き換えるため、書込み失敗で既存の記録を切り詰めない。
MCP は SRS ルートの外側の文書を状態取得や更新の対象にしない。
整合性チェックは評価対象の組を返す操作で、意味的な合否の自動判定は含まない。
Plan の保存・タスク実行・ディスパッチはこの MCP の範囲に含まれない。

履歴は現在ブランチの first-parent に沿って各コミットを読み、当時の `srs.md` と `manifest.files` の順序で集約する。現在は削除された文書も対象にする。状態履歴では削除自体を記録せず、再作成を新しい開始点として扱う。未コミットの変更は Git 履歴に含まれない。

## インターフェースの変更検知

[test/mcp-tools.json](test/mcp-tools.json) は、13 ツールの名前・説明・入力 Schema を保存した検証用スナップショット。
サーバーや接続するエージェントが実行時に読み込む設定ファイルではない。
ツール定義は [src/protocol/tools.ts](src/protocol/tools.ts) にあり、MCP のツール一覧として接続先へ返す。

[test/tools.test.js](test/tools.test.js) はサーバーを stdio で起動し、返されたツール一覧をこのスナップショットと照合する。
`npm test` と CI で実行し、意図しない名前・説明・引数の変更を検出する。
状態遷移、Git 操作、レビューの振る舞いの回帰検証も同じ [test/](test/) で行う。

インターフェースを意図的に変更した場合は、このディレクトリで次を実行してスナップショットを更新する（前処理でサーバーを再ビルドする）。
更新後は JSON の差分をレビューし、意図した変更だけが含まれることを確認する。

```sh
UPDATE_SNAPSHOT=1 npm test
npm test
```
