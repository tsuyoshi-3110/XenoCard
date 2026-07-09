export type BusinessCard = {
  name: string;
  company: string;
  department: string;
  title: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  logoUrl: string;
  backgroundUrl: string;
  mainColor: string;
  textColor: string;
  slug: string;
  logoSize?: number; // カード幅に対する% (5–90)
  logoX?: number;    // % from left (0–90)
  logoY?: number;    // % from top  (0–80)
  textAreaX?: number;     // 文字ブロック % from left (0–80)
  textAreaY?: number;     // 文字ブロック % from bottom (0–85)
  textAreaWidth?: number; // 文字ブロック幅 カード幅% (20–150)。文字サイズも連動
  textAlign?: "left" | "center" | "right"; // 文字の水平揃え(既定left)
  createdAt?: unknown;
  updatedAt?: unknown;
};

export const EMPTY_BUSINESS_CARD: BusinessCard = {
  name: "",
  company: "",
  department: "",
  title: "",
  phone: "",
  email: "",
  website: "",
  address: "",
  logoUrl: "",
  backgroundUrl: "",
  mainColor: "#c9a96e",
  textColor: "#ffffff",
  slug: "",
};

// 色(6桁hex)が明るいかを輝度で判定する
export function isLightColor(hex: string, threshold = 0.82): boolean {
  const match = /^#?([0-9a-f]{6})$/i.exec((hex || "").trim());
  if (!match) return false;
  const value = parseInt(match[1], 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > threshold;
}

function escapeVCardValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

export function buildVCard(card: BusinessCard): string {
  return [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${escapeVCardValue(card.name)}`,
    `ORG:${escapeVCardValue(card.company)}${card.department ? `;${escapeVCardValue(card.department)}` : ""}`,
    `TITLE:${escapeVCardValue(card.title)}`,
    `TEL:${escapeVCardValue(card.phone)}`,
    `EMAIL:${escapeVCardValue(card.email)}`,
    `URL:${escapeVCardValue(card.website)}`,
    `ADR:;;${escapeVCardValue(card.address)};;;;`,
    "END:VCARD",
  ].join("\r\n");
}

export function createCardSlug(name: string): string {
  const base = name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 10)
      : Math.random().toString(36).slice(2, 12);

  return `${base || "card"}-${suffix}`;
}

export function normalizeCardSlug(value: string): string {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function getPublicCardUrl(slug: string): string {
  const configuredOrigin = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  const browserOrigin =
    typeof window !== "undefined" ? window.location.origin.replace(/\/$/, "") : "";
  // QRは現在ページを表示している実際のホストを優先する。
  // localhostを環境変数に設定した開発中でも、スマホからはLAN内IPへアクセスできる。
  const origin = browserOrigin || configuredOrigin || "https://card.example.com";
  return `${origin}/v/${encodeURIComponent(slug || "preview")}`;
}
