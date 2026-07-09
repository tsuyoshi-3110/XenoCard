"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { CreditCard, Images, QrCode, ScanLine, Share2, X } from "lucide-react";
import { isLightColor } from "@/lib/businessCard";
import ScanCardFlow from "@/components/scanned/ScanCardFlow";

// サーバーから渡す表示用の最小データ(Firestore Timestamp等は含めない)
export type MemberCard = {
  slug: string;
  name: string;
  company: string;
  title: string;
  logoUrl: string;
  mainColor: string;
  textColor: string;
};

export default function MemberPageClient({ card }: { card: MemberCard }) {
  const slug = card.slug;

  const [qrOpen, setQrOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanFile, setScanFile] = useState<File | null>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);

  // 名刺一覧ページからの取り込みでも使えるようslugを端末に記憶する
  useEffect(() => {
    if (slug) {
      try {
        window.localStorage.setItem("xenocard:lastSlug", slug);
      } catch {
        /* localStorage不可の環境は無視 */
      }
    }
  }, [slug]);

  const appOrigin = (process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://xeno-card.vercel.app");
  // 受け取った側には名刺ページ(/v/)を直接開かせる
  const cardViewUrl = `${appOrigin}/v/${encodeURIComponent(slug)}`;

  const handleNativeShare = () => {
    if (navigator.share) {
      void navigator.share({ title: `${card.name}の名刺`, url: cardViewUrl });
    }
  };

  const handleQrOpen = async () => {
    if (!qrDataUrl) {
      const dataUrl = await QRCode.toDataURL(cardViewUrl, {
        width: 320,
        margin: 2,
        color: { dark: "#000000", light: "#ffffff" },
      });
      setQrDataUrl(dataUrl);
    }
    setQrOpen(true);
  };

  // 明るいデザイン(文字色が暗い)ならページも白基調にする
  const lightPage = !isLightColor(card.textColor, 0.6);
  const secondaryButton = lightPage
    ? "border border-black/15 text-black/70 hover:bg-black/5"
    : "border border-white/15 text-white/80 hover:bg-white/8";

  return (
    <main
      className={`grid min-h-[100dvh] place-items-center px-6 ${
        lightPage ? "bg-white" : "bg-[#0d0d0d]"
      }`}
    >
      <div className="w-full max-w-xs">
        {/* メンバー情報 */}
        <div className="mb-10 text-center">
          {card.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={card.logoUrl} alt="ロゴ" className="mx-auto mb-6 h-32 max-w-[60%] object-contain" />
          ) : (
            <div
              className={`mx-auto mb-6 grid h-28 w-28 place-items-center rounded-3xl text-4xl font-semibold ${
                lightPage ? "border border-black/10 text-black" : "text-white"
              }`}
              style={{ backgroundColor: card.mainColor || "#c9a96e" }}
            >
              {(card.company || card.name || "C").slice(0, 1)}
            </div>
          )}
          <p
            className={`text-xs font-medium tracking-widest ${
              lightPage ? "text-black/40" : "text-white/40"
            }`}
          >
            {card.company}
          </p>
          <h1
            className={`mt-2 text-2xl font-semibold ${
              lightPage ? "text-black" : "text-white"
            }`}
          >
            {card.name}
          </h1>
          {card.title && (
            <p
              className={`mt-1 text-sm ${
                lightPage ? "text-black/50" : "text-white/50"
              }`}
            >
              {card.title}
            </p>
          )}
        </div>

        {/* ボタン */}
        <div className="grid gap-3">
          <a
            href={`/v/${encodeURIComponent(slug)}`}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex h-14 items-center justify-center gap-2.5 rounded-2xl text-base font-semibold transition ${
              lightPage
                ? "bg-stone-900 text-white hover:bg-black"
                : "bg-white text-black hover:bg-stone-100"
            }`}
          >
            <CreditCard className="h-5 w-5" />
            名刺を見る
          </a>
          <button
            type="button"
            onClick={() => void handleQrOpen()}
            className={`flex h-14 items-center justify-center gap-2.5 rounded-2xl text-base font-semibold transition ${secondaryButton}`}
          >
            <QrCode className="h-5 w-5" />
            QRを表示する
          </button>
          <button
            type="button"
            onClick={handleNativeShare}
            className={`flex h-14 items-center justify-center gap-2.5 rounded-2xl text-base font-semibold transition ${secondaryButton}`}
          >
            <Share2 className="h-5 w-5" />
            この名刺を共有
          </button>

          <div className={`my-1 h-px ${lightPage ? "bg-black/10" : "bg-white/10"}`} />
          <input
            ref={scanInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                setScanFile(file);
                setScanOpen(true);
              }
            }}
          />
          <button
            type="button"
            onClick={() => scanInputRef.current?.click()}
            className={`flex h-14 items-center justify-center gap-2.5 rounded-2xl text-base font-semibold transition ${
              lightPage
                ? "bg-black/5 text-black hover:bg-black/10"
                : "bg-white/10 text-white hover:bg-white/15"
            }`}
          >
            <ScanLine className="h-5 w-5" />
            名刺を取り込む
          </button>
          <Link
            href="/scanned"
            className={`flex h-14 items-center justify-center gap-2.5 rounded-2xl text-base font-semibold transition ${secondaryButton}`}
          >
            <Images className="h-5 w-5" />
            取り込んだ名刺一覧
          </Link>
        </div>
      </div>

      {scanOpen && (
        <ScanCardFlow
          slug={slug}
          initialFile={scanFile}
          onClose={() => {
            setScanOpen(false);
            setScanFile(null);
            if (scanInputRef.current) scanInputRef.current.value = "";
          }}
        />
      )}

      {/* QRモーダル */}
      {qrOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setQrOpen(false)}
          />
          <div className="relative z-10 w-full max-w-xs rounded-3xl bg-white p-8 text-center">
            <button
              type="button"
              onClick={() => setQrOpen(false)}
              className="absolute right-4 top-4 rounded-full p-1 text-black/30 hover:text-black/60"
            >
              <X className="h-5 w-5" />
            </button>
            <p className="mb-1 text-sm font-semibold text-black">{card.name}</p>
            <p className="mb-5 text-xs text-black/40">カメラで読み取ると名刺が開きます</p>
            {qrDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrDataUrl} alt="QR" className="mx-auto w-48" />
            )}
            <p className="mt-5 text-[10px] text-black/30">名刺ページが開きます</p>
          </div>
        </div>
      )}
    </main>
  );
}
