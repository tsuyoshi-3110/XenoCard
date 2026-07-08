"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { ArrowLeft, ScanLine, Trash2, UserPlus, X } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import ScanCardFlow from "@/components/scanned/ScanCardFlow";
import { db } from "@/lib/firebase";
import { downloadVCard, type ScannedCard } from "@/lib/scannedCard";

export default function ScannedListPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [cards, setCards] = useState<ScannedCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ScannedCard | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login?next=/scanned");
    }
  }, [authLoading, router, user]);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, "xenocardUsers", user.uid, "scannedCards"),
      orderBy("createdAt", "desc"),
    );
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setCards(
          snapshot.docs.map((docSnap) => ({
            id: docSnap.id,
            ...(docSnap.data() as Omit<ScannedCard, "id">),
          })),
        );
        setLoading(false);
      },
      () => setLoading(false),
    );
    return () => unsubscribe();
  }, [user]);

  const handleDelete = async (card: ScannedCard) => {
    if (!user || !card.id) return;
    if (!window.confirm("この名刺を削除しますか？")) return;
    setDeletingId(card.id);
    try {
      await deleteDoc(doc(db, "xenocardUsers", user.uid, "scannedCards", card.id));
      if (card.imagePath) {
        const token = await user.getIdToken();
        await fetch("/api/scan-upload", {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ imagePath: card.imagePath }),
        });
      }
      setSelected(null);
    } catch {
      window.alert("削除に失敗しました。");
    } finally {
      setDeletingId(null);
    }
  };

  if (authLoading || (loading && user)) {
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-[#0d0d0d] text-sm text-white/60">
        読み込んでいます…
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-[#0d0d0d] text-white">
      <div className="mx-auto max-w-xl px-5 pb-28 pt-6">
        <div className="mb-6 flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-full p-1.5 text-white/60 hover:bg-white/10 hover:text-white"
            aria-label="戻る"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-semibold">取り込んだ名刺</h1>
          <span className="ml-auto text-sm text-white/40">{cards.length}件</span>
        </div>

        {cards.length === 0 ? (
          <div className="mt-20 text-center text-sm text-white/50">
            まだ取り込んだ名刺はありません。
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {cards.map((card) => (
              <button
                key={card.id}
                type="button"
                onClick={() => setSelected(card)}
                className="overflow-hidden rounded-2xl border border-white/10 bg-white/5 text-left transition hover:border-white/25"
              >
                {card.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={card.imageUrl}
                    alt={card.name || "名刺"}
                    className="aspect-[16/10] w-full object-cover"
                  />
                )}
                <div className="p-3">
                  <p className="truncate text-sm font-semibold">
                    {card.name || "（氏名なし）"}
                  </p>
                  <p className="truncate text-xs text-white/50">{card.company}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 取り込むボタン(固定) */}
      <button
        type="button"
        onClick={() => setScanOpen(true)}
        className="fixed bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-white px-6 py-3.5 text-sm font-semibold text-black shadow-lg transition hover:bg-stone-100"
      >
        <ScanLine className="h-5 w-5" />
        名刺を取り込む
      </button>

      {/* 詳細モーダル */}
      {selected && (
        <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setSelected(null)}
          />
          <div className="relative z-10 max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-[#161616] p-6 sm:rounded-3xl">
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="absolute right-4 top-4 rounded-full p-1.5 text-white/50 hover:bg-white/10 hover:text-white"
              aria-label="閉じる"
            >
              <X className="h-5 w-5" />
            </button>

            {selected.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={selected.imageUrl}
                alt={selected.name || "名刺"}
                className="mb-5 w-full rounded-2xl border border-white/10 object-contain"
              />
            )}

            <dl className="grid gap-2.5 text-sm">
              {[
                ["氏名", selected.name],
                ["会社名", selected.company],
                ["部署", selected.department],
                ["役職", selected.title],
                ["電話番号", selected.phone],
                ["メール", selected.email],
                ["サイト", selected.website],
                ["住所", selected.address],
                ["メモ", selected.memo],
              ]
                .filter(([, value]) => Boolean(value))
                .map(([label, value]) => (
                  <div key={label} className="flex gap-3">
                    <dt className="w-16 shrink-0 text-white/40">{label}</dt>
                    <dd className="flex-1 break-words text-white/90">{value}</dd>
                  </div>
                ))}
            </dl>

            <div className="mt-6 grid gap-3">
              <button
                type="button"
                onClick={() => downloadVCard(selected)}
                className="flex h-14 items-center justify-center gap-2.5 rounded-2xl bg-white text-base font-semibold text-black transition hover:bg-stone-100"
              >
                <UserPlus className="h-5 w-5" />
                連絡先に追加
              </button>
              <button
                type="button"
                onClick={() => void handleDelete(selected)}
                disabled={deletingId === selected.id}
                className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-red-500/30 text-sm font-semibold text-red-300 transition hover:bg-red-500/10 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                削除
              </button>
            </div>
          </div>
        </div>
      )}

      {scanOpen && user && (
        <ScanCardFlow user={user} onClose={() => setScanOpen(false)} />
      )}
    </main>
  );
}
