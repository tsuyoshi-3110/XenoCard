"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import QRCode from "qrcode";
import { CreditCard, QrCode, Share2, X } from "lucide-react";
import { type BusinessCard } from "@/lib/businessCard";
import { db } from "@/lib/firebase";

export default function MemberPage() {
  const params = useParams<{ slug: string }>();
  const slug = decodeURIComponent(params.slug || "");

  const [card, setCard] = useState<BusinessCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    let active = true;
    void getDoc(doc(db, "xenocardPublicCards", slug))
      .then((snapshot) => {
        if (!active) return;
        if (!snapshot.exists()) setNotFound(true);
        else setCard(snapshot.data() as BusinessCard);
      })
      .catch(() => { if (active) setNotFound(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [slug]);

  const appOrigin = (process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://xeno-card.vercel.app");
  // 受け取った側には名刺ページ(/v/)を直接開かせる
  const cardViewUrl = `${appOrigin}/v/${encodeURIComponent(slug)}`;

  const handleNativeShare = () => {
    if (!card) return;
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

  if (loading) {
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-[#0d0d0d]">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white" />
      </main>
    );
  }

  if (notFound || !card) {
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-[#0d0d0d] px-6 text-center text-white">
        <div>
          <p className="text-xs tracking-[0.2em] text-white/40">404</p>
          <h1 className="mt-3 text-xl font-semibold">ページが見つかりません</h1>
        </div>
      </main>
    );
  }

  return (
    <main className="grid min-h-[100dvh] place-items-center bg-[#0d0d0d] px-6">
      <div className="w-full max-w-xs">
        {/* メンバー情報 */}
        <div className="mb-10 text-center">
          {card.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={card.logoUrl} alt="ロゴ" className="mx-auto mb-6 h-32 max-w-[60%] object-contain" />
          ) : (
            <div
              className="mx-auto mb-6 grid h-28 w-28 place-items-center rounded-3xl text-4xl font-semibold text-white"
              style={{ backgroundColor: card.mainColor || "#c9a96e" }}
            >
              {(card.company || card.name || "C").slice(0, 1)}
            </div>
          )}
          <p className="text-xs font-medium tracking-widest text-white/40">{card.company}</p>
          <h1 className="mt-2 text-2xl font-semibold text-white">{card.name}</h1>
          {card.title && <p className="mt-1 text-sm text-white/50">{card.title}</p>}
        </div>

        {/* ボタン */}
        <div className="grid gap-3">
          <a
            href={`/v/${encodeURIComponent(card.slug || "")}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-14 items-center justify-center gap-2.5 rounded-2xl bg-white text-base font-semibold text-black transition hover:bg-stone-100"
          >
            <CreditCard className="h-5 w-5" />
            名刺を見る
          </a>
          <button
            type="button"
            onClick={() => void handleQrOpen()}
            className="flex h-14 items-center justify-center gap-2.5 rounded-2xl border border-white/15 text-base font-semibold text-white/80 transition hover:bg-white/8"
          >
            <QrCode className="h-5 w-5" />
            QRを表示する
          </button>
          <button
            type="button"
            onClick={handleNativeShare}
            className="flex h-14 items-center justify-center gap-2.5 rounded-2xl border border-white/15 text-base font-semibold text-white/80 transition hover:bg-white/8"
          >
            <Share2 className="h-5 w-5" />
            この名刺を共有
          </button>
        </div>
      </div>

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
