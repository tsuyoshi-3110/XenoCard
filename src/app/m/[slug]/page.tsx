"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { Check, Copy, CreditCard, LogIn, Mail, Share2, X } from "lucide-react";
import { type BusinessCard } from "@/lib/businessCard";
import { db } from "@/lib/firebase";

export default function MemberPage() {
  const params = useParams<{ slug: string }>();
  const slug = decodeURIComponent(params.slug || "");

  const [card, setCard] = useState<BusinessCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);

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

  const handleCopy = () => {
    const doCopy = () => { setCopied(true); setTimeout(() => setCopied(false), 2000); };
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(pageUrl).then(doCopy);
    } else {
      const el = document.createElement("textarea");
      el.value = pageUrl;
      el.style.position = "fixed"; el.style.opacity = "0";
      document.body.appendChild(el); el.select();
      document.execCommand("copy"); document.body.removeChild(el);
      doCopy();
    }
  };

  const handleLine = () => {
    window.open(`https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(pageUrl)}`, "_blank");
  };

  const handleMail = () => {
    if (!card) return;
    const subject = encodeURIComponent(`${card.name}のデジタル名刺`);
    const body = encodeURIComponent(`${card.name}のデジタル名刺はこちら\n\n${pageUrl}`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

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
              {/* LINE */}
              <button
                type="button"
                onClick={handleLine}
                className="flex h-14 items-center gap-4 rounded-2xl bg-[#06C755] px-5 text-sm font-semibold text-white"
              >
                <svg viewBox="0 0 24 24" className="h-6 w-6 fill-white">
                  <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.281.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
                </svg>
                LINEで送る
              </button>

              {/* メール */}
              <button
                type="button"
                onClick={handleMail}
                className="flex h-14 items-center gap-4 rounded-2xl bg-white/10 px-5 text-sm font-semibold text-white"
              >
                <Mail className="h-6 w-6" />
                メールで送る
              </button>

              {/* AirDrop / システム共有（HTTPS環境のみ表示） */}
              {typeof navigator !== "undefined" && "share" in navigator && (
                <button
                  type="button"
                  onClick={handleNativeShare}
                  className="flex h-14 items-center gap-4 rounded-2xl bg-white/10 px-5 text-sm font-semibold text-white"
                >
                  <Share2 className="h-6 w-6" />
                  AirDrop / その他
                </button>
              )}

              {/* URLコピー */}
              <button
                type="button"
                onClick={handleCopy}
                className="flex h-14 items-center gap-4 rounded-2xl bg-white/10 px-5 text-sm font-semibold text-white"
              >
                {copied ? <Check className="h-6 w-6 text-green-400" /> : <Copy className="h-6 w-6" />}
                {copied ? "コピーしました" : "URLをコピー"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
