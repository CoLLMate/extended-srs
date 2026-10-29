<!-- SPDX-License-Identifier: Apache-2.0 -->

# extended-srs-core

Copyright (c) 2026 CoLLMate, Inc.

CoLLMate, Inc. が開発・提供する Extended SRS の公式 core ライブラリ。
TypeScript による Extended SRS の解析・検証・集約、ツリー操作、状態遷移・着手可否・レビューの判定、i18n。ファイルの取得方法や UI から独立して、渡された Markdown や構造化データを処理する。

同梱の `schema/` を含め、Apache License 2.0 で提供する。本文は `LICENSE` に同梱する。第三者依存物は各条件に従う。

## ビルドとテスト

開発・テストには Node.js 24 LTS と npm を使用する。このディレクトリで実行する。

```sh
npm ci
npm run build
npm test
npm run test:coverage
```

build と test の前処理で、`../schema/` の Schema をパッケージ内に取り込む。`schema/` は生成コピーで、変更は `../schema/` の正本に行う。

テストの前処理でパッケージをビルドする。解析・検証・集約・ツリー操作・i18n、公開型の互換性、公開エントリーからのブラウザーバンドルと実行を確認する。

`test:coverage` のレポートは `coverage/` に出力する。

静的検査と整形はリポジトリ共通の ESLint / Prettier を使用する。リポジトリのルートで `npm ci` を実行し、`npm run check:style` でソース・テスト・補助スクリプトを確認する。修正時は `npm run lint:fix`、`npm run format` を使用する。

## 公開 API

集約・状態・レビューなどのアプリケーション操作には、`extended-srs-core/api` の `createCoreApi(): CoreApiV1` を使用する。[contracts.ts](src/api/contracts.ts) に入出力を定義し、実装クラスから分離している。`apiVersion` は `1`。従来の `extended-srs-core` と `extended-srs-core/i18n` も引き続き利用でき、既存の関数・クラス・型を維持する。Schema 参照やエディター向けの解析・ツリー操作は従来のルート API を利用できる。

```ts
import { createCoreApi, type CoreDocument } from 'extended-srs-core/api';

const core = createCoreApi();
// 文書の取得はアプリケーション側で行う。
const documents: CoreDocument[] = [{ path: 'srs.md', content: markdown }];
const project = await core.aggregateDocuments(documents);
const state = core.getProjectState(project.aggregate.srs);
// project.documents は入口と manifest.files の集約順に並ぶ。
const change = core.planElementStatusChange(project.documents, {
  element_id: 'FR-001', new_status: 'approved',
});
// change.original と現在の文書が一致することを確認し、change.content を保存する。
```

`aggregateDocuments` は集約結果・参加文書・セクション情報を返す。`findElement` は集約後の有効な要素を返し、`extractConsistencyPairs` は各 YAML ブロックと直後の本文を対応付ける。既定では `srs.md` が必要。履歴や未完成の草稿を扱うための `allowStandalone: true` は入口なしでも渡された順に集約するが、プロジェクトの完全性検証には使わない（`isComplete: false`）。

検証結果の errors / warnings はデータとして返す。不正な状態遷移・レビュー判定は `SRSRuleError` を throw する。core はファイル、Git、通知、レビューの排他保存を扱わない。Markdown・レビュー・実行者・日時を渡す同じ I/F をブラウザーと Node.js の両方から利用できる。

Schema にないフィールドも解析・集約したデータに保持する。`validateYAML`・`validateExtendedSRSFile`・`validateExtendedSRS` は、未知フィールドを共通の文言と `unknown-property` 型の警告で知らせる。未知フィールドだけでは `isValid` を false にせず、集約結果と MCP の検証応答でも警告として返す。型・必須項目などの違反は引き続き検証する。検証によるデータの削除・変更は行わない。集約結果の診断にはフィールドのパスと出典ファイルが入り、位置を特定できる場合は行番号も付く。Schema が許可する `x-*` などの拡張は、未知フィールドとして報告しない。表示や保存の可否は、利用側がデータと検証結果を使って判断する。

