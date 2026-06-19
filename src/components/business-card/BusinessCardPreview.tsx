"use client";

import { useCallback, useRef } from "react";
import { Globe2, Mail, MapPin, Phone } from "lucide-react";
import { type BusinessCard } from "@/lib/businessCard";

type LogoVals = { logoX: number; logoY: number; logoSize: number };

type Props = {
  card: BusinessCard;
  logoPreviewUrl?: string;
  backgroundPreviewUrl?: string;
  previewRef?: React.Ref<HTMLDivElement>;
  qrValue?: string; // 削除予定・互換性のため残す
  fullscreen?: boolean;
  fill?: boolean;
  hideLogo?: boolean;
  onLogoChange?: (vals: LogoVals) => void; // 渡すとロゴがドラッグ可能になる
};

const contactRows = [
  { key: "phone", Icon: Phone },
  { key: "email", Icon: Mail },
  { key: "website", Icon: Globe2 },
  { key: "address", Icon: MapPin },
] as const;

export default function BusinessCardPreview({
  card,
  logoPreviewUrl,
  backgroundPreviewUrl,
  previewRef,
  qrValue,
  fullscreen = false,
  fill = false,
  hideLogo = false,
  onLogoChange,
}: Props) {
  const logoUrl = logoPreviewUrl || card.logoUrl;
  const backgroundUrl = backgroundPreviewUrl || card.backgroundUrl;

  // カードコンテナの ref（ドラッグ座標計算用）
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mergedRef = useCallback(
    (el: HTMLDivElement | null) => {
      containerRef.current = el;
      if (!previewRef) return;
      if (typeof previewRef === "function") previewRef(el);
      else (previewRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    },
    [previewRef],
  );

  // ドラッグ状態（re-render 不要なので ref）
  const drag = useRef<{
    type: "move" | "resize";
    startCX: number; startCY: number;
    startX: number; startY: number; startSize: number;
  } | null>(null);

  // --- ドラッグハンドラ（onLogoChange がある場合のみ使用） ---
  const onLogoPD = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    drag.current = {
      type: "move",
      startCX: e.clientX, startCY: e.clientY,
      startX: card.logoX ?? 8, startY: card.logoY ?? 8,
      startSize: card.logoSize ?? 88,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onLogoPM = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.type !== "move") return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dx = ((e.clientX - d.startCX) / rect.width) * 100;
    const dy = ((e.clientY - d.startCY) / rect.height) * 100;
    onLogoChange?.({
      logoX: Math.round(Math.max(0, Math.min(80, d.startX + dx)) * 10) / 10,
      logoY: Math.round(Math.max(0, Math.min(80, d.startY + dy)) * 10) / 10,
      logoSize: d.startSize,
    });
  };

  const onResizePD = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    drag.current = {
      type: "resize",
      startCX: e.clientX, startCY: e.clientY,
      startX: card.logoX ?? 8, startY: card.logoY ?? 8,
      startSize: card.logoSize ?? 88,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onResizePM = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.type !== "resize") return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    // px移動量をカード幅に対する%に変換
    const deltaPct = ((e.clientX - d.startCX + (e.clientY - d.startCY)) / 2) / rect.width * 100;
    onLogoChange?.({
      logoX: d.startX, logoY: d.startY,
      logoSize: Math.round(Math.max(5, Math.min(60, d.startSize + deltaPct)) * 10) / 10,
    });
  };

  const onPU = () => { drag.current = null; };

  const interactive = !!onLogoChange;
  // logoSize はカード幅に対する% (5–60)。旧形式(px, >60)は変換
  const rawSize = card.logoSize ?? 20;
  const logoSize = rawSize > 60 ? 20 : rawSize; // px時代の値はデフォルトに戻す
  const logoX = card.logoX ?? 8;
  const logoY = card.logoY ?? 8;

  return (
    <div
      ref={mergedRef}
      className={[
        "relative w-full overflow-hidden bg-[#141414] shadow-2xl [container-type:inline-size]",
        fill ? "h-full" : fullscreen ? "h-[100dvh]" : "aspect-[9/16]",
      ].join(" ")}
      style={{ color: card.textColor }}
    >
      {/* 背景 */}
      {backgroundUrl ? (
        <div
          className="absolute inset-0 bg-cover bg-top"
          style={{ backgroundImage: `url("${backgroundUrl}")` }}
        />
      ) : (
        <div
          className="absolute inset-0"
          style={{
            background: `radial-gradient(circle at 18% 15%, ${card.mainColor}66, transparent 34%), linear-gradient(145deg, #252525 0%, #090909 68%, ${card.mainColor}55 135%)`,
          }}
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/35 to-black/80" />

      {/* コンテンツ */}
      <div className="relative flex h-full flex-col px-[8%] pb-[7%] pt-[10%]">

        {/* ロゴ */}
        {!hideLogo && (logoUrl ? (
          <div
            className={`absolute ${interactive ? "touch-none cursor-move" : ""}`}
            style={{ top: `${logoY}%`, left: `${logoX}%`, width: `${logoSize}%` }}
            onPointerDown={interactive ? onLogoPD : undefined}
            onPointerMove={interactive ? onLogoPM : undefined}
            onPointerUp={interactive ? onPU : undefined}
          >
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={logoUrl}
                alt="ロゴ"
                draggable={false}
                style={{ width: "100%", height: "auto", objectFit: "contain", display: "block" }}
              />
              {/* 選択枠 */}
              {interactive && (
                <div className="pointer-events-none absolute inset-0 rounded border-2 border-dashed border-white/70" />
              )}
              {/* リサイズハンドル */}
              {interactive && (
                <div
                  className="absolute cursor-se-resize touch-none rounded-sm bg-white shadow-md"
                  style={{ width: 12, height: 12, bottom: -6, right: -6 }}
                  onPointerDown={onResizePD}
                  onPointerMove={onResizePM}
                  onPointerUp={onPU}
                />
              )}
            </div>
          </div>
        ) : (
          <div
            className={`absolute grid place-items-center rounded-2xl border border-white/20 font-semibold shadow-lg ${interactive ? "cursor-move touch-none" : ""}`}
            style={{
              top: `${logoY}%`, left: `${logoX}%`,
              width: `${logoSize}%`, aspectRatio: "1",
              fontSize: `${logoSize * 0.35}cqw`,
              backgroundColor: `${card.mainColor}dd`,
            }}
            onPointerDown={interactive ? onLogoPD : undefined}
            onPointerMove={interactive ? onLogoPM : undefined}
            onPointerUp={interactive ? onPU : undefined}
          >
            {(card.company || card.name || "C").slice(0, 1)}
          </div>
        ))}

        {/* 名前・会社 — フォントサイズはcqw基準でどのサイズでも実物と同比率 */}
        <div className="mt-auto">
          <div className="mb-[3.6cqw] h-px w-[10%]" style={{ backgroundColor: card.mainColor }} />
          <p className="[font-size:3cqw] font-medium tracking-[0.22em] opacity-80">
            {card.company || "COMPANY NAME"}
          </p>
          <h1 className="mt-[1.2cqw] [font-size:7.2cqw] font-semibold leading-tight tracking-[0.06em]">
            {card.name || "お名前"}
          </h1>
          <p className="mt-[1.2cqw] [font-size:3.6cqw] font-medium opacity-80">
            {card.title || "役職・肩書き"}
          </p>
          {card.department && (
            <p className="mt-[0.6cqw] [font-size:3cqw] font-medium opacity-60">{card.department}</p>
          )}
        </div>

        {/* 連絡先 */}
        <div className="mt-[3.6cqw] grid min-w-0 gap-[1.8cqw] [font-size:3cqw]">
          {contactRows.map(({ key, Icon }) => {
            const value = card[key];
            if (!value) return null;
            return (
              <div key={key} className="flex min-w-0 items-start gap-[1.8cqw]">
                <Icon className="mt-[0.4cqw] shrink-0 [height:3.6cqw] [width:3.6cqw]" style={{ color: card.mainColor }} />
                <span className="min-w-0 break-all leading-relaxed opacity-90">{value}</span>
              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
}
