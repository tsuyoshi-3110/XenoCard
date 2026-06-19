"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import {
  Bot,
  Download,
  ExternalLink,
  LogOut,
  Save,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";
import { signOut } from "firebase/auth";
import BusinessCardPreview from "@/components/business-card/BusinessCardPreview";
import { useAuth } from "@/components/auth/AuthProvider";
import { auth, db, storage } from "@/lib/firebase";
import {
  buildVCard,
  createCardSlug,
  EMPTY_BUSINESS_CARD,
  type BusinessCard,
} from "@/lib/businessCard";
import { compressImageToWebP } from "@/lib/imageCompression";

type FieldName = keyof Pick<
  BusinessCard,
  | "name"
  | "company"
  | "department"
  | "title"
  | "phone"
  | "email"
  | "website"
  | "address"
>;

const fields: Array<{
  name: FieldName;
  label: string;
  placeholder: string;
  type?: string;
}> = [
  { name: "name", label: "氏名", placeholder: "山田 太郎" },
  { name: "company", label: "会社名", placeholder: "株式会社 Example" },
  { name: "title", label: "肩書き", placeholder: "代表取締役" },
  { name: "department", label: "追加情報（任意）", placeholder: "営業部 / 資格名 / 特許番号 など" },
  { name: "phone", label: "電話番号", placeholder: "090-1234-5678", type: "tel" },
  {
    name: "email",
    label: "メールアドレス",
    placeholder: "hello@example.com",
    type: "email",
  },
  {
    name: "website",
    label: "WebサイトURL",
    placeholder: "https://example.com",
    type: "url",
  },
  { name: "address", label: "住所", placeholder: "東京都〇〇区..." },
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "処理に失敗しました。";
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const link = document.createElement("a");
  link.download = filename;
  link.href = dataUrl;
  link.click();
}

