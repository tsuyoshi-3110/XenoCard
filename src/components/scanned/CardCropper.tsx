"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, RotateCcw } from "lucide-react";
import {
  canvasToWebpFile,
  detectCardQuad,
  warpToCanvas,
  type Point,
  type Quad,
} from "@/lib/cardCrop";

const CORNER_KEYS: (keyof Quad)[] = ["tl", "tr", "br", "bl"];

export default function CardCropper({
  file,
  onConfirm,
  onCancel,
}: {
  file: File;
  onConfirm: (cropped: File) => void;
  onCancel: () => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const dragIndex = useRef<number | null>(null);
  const [url] = useState(() => URL.createObjectURL(file));
  const [quad, setQuad] = useState<Quad | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      if (dragIndex.current === null || !imgRef.current) return;
      event.preventDefault();
      const rect = imgRef.current.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
      const key = CORNER_KEYS[dragIndex.current];
      setQuad((prev) => (prev ? { ...prev, [key]: { x, y } } : prev));
    };
    const endDrag = () => {
      dragIndex.current = null;
    };
    window.addEventListener("pointermove", handleMove, { passive: false });
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    };
  }, []);

  const handleLoad = () => {
    if (imgRef.current) setQuad(detectCardQuad(imgRef.current));
  };

  const handleConfirm = async () => {
    if (!imgRef.current || !quad) return;
    setBusy(true);
    try {
      const canvas = warpToCanvas(imgRef.current, quad);
      const baseName = file.name.replace(/\.[^.]+$/, "") || "card";
      const cropped = await canvasToWebpFile(canvas, `${baseName}-crop`);
      onConfirm(cropped);
    } catch {
      setBusy(false);
    }
  };

  const corners: Point[] = quad
    ? [quad.tl, quad.tr, quad.br, quad.bl]
    : [];
  const polygonPoints = corners
    .map((p) => `${p.x * 100},${p.y * 100}`)
    .join(" ");

  return (
    <div className="mx-auto max-w-sm">
      <p className="mb-1 text-sm font-semibold">切り抜き範囲を調整</p>
      <p className="mb-4 text-xs text-white/50">
        四隅の丸を名刺の角に合わせてください。まっすぐに補正して切り抜きます。
      </p>

      <div className="relative select-none overflow-hidden rounded-2xl border border-white/10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={url}
          alt="撮影した名刺"
          draggable={false}
          onLoad={handleLoad}
          className="block w-full touch-none"
        />
        {quad && (
          <>
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="pointer-events-none absolute inset-0 h-full w-full"
            >
              <polygon
                points={polygonPoints}
                fill="rgba(56,189,248,0.15)"
                stroke="rgb(56,189,248)"
                strokeWidth="0.6"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            {corners.map((point, index) => (
              <button
                key={CORNER_KEYS[index]}
                type="button"
                onPointerDown={(event) => {
                  event.preventDefault();
                  dragIndex.current = index;
                }}
                style={{
                  left: `${point.x * 100}%`,
                  top: `${point.y * 100}%`,
                  touchAction: "none",
                }}
                className="absolute z-10 h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-sky-400 bg-sky-400/30 backdrop-blur-sm active:bg-sky-400/60"
                aria-label="角を調整"
              />
            ))}
          </>
        )}
      </div>

      <div className="mt-6 grid gap-3">
        <button
          type="button"
          onClick={() => void handleConfirm()}
          disabled={busy || !quad}
          className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-white text-base font-semibold text-black transition hover:bg-stone-100 disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Check className="h-5 w-5" />
          )}
          この範囲で切り抜く
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-white/15 text-sm font-semibold text-white/70 transition hover:bg-white/8 disabled:opacity-50"
        >
          <RotateCcw className="h-4 w-4" />
          撮り直す
        </button>
      </div>
    </div>
  );
}
