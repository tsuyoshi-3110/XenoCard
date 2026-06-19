# XenoCard future modules

Ver1以降の機能は、既存の名刺表示・保存ロジックから分離してこのディレクトリ配下へ追加します。

```text
src/features/xenocard/
  ai-design/          AI名刺デザイン生成
  integrations/
    pageit/           Pageitプロフィール連携
  social/             SNSリンク
  company-profile/    会社紹介ページ
  multi-card/         複数名刺管理
  nfc/                NFCカード対応
```

Ver1では各機能を実装せず、`src/lib/businessCard.ts` の共通データモデルと `src/components/business-card/` の表示部品を拡張ポイントとして利用します。

