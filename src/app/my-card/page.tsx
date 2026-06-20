"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import BusinessCardPreview from "@/components/business-card/BusinessCardPreview";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  buildVCard,
  EMPTY_BUSINESS_CARD,
  type BusinessCard,
} from "@/lib/businessCard";
import { db } from "@/lib/firebase";

export default function MyCardPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [card, setCard] = useState<BusinessCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login?next=/my-card");
    }
  }, [authLoading, router, user]);

  useEffect(() => {
    if (!authLoading || user) return;
    const timer = window.setTimeout(() => {
      router.replace("/login?next=/my-card");
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [authLoading, router, user]);

  useEffect(() => {
    if (!user) return;
    let active = true;

    void getDoc(doc(db, "xenocardUsers", user.uid))
      .then(async (snapshot) => {
        if (!active) return;
        const cardSlug = snapshot.data()?.cardSlug;
        if (!snapshot.exists() || typeof cardSlug !== "string" || !cardSlug) {
          setCard(null);
          return;
        }
        const cardSnapshot = await getDoc(doc(db, "xenocardPublicCards", cardSlug));
        if (!active) return;
        if (!cardSnapshot.exists()) {
          setCard(null);
          return;
        }
        setCard({
          ...EMPTY_BUSINESS_CARD,
          ...(cardSnapshot.data() as BusinessCard),
        });
      })
      .catch(() => {
        if (active) setError("名刺を読み込めませんでした。");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [user]);

  if (authLoading || loading || !user) {
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-[#111] text-sm text-white/60">
        マイ名刺を読み込んでいます...
      </main>
    );
  }

  if (error || !card) {
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-[#111] px-6 text-center text-white">
        <div>
          <h1 className="text-xl font-semibold">
            {error || "まだ名刺が作成されていません"}
          </h1>
          <Link
            href="/admin"
            className="mt-5 inline-flex rounded-full bg-white px-5 py-3 text-sm font-semibold text-black"
          >
            名刺を作成する
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="fixed inset-0 overflow-hidden bg-black">
      <BusinessCardPreview
        card={card}
        qrValue={buildVCard(card)}
        fullscreen
      />
    </main>
  );
}
