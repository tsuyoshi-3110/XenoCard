"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { CreditCard, LogIn, Share2, X } from "lucide-react";
import { type BusinessCard } from "@/lib/businessCard";
import { db } from "@/lib/firebase";

export default function MemberPage() {
  const params = useParams<{ slug: string }>();
  const slug = decodeURIComponent(params.slug || "");

  const [card, setCard] = useState<BusinessCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    if (!slug) return;
    let active = true;
    void getDoc(doc(db, "publicCards", slug))
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
  const pageUrl = card ? `${appOrigin}/m/${card.slug}` : `${appOrigin}/m/${slug}`;

  const handleNativeShare = () => {
    if (!card) return;
    if (navigator.share) {
      void navigator.share({ title: `${card.name}の名刺`, url: pageUrl });
    }
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
            href={`/v/${card.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-14 items-center justify-center gap-2.5 rounded-2xl bg-white text-base font-semibold text-black transition hover:bg-stone-100"
          >
            <CreditCard className="h-5 w-5" />
            名刺を見る
          </a>
          <button
            type="button"
            onClick={() => setShareOpen(true)}
            className="flex h-14 items-center justify-center gap-2.5 rounded-2xl border border-white/15 text-base font-semibold text-white/80 transition hover:bg-white/8"
          >
            <Share2 className="h-5 w-5" />
            この名刺を共有
          </button>
          <Link
            href="/login"
            className="flex h-14 items-center justify-center gap-2.5 rounded-2xl border border-white/10 text-sm font-medium text-white/35 transition hover:bg-white/5"
          >
            <LogIn className="h-4 w-4" />
            ログイン
          </Link>
        </div>
      </div>

      {/* 共有シート */}
      {shareOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          {/* オーバーレイ */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setShareOpen(false)}
          />

          {/* ボトムシート */}
          <div className="relative z-10 w-full max-w-sm rounded-t-3xl bg-[#1c1c1e] px-5 pb-10 pt-5">
            {/* ハンドル */}
            <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-white/20" />

            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-semibold text-white">共有する</p>
              <button type="button" onClick={() => setShareOpen(false)}>
                <X className="h-5 w-5 text-white/40" />
              </button>
            </div>

            <div className="grid gap-3">
              <button
                type="button"
                onClick={handleNativeShare}
                className="flex h-14 items-center gap-4 rounded-2xl bg-white/10 px-5 text-sm font-semibold text-white"
              >
                <Share2 className="h-6 w-6" />
                AirDrop / その他
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
