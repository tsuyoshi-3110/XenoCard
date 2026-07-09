import OpenAI, { toFile } from "openai";
import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const maxDuration = 120;

type ImageKind = "background" | "logo";

type RequestBody = {
  kind?: ImageKind;
  prompt?: string;
  company?: string;
  mainColor?: string;
  editImageDataUrl?: string;
  useStoreContext?: boolean;
};

type BuildPromptArgs = {
  kind: ImageKind;
  prompt: string;
  company: string;
  mainColor: string;
  storeContext?: string;
};

const generationHistory = new Map<string, number[]>();
const MAX_GENERATIONS_PER_HOUR = 10;

function checkRateLimit(uid: string): boolean {
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const recent = (generationHistory.get(uid) || []).filter(
    (timestamp) => timestamp > oneHourAgo,
  );
  if (recent.length >= MAX_GENERATIONS_PER_HOUR) return false;
  recent.push(now);
  generationHistory.set(uid, recent);
  return true;
}

async function verifyFirebaseToken(token: string): Promise<string | null> {
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}

function asText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .join("、")
      .trim();
  }
  return "";
}

function firstText(
  sources: Array<Record<string, unknown> | null>,
  keys: string[],
): string {
  for (const source of sources) {
    if (!source) continue;
    for (const key of keys) {
      const value = asText(source[key]);
      if (value) return value;
    }
  }
  return "";
}

async function loadStoreContext(uid: string): Promise<{
  company: string;
  context: string;
}> {
  const settingsQuery = await adminDb
    .collection("siteSettings")
    .where("ownerId", "==", uid)
    .limit(1)
    .get();
  const settingsDoc = settingsQuery.docs[0];
  if (!settingsDoc) {
    throw new Error(
      "Pageitの店舗情報が見つかりません。Pageitの管理者アカウントでお試しください。",
    );
  }

  const siteKey = settingsDoc.id;
  const settings = settingsDoc.data() as Record<string, unknown>;
  const [editableSnapshot, storesSnapshot] = await Promise.all([
    adminDb.collection("siteSettingsEditable").doc(siteKey).get(),
    adminDb.collection("siteStores").doc(siteKey).collection("items").limit(5).get(),
  ]);
  const editable = editableSnapshot.exists
    ? (editableSnapshot.data() as Record<string, unknown>)
    : null;
  const sources = [editable, settings];
  const company = firstText(sources, [
    "siteName",
    "shopName",
    "storeName",
    "companyName",
    "name",
  ]);
  const details = [
    company ? `店名・会社名: ${company}` : "",
    firstText(sources, ["tagline", "catchphrase", "subTitle"])
      ? `キャッチコピー: ${firstText(sources, ["tagline", "catchphrase", "subTitle"])}`
      : "",
    firstText(sources, [
      "description",
      "siteDescription",
      "businessDescription",
      "about",
      "introText",
      "companyDescription",
    ])
      ? `店舗・事業の紹介: ${firstText(sources, [
          "description",
          "siteDescription",
          "businessDescription",
          "about",
          "introText",
          "companyDescription",
        ])}`
      : "",
    firstText(sources, ["keywords", "services", "categories"])
      ? `商品・サービス・特徴: ${firstText(sources, [
          "keywords",
          "services",
          "categories",
        ])}`
      : "",
    firstText(sources, ["ownerAddress", "address", "area"])
      ? `地域: ${firstText(sources, ["ownerAddress", "address", "area"])}`
      : "",
    ...storesSnapshot.docs.map((storeDoc) => {
      const store = storeDoc.data() as Record<string, unknown>;
      return [
        asText(store.name),
        asText(store.description),
        asText(store.category),
        asText(store.address),
      ]
        .filter(Boolean)
        .join(" / ");
    }),
  ].filter(Boolean);

  return {
    company,
    context: details.join("\n").slice(0, 3000),
  };
}

