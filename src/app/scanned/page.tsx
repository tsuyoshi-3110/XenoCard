"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ScanLine, Search, Trash2, UserPlus, X } from "lucide-react";
import ScanCardFlow from "@/components/scanned/ScanCardFlow";
import { downloadVCard, type ScannedCard } from "@/lib/scannedCard";
import { deleteScannedCard, listScannedCards } from "@/lib/scannedStore";
import {
  deleteRemoteScan,
  listRemoteScans,
  loadScanCredential,
  migrateLocalScans,
  type ScanCredential,
} from "@/lib/scannedRemote";

function onlyDigits(value: string): string {
  return (value || "").replace(/[^0-9]/g, "");
}

// 名前・社名・電話番号で絞り込む
function matchesQuery(card: ScannedCard, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = `${card.name} ${card.company}`.toLowerCase();
  if (haystack.includes(q)) return true;
  const digits = onlyDigits(q);
  if (digits && onlyDigits(card.phone).includes(digits)) return true;
  return false;
}

export default function ScannedListPage() {
  const router = useRouter();
  const [cards, setCards] = useState<ScannedCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanFile, setScanFile] = useState<File | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [scanSlug, setScanSlug] = useState("");
  const [cred, setCred] = useState<ScanCredential | null>(null);
  const [credReady, setCredReady] = useState(false);
  const scanInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      setScanSlug(window.localStorage.getItem("xenocard:lastSlug") || "");
    } catch {
      setScanSlug("");
    }
    setCred(loadScanCredential());
    setCredReady(true);
  }, []);

  const reload = useCallback(async () => {
    try {
      // 本人用リンク登録済みならサーバーから、無ければこの端末内から読む
      setCards(cred ? await listRemoteScans(cred) : await listScannedCards());
    } catch {
      setCards([]);
    } finally {
      setLoading(false);
    }
  }, [cred]);

  useEffect(() => {
    if (!credReady) return;
    void (async () => {
      if (cred) {
        try {
          // 端末内に残っている過去データをサーバーへ移行
          await migrateLocalScans(cred);
        } catch {
          /* 移行失敗分はローカルに残る */
        }
      }
      await reload();
    })();
  }, [credReady, cred, reload]);

  // 表示用URL(サーバー保存はimageUrl、端末内保存はBlobから生成)
  const imageUrls = useMemo(() => {
    const map = new Map<string, string>();
    for (const card of cards) {
      if (!card.id) continue;
      if (card.imageUrl) map.set(card.id, card.imageUrl);
      else if (card.image) map.set(card.id, URL.createObjectURL(card.image));
    }
    return map;
  }, [cards]);

  // 裏面(任意)の表示用URL
  const imageBackUrls = useMemo(() => {
    const map = new Map<string, string>();
    for (const card of cards) {
      if (!card.id) continue;
      if (card.imageBackUrl) map.set(card.id, card.imageBackUrl);
      else if (card.imageBack) map.set(card.id, URL.createObjectURL(card.imageBack));
    }
    return map;
  }, [cards]);

  useEffect(() => {
    return () => {
      [imageUrls, imageBackUrls].forEach((map) =>
        map.forEach((url) => {
          if (url.startsWith("blob:")) URL.revokeObjectURL(url);
        }),
      );
    };
  }, [imageUrls, imageBackUrls]);

  const filtered = useMemo(
    () => cards.filter((card) => matchesQuery(card, query)),
    [cards, query],
  );

  const handleDelete = async (card: ScannedCard) => {
    if (!card.id) return;
    if (!window.confirm("この名刺を削除しますか？")) return;
    setDeleting(true);
    try {
      if (cred) await deleteRemoteScan(cred, card.id);
      else await deleteScannedCard(card.id);
      setViewerIndex(null);
      await reload();
    } catch {
      window.alert("削除に失敗しました。");
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-[#0d0d0d] text-sm text-white/60">
        読み込んでいます…
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-[#0d0d0d] text-white">
      {/* ヘッダー＋検索 */}
      <div className="sticky top-0 z-20 border-b border-white/10 bg-[#0d0d0d]/95 backdrop-blur">
        <div className="mx-auto max-w-xl px-5 pt-5">
          <div className="mb-3 flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.back()}
              className="rounded-full p-1.5 text-white/60 hover:bg-white/10 hover:text-white"
              aria-label="戻る"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold">取り込んだ名刺</h1>
              <p className="truncate text-[10px] text-white/30">
                {cred
                  ? "サーバー保存（端末が変わっても本人用リンクで引き継げます）"
                  : "この端末内のみ（本人用リンクを開くとサーバー保存になります）"}
              </p>
            </div>
            <span className="ml-auto shrink-0 text-sm text-white/40">
              {query ? `${filtered.length} / ${cards.length}` : `${cards.length}件`}
            </span>
          </div>
          <div className="pb-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="氏名・社名・電話番号で検索"
                className="h-11 w-full rounded-xl border border-white/15 bg-white/5 pl-10 pr-9 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/40"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-white/40 hover:bg-white/10 hover:text-white"
                  aria-label="クリア"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-xl px-5 pb-28 pt-5">
        {cards.length === 0 ? (
          <div className="mt-16 text-center text-sm text-white/50">
            まだ取り込んだ名刺はありません。
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-16 text-center text-sm text-white/50">
            「{query}」に一致する名刺はありません。
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {filtered.map((card, index) => (
              <button
                key={card.id}
                type="button"
                onClick={() => setViewerIndex(index)}
                className="overflow-hidden rounded-2xl border border-white/10 bg-white/5 text-left transition hover:border-white/25"
              >
                {card.id && imageUrls.get(card.id) && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={imageUrls.get(card.id)}
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

      {/* 取り込むボタン(固定) — タップで即カメラ起動 */}
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
        className="fixed bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-white px-6 py-3.5 text-sm font-semibold text-black shadow-lg transition hover:bg-stone-100"
      >
        <ScanLine className="h-5 w-5" />
        名刺を取り込む
      </button>

      {/* 全画面スワイプ閲覧 */}
      {viewerIndex !== null && filtered[viewerIndex] && (
        <CardViewer
          cards={filtered}
          imageUrls={imageUrls}
          imageBackUrls={imageBackUrls}
          startIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
          onAdd={(card) => downloadVCard(card)}
          onDelete={(card) => void handleDelete(card)}
          deleting={deleting}
        />
      )}

      {scanOpen && (
        <ScanCardFlow
          slug={scanSlug}
          initialFile={scanFile}
          onClose={() => {
            setScanOpen(false);
            setScanFile(null);
            if (scanInputRef.current) scanInputRef.current.value = "";
          }}
          onSaved={() => void reload()}
        />
      )}
    </main>
  );
}

function CardViewer({
  cards,
  imageUrls,
  imageBackUrls,
  startIndex,
  onClose,
  onAdd,
  onDelete,
  deleting,
}: {
  cards: ScannedCard[];
  imageUrls: Map<string, string>;
  imageBackUrls: Map<string, string>;
  startIndex: number;
  onClose: () => void;
  onAdd: (card: ScannedCard) => void;
  onDelete: (card: ScannedCard) => void;
  deleting: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(startIndex);

  // 開いたページへ初期スクロール
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ left: startIndex * el.clientWidth, behavior: "auto" });
  }, [startIndex]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const next = Math.round(el.scrollLeft / el.clientWidth);
    setIndex((prev) => (prev === next ? prev : next));
  };

  const current = cards[index];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex items-center justify-between px-5 py-4 text-white">
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-1.5 text-white/70 hover:bg-white/10 hover:text-white"
          aria-label="閉じる"
        >
          <X className="h-5 w-5" />
        </button>
        <span className="text-sm text-white/60">
          {index + 1} / {cards.length}
        </span>
        <span className="w-8" />
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden"
        style={{ scrollbarWidth: "none" }}
      >
        {cards.map((card) => (
          <div
            key={card.id}
            className="h-full w-full shrink-0 snap-center snap-always overflow-y-auto px-5 pb-8"
          >
            {card.id && imageUrls.get(card.id) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageUrls.get(card.id)}
                alt={card.name || "名刺"}
                className="mx-auto max-h-[55vh] w-full max-w-md rounded-2xl border border-white/10 object-contain"
              />
            )}
            {card.id && imageBackUrls.get(card.id) && (
              <div className="mx-auto mt-3 w-full max-w-md">
                <p className="mb-1 text-xs text-white/40">裏面</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageBackUrls.get(card.id)}
                  alt={`${card.name || "名刺"}(裏面)`}
                  className="max-h-[55vh] w-full rounded-2xl border border-white/10 object-contain"
                />
              </div>
            )}

            <div className="mx-auto mt-5 max-w-md text-white">
              <h2 className="text-lg font-semibold">
                {card.name || "（氏名なし）"}
              </h2>
              {card.company && (
                <p className="text-sm text-white/60">{card.company}</p>
              )}

              <dl className="mt-4 grid gap-2.5 text-sm">
                {[
                  ["部署", card.department],
                  ["役職", card.title],
                  ["電話番号", card.phone],
                  ["メール", card.email],
                  ["サイト", card.website],
                  ["住所", card.address],
                  ["メモ", card.memo],
                ]
                  .filter(([, value]) => Boolean(value))
                  .map(([label, value]) => (
                    <div key={label} className="flex gap-3">
                      <dt className="w-16 shrink-0 text-white/40">{label}</dt>
                      <dd className="flex-1 break-words text-white/90">{value}</dd>
                    </div>
                  ))}
              </dl>
            </div>
          </div>
        ))}
      </div>

      {/* 操作(現在表示中の名刺) */}
      {current && (
        <div className="border-t border-white/10 px-5 py-4">
          <div className="mx-auto grid max-w-md grid-cols-[1fr_auto] gap-3">
            <button
              type="button"
              onClick={() => onAdd(current)}
              className="flex h-14 items-center justify-center gap-2.5 rounded-2xl bg-white text-base font-semibold text-black transition hover:bg-stone-100"
            >
              <UserPlus className="h-5 w-5" />
              連絡先に追加
            </button>
            <button
              type="button"
              onClick={() => onDelete(current)}
              disabled={deleting}
              className="flex h-14 w-14 items-center justify-center rounded-2xl border border-red-500/30 text-red-300 transition hover:bg-red-500/10 disabled:opacity-50"
              aria-label="削除"
            >
              <Trash2 className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
