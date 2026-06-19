"use client";

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { UserRoundPlus } from "lucide-react";
import BusinessCardPreview from "@/components/business-card/BusinessCardPreview";
import { type BusinessCard } from "@/lib/businessCard";
import { db } from "@/lib/firebase";

export default function PublicCardView({ slug }: { slug: string }) {
  const [card, setCard] = useState<BusinessCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let active = true;

    void getDoc(doc(db, "publicCards", slug))
      .then((snapshot) => {
        if (!active) return;
        if (!snapshot.exists()) {
          setNotFound(true);
          return;
        }
        setCard(snapshot.data() as BusinessCard);
      })
      .catch(() => {
        if (active) setNotFound(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [slug]);


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
            qrValue={`${typeof window !== "undefined" ? window.location.origin : ""}/api/vcard/${card.slug}`}
          />
        </div>
        <a
          href={`/api/vcard/${card.slug}`}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-5 py-4 text-sm font-semibold text-black transition hover:bg-stone-100"
        >
          <UserRoundPlus className="h-5 w-5" />
          連絡先に追加
        </a>
        <p className="mt-3 text-center text-xs leading-relaxed text-white/45">
          ボタンを押すとvCard形式の連絡先ファイルを保存できます。
        </p>
      </div>
    </main>
  );
}

