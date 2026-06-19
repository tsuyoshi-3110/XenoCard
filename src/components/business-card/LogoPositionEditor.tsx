"use client";

import { useRef } from "react";
import BusinessCardPreview from "@/components/business-card/BusinessCardPreview";
import { type BusinessCard } from "@/lib/businessCard";

type Props = {
  card: BusinessCard;
  logoPreviewUrl?: string;
  logoSize: number;
  logoX: number;
  logoY: number;
  onChange: (vals: { logoX: number; logoY: number; logoSize: number }) => void;
};

export default function LogoPositionEditor({
  card,
  logoPreviewUrl,
  logoSize,
  logoX,
  logoY,
  onChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const logoUrl = logoPreviewUrl || card.logoUrl;

  // ドラッグ状態を ref で管理（re-render 不要）
  const drag = useRef<{
    type: "move" | "resize";
    startCX: number;
    startCY: number;
    startX: number;
    startY: number;
    startSize: number;
  } | null>(null);

  const getRect = () => containerRef.current?.getBoundingClientRect() ?? null;

  // --- 移動ハンドラ ---
  const onLogoPD = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    drag.current = {
      type: "move",
      startCX: e.clientX,
      startCY: e.clientY,
      startX: logoX,
      startY: logoY,
      startSize: logoSize,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onLogoPM = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.type !== "move") return;
    const rect = getRect();
    if (!rect) return;
    const dx = ((e.clientX - d.startCX) / rect.width) * 100;
    const dy = ((e.clientY - d.startCY) / rect.height) * 100;
    onChange({
      logoX: Math.round(Math.max(0, Math.min(80, d.startX + dx)) * 10) / 10,
      logoY: Math.round(Math.max(0, Math.min(80, d.startY + dy)) * 10) / 10,
      logoSize,
    });
  };

  const onLogoPU = () => { drag.current = null; };

  // --- リサイズハンドラ ---
  const onResizePD = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    drag.current = {
      type: "resize",
      startCX: e.clientX,
      startCY: e.clientY,
      startX: logoX,
      startY: logoY,
      startSize: logoSize,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onResizePM = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.type !== "resize") return;
    // 右 or 下方向へのドラッグ距離でサイズ変更
    const delta = (e.clientX - d.startCX + (e.clientY - d.startCY)) / 2;
    onChange({
      logoX,
      logoY,
      logoSize: Math.round(Math.max(24, Math.min(220, d.startSize + delta))),
    });
  };

  const onResizePU = () => { drag.current = null; };

  if (!logoUrl) return null;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[10px] font-medium text-black/50">
        ドラッグで移動・右下ハンドルでリサイズ
      </p>
      <div
        ref={containerRef}
        className="relative aspect-[9/16] w-full overflow-hidden rounded-2xl"
      >
        {/* カードのロゴなし版を下敷き */}
        <BusinessCardPreview
          card={card}
          logoPreviewUrl={logoPreviewUrl}
          qrValue=""
          hideLogo
        />

        {/* ドラッグ可能なロゴ */}
        <div
          className="absolute touch-none cursor-move select-none"
          style={{ top: `${logoY}%`, left: `${logoX}%` }}
          onPointerDown={onLogoPD}
          onPointerMove={onLogoPM}
          onPointerUp={onLogoPU}
        >
          <div className="relative" style={{ width: logoSize, height: logoSize }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={logoUrl}
              alt="logo"
              draggable={false}
              style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
            />

            {/* 選択枠 */}
            <div className="pointer-events-none absolute inset-0 rounded border-2 border-dashed border-white/80 shadow-[0_0_0_1px_rgba(0,0,0,0.4)]" />

            {/* リサイズハンドル（右下） */}
            <div
              className="absolute cursor-se-resize touch-none rounded-sm bg-white shadow-md"
              style={{
                width: 14,
                height: 14,
                bottom: -7,
                right: -7,
              }}
              onPointerDown={onResizePD}
              onPointerMove={onResizePM}
              onPointerUp={onResizePU}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
