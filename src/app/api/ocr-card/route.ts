import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

type RequestBody = {
  imageDataUrl?: string;
  slug?: string;
};

// 端末ローカル保存のため認証は無い。乱用対策はIP単位のレート制限で行う。
const requestHistory = new Map<string, number[]>();
const MAX_REQUESTS_PER_HOUR = 40;

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  return forwarded.split(",")[0].trim() || "unknown";
}

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const recent = (requestHistory.get(key) || []).filter((t) => t > oneHourAgo);
  if (recent.length >= MAX_REQUESTS_PER_HOUR) return false;
  recent.push(now);
  requestHistory.set(key, recent);
  return true;
}

const SYSTEM_PROMPT = [
  "You extract contact details from a photograph of a Japanese business card (名刺).",
  "Read every visible field carefully, including small print.",
  "Return ONLY a JSON object with exactly these string keys:",
  '"name", "company", "department", "title", "phone", "email", "website", "address".',
  "Rules:",
  "- name: person's full name as printed (keep Japanese as-is, keep the spacing between family and given name).",
  "- company: company / organization name.",
  "- department: 部署・事業部 (e.g. 営業部). Empty if none.",
  "- title: 役職 (e.g. 代表取締役, 部長). Empty if none.",
  "- phone: primary phone number. Prefer 携帯 (mobile) if present, otherwise the main line. Keep digits and hyphens.",
  "- email: email address exactly as printed.",
  "- website: URL if present.",
  "- address: postal address on one line.",
  "- Use an empty string \"\" for any field you cannot read. Never invent values.",
  "Output must be valid JSON with no markdown, no commentary.",
].join("\n");

export async function POST(request: NextRequest) {
  try {
    if (!checkRateLimit(clientIp(request))) {
      return NextResponse.json(
        { error: "読み取り回数が上限に達しました。しばらくして再度お試しください。" },
        { status: 429 },
      );
    }

    const body = (await request.json()) as RequestBody;
    const imageDataUrl = String(body.imageDataUrl || "");

    if (!/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(imageDataUrl)) {
      return NextResponse.json(
        { error: "画像データが正しくありません。" },
        { status: 400 },
      );
    }
    if (imageDataUrl.length > 6 * 1024 * 1024) {
      return NextResponse.json(
        { error: "画像サイズが大きすぎます。" },
        { status: 413 },
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEYが設定されていません。" },
        { status: 500 },
      );
    }

    // タイムアウト・SDK自動リトライを設定して安定化
    const openai = new OpenAI({ apiKey, timeout: 45_000, maxRetries: 1 });

    const extract = async (model: string): Promise<Record<string, unknown>> => {
      const completion = await openai.chat.completions.create({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "この名刺画像から連絡先情報を抽出してJSONで返してください。",
              },
              {
                type: "image_url",
                image_url: { url: imageDataUrl, detail: "high" },
              },
            ],
          },
        ],
      });
      const content = completion.choices[0]?.message?.content || "";
      return JSON.parse(content) as Record<string, unknown>;
    };

    let fields: Record<string, unknown>;
    try {
      fields = await extract("gpt-4o");
    } catch (primaryError) {
      // 一時障害に備えて軽量モデルへ自動フォールバック
      console.warn(
        "gpt-4o OCR failed, falling back to gpt-4o-mini:",
        primaryError instanceof Error ? primaryError.message : primaryError,
      );
      fields = await extract("gpt-4o-mini");
    }

    return NextResponse.json({ fields });
  } catch (error) {
    console.error("Business card OCR failed:", error);
    const status = (error as { status?: number } | null)?.status;
    const message =
      error instanceof Error ? error.message : "名刺の読み取りに失敗しました。";
    return NextResponse.json(
      { error: status ? `${message}（コード${status}）` : message },
      { status: 500 },
    );
  }
}
