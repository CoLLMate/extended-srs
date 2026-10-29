<!-- SPDX-License-Identifier: Apache-2.0 -->

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/ex-srs-logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/ex-srs-logo.svg">
    <img src="assets/ex-srs-logo.svg" alt="ex-srs ロゴ" width="96" height="96">
  </picture>
</p>

# Extended SRS

**人間と AI エージェントが、同じ仕様書を正しく読み、共に開発するために。**

Extended SRS（Extended Software Requirements Specification）は、人間にも AI エージェントにも読みやすい、新しいソフトウェア仕様書の形式です。人間とエージェントが同じ文書から目的や要件を正しく共有し、その理解を基に一緒に開発を進めることを目指しています。

このリポジトリは、文書の形式を定める **仕様**（JSON Schema と、そこから生成した仕様書）と、エージェントがその形式に沿って文書を検証・操作するための **専用 MCP サーバーを含む公式実装** を一緒に提供します。

## なぜ Extended SRS なのか

これからのソフトウェア開発では、人間が AI エージェントと共に、何を作るかを考え、設計し、実装していきます。そのときに重要なのは、人間とエージェントが**同じ仕様書を読み、そこに書かれた意図や要件を正しく共有できること**です。

Extended SRS は、そのために、人間にとっての読みやすさと、エージェントにとっての読みやすさを両立する形式として定義しています。人間は目的や背景を文章として読み、エージェントはその文章と構造化された情報から、要件や関係を把握します。両者が同じ文書を確認・更新しながら開発を進めるための共通の土台です。

さらに、**ソフトウェア開発の初心者でも、エージェントのサポートを受けてビジネスレベルの仕様書を作れること**を目指しています。利用者は実現したいことや業務の流れを自分の言葉で伝え、エージェントとの対話を通じて要件を整理します。エージェントは専用 MCP で形式を確認しながら文書を整え、利用者はその内容が自分の意図に合っているかを確かめます。

**この目的のために、仕様と専用 MCP を同時に提供します。** 仕様が人間とエージェントの共通の読み書きの形式を定め、MCP がエージェントによる形式確認や文書の操作を支えます。両方を揃えることで、利用者が高度な記法を習得しなくても、対話から仕様書を作り、エンジニアが設計・実装へ進められる形で共有することを目指します。

## AI エージェントと使うメリット

公式実装は、仕様に基づく解析・検証・操作を MCP（Model Context Protocol）のツールとして提供します。AI エージェントは、利用者との対話やソースコードの調査から Extended SRS を作成し、MCP による形式確認の結果を受け取って修正できます。仕様の作成から検証・レビューまで、同じ文書を使って進められます。

### 高度な記法を覚えず、対話から仕様を作る

利用者は、実現したいこと、業務の流れ、守りたい条件を自分の言葉で伝えます。エージェントが必要な項目を整理し、Extended SRS の構造に落とし込み、MCP で必須項目や型などを確認しながら文書を整えます。

人間が複雑な YAML や Schema を習得し、高度な Extended SRS を最初から手作業で書く必要はありません。利用者は、エージェントからの確認に答え、文書に表れた目的・業務ルール・判断が自分の意図に合っているかを確かめることに集中できます。

### 非エンジニアの業務知識を、エンジニアが使える設計にする

業務担当者や事業責任者は、エージェントとの対話を通じて、ビジネス上の目的、利用者の行動、例外処理、制約を整理できます。エージェントがそれをユースケース、ドメインモデル、機能要件などに構造化することで、エンジニアが理解し、技術設計や実装計画へ展開できる**ビジネスレベルの設計の基礎**になります。

非エンジニアは業務の意図を確認し、エンジニアは同じ文書から要件や依存関係を読み取れます。共通の仕様を介して、不明点や判断が必要な箇所を共有し、業務の説明から開発へ情報を引き継げます。

### レガシーコードから仕様を取り出し、モダンな実装へ移行する

