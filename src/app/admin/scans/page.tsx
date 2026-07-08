"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Search, Trash2, UserPlus, X } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { downloadVCard, type ScannedCard } from "@/lib/scannedCard";

// 管理者用: グループ全メンバーの取り込んだ名刺を閲覧・管理する
type AdminScan = ScannedCard & {
  slug?: string;
  inherited?: boolean;
  imageBackUrl?: string;
};

function onlyDigits(value: string): string {
  return (value || "").replace(/[^0-9]/g, "");
}

function matchesQuery(card: AdminScan, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = `${card.name} ${card.company}`.toLowerCase();
  if (haystack.includes(q)) return true;
  const digits = onlyDigits(q);
  if (digits && onlyDigits(card.phone).includes(digits)) return true;
  return false;
}

export default function AdminScansPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [items, setItems] = useState<AdminScan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [slugFilter, setSlugFilter] = useState("");
  const [selected, setSelected] = useState<AdminScan | null>(null);
  const [deleting, setDeleting] = useState(false);
  // slug → メンバー表示名
  const [memberNames, setMemberNames] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login?next=/admin/scans");
  }, [authLoading, router, user]);

  const reload = useCallback(async () => {
    if (!user) return;
    setError("");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/scans?all=1", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await response.json().catch(() => ({}))) as {
        items?: AdminScan[];
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "読み込みに失敗しました。");
      setItems(data.items || []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "読み込みに失敗しました。");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // メンバー名(slug→氏名)を取得
  useEffect(() => {
    const slugs = Array.from(new Set(items.map((i) => i.slug).filter(Boolean))) as string[];
    if (slugs.length === 0) return;
    let active = true;
    void (async () => {
      const { doc, getDoc } = await import("firebase/firestore");
      const { db } = await import("@/lib/firebase");
      const entries = await Promise.all(
        slugs.map(async (slug) => {
          try {
            const snap = await getDoc(doc(db, "xenocardPublicCards", slug));
            return [slug, String(snap.data()?.name || slug)] as const;
          } catch {
            return [slug, slug] as const;
          }
        }),
      );
      if (active) setMemberNames(new Map(entries));
    })();
    return () => {
      active = false;
    };
  }, [items]);

  const slugOptions = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) {
      if (item.slug) map.set(item.slug, (map.get(item.slug) || 0) + 1);
    }
    return Array.from(map.entries());
  }, [items]);

  const filtered = useMemo(
    () =>
      items.filter(
        (item) =>
          (!slugFilter || item.slug === slugFilter) && matchesQuery(item, query),
      ),
    [items, slugFilter, query],
  );

  const handleDelete = async (item: AdminScan) => {
    if (!user || !item.id) return;
    if (!window.confirm("この取り込んだ名刺を削除しますか？")) return;
    setDeleting(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/scans", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ id: item.id }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "削除に失敗しました。");
      }
      setSelected(null);
      await reload();
    } catch (caught) {
      window.alert(caught instanceof Error ? caught.message : "削除に失敗しました。");
    } finally {
      setDeleting(false);
    }
  };

  if (authLoading || !user || loading) {
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-stone-100 text-sm text-black/50">
        読み込んでいます…
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-stone-100 text-black">
      <div className="sticky top-0 z-20 border-b border-stone-200 bg-white/95 backdrop-blur">
        <div className="mx-auto max-w-3xl px-5 pt-5">
          <div className="mb-3 flex items-center gap-3">
            <Link
              href="/admin"
              className="rounded-full p-1.5 text-black/50 hover:bg-stone-100 hover:text-black"
              aria-label="管理画面へ戻る"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <h1 className="text-lg font-semibold">取り込んだ名刺（全メンバー）</h1>
              <p className="text-[10px] text-black/40">
                メンバーがスキャンした名刺の画像と情報を確認できます
              </p>
            </div>
            <span className="ml-auto shrink-0 text-sm text-black/40">
              {query || slugFilter ? `${filtered.length} / ${items.length}` : `${items.length}件`}
            </span>
          </div>
          <div className="grid gap-2 pb-4 sm:grid-cols-[1fr_220px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-black/30" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="氏名・社名・電話番号で検索"
                className="h-11 w-full rounded-xl border border-stone-300 bg-white pl-10 pr-4 text-sm outline-none placeholder:text-black/30 focus:border-black/40"
              />
            </div>
            <select
              value={slugFilter}
              onChange={(event) => setSlugFilter(event.target.value)}
              className="h-11 rounded-xl border border-stone-300 bg-white px-3 text-sm outline-none focus:border-black/40"
            >
              <option value="">全メンバー</option>
              {slugOptions.map(([slug, count]) => (
                <option key={slug} value={slug}>
                  {memberNames.get(slug) || slug}（{count}）
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-5 pb-16 pt-5">
        {error && (
          <p className="mb-4 rounded-xl bg-red-100 px-4 py-3 text-sm text-red-700">{error}</p>
        )}
        {filtered.length === 0 ? (
          <div className="mt-16 text-center text-sm text-black/40">
            {items.length === 0
              ? "まだ取り込まれた名刺はありません。"
              : "条件に一致する名刺はありません。"}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {filtered.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelected(item)}
                className="overflow-hidden rounded-2xl border border-stone-200 bg-white text-left shadow-sm transition hover:border-stone-400"
              >
                {item.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.imageUrl}
                    alt={item.name || "名刺"}
                    className="aspect-[16/10] w-full object-cover"
                  />
                )}
                <div className="p-3">
                  <p className="truncate text-sm font-semibold">
                    {item.name || "（氏名なし）"}
                  </p>
                  <p className="truncate text-xs text-black/50">{item.company}</p>
                  <p className="mt-1 truncate text-[10px] text-black/35">
                    取込: {memberNames.get(item.slug || "") || item.slug}
                    {item.inherited ? "（引き継ぎ）" : ""}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 詳細モーダル */}
      {selected && (
        <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setSelected(null)}
          />
          <div className="relative z-10 max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-6 sm:rounded-3xl">
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="absolute right-4 top-4 rounded-full p-1.5 text-black/40 hover:bg-stone-100 hover:text-black"
              aria-label="閉じる"
            >
              <X className="h-5 w-5" />
            </button>

            {selected.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={selected.imageUrl}
                alt={selected.name || "名刺"}
                className="mb-3 w-full rounded-2xl border border-stone-200 object-contain"
              />
            )}
            {selected.imageBackUrl && (
              <div className="mb-3">
                <p className="mb-1 text-xs text-black/40">裏面</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={selected.imageBackUrl}
                  alt={`${selected.name || "名刺"}(裏面)`}
                  className="w-full rounded-2xl border border-stone-200 object-contain"
                />
              </div>
            )}

            <dl className="grid gap-2.5 text-sm">
              {[
                ["取込者", memberNames.get(selected.slug || "") || selected.slug || ""],
                ["氏名", selected.name],
                ["会社名", selected.company],
                ["部署", selected.department],
                ["役職", selected.title],
                ["資格", selected.qualifications],
                ["電話番号", selected.phone],
                ["メール", selected.email],
                ["サイト", selected.website],
                ["住所", selected.address],
                ["メモ", selected.memo],
              ]
                .filter(([, value]) => Boolean(value))
                .map(([label, value]) => (
                  <div key={label} className="flex gap-3">
                    <dt className="w-16 shrink-0 text-black/40">{label}</dt>
                    <dd className="flex-1 break-words text-black/90">{value}</dd>
                  </div>
                ))}
            </dl>

            <div className="mt-6 grid gap-3">
              <button
                type="button"
                onClick={() => downloadVCard(selected)}
                className="flex h-14 items-center justify-center gap-2.5 rounded-2xl bg-black text-base font-semibold text-white transition hover:bg-stone-800"
              >
                <UserPlus className="h-5 w-5" />
                連絡先に追加
              </button>
              <button
                type="button"
                onClick={() => void handleDelete(selected)}
                disabled={deleting}
                className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-red-300 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                削除
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
