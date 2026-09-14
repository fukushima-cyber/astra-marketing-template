# セットアップ

この手順では新しい D1 を作成します。既存運用データを移行・削除する手順ではありません。

## 1. インストールと接続

```sh
npm ci
npx wrangler login
npx wrangler d1 create astra-marketing-template
```

出力された `database_id` を `wrangler.jsonc` の同じ項目へ設定します。複数のアカウントを持つ場合は自分の `account_id` も設定してください。Worker 名・D1 名は自分の環境に合わせて変更できます。初期設定のゼロの UUID はプレースホルダーです。

## 2. ローカル環境

以下は新しいローカル専用キーを、表示せず `.dev.vars` に保存します。既存ファイルがある場合は上書きせず停止します。

```sh
node --input-type=module -e 'import {randomBytes} from "node:crypto"; import {writeFileSync} from "node:fs"; writeFileSync(".dev.vars", `SESSION_SECRET=${randomBytes(32).toString("hex")}\nCONNECTOR_KEY=${randomBytes(32).toString("base64")}\n`, {flag:"wx",mode:0o600});'
npx wrangler d1 migrations apply astra-marketing-template --local
npm run build
npm run preview
```

別ターミナルで初回登録リンクを作成します。

```sh
D1_DATABASE=astra-marketing-template node scripts/owner-invite.mjs --local
```

`.data/local-owner-registration.md` のリンクを開き、自分の表示名・メール・パスワードで登録します。リンクは他の人に共有しないでください。グラフは自分でデータを登録するまで空です。

## 3. 本番環境

ローカル用とは別のランダムキーをパスワードマネージャー等で生成し、以下のプロンプトから登録します。`SESSION_SECRET` は十分に長いランダム値、`CONNECTOR_KEY` はランダムな 32 バイトを Base64 化した値です。キーをソースに書かないでください。

```sh
npx wrangler secret put SESSION_SECRET
npx wrangler secret put CONNECTOR_KEY
npx wrangler d1 migrations apply astra-marketing-template --remote
npm run build
npm run deploy -- --keep-vars
```

デプロイ結果の自分の URL を `APP_URL` に指定します。末尾のスラッシュやパスは付けません。

```sh
APP_URL=https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev D1_DATABASE=astra-marketing-template node scripts/owner-invite.mjs
```

`.data/owner-registration.md` のリンクで全体管理者を登録します。本人の復旧リンクが必要な場合だけ同じコマンドに `--recover` を付けます。新規所有者の追加ではありません。

## 4. データと外部連携

「設定」で案件・ファネル・目標を登録し、「実績の取込」で CSV をプレビューして保存します。CSV の空欄は未取得、`0` は実測のゼロです。列順はテンプレートを維持してください。

SNS・UTAGE・広告は各設定画面で接続します。自律運用のモデル接続は「Astra・モデル」で利用可能なモデル名と API キーを設定します。改善・診断のモデル機能では `ASTRA_OPENAI_KEY` secret と `ASTRA_MODEL` Worker 変数を使用します。自動スケジュールは初期テンプレートでは有効化していません。

設定した外部変更の権限は、実際の広告・サービスに作用します。自分の運用範囲に合わせて設定してください。
