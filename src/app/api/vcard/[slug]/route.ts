import { NextRequest, NextResponse } from "next/server";
import { getFirestore } from "firebase-admin/firestore";
import { adminAuth } from "@/lib/firebase-admin"; // admin初期化のためにimport
import type { BusinessCard } from "@/lib/businessCard";

// adminAuthをimportすることでFirebase Adminが初期化される
void adminAuth;

function escapeVCardValue(value: string): string {
  return (value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

async function fetchImageBase64(url: string): Promise<{ b64: string; mime: string } | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "image/png";
    const mime = contentType.split(";")[0].trim();
    const buffer = await res.arrayBuffer();
    const b64 = Buffer.from(buffer).toString("base64");
    return { b64, mime };
  } catch {
    return null;
  }
}

async function buildVCard(card: BusinessCard): Promise<string> {
  // ロゴを連絡先写真として埋め込む
  const photo = card.logoUrl ? await fetchImageBase64(card.logoUrl) : null;

  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    // N フィールド必須（iOS はこれがないと電話番号を名前にしてしまう）
    `N:${escapeVCardValue(card.name)};;;;`,
    `FN:${escapeVCardValue(card.name)}`,
    `ORG:${escapeVCardValue(card.company)}${card.department ? `;${escapeVCardValue(card.department)}` : ""}`,
    `TITLE:${escapeVCardValue(card.title)}`,
    card.phone ? `TEL;TYPE=CELL:${escapeVCardValue(card.phone)}` : "",
    card.email ? `EMAIL:${escapeVCardValue(card.email)}` : "",
    card.website ? `URL:${escapeVCardValue(card.website)}` : "",
    card.address ? `ADR:;;${escapeVCardValue(card.address)};;;;` : "",
    photo ? `PHOTO;ENCODING=b;TYPE=${photo.mime}:${photo.b64}` : "",
    "END:VCARD",
  ];

  return lines.filter(Boolean).join("\r\n");
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  if (!slug) {
    return new NextResponse("Not found", { status: 404 });
  }

  try {
    const db = getFirestore();
    const snap = await db.collection("publicCards").doc(slug).get();

    if (!snap.exists) {
      return new NextResponse("Not found", { status: 404 });
    }

    const card = snap.data() as BusinessCard;
    const vcardText = await buildVCard(card);
    const filename = `${card.name || "contact"}.vcf`;

    return new NextResponse(vcardText, {
      status: 200,
      headers: {
        "Content-Type": "text/vcard; charset=utf-8",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
        "Cache-Control": "no-cache",
      },
    });
  } catch (e) {
    console.error("vCard fetch error:", e);
    return new NextResponse("Server error", { status: 500 });
  }
}