`request_schema` などのデータ型定義には JSON Schema Draft 7 を記述できる。固定のメタスキーマは AJV に同梱されており、ネットワークアクセスなしでキーワード値の型と構造を検証する。未知のキーワードは保持して `unknown-schema-keyword` 警告で通知する。`x-*` は拡張注釈として警告対象から除く。型定義中の `$ref` は保持し、参照先を解決・検証していないことを `schema-reference-unchecked` 警告で通知する。実データへの適用やフォームの生成は利用側の役割。仕様と記述例は [システムアーキテクチャ活用ガイド](../schema-docs/usage-guides/system-architecture-usage-guide.md) を参照する。

細工された文書による過大なメモリ確保や再帰を防ぐため、YAML 解析前にメタデータブロックを UTF-8 で最大4 MiBに制限する。本文はこのサイズ制限の対象外。配列は最大10,000要素、部分ブロックの配列添字は `0`〜`9999`、YAML と部分パスの入れ子は最大100階層に制限する。重複キーは同梱の yaml ライブラリと同じ比較基準で各マッピングを一度走査して検出し、エラーにする。循環する YAML エイリアスも解析エラーにする。循環しないエイリアスは利用できる。制限に該当する入力は診断として返し、元の Markdown は変更しない。

既定の YAML 1.2 では `<<` は通常のキーとして扱い、同じマッピングに複数書くと重複エラーになる。`%YAML 1.1` を指定して merge key が有効になった場合は、ライブラリと同様に複数の非引用 `<<` を許容する。引用した `"<<"` は通常の文字列キーとして扱う。

極端に深い YAML は、core の深さ検査に到達する前に解析ライブラリが再帰上限に達する場合がある。その場合も解析エラーとして返すが、診断は100階層の上限ではなくスタック超過を示すことがある。

未知フィールドを保持する扱いの例外として、`__proto__`・`prototype`・`constructor` はプロトタイプ汚染を防ぐため集約・ツリー操作の対象から除外する。これも元の Markdown を書き換える処理ではない。

`getSchemaNodeForPath(schema, path)` は対応する Schema を返し、未知のパスには `null` を返す。配列添字は `['functional-requirements', 'requirements', '0', 'req_id']` のように独立した要素にする。同じ item Schema を持つ配列では、従来の添字を省略したパスも利用できる。許可された自由形式の拡張には `{}` が返る。部分ブロックの検証で未知のパスを指定した場合は、そのパスを診断として返す。この関数の戻り値によるデータの自動除外は行わない。

型定義だけでは互換性を保証できないため、既存 API と v1 I/F の公開型・引数・戻り値・メンバー・enum 値を [契約テスト](test/apiCompatibility.test.ts) で照合する。[利用側の型検査とブラウザー実行](test/browserContract.test.ts) も通常のテストに含む。互換性のない変更は新しいメジャー版として移行手順を用意し、既存契約のスナップショットを単に上書きして通さない。Schema の変更による挙動の互換性は、解析・集約・ルールの回帰テストで別途確認する。

従来のルート API の主な項目:

| API | 用途 |
| --- | --- |
| `parseExtendedSRS` | Markdown からメタデータと本文の区間を取り出す |
| `validateYAML` | YAML の構文と Schema を検証する |
| `validateExtendedSRS` | 構造化された SRS データを検証する |
| `validateExtendedSRSFile` | Markdown 内の SRS メタデータブロックを検証する |
| `ExtendedSRSAggregator` | ファイル一覧と内容から、分割された SRS を集約する |
| `getProjectState` / `getUnblockedElements` | 要素一覧・逆依存・状態集計と、依存条件・承認条件を満たす作業対象を取得する |
| `assertLifecycleTransition` | schema の遷移・依存条件・承認ゲートを確認し、不成立なら `SRSRuleError` を返す |
| `planElementStatusChange` | 集約順の文書から更新対象を特定し、変更後の Markdown と変更情報を返す。保存はしない |
| `createReview` / `resolveReview` / `getReviewHistory` | レビュー記録の作成・承認・却下・履歴整形。採番、日時、実行者、保存は呼び出し側が提供する |
| `getWorkflowConfig` / `assertWorkflowTransition` | `workflow.config` を検証し、承認ゲートと自律度ポリシーを適用する |

