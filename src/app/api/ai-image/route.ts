import OpenAI, { toFile } from "openai";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

type ImageKind = "background" | "logo";

type RequestBody = {
  kind?: ImageKind;
  prompt?: string;
  company?: string;
  mainColor?: string;
  editImageDataUrl?: string;
};

type BuildPromptArgs = {
  kind: ImageKind;
  prompt: string;
  company: string;
  mainColor: string;
};

type FirebaseLookupResponse = {
  users?: Array<{ localId?: string }>;
  error?: { message?: string };
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
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) throw new Error("Firebase APIキーが設定されていません。");

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: token }),
      cache: "no-store",
    },
  );
  const json = (await response.json()) as FirebaseLookupResponse;
  return response.ok ? json.users?.[0]?.localId || null : null;
}

function buildPrompt({ kind, prompt, company, mainColor }: BuildPromptArgs): string {
  const brandContext = [
    company ? `Brand or company: ${company}.` : "",
    mainColor ? `Primary accent color: ${mainColor}.` : "",
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
    "Keep the center and lower-left areas calm and dark enough for white contact text.",
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
    const prompt = String(body.prompt || "").trim().slice(0, 1200);
    if ((kind !== "background" && kind !== "logo") || !prompt) {
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
          company: String(body.company || "").trim().slice(0, 120),
          mainColor: String(body.mainColor || "").trim().slice(0, 20),
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
          company: String(body.company || "").trim().slice(0, 120),
          mainColor: String(body.mainColor || "").trim().slice(0, 20),
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