既存のソースコードをエージェントが解析し、業務ルール、データ構造、機能の関係を Extended SRS に変換することで、コードの中に埋もれていた仕様を読み直せる形にできます。業務担当者とエンジニアが、維持すべき振る舞いと変更したい部分を確認するための基準になります。

整理した Extended SRS を基に、エージェントとエンジニアがモダンな言語・フレームワーク・アーキテクチャで再設計・実装し、移行前後の振る舞いをテストで照合しながら切り替えられます。既存コードの理解から新しい実装への移行まで、仕様を引き継ぐために利用できます。

ソースコードの解析・生成はエージェントが担い、Extended SRS と MCP は、その過程で扱う仕様の共通形式、構造検証、状態・レビュー管理を提供します。

## 文書の形

SRS ルートに置く `srs.md` が文書の入口です。Markdown 内の `<!--@srs` と `@srs-->` の間に YAML を記述します。メタデータは HTML コメント内に収まるため、通常の Markdown 表示では説明文をそのまま読むことができます。

```markdown
# チームのタスク管理

<!--@srs
manifest:
  format: extended-srs/v1
  project_name: Team Tasks
project-overview:
  objective: チームの担当と進捗を共有し、対応漏れを減らす。
@srs-->

## 背景

担当者や対応状況が複数の場所に分散しているため、
チーム全員が同じ情報を確認できるようにする。
```

必須の `manifest` から始め、必要に応じてユースケース、機能要件、非機能要件、ドメインモデル、アーキテクチャ、開発実装詳細、ワークフローを追加できます。タグの間の YAML が構造化データになり、その後から次のメタデータブロックまでの Markdown を関連する本文として扱います。特定のパスを指定してメタデータを記述する方法は、[仕様書](schema-docs/extended-srs-spec.md)を参照してください。

文書が大きくなったら、入口の `manifest.files` に SRS ルートからの相対パスを列挙して、複数の Markdown ファイルを一つの SRS として扱えます。

```yaml
manifest:
  format: extended-srs/v1
  project_name: Team Tasks
  files:
    - overview.md
    - requirements.md
```

列挙した順序でファイルを読み込み、同一のメタデータパスには後続ファイルの値を優先して適用します。`../` による SRS ルートの外側への参照は認めません。

## 仕様が扱う範囲

| セクション | 記述する内容 |
| --- | --- |
| [`manifest`](schema-docs/usage-guides/manifest-usage-guide.md) | 文書形式、プロジェクト名、分割されたファイルの一覧 |
| [`project-overview`](schema-docs/usage-guides/project-overview-usage-guide.md) | 目的、背景、利用者像、スコープ |
| [`use-cases`](schema-docs/usage-guides/use-cases-usage-guide.md) | 利用者とシステムのやり取り |
| [`functional-requirements`](schema-docs/usage-guides/functional-requirements-usage-guide.md) | 提供する機能、要件、機能に関するデータ定義 |
| [`non-functional-requirements`](schema-docs/usage-guides/non-functional-requirements-usage-guide.md) | 性能、信頼性、セキュリティなどの品質要求 |
| [`constraints`](schema-docs/usage-guides/constraints-usage-guide.md) | 技術・業務・運用上の制約 |
| [`domain-model`](schema-docs/usage-guides/domain-model-usage-guide.md) | 業務の概念、用語、関係 |
| [`system-architecture`](schema-docs/usage-guides/system-architecture-usage-guide.md) | システム構成、技術選定、設計方針 |
| [`development-implementation`](schema-docs/usage-guides/development-implementation-usage-guide.md) | マイルストーン、統合テスト・品質ゲート、配備設定 |
| [`workflow`](schema-docs/usage-guides/workflow-usage-guide.md) | 自律度・承認方針、整合性確認の設定、決定事項と未解決の判断 |

