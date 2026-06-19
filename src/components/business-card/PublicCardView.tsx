"use client";

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { ExternalLink, UserRoundPlus } from "lucide-react";
import BusinessCardPreview from "@/components/business-card/BusinessCardPreview";
import { type BusinessCard } from "@/lib/businessCard";
import { db } from "@/lib/firebase";

export default function PublicCardView({ slug }: { slug: string }) {
  const [card, setCard] = useState<BusinessCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [isLineBrowser, setIsLineBrowser] = useState(false);

  useEffect(() => {
    // LINE内蔵ブラウザ検知
    setIsLineBrowser(/Line\//i.test(navigator.userAgent));
  }, []);

  useEffect(() => {
    let active = true;
    void getDoc(doc(db, "publicCards", slug))
      .then((snapshot) => {
        if (!active) return;
        if (!snapshot.exists()) { setNotFound(true); return; }
        setCard(snapshot.data() as BusinessCard);
      })
      .catch(() => { if (active) setNotFound(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [slug]);

  const appOrigin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? (typeof window !== "undefined" ? window.location.origin : "");
  const vcardUrl = `${appOrigin}/api/vcard/${slug}`;
  const cardPageUrl = `${appOrigin}/v/${slug}`;

  const openInSafari = () => {
    // LINE内では window.open も制限されるため、Safariスキームで誘導
    window.location.href = `x-safari-${cardPageUrl}`;
    // フォールバック: 通常のURLをコピーするよう案内
    setTimeout(() => {
      window.location.href = cardPageUrl;
    }, 500);
  };

  if (loading) {
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-[#111] text-sm text-white/70">
        名刺を読み込んでいます...
      </main>
    );
  }

  if (notFound || !card) {
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-[#111] px-6 text-center text-white">
        <div>
          <p className="text-xs tracking-[0.2em] text-white/50">404</p>
          <h1 className="mt-3 text-xl font-semibold">名刺が見つかりません</h1>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-[#0d0d0d] px-4 py-6 text-white sm:py-10">
      <div className="mx-auto max-w-[410px]">
        <div className="overflow-hidden rounded-[30px] border border-white/10 bg-black shadow-2xl">
          <BusinessCardPreview
            card={card}
            qrValue={vcardUrl}
          />
        </div>

        {isLineBrowser ? (
          /* LINE内ブラウザ：Safariで開くよう誘導 */
          <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-center">
            <p className="text-sm font-semibold text-white">連絡先に追加するには</p>
            <p className="mt-1 text-xs text-white/50">
              右下の「…」→「ブラウザで開く」を選んでからボタンを押してください
            </p>
            <button
              type="button"
              onClick={openInSafari}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black"
            >
              <ExternalLink className="h-4 w-4" />
              Safariで開く
            </button>
          </div>
        ) : (
          /* 通常ブラウザ：直接vCardダウンロード */
          <a
            href={vcardUrl}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-5 py-4 text-sm font-semibold text-black transition hover:bg-stone-100"
          >
            <UserRoundPlus className="h-5 w-5" />
            連絡先に追加
          </a>
        )}

        <p className="mt-3 text-center text-xs leading-relaxed text-white/45">
          ボタンを押すとvCard形式の連絡先ファイルを保存できます。
        </p>
      </div>
    </main>
  );
}
