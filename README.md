## XenoCard デジタル名刺管理アプリ Ver1

Next.js App Router、Firebase、Tailwind CSSで動作するPWA対応デジタル名刺管理機能です。

- `/dashboard`: 名刺編集、画像アップロード、QR付きプレビュー
- `/my-card`: ログインユーザー専用の全画面マイ名刺
- `/v/[slug]`: ログイン不要の公開名刺ページとvCard保存
- QRコード: 公開ページURL
- PWA起動先: `/my-card`
- 保存先: `users/{uid}/cards/{cardId}`

## セットアップ

Node.jsを用意し、依存パッケージをインストールします。

```bash
npm install
npm run dev
```

開発サーバー起動後、[編集画面](http://localhost:3000/dashboard) で名刺を保存し、[マイ名刺](http://localhost:3000/my-card) で表示します。

## Firebase設定

1. Firebase Consoleでプロジェクトを作成
2. Authenticationの「メール/パスワード」を有効化
3. Firestore Databaseを作成
4. Storageを作成
5. Webアプリを登録し、設定値を `.env.local` に記載
6. `firestore.rules` と `storage.rules` をFirebaseへ反映

## 必要な環境変数

`.env.local`:

```dotenv
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_APP_URL=http://localhost:3000
OPENAI_API_KEY=
```

既存機能でFirebase Admin SDKやStripe等を利用する場合は、それぞれの既存環境変数も設定してください。

`OPENAI_API_KEY` はサーバー専用です。`NEXT_PUBLIC_` を付けないでください。

## AI画像生成

- 編集画面の「AIデザイン」から背景またはロゴを生成
- 背景: `gpt-image-2`、縦長1024×1536
- ロゴ: `gpt-image-1.5`、透明背景PNGを指定
- Firebase AuthenticationのIDトークンをサーバーで確認
- 1ユーザーあたり1時間10回までの簡易制限
- 生成画像はプレビューへ適用後、「名刺を保存」でFirebase Storageへ保存

OpenAI Platform側でAPI課金設定が必要です。GPT Imageモデルの利用時に組織確認を求められる場合があります。

## Firestoreデータ構造

```text
users/{uid}/cards/{cardId}
  name
  company
  title
  phone
  email
  website
  address
  logoUrl
  backgroundUrl
  mainColor
  textColor
  slug
  createdAt
  updatedAt
```

## Firestoreルール案

公開ページが `collectionGroup("cards")` と `slug` で検索でき、書き込みは所有者だけに限定します。

```text
match /{path=**}/cards/{cardId} {
  allow read: if true;
}

match /users/{uid}/cards/{cardId} {
  allow read: if true;
  allow create, update, delete: if request.auth != null
    && request.auth.uid == uid;
}
```

実際のルールファイルは `firestore.rules` に用意しています。

## Storageルール案

```text
match /users/{uid}/cards/{cardId}/{fileName} {
  allow read: if true;
  allow create, update, delete: if request.auth != null
    && request.auth.uid == uid
    && (request.resource == null || (
      request.resource.contentType.matches('image/.*')
      && request.resource.size < 10 * 1024 * 1024
    ));
}
```

実際のルールファイルは `storage.rules` に用意しています。

## 画像最適化

- アップロード前にブラウザ上でWebPへ変換
- ロゴは最大300KBを目標に圧縮
- 背景画像は最大500KBを目標に圧縮
- 背景画像は最大1440×2560、ロゴは最大1200×1200へ縮小
- Firebaseへは圧縮後の画像のみアップロード

## PWA

`manifest.webmanifest` とService Workerを含みます。対応ブラウザで「ホーム画面に追加」すると、XenoCardアイコンから `/my-card` をスタンドアロン表示できます。

Service Workerはアプリシェルと取得済みリソースをキャッシュします。名刺の最新情報取得にはネットワーク接続が必要です。

## JPEG / PDF

通常運用は `/my-card` の表示を推奨します。JPEG/PDF出力は編集画面の「その他の出力」に補助機能として残しており、生成処理はすべてクライアント側で行います。

## 将来拡張用の構成

名刺の型・URL・vCard生成は `src/lib/businessCard.ts`、表示部品は `src/components/business-card/` に分離しています。将来機能の配置案は `src/features/xenocard/README.md` に用意しています。

## 無料枠を意識した構成

- Next.jsのクライアント表示とFirebaseのサーバーレス構成
- QRコード、WebP変換、JPEG/PDF生成はブラウザ内で実行
- Storageへアップロードする前に画像容量を削減
- 常時稼働サーバーやサーバー側画像生成は不使用

利用頻度と画像枚数に左右されますが、利用者100〜300人程度の初期運用でFirebase無料枠を活用しやすい構成です。実運用ではFirebase Consoleの使用量アラートを設定してください。

## 本番反映前の確認

- Firebase Authenticationにログイン用ユーザーを作成
- Firestore/Storageルールをデプロイ
- Firebase StorageのダウンロードURLを利用するドメインのCORS設定を確認
- `npm run build` が成功することを確認