最小構成で必要なのは `manifest` です。各セクションを追加するときは、そのセクションの必須フィールドを満たします。要素の状態や型付き依存関係には共通の定義を用い、要求・設計・開発作業を関連付けます。

ワークフローの方針は文書に宣言する情報です。その方針を実行時に適用する機能の範囲は、利用するツールの実装と併せて確認してください。

## リポジトリの構成

| 場所 | 役割 |
| --- | --- |
| [schema/](schema/) | 形式の正本。JSON Schema と、仕様書の生成元となる説明データ |
| [schema-docs/](schema-docs/) | Schema から生成した[仕様書](schema-docs/extended-srs-spec.md)と[利用ガイド](schema-docs/usage-guides/)。直接編集しない |
| [schemadocs-generator/](schemadocs-generator/) | Schema から仕様書と利用ガイドを生成する Python ツール |
| [extended-srs-core/](extended-srs-core/README.md) | 公式 core ライブラリ。TypeScript による解析・検証・集約 |
| [mcp-server/](mcp-server/README.md) | 公式 MCP サーバー。stdio 接続で SRS を参照・更新する 13 ツール |

Schema と仕様書は、SRS を記述する人と対応ツールを実装する人のための資料です。core と MCP サーバーは、CoLLMate, Inc. が開発・提供する公式実装です。公式 MCP サーバーを AI エージェントに接続して仕様書の検証・操作に利用でき、core ライブラリはアプリケーションに組み込めます。

## はじめ方

| したいこと | 読むもの |
| --- | --- |
| Extended SRS で要求仕様を書く | [仕様書](schema-docs/extended-srs-spec.md)と[利用ガイド](schema-docs/usage-guides/) |
| エディターやアプリケーションに解析・検証を組み込む | [core ライブラリ](extended-srs-core/README.md) |
| AI エージェントとの対話で仕様を作成・検証・レビューする | [公式 MCP サーバー](mcp-server/README.md) |
| 対応ツールを実装する | [JSON Schema](schema/extended-srs-schema.json)、[仕様書](schema-docs/extended-srs-spec.md) |

ビルドとローカル検証の手順は各パッケージの README にまとめています。

## 対応ツールを実装する

文書の形式識別子は `extended-srs/v1` です。[トップレベル Schema](schema/extended-srs-schema.json) は JSON Schema Draft 7 に基づき、`schema/schemas/` の各セクションを参照します。フィールドの型・必須条件・列挙値は Schema、Markdown からの抽出や複数ファイルの扱いは仕様書を参照してください。

公式 MCP のツール定義・操作説明・検証データは [mcp-server/](mcp-server/README.md) で管理します。Extended SRS の文書形式に対応するために、公式 MCP と同じツールを提供する必要はありません。

## 仕様を更新する

データ構造と生成文書の説明は `schema/` で管理します。生成済みの仕様書と利用ガイドは直接編集せず、リポジトリのルートから再生成します。

```sh
python3 schemadocs-generator/generate.py
python3 schemadocs-generator/generate.py --check
```

`--check` はファイルを書き換えず、生成結果との不一致を検出します。生成器は Python 3 の標準ライブラリだけで動作します。仕様を変更したときは、公式実装への影響も確認し、各パッケージのテストを実行してください。

## 不具合報告

[Issues](https://github.com/CoLLMate/extended-srs/issues) は不具合報告のみ受け付けます。質問、機能追加の要望、個別環境へのサポートは対象外です。

報告には、使用バージョン、再現手順、期待する動作、実際の動作を記載してください。

返信・調査・修正の実施および対応時期は保証しません。受付対象外の投稿はクローズする場合があります。

## ライセンス

仕様と公式実装を含むこのリポジトリ全体を [Apache License 2.0](LICENSE) で提供します。第三者の依存物には、それぞれのライセンスが適用されます。

開発・提供：**CoLLMate, Inc.**

Copyright (c) 2026 CoLLMate, Inc.
