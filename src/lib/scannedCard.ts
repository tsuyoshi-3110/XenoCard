// 取り込んだ（スキャンした）他社名刺のデータモデルとユーティリティ。
// 保存はこの端末内(IndexedDB)。認証アカウント不要。
export type ScannedCard = {
  id?: string;
  name: string;
  company: string;
  department: string;
  title: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  memo: string;
  image?: Blob; // 補正済みの名刺画像・表面(端末内保存時)
  imageUrl?: string; // サーバー保存時の表面画像URL
  imageBack?: Blob; // 裏面(任意・端末内保存時)
  imageBackUrl?: string; // サーバー保存時の裏面画像URL(任意)
  createdAt?: number;
};

export const EMPTY_SCANNED_CARD: ScannedCard = {
  name: "",
  company: "",
  department: "",
  title: "",
  phone: "",
  email: "",
  website: "",
  address: "",
  memo: "",
};

// AI(OCR)の抽出結果を安全にScannedCardの文字項目へ正規化する
export function normalizeScannedFields(
  raw: unknown,
): Omit<ScannedCard, "id" | "image" | "createdAt"> {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = (key: string): string => {
    const value = source[key];
    return typeof value === "string" ? value.trim().slice(0, 300) : "";
  };
  return {
    name: pick("name"),
    company: pick("company"),
    department: pick("department"),
    title: pick("title"),
    phone: pick("phone"),
    email: pick("email"),
    website: pick("website"),
    address: pick("address"),
    memo: "",
  };
}

function escapeVCardValue(value: string): string {
  return (value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

// 取り込んだ名刺から連絡先(vCard)テキストを生成する
export function buildScannedVCard(card: ScannedCard): string {
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    // N は必須。無いと iOS が電話番号を名前にしてしまう
    `N:${escapeVCardValue(card.name)};;;;`,
    `FN:${escapeVCardValue(card.name)}`,
    `ORG:${escapeVCardValue(card.company)}${card.department ? `;${escapeVCardValue(card.department)}` : ""}`,
    card.title ? `TITLE:${escapeVCardValue(card.title)}` : "",
    card.phone ? `TEL;TYPE=CELL:${escapeVCardValue(card.phone)}` : "",
    card.email ? `EMAIL:${escapeVCardValue(card.email)}` : "",
    card.website ? `URL:${escapeVCardValue(card.website)}` : "",
    card.address ? `ADR:;;${escapeVCardValue(card.address)};;;;` : "",
    card.memo ? `NOTE:${escapeVCardValue(card.memo)}` : "",
    "END:VCARD",
  ];
  return lines.filter(Boolean).join("\r\n");
}

// vCardをダウンロード(iOSは連絡先追加画面が開く)
export function downloadVCard(card: ScannedCard): void {
  const vcf = buildScannedVCard(card);
  const blob = new Blob([vcf], { type: "text/vcard;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${(card.name || "contact").replace(/[\\/:*?"<>|]/g, "_")}.vcf`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
