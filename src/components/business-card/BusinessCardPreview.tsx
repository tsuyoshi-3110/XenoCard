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
}: Props) {
  const [qrDataUrl, setQrDataUrl] = useState("");
  const logoUrl = logoPreviewUrl || card.logoUrl;
  const backgroundUrl = backgroundPreviewUrl || card.backgroundUrl;

  useEffect(() => {
    let active = true;

    void QRCode.toDataURL(qrValue, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 220,
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
        fullscreen ? "h-[100dvh]" : "aspect-[9/16]",
      ].join(" ")}
      style={{ color: card.textColor }}
    >
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

      <div className="relative flex h-full flex-col px-[8%] pb-[8%] pt-[10%]">
        <div className="flex min-h-24 items-start justify-between gap-4">
          {logoUrl ? (
            <div className="flex max-h-24 max-w-[58%] items-center bg-transparent">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={logoUrl}
                alt="ロゴ"
                className="max-h-24 max-w-full object-contain"
              />
            </div>
          ) : (
            <div
              className="grid h-[77px] w-[77px] place-items-center rounded-2xl border border-white/20 text-2xl font-semibold shadow-lg"
              style={{ backgroundColor: `${card.mainColor}dd` }}
            >
              {(card.company || card.name || "C").slice(0, 1)}
            </div>
          )}

        </div>

        <div className="mt-auto pb-7">
          <div
            className="mb-5 h-px w-12"
            style={{ backgroundColor: card.mainColor }}
          />
          <p className="text-xs font-medium tracking-[0.22em] opacity-80">
            {card.company || "COMPANY NAME"}
          </p>
          <h1 className="mt-2 text-3xl font-semibold leading-tight tracking-[0.08em]">
            {card.name || "お名前"}
          </h1>
          <p className="mt-2 text-sm font-medium opacity-80">
            {card.title || "役職・肩書き"}
          </p>
          {card.department && (
            <p className="mt-1 text-xs font-medium opacity-60">
              {card.department}
            </p>
          )}
        </div>

        <div className="grid gap-2.5 pr-24 text-[11px]">
          {contactRows.map(({ key, Icon }) => {
            const value = card[key];
            if (!value) return null;

            return (
              <div key={key} className="flex min-w-0 items-start gap-2.5">
                <Icon
                  className="mt-0.5 h-3.5 w-3.5 shrink-0"
                  style={{ color: card.mainColor }}
                />
                <span className="break-words leading-relaxed opacity-90">
                  {value}
                </span>
              </div>
            );
          })}
        </div>

        <div className="absolute bottom-[7%] right-[7%] rounded-lg bg-white p-1.5 shadow-xl">
          {qrDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrDataUrl} alt="連絡先追加QRコード" className="h-20 w-20" />
          ) : (
            <div className="h-20 w-20 animate-pulse bg-gray-100" />
          )}
        </div>
      </div>
    </div>
  );
}
