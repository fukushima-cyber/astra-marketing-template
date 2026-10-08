# セットアップ

新しい空のSupabaseとCloudflare Workerへ導入する手順です。このテンプレートから既存の本番データを復元・移行しません。

## Supabase

1. 自分のSupabaseプロジェクトを用意し、SQLエディターで `supabase/migrations/` のSQLをファイル名の順に実行します。`astra` は非公開スキーマです。ブラウザにはDBキーや接続文字列を渡しません。
2. 新規導入時だけ `templates/initialize-supabase.sql` を実行します。会社と最初の空の事業を作り、ユーザーや実績は登録しません。
3. アプリ専用のログインユーザーを作り、`astra_runtime` の権限を与えてください。管理者・service_roleの接続情報をWorkerへ渡さず、SQLエディターから安全に設定します。パスワードは自分で生成し、ソースに記載しません。専用接続は `search_path=astra,extensions,pg_catalog` を設定します。
4. Supabaseの接続画面で専用ユーザーの接続情報を確認します。TLSと証明書検証を有効にしてください。[Supabase接続ガイド](https://supabase.com/docs/guides/database/connecting-to-postgres)を参照してください。

## Cloudflare

`npm ci` と `npx wrangler login` を実行し、自分の専用DB接続を使ってHyperdriveを作成します。[Hyperdriveの設定](https://developers.cloudflare.com/hyperdrive/get-started/)に従い、クエリーキャッシュを無効、最大接続数を5に設定してください。接続文字列を共有ログやシェル履歴へ残さないでください。

`wrangler.jsonc` のHyperdrive IDを自分のIDへ置き換えます。Worker名も自分の環境に合わせます。`docs/data-safety-manifest.json` の `supabase.projectId` と `supabase.hyperdriveId` を同じ環境の値へ変更します。複数のCloudflareアカウントを使う場合は、設定とmanifestの両方へ `account_id` / `accountId` を揃えてください。

自分の環境を設定した後は `check:template` が失敗するのが正常です。配布前の空状態を検査するコマンドです。導入後は `npm run check:data-safety` で保存先と適用済みSQLのハッシュを確認します。既存データを持つ環境のmanifestを別の保存先へ安易に書き換えないでください。

ローカル実行ではHyperdriveの公式ガイドに従い、専用接続文字列をローカル開発用環境変数で指定してください。公開の設定ファイルへ保存しません。

## キーと初回登録

自分で生成した十分に長い `SESSION_SECRET` と、ランダム32バイトをBase64にした `CONNECTOR_KEY` を、それぞれ `npx wrangler secret put SESSION_SECRET` / `npx wrangler secret put CONNECTOR_KEY` から登録します。既存ユーザーがいる環境のSESSION_SECRETを無計画に交換しないでください。

```sh
npm run check:data-safety
npm test
npm run build
npm run deploy
```

デプロイ後、自分の専用接続文字列を `ASTRA_BACKUP_DB_URL`、自分の公開先のHTTPS originを `APP_URL` として安全に環境変数へ設定し、`node scripts/owner-invite.mjs` を実行します。生成される `.data/owner-registration.md` の非公開リンクから全体管理者を登録します。接続文字列をコマンド引数やGitへ書かないでください。既存の所有者の本人復旧だけは `--recover` を使います。

## 接続とAI

「外部サービス連携」に広告・SNS・UTAGE・計測をまとめています。「商品・売上」で商材と売上を記帳し、「案件・販売導線」「目標設定」で事業の導線を登録します。

「AI設定」でモデルと実行範囲を登録し、広告の停止・再開・日予算変更はMeta側の許可範囲も設定します。初期状態で外部変更やAIの仕事を開始しません。AIモデルや外部サービスにはそれぞれの利用料金・API利用条件が適用されます。ChatGPT広告とDotは、このテンプレートだけで接続・稼働するものではありません。

## バックアップ

専用接続を環境変数 `ASTRA_BACKUP_DB_URL` に安全に設定し、`npm run backup:database` を実行します。`.data/backups` は700、ファイルは600で保存されます。本文・接続文字列・顧客データを公開しないでください。`lib/backup/validate.ts` の `validateBackup` で全テーブルの件数とハッシュを検証できます。復元スクリプトは公開版に含めず、バックアップを本番へ自動投入しません。
