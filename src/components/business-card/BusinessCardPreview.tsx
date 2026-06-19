"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Globe2, Mail, MapPin, Phone } from "lucide-react";
import { type BusinessCard } from "@/lib/businessCard";

type Props = {
  card: BusinessCard;
  logoPreviewUrl?: string;
  backgroundPreviewUrl?: string;
  previewRef?: React.Ref<HTMLDivElement>;
  qrValue: string;
  fullscreen?: boolean;
  fill?: boolean; // 親コンテナを100%埋める（PhoneMockup内で使用）
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
}: Props) {
  const [qrDataUrl, setQrDataUrl] = useState("");
  const logoUrl = logoPreviewUrl || card.logoUrl;
  const backgroundUrl = backgroundPreviewUrl || card.backgroundUrl;

  useEffect(() => {
    if (!qrValue) return;
    let active = true;

    void QRCode.toDataURL(qrValue, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 180,
      color: { dark: "#111111", light: "#ffffff" },
    }).then((url) => {
      if (active) setQrDataUrl(url);
    });

    return () => {
      active = false;
    };
  }, [qrValue]);

  return (
    <div
      ref={previewRef}
      className={[
        "relative w-full overflow-hidden bg-[#141414] shadow-2xl",
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
        <div className="flex items-start">
          {logoUrl ? (
            <div className="flex max-h-24 max-w-[50%] items-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logoUrl} alt="ロゴ" className="max-h-24 max-w-full object-contain" />
            </div>
          ) : (
            <div
              className="grid h-[88px] w-[88px] place-items-center rounded-2xl border border-white/20 text-3xl font-semibold shadow-lg"
              style={{ backgroundColor: `${card.mainColor}dd` }}
            >
              {(card.company || card.name || "C").slice(0, 1)}
            </div>
          )}
        </div>

        {/* 名前・会社 */}
        <div className="mt-auto">
          <div className="mb-4 h-px w-10" style={{ backgroundColor: card.mainColor }} />
          <p className="text-[10px] font-medium tracking-[0.22em] opacity-80">
            {card.company || "COMPANY NAME"}
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold leading-tight tracking-[0.06em]">
            {card.name || "お名前"}
          </h1>
          <p className="mt-1.5 text-xs font-medium opacity-80">
            {card.title || "役職・肩書き"}
          </p>
          {card.department && (
            <p className="mt-0.5 text-[10px] font-medium opacity-60">{card.department}</p>
          )}
        </div>

        {/* 連絡先 + QR（横並び） */}
        <div className="mt-4 flex items-end justify-between gap-2">
          <div className="grid min-w-0 flex-1 gap-2 text-[10px]">
            {contactRows.map(({ key, Icon }) => {
              const value = card[key];
              if (!value) return null;
              return (
                <div key={key} className="flex min-w-0 items-start gap-2">
                  <Icon className="mt-0.5 h-3 w-3 shrink-0" style={{ color: card.mainColor }} />
                  <span className="min-w-0 break-all leading-relaxed opacity-90">{value}</span>
                </div>
              );
            })}
          </div>

          {qrDataUrl && (
            <div className="shrink-0 rounded-lg bg-white p-1.5 shadow-xl">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} alt="QR" className="h-14 w-14" />
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
