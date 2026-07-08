"use client";

import { useRef, useState } from "react";
import {
  Camera,
  Check,
  Loader2,
  RefreshCw,
  RotateCcw,
  UserPlus,
  X,
} from "lucide-react";
import { enhanceCardImage, fileToDataUrl } from "@/lib/cardImageEnhance";
import { compressImageToWebP } from "@/lib/imageCompression";
import {
  downloadVCard,
  EMPTY_SCANNED_CARD,
  normalizeScannedFields,
  type ScannedCard,
} from "@/lib/scannedCard";
import { addScannedCard } from "@/lib/scannedStore";
import { loadScanCredential, saveRemoteScan } from "@/lib/scannedRemote";
import CardCropper from "@/components/scanned/CardCropper";

type Step = "capture" | "crop" | "processing" | "review" | "saving" | "done";

type FieldConfig = {
  key: keyof Omit<
    ScannedCard,
    "id" | "image" | "imageUrl" | "imageBack" | "imageBackUrl" | "createdAt"
  >;
  label: string;
  type?: string;
  full?: boolean;
};

const FIELDS: FieldConfig[] = [
  { key: "name", label: "氏名" },
  { key: "company", label: "会社名", full: true },
  { key: "department", label: "部署" },
  { key: "title", label: "役職" },
  { key: "phone", label: "電話番号", type: "tel" },
  { key: "email", label: "メール", type: "email" },
  { key: "website", label: "サイト", full: true },
  { key: "address", label: "住所", full: true },
  { key: "memo", label: "メモ", full: true },
];