ビルド済みの core で最小構成の文書を解析・検証する例。このディレクトリに `.mjs` ファイルとして保存し、Node.js で実行できる。

```js
import core from './dist/index.js';

const markdown = `# My Project

<!--@srs
manifest:
  format: extended-srs/v1
  project_name: My Project
@srs-->
`;
const parsed = core.parseExtendedSRS(markdown);
const validation = await core.validateExtendedSRSFile(markdown);

console.log(parsed.srsData.manifest.project_name);
console.log({ isValid: validation.isValid, errors: validation.errors });
```

複数ファイルの SRS 全体を扱う場合は `ExtendedSRSAggregator` を使用する。API の型は [公開 exports](src/index.ts)、利用例は [テスト](test/)を参照する。

## schema のルールを使う

`src/rules/` は schema の定義を実行する共通処理。ブラウザーと MCP が同じ API を使用する。Node.js のファイル操作・環境変数・子プロセス・Git・通知には依存しない。文書、レビュー記録、実行者、日時、外部の判定材料を引数で受け取る。

- 状態遷移は `common-definitions-schema.json` の遷移図に対応し、テストで図との一致を確認する。`draft → approved` の省略経路にも、`draft → tentative → approved` の承認条件を適用する。不正な現在状態を任意の状態へ変更する経路は設けない。
- `hard` 依存は依存先が `implemented` または `verified` のときに成立する。`soft` は先行作業を妨げない。`interface` はモジュールの `provided_interfaces`、または呼び出し側が確認した契約の存在を必要とする。見つからない参照を自動的に完了扱いにしない。
- 外部依存の完了や契約の確認結果は `DependencyEvidence` の `completed` / `interfaces` に ID の配列で渡す。`getUnblockedElements(srs, workType, evidence, workflowContext)` と状態変更の `LifecycleContext.dependency_evidence` で同じ判定を使う。
- `workflow.config` の `approval_gates` と `autonomy_policy` を参照する。承認ゲートの役割・必須チェック・ブロック指定を確認し、構成や対象要素が変わった古いレビューは承認根拠にしない。複数ゲートがある場合、途中の承認は保存でき、全条件が揃うまで `transition_pending` を返す。
- 条件式の評価言語は schema に定義されていないため、文字列をコードとして実行しない。自動承認条件は `WorkflowContext.evaluateCondition`、条件付きの自律度判定は `resolveAutonomyGate` を呼び出し側が提供する。評価結果がない場合、自動承認や人間承認の省略は行わない。レビュー基準の自然言語評価やテストの実行も呼び出し側の役割。

レビューの `reviewer_role` は `human` / `agent` の区別、`approver_role` は `product_owner` などプロジェクト上の役割。これらやチェック結果は呼び出し側が確認して渡す情報であり、core 自体は認証やテスト実行を行わない。

`planElementStatusChange` に渡す文書は、入口文書、`manifest.files` の順序に従う。各文書内では全体記法を記載順に適用した後、部分抽出記法を記載順に適用する。集約結果の `contributions` のキー順から文書順を取得できる。返された `original` と現在の内容を比較してから `content` を保存すること。保存時のパス保護・競合対策は利用側の責任で、公式 MCP は専用の保存アダプターで実施する。

## 配布物を作る

現在は `private: true` とし、npm レジストリへの公開を無効にしている。ローカルの配布アーカイブは次のコマンドで作成できる。

```sh
npm pack
```

アーカイブには、ビルド済みコード、型宣言、ソース、Schema、ライセンス本文を含める。実行時にリポジトリ外の Schema を参照せず、収録したソースからの再ビルドも可能。MCP サーバーは、このソース構成では隣接する `extended-srs-core` を依存先にしている。
