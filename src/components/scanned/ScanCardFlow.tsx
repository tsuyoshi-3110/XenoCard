"use client";

import { useRef, useState } from "react";
import {
  Camera,
  Check,
  Loader2,
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
import CardCropper from "@/components/scanned/CardCropper";

type Step = "capture" | "crop" | "processing" | "review" | "saving" | "done";

type FieldConfig = {
  key: keyof Omit<ScannedCard, "id" | "image" | "createdAt">;
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
  onClose,
  onSaved,
}: {
  slug: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("capture");
  const [processingLabel, setProcessingLabel] = useState("");
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const [rawFile, setRawFile] = useState<File | null>(null);
  const [fields, setFields] = useState<ScannedCard>({ ...EMPTY_SCANNED_CARD });
  const [savedCard, setSavedCard] = useState<ScannedCard | null>(null);

  const resetForNext = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl("");
    setImageBlob(null);
    setRawFile(null);
    setFields({ ...EMPTY_SCANNED_CARD });
    setError("");
    setWarning("");
    setSavedCard(null);
    setStep("capture");
    if (inputRef.current) inputRef.current.value = "";
  };

  // 切り抜き後の画像を補正→OCR→確認へ
  const handleCropped = async (file: File) => {
    setError("");
    setWarning("");
    setStep("processing");
    try {
      setProcessingLabel("画像を補正しています…");
      const enhanced = await enhanceCardImage(file);
      const compressed = await compressImageToWebP(enhanced, {
        maxBytes: 1.4 * 1024 * 1024,
        maxWidth: 1600,
        maxHeight: 1600,
      });
      setImageBlob(compressed);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(compressed));

      setProcessingLabel("AIが文字を読み取っています…");
      const dataUrl = await fileToDataUrl(compressed);
      const response = await fetch("/api/ocr-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl: dataUrl, slug }),
      });
      const data = (await response.json()) as {
        fields?: unknown;
        error?: string;
      };
      if (!response.ok) {
        setWarning(
          data.error
            ? `自動読み取りに失敗しました（${data.error}）。手入力で登録できます。`
            : "自動読み取りに失敗しました。手入力で登録できます。",
        );
        setFields({ ...EMPTY_SCANNED_CARD });
      } else {
        const normalized = normalizeScannedFields(data.fields);
        setFields({ ...EMPTY_SCANNED_CARD, ...normalized });
      }
      setStep("review");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "画像を処理できませんでした。",
      );
      setStep("capture");
    }
  };

  const handleSave = async () => {
    if (!imageBlob) return;
    setError("");
    setStep("saving");
    try {
      const saved = await addScannedCard({
        name: fields.name,
        company: fields.company,
        department: fields.department,
        title: fields.title,
        phone: fields.phone,
        email: fields.email,
        website: fields.website,
        address: fields.address,
        memo: fields.memo,
        image: imageBlob,
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

        {step === "review" && (
          <div className="mx-auto max-w-sm">
            {previewUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt="名刺プレビュー"
                className="mb-5 w-full rounded-2xl border border-white/10 object-contain"
              />
            )}
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
                onClick={resetForNext}
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