export default function ScanCardFlow({
  slug,
  initialFile,
  onClose,
  onSaved,
}: {
  slug: string;
  initialFile?: File | null;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>(initialFile ? "crop" : "capture");
  const [processingLabel, setProcessingLabel] = useState("");
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const [rawFile, setRawFile] = useState<File | null>(initialFile ?? null);
  const [fields, setFields] = useState<ScannedCard>({ ...EMPTY_SCANNED_CARD });
  const [savedCard, setSavedCard] = useState<ScannedCard | null>(null);

  // 裏面(任意)
  const backInputRef = useRef<HTMLInputElement>(null);
  const [backRawFile, setBackRawFile] = useState<File | null>(null);
  const [backBlob, setBackBlob] = useState<Blob | null>(null);
  const [backPreviewUrl, setBackPreviewUrl] = useState("");
  const [backProcessing, setBackProcessing] = useState(false);

  const removeBack = () => {
    if (backPreviewUrl) URL.revokeObjectURL(backPreviewUrl);
    setBackPreviewUrl("");
    setBackBlob(null);
    setBackRawFile(null);
  };

  const resetForNext = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl("");
    setImageBlob(null);
    setRawFile(null);
    removeBack();
    setFields({ ...EMPTY_SCANNED_CARD });
    setError("");
    setWarning("");
    setSavedCard(null);
    setStep("capture");
    if (inputRef.current) inputRef.current.value = "";
  };

  // 「続けて取り込む」等からカメラを即起動(ユーザー操作の直下で呼ぶこと)
  const captureAgain = () => {
    resetForNext();
    inputRef.current?.click();
  };

  // AI読み取り。通信用にさらに縮小し、タイムアウト付きで呼ぶ。
  // 失敗しても例外を投げず結果オブジェクトで返す(写真を失わないため)。
  const runOcr = async (
    image: Blob,
  ): Promise<
    | { ok: true; fields: ReturnType<typeof normalizeScannedFields> }
    | { ok: false; message: string }
  > => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 75_000);
    try {
      const ocrFile = await compressImageToWebP(
        new File([image], "ocr.webp", { type: image.type || "image/webp" }),
        { maxBytes: 900 * 1024, maxWidth: 1280, maxHeight: 1280 },
      );
      const dataUrl = await fileToDataUrl(ocrFile);
      const response = await fetch("/api/ocr-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl: dataUrl, slug }),
        signal: controller.signal,
      });
      const data = (await response
        .json()
        .catch(() => ({}))) as { fields?: unknown; error?: string };
      if (!response.ok) {
        return {
          ok: false,
          message: data.error || `サーバーエラー（${response.status}）`,
        };
      }
      return { ok: true, fields: normalizeScannedFields(data.fields) };
    } catch (caught) {
      const aborted = caught instanceof DOMException && caught.name === "AbortError";
      return {
        ok: false,
        message: aborted
          ? "時間切れになりました"
          : "通信に失敗しました。電波状況をご確認ください",
      };
    } finally {
      window.clearTimeout(timer);
    }
  };

  // OCR結果を画面へ反映(全項目空なら注意を表示)
  const applyOcrResult = (
    result: Awaited<ReturnType<typeof runOcr>>,
  ) => {
    if (result.ok) {
      setFields({ ...EMPTY_SCANNED_CARD, ...result.fields });
      const allEmpty = Object.values(result.fields).every((v) => !v);
      setWarning(
        allEmpty
          ? "文字を読み取れませんでした。「AIで再読み取り」か手入力をお試しください。"
          : "",
      );
    } else {
      setWarning(
        `自動読み取りに失敗しました（${result.message}）。「AIで再読み取り」か手入力で登録できます。`,
      );
    }
  };

  // 切り抜き後の画像を補正→OCR→確認へ。
  // OCRに失敗しても写真は保持したまま確認画面へ進む。
  const handleCropped = async (file: File) => {
    setError("");
    setWarning("");
    setStep("processing");

    let compressed: File;
    try {
      setProcessingLabel("画像を補正しています…");
      const enhanced = await enhanceCardImage(file);
      compressed = await compressImageToWebP(enhanced, {
        maxBytes: 1.4 * 1024 * 1024,
        maxWidth: 1600,
        maxHeight: 1600,
      });
      setImageBlob(compressed);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(compressed));
    } catch (caught) {
      // 画像処理自体の失敗のみ撮り直しへ戻す
      setError(
        caught instanceof Error ? caught.message : "画像を処理できませんでした。",
      );
      setStep("capture");
      return;
    }

    setProcessingLabel("AIが文字を読み取っています…");
    applyOcrResult(await runOcr(compressed));
    setStep("review");
  };

  // 裏面: 切り抜き後に補正して保持(AI読み取りは行わない)
  const handleBackCropped = async (file: File) => {
    setBackRawFile(null);
    setBackProcessing(true);
    try {
      const enhanced = await enhanceCardImage(file);
      const compressed = await compressImageToWebP(enhanced, {
        maxBytes: 1.4 * 1024 * 1024,
        maxWidth: 1600,
        maxHeight: 1600,
      });
      if (backPreviewUrl) URL.revokeObjectURL(backPreviewUrl);
      setBackBlob(compressed);
      setBackPreviewUrl(URL.createObjectURL(compressed));
    } catch {
      window.alert("裏面画像を処理できませんでした。");
    } finally {
      setBackProcessing(false);
    }
  };

  // 確認画面から同じ画像でAI読み取りをやり直す
  const [ocrRetrying, setOcrRetrying] = useState(false);
  const retryOcr = async () => {
    if (!imageBlob || ocrRetrying) return;
    setOcrRetrying(true);
    setWarning("");
    try {
      applyOcrResult(await runOcr(imageBlob));
    } finally {
      setOcrRetrying(false);
    }
  };

  const handleSave = async () => {
    if (!imageBlob) return;
    setError("");
    setStep("saving");
    try {
      const payload = {
        name: fields.name,
        company: fields.company,
        department: fields.department,
        title: fields.title,
        phone: fields.phone,
        email: fields.email,
        website: fields.website,
        address: fields.address,
        memo: fields.memo,
      };
      // 本人用リンク登録済みならサーバー(Firestore)へ、無ければこの端末内へ保存
      const cred = loadScanCredential();
      const saved = cred
        ? await saveRemoteScan(cred, payload, imageBlob, backBlob)
        : await addScannedCard({
            ...payload,
            image: imageBlob,
            imageBack: backBlob ?? undefined,
          });
      setSavedCard(saved);
      setStep("done");
      onSaved?.();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "保存に失敗しました。",
      );
      setStep("review");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0d0d0d] text-white">
      {/* ヘッダー */}
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <p className="text-sm font-semibold">名刺を取り込む</p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-1.5 text-white/50 hover:bg-white/10 hover:text-white"
          aria-label="閉じる"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-6">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              setRawFile(file);
              setError("");
              setStep("crop");
            }
          }}
        />

        {step === "crop" && rawFile && (
          <CardCropper
            file={rawFile}
            onConfirm={(cropped) => void handleCropped(cropped)}
            onCancel={resetForNext}
          />
        )}

        {/* 裏面撮影用(任意) */}
        <input
          ref={backInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) setBackRawFile(file);
            event.target.value = "";
          }}
        />

        {/* 裏面の切り抜き */}
        {step === "review" && backRawFile && (
          <CardCropper
            file={backRawFile}
            onConfirm={(cropped) => void handleBackCropped(cropped)}
            onCancel={() => setBackRawFile(null)}
          />
        )}

        {step === "capture" && (
          <div className="mx-auto flex max-w-sm flex-col items-center py-10 text-center">
            <div className="mb-6 grid h-20 w-20 place-items-center rounded-3xl bg-white/5">
              <Camera className="h-9 w-9 text-white/70" />
            </div>
            <h2 className="text-lg font-semibold">相手の名刺を撮影</h2>
            <p className="mt-2 text-sm text-white/50">
              明るい場所で、名刺全体が画面に入るように撮ってください。
              反射を抑えて自動で見やすく補正します。
            </p>
            <p className="mt-2 text-xs text-white/30">
              取り込んだ名刺はこの端末内にのみ保存されます。
            </p>
            {error && (
              <p className="mt-4 rounded-xl bg-red-500/15 px-4 py-3 text-sm text-red-200">
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="mt-8 flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl bg-white text-base font-semibold text-black transition hover:bg-stone-100"
            >
              <Camera className="h-5 w-5" />
              カメラを起動
            </button>
          </div>
        )}

        {step === "processing" && (
          <div className="mx-auto flex max-w-sm flex-col items-center py-20 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-white/70" />
            <p className="mt-5 text-sm text-white/70">{processingLabel}</p>
            {previewUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt="名刺プレビュー"
                className="mt-6 w-full max-w-xs rounded-2xl border border-white/10 object-contain"
              />
            )}
          </div>
        )}

        {step === "review" && !backRawFile && (
          <div className="mx-auto max-w-sm">
            {previewUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt="名刺プレビュー(表面)"
                className="mb-3 w-full rounded-2xl border border-white/10 object-contain"
              />
            )}

            {/* 裏面(任意) */}
            <div className="mb-5">
              {backProcessing ? (
                <div className="flex h-11 items-center justify-center gap-2 rounded-xl border border-white/10 text-xs text-white/50">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  裏面を処理しています…
                </div>
              ) : backBlob && backPreviewUrl ? (
                <div>
                  <p className="mb-1.5 text-xs text-white/40">裏面</p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={backPreviewUrl}
                    alt="名刺プレビュー(裏面)"
                    className="w-full rounded-2xl border border-white/10 object-contain"
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => backInputRef.current?.click()}
                      className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/15 text-xs font-semibold text-white/60 transition hover:bg-white/8"
                    >
                      <Camera className="h-3.5 w-3.5" />
                      裏面を撮り直す
                    </button>
                    <button
                      type="button"
                      onClick={removeBack}
                      className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-white/15 px-3 text-xs font-semibold text-white/60 transition hover:bg-white/8"
                    >
                      <X className="h-3.5 w-3.5" />
                      削除
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => backInputRef.current?.click()}
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 text-xs font-semibold text-white/50 transition hover:bg-white/5"
                >
                  <Camera className="h-4 w-4" />
                  裏面も保存する（任意）
                </button>
              )}
            </div>

            {warning && (
              <p className="mb-4 rounded-xl bg-amber-500/15 px-4 py-3 text-sm text-amber-200">
                {warning}
              </p>
            )}
            <p className="mb-3 text-sm text-white/60">
              読み取り結果を確認・修正してください。
            </p>
            <div className="grid grid-cols-2 gap-3">
              {FIELDS.map((field) => (
                <label
                  key={field.key}
                  className={field.full ? "col-span-2" : "col-span-1"}
                >
                  <span className="mb-1 block text-xs text-white/40">
                    {field.label}
                  </span>
                  <input
                    type={field.type || "text"}
                    value={fields[field.key]}
                    onChange={(event) =>
                      setFields((prev) => ({
                        ...prev,
                        [field.key]: event.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-white outline-none focus:border-white/40"
                  />
                </label>
              ))}
            </div>

            {error && (
              <p className="mt-4 rounded-xl bg-red-500/15 px-4 py-3 text-sm text-red-200">
                {error}
              </p>
            )}

            <div className="mt-6 grid gap-3">
              <button
                type="button"
                onClick={() => void handleSave()}
                className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-white text-base font-semibold text-black transition hover:bg-stone-100"
              >
                <Check className="h-5 w-5" />
                この内容で保存
              </button>
              <button
                type="button"
                onClick={() => void retryOcr()}
                disabled={ocrRetrying}
                className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-white/15 text-sm font-semibold text-white/70 transition hover:bg-white/8 disabled:opacity-50"
              >
                {ocrRetrying ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                AIで再読み取り
              </button>
              <button
                type="button"
                onClick={resetForNext}
                className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-white/15 text-sm font-semibold text-white/70 transition hover:bg-white/8"
              >
                <RotateCcw className="h-4 w-4" />
                撮り直す
              </button>
            </div>
          </div>
        )}

        {step === "saving" && (
          <div className="mx-auto flex max-w-sm flex-col items-center py-20 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-white/70" />
            <p className="mt-5 text-sm text-white/70">保存しています…</p>
          </div>
        )}

        {step === "done" && savedCard && (
          <div className="mx-auto flex max-w-sm flex-col items-center py-10 text-center">
            <div className="mb-5 grid h-16 w-16 place-items-center rounded-full bg-emerald-500/20">
              <Check className="h-8 w-8 text-emerald-300" />
            </div>
            <h2 className="text-lg font-semibold">保存しました</h2>
            <p className="mt-1 text-sm text-white/50">
              {savedCard.name || savedCard.company || "名刺"}
            </p>
            <div className="mt-8 grid w-full gap-3">
              <button
                type="button"
                onClick={() => downloadVCard(savedCard)}
                className="flex h-14 items-center justify-center gap-2.5 rounded-2xl bg-white text-base font-semibold text-black transition hover:bg-stone-100"
              >
                <UserPlus className="h-5 w-5" />
                連絡先に追加
              </button>
              <button
                type="button"
                onClick={captureAgain}
                className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-white/15 text-sm font-semibold text-white/70 transition hover:bg-white/8"
              >
                <Camera className="h-4 w-4" />
                続けて取り込む
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex h-12 items-center justify-center rounded-2xl text-sm font-semibold text-white/50 transition hover:text-white/80"
              >
                閉じる
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