function buildPrompt({
  kind,
  prompt,
  company,
  mainColor,
  storeContext,
}: BuildPromptArgs): string {
  const brandContext = [
    company ? `Brand or company: ${company}.` : "",
    mainColor ? `Primary accent color: ${mainColor}.` : "",
    storeContext
      ? `The following verified Pageit store information must guide the visual concept:\n${storeContext}`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (kind === "logo") {
    return [
      "Create one premium, minimal symbol-mark logo for a digital business card.",
      brandContext,
      `Creative direction: ${prompt}.`,
      "Centered single emblem, bold clean silhouette, balanced negative space.",
      "No mockup, no business card, no stationery, no border, no shadow, no photograph.",
      "Do not include letters, company names, words, numbers, signatures, or watermarks.",
      "Transparent background. The emblem must remain readable at small mobile size.",
    ].join(" ");
  }

  return [
    "Create a premium vertical background artwork for a digital business card.",
    "Portrait 9:16 composition designed for a smartphone screen.",
    brandContext,
    `Creative direction: ${prompt}.`,
    "Elegant, understated, high-end visual identity.",
    "Follow the creative direction for overall brightness: if a light, white, or pale background is requested, make it genuinely light and airy; otherwise a deep, dark tone works well.",
    "Keep the center and lower-left areas calm and evenly toned so overlaid contact text stays readable.",
    "Leave the upper-left area usable for a logo and the lower-right area usable for a QR code.",
    "No people, no devices, no business card mockup, no text, no letters, no numbers, no logo, no watermark.",
  ].join(" ");
}

export async function POST(request: NextRequest) {
  try {
    const authorization = request.headers.get("authorization") || "";
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";
    if (!token) {
      return NextResponse.json(
        { error: "ログイン情報がありません。" },
        { status: 401 },
      );
    }

    const uid = await verifyFirebaseToken(token);
    if (!uid) {
      return NextResponse.json(
        { error: "ログイン情報を確認できませんでした。" },
        { status: 401 },
      );
    }

    if (!checkRateLimit(uid)) {
      return NextResponse.json(
        { error: "生成回数が上限に達しました。1時間後に再度お試しください。" },
        { status: 429 },
      );
    }

    const body = (await request.json()) as RequestBody;
    const kind = body.kind;
    const useStoreContext = body.useStoreContext === true;
    let prompt = String(body.prompt || "").trim().slice(0, 1200);
    if (
      (kind !== "background" && kind !== "logo") ||
      (!prompt && !useStoreContext)
    ) {
      return NextResponse.json(
        { error: "生成種類とデザイン指示を入力してください。" },
        { status: 400 },
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEYが設定されていません。" },
        { status: 500 },
      );
    }

    const openai = new OpenAI({ apiKey });
    const size = kind === "logo" ? "1024x1024" : "1024x1536";
    let base64: string | null | undefined;
    let storeContext = "";
    let company = String(body.company || "").trim().slice(0, 120);

    if (useStoreContext) {
      const store = await loadStoreContext(uid);
      storeContext = store.context;
      company = store.company || company;
      prompt =
        kind === "logo"
          ? "Create a distinctive symbol that naturally expresses this store's business, atmosphere, values, customers, and local character."
          : "Create a distinctive visual identity that naturally expresses this store's business, atmosphere, values, customers, and local character.";
    }

    if (body.editImageDataUrl) {
      // 既存画像を編集モード
      const base64Data = body.editImageDataUrl.replace(/^data:image\/\w+;base64,/, "");
      const imageBuffer = Buffer.from(base64Data, "base64");
      const imageFile = await toFile(imageBuffer, "image.png", { type: "image/png" });

      const editResult = await openai.images.edit({
        model: "gpt-image-1",
        image: imageFile,
        prompt: buildPrompt({
          kind,
          prompt,
          company,
          mainColor: String(body.mainColor || "").trim().slice(0, 20),
          storeContext,
        }),
        n: 1,
        size,
        output_format: "png",
        user: uid,
      });
      base64 = editResult.data?.[0]?.b64_json;
    } else {
      // 新規生成モード
      const generateResult = await openai.images.generate({
        model: kind === "logo" ? "gpt-image-1.5" : "gpt-image-2",
        prompt: buildPrompt({
          kind,
          prompt,
          company,
          mainColor: String(body.mainColor || "").trim().slice(0, 20),
          storeContext,
        }),
        n: 1,
        size,
        quality: "medium",
        output_format: "png",
        background: kind === "logo" ? "transparent" : "opaque",
        moderation: "auto",
        user: uid,
      });
      base64 = generateResult.data?.[0]?.b64_json;
    }

    if (!base64) throw new Error("画像データが返されませんでした。");

    return NextResponse.json({
      imageDataUrl: `data:image/png;base64,${base64}`,
      kind,
    });
  } catch (error) {
    console.error("AI image generation failed:", error);
    const message =
      error instanceof Error ? error.message : "画像生成に失敗しました。";
    return NextResponse.json(
      {
        error:
          message.includes("organization")
            ? "OpenAI組織の本人確認が必要です。OpenAI Platformをご確認ください。"
            : message,
      },
      { status: 500 },
    );
  }
}