async function dataUrlToFile(dataUrl: string, filename: string): Promise<File> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], filename, {
    type: blob.type || "image/png",
    lastModified: Date.now(),
  });
}

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const previewRef = useRef<HTMLDivElement>(null);
  const [card, setCard] = useState<BusinessCard>(EMPTY_BUSINESS_CARD);
  const [cardId, setCardId] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [backgroundFile, setBackgroundFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [aiKind, setAiKind] = useState<"background" | "logo">("background");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiResult, setAiResult] = useState<{
    kind: "background" | "logo";
    dataUrl: string;
  } | null>(null);
  const [aiStatus, setAiStatus] = useState("");
  const [aiError, setAiError] = useState("");

  const logoPreviewUrl = useMemo(
    () => (logoFile ? URL.createObjectURL(logoFile) : ""),
    [logoFile],
  );
  const backgroundPreviewUrl = useMemo(
    () => (backgroundFile ? URL.createObjectURL(backgroundFile) : ""),
    [backgroundFile],
  );

  useEffect(() => {
    return () => {
      if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl);
      if (backgroundPreviewUrl) URL.revokeObjectURL(backgroundPreviewUrl);
    };
  }, [logoPreviewUrl, backgroundPreviewUrl]);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login?next=/dashboard");
    }
  }, [loading, router, user]);

  useEffect(() => {
    if (!loading || user) return;
    const timer = window.setTimeout(() => {
      router.replace("/login?next=/dashboard");
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [loading, router, user]);

  useEffect(() => {
    if (!user) return;
    let active = true;

    void getDocs(
      query(
        collection(db, "users", user.uid, "cards"),
        orderBy("updatedAt", "desc"),
        limit(1),
      ),
    )
      .then((snapshot) => {
        if (!active || snapshot.empty) return;
        const latest = snapshot.docs[0];
        setCardId(latest.id);
        setCard({ ...EMPTY_BUSINESS_CARD, ...(latest.data() as BusinessCard) });
      })
      .catch((loadError) => {
        if (active) setError(`保存済み名刺の読込に失敗しました: ${errorMessage(loadError)}`);
      });

    return () => {
      active = false;
    };
  }, [user]);

  const updateField = (name: keyof BusinessCard, value: string) => {
    setCard((current) => ({ ...current, [name]: value }));
  };

  const generateAiImage = async () => {
    if (!user || aiGenerating) return;
    if (!aiPrompt.trim()) {
      setError("AIへ伝えるデザイン指示を入力してください。");
      return;
    }

    setAiGenerating(true);
    setError("");
    setMessage("");
    setAiError("");
    setAiResult(null);
    setAiStatus("OpenAIへ画像生成を依頼しています。通常30秒〜2分ほどかかります。");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 150_000);

    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/ai-image", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          kind: aiKind,
          prompt: aiPrompt,
          company: card.company,
          mainColor: card.mainColor,
        }),
        signal: controller.signal,
      });
      const json = (await response.json()) as {
        imageDataUrl?: string;
        error?: string;
      };
      if (!response.ok || !json.imageDataUrl) {
        throw new Error(json.error || "AI画像を生成できませんでした。");
      }

      setAiResult({ kind: aiKind, dataUrl: json.imageDataUrl });
      setAiStatus("生成が完了しました。画像を確認して採用してください。");
    } catch (generationError) {
      const message =
        generationError instanceof DOMException &&
        generationError.name === "AbortError"
          ? "画像生成がタイムアウトしました。もう一度お試しください。"
          : errorMessage(generationError);
      setAiError(message);
      setAiStatus("");
    } finally {
      window.clearTimeout(timeout);
      setAiGenerating(false);
    }
  };

  const applyAiResult = async () => {
    if (!aiResult) return;

    try {
      const file = await dataUrlToFile(
        aiResult.dataUrl,
        `ai-${aiResult.kind}-${Date.now()}.png`,
      );
      if (aiResult.kind === "logo") setLogoFile(file);
      else setBackgroundFile(file);

      setMessage(
        aiResult.kind === "logo"
          ? "AIロゴをプレビューへ反映しました。「名刺を保存」で確定してください。"
          : "AI背景をプレビューへ反映しました。「名刺を保存」で確定してください。",
      );
      setAiStatus("");
      setAiResult(null);
      setAiOpen(false);
    } catch (applyError) {
      setAiError(`生成画像を適用できませんでした: ${errorMessage(applyError)}`);
    }
  };

  const uploadImage = async (
    file: File,
    uid: string,
    nextCardId: string,
    kind: "logo" | "background",
  ) => {
    const storageRef = ref(
      storage,
      `users/${uid}/cards/${nextCardId}/${kind}-${Date.now()}.webp`,
    );
    await uploadBytes(storageRef, file, { contentType: file.type });
    return getDownloadURL(storageRef);
  };

  const saveCard = async () => {
    if (!user || saving) return;
    if (!card.name.trim()) {
      setError("氏名を入力してください。");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const nextRef = cardId
        ? doc(db, "users", user.uid, "cards", cardId)
        : doc(collection(db, "users", user.uid, "cards"));
      const nextCardId = nextRef.id;
      const [optimizedLogo, optimizedBackground] = await Promise.all([
        logoFile
          ? compressImageToWebP(logoFile, {
              maxBytes: 300 * 1024,
              maxWidth: 1200,
              maxHeight: 1200,
            })
          : Promise.resolve(null),
        backgroundFile
          ? compressImageToWebP(backgroundFile, {
              maxBytes: 500 * 1024,
              maxWidth: 1440,
              maxHeight: 2560,
            })
          : Promise.resolve(null),
      ]);
      const [logoUrl, backgroundUrl] = await Promise.all([
        optimizedLogo
          ? uploadImage(optimizedLogo, user.uid, nextCardId, "logo")
          : Promise.resolve(card.logoUrl),
        optimizedBackground
          ? uploadImage(optimizedBackground, user.uid, nextCardId, "background")
          : Promise.resolve(card.backgroundUrl),
      ]);
      const slug = card.slug || createCardSlug(card.name);
      const payload = {
        ...card,
        name: card.name.trim(),
        company: card.company.trim(),
        department: card.department.trim(),
        title: card.title.trim(),
        phone: card.phone.trim(),
        email: card.email.trim(),
        website: card.website.trim(),
        address: card.address.trim(),
        logoUrl,
        backgroundUrl,
        slug,
        updatedAt: serverTimestamp(),
        ...(cardId ? {} : { createdAt: serverTimestamp() }),
      };

      await setDoc(nextRef, payload, { merge: true });
      setCardId(nextCardId);
      setCard((current) => ({ ...current, logoUrl, backgroundUrl, slug }));
      setLogoFile(null);
      setBackgroundFile(null);
      setMessage("名刺を保存しました。");
    } catch (saveError) {
      setError(`保存に失敗しました: ${errorMessage(saveError)}`);
    } finally {
      setSaving(false);
    }
  };


  if (loading || !user) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f4f1eb] text-sm text-stone-600">
        読み込み中...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f4f1eb] text-stone-900">
      <header className="border-b border-black/10 bg-[#f4f1eb]/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.28em] text-stone-500">
              DIGITAL IDENTITY
            </p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight">
              AI名刺画像作成
            </h1>
          </div>
          <button
            type="button"
            onClick={() => void signOut(auth)}
            className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold shadow-sm transition hover:bg-stone-50"
          >
            <LogOut className="h-4 w-4" />
            ログアウト
          </button>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <section className="rounded-3xl border border-black/10 bg-white p-5 shadow-sm sm:p-8">
          <div className="mb-7 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">名刺情報</h2>
              <p className="mt-1 text-sm text-stone-500">
                入力内容は右側のカードへ即時反映されます。
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAiOpen((current) => !current)}
              className="hidden items-center gap-2 rounded-full border border-stone-900 bg-stone-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-black sm:flex"
            >
              <Sparkles className="h-4 w-4" />
              AIデザイン
            </button>
          </div>

          {aiOpen && (
            <section className="mb-7 rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-violet-600 text-white">
                    <Bot className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold">AIデザイン生成</h3>
                    <p className="mt-0.5 text-xs text-stone-500">
                      OpenAIで背景またはシンボルロゴを1枚生成します。
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (!aiGenerating) setAiOpen(false);
                  }}
                  disabled={aiGenerating}
                  aria-label="AIデザインを閉じる"
                  className="grid h-8 w-8 place-items-center rounded-full text-stone-400 hover:bg-white hover:text-stone-700 disabled:opacity-30"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-2 rounded-xl bg-white p-1">
                {(["background", "logo"] as const).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => {
                      setAiKind(kind);
                      setAiResult(null);
                      setAiError("");
                      setAiStatus("");
                    }}
                    disabled={aiGenerating}
                    className={[
                      "rounded-lg px-3 py-2 text-sm font-semibold transition",
                      aiKind === kind
                        ? "bg-violet-600 text-white"
                        : "text-stone-500 hover:bg-violet-50",
                    ].join(" ")}
                  >
                    {kind === "background" ? "背景を作る" : "ロゴを作る"}
                  </button>
                ))}
              </div>

              <label className="mt-4 block">
                <span className="text-xs font-semibold text-stone-600">
                  デザイン指示
                </span>
                <textarea
                  value={aiPrompt}
                  onChange={(event) => setAiPrompt(event.target.value)}
                  rows={4}
                  maxLength={1200}
                  placeholder={
                    aiKind === "background"
                      ? "例：黒とゴールドを基調にした、建築会社向けの高級感ある幾何学デザイン。落ち着いて信頼感のある印象。"
                      : "例：飛躍と信頼を表す、鷹をモチーフにしたミニマルで力強いシンボル。"
                  }
                  className="mt-2 w-full resize-none rounded-xl border border-violet-200 bg-white px-4 py-3 text-sm outline-none focus:border-violet-500"
                />
              </label>

              {aiKind === "logo" && (
                <p className="mt-2 text-xs leading-relaxed text-stone-500">
                  ロゴは文字を含めず、透明背景のシンボルマークとして生成します。生成結果によっては背景が完全に透明にならない場合があります。
                </p>
              )}

              <button
                type="button"
                onClick={() => void generateAiImage()}
                disabled={aiGenerating || !aiPrompt.trim()}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <WandSparkles className="h-4 w-4" />
                {aiGenerating
                  ? "AIが生成しています…"
                  : aiKind === "background"
                    ? "AI背景を生成"
                    : "AIロゴを生成"}
              </button>

              {aiStatus && (
                <div className="mt-4 rounded-xl border border-violet-200 bg-white px-4 py-3 text-sm text-violet-700">
                  <div className="flex items-center gap-3">
                    {aiGenerating && (
                      <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" />
                    )}
                    <span>{aiStatus}</span>
                  </div>
                </div>
              )}

              {aiError && (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-relaxed text-red-700">
                  <p className="font-semibold">画像生成に失敗しました</p>
                  <p className="mt-1">{aiError}</p>
                </div>
              )}

              {aiResult && (
                <div className="mt-4 rounded-2xl border border-violet-200 bg-white p-3">
                  <div
                    className={[
                      "mx-auto overflow-hidden rounded-xl bg-[linear-gradient(45deg,#eee_25%,transparent_25%),linear-gradient(-45deg,#eee_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#eee_75%),linear-gradient(-45deg,transparent_75%,#eee_75%)] bg-[length:20px_20px] bg-[position:0_0,0_10px,10px_-10px,-10px_0px]",
                      aiResult.kind === "logo"
                        ? "aspect-square max-w-64"
                        : "aspect-[2/3] max-w-64",
                    ].join(" ")}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={aiResult.dataUrl}
                      alt="AI生成結果"
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => void applyAiResult()}
                      className="rounded-xl bg-stone-900 px-4 py-3 text-sm font-semibold text-white hover:bg-black"
                    >
                      {aiResult.kind === "logo"
                        ? "このロゴを採用"
                        : "この背景を採用"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void generateAiImage()}
                      className="rounded-xl border border-stone-200 px-4 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50"
                    >
                      もう一度生成
                    </button>
                  </div>
                </div>
              )}

              <p className="mt-2 text-center text-[11px] text-stone-400">
                画像生成ごとにOpenAI API料金が発生します。画面を閉じずにお待ちください。
              </p>
            </section>
          )}

          <div className="grid gap-5 sm:grid-cols-2">
            {fields.map((field) => (
              <label
                key={field.name}
                className={field.name === "address" ? "sm:col-span-2" : ""}
              >
                <span className="text-xs font-semibold text-stone-600">
                  {field.label}
                </span>
                <input
                  type={field.type || "text"}
                  value={card[field.name]}
                  onChange={(event) => updateField(field.name, event.target.value)}
                  placeholder={field.placeholder}
                  className="mt-2 w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm outline-none transition placeholder:text-stone-400 focus:border-stone-500 focus:bg-white"
                />
              </label>
            ))}

            <ImageInput
              label="ロゴ画像"
              file={logoFile}
              onChange={setLogoFile}
              hint="透過PNG推奨"
            />
            <ImageInput
              label="背景画像"
              file={backgroundFile}
              onChange={setBackgroundFile}
              hint="縦長推奨・500KB以下へ自動圧縮"
            />

            <ColorInput
              label="メインカラー"
              value={card.mainColor}
              onChange={(value) => updateField("mainColor", value)}
            />
            <ColorInput
              label="文字色"
              value={card.textColor}
              onChange={(value) => updateField("textColor", value)}
            />
          </div>

          <button
            type="button"
            onClick={() => setAiOpen(true)}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-violet-300 bg-violet-50 px-4 py-3 text-sm font-semibold text-violet-700 transition hover:border-violet-500 hover:bg-violet-100 sm:hidden"
          >
            <Sparkles className="h-4 w-4" />
            AIデザインを作る
          </button>

          {(error || message) && (
            <div
              className={`mt-6 rounded-xl px-4 py-3 text-sm ${
                error
                  ? "border border-red-200 bg-red-50 text-red-700"
                  : "border border-emerald-200 bg-emerald-50 text-emerald-700"
              }`}
            >
              {error || message}
            </div>
          )}

          <div className="mt-7 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => void saveCard()}
              disabled={saving}
              className="flex items-center justify-center gap-2 rounded-xl bg-stone-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-black disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? "保存中..." : "名刺を保存"}
            </button>
            <Link
              href="/my-card"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 rounded-xl border border-stone-900 bg-white px-4 py-3 text-sm font-semibold transition hover:bg-stone-50"
            >
              <ExternalLink className="h-4 w-4" />
              マイ名刺を開く
            </Link>
          </div>


          {card.slug && (
            <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl bg-stone-50 px-4 py-3 text-sm">
              <span className="text-stone-500">公開URL</span>
              <Link
                href={`/v/${card.slug}`}
                target="_blank"
                className="font-semibold text-stone-900 underline decoration-stone-300 underline-offset-4"
              >
                /v/{card.slug}
              </Link>
            </div>
          )}
        </section>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-[0.18em] text-stone-500">
                LIVE PREVIEW
              </p>
              <p className="mt-1 text-xs text-stone-500">9:16 / 公開URL QR</p>
            </div>
            <Download className="h-4 w-4 text-stone-400" />
          </div>
          <div className="mx-auto max-w-[380px] overflow-hidden rounded-[28px] border-[7px] border-stone-900 bg-stone-900 shadow-2xl">
            <BusinessCardPreview
              card={card}
              logoPreviewUrl={logoPreviewUrl}
              backgroundPreviewUrl={backgroundPreviewUrl}
              previewRef={previewRef}
              qrValue={buildVCard(card)}
            />
          </div>
        </aside>
      </div>
    </main>
  );
}

function ImageInput({
  label,
  file,
  onChange,
  hint,
}: {
  label: string;
  file: File | null;
  onChange: (file: File | null) => void;
  hint: string;
}) {
  return (
    <label>
      <span className="text-xs font-semibold text-stone-600">{label}</span>
      <span className="mt-2 flex min-h-12 cursor-pointer items-center rounded-xl border border-dashed border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-500 transition hover:border-stone-500">
        {file?.name || `${hint}・クリックして選択`}
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(event) => onChange(event.target.files?.[0] || null)}
        />
      </span>
    </label>
  );
}

function ColorInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span className="text-xs font-semibold text-stone-600">{label}</span>
      <span className="mt-2 flex items-center gap-3 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2">
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-8 w-10 cursor-pointer border-0 bg-transparent"
        />
        <span className="font-mono text-sm uppercase text-stone-600">{value}</span>
      </span>
    </label>
  );
}
