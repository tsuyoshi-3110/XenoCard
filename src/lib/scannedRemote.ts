// 取り込んだ名刺のサーバー(Firestore)保存クライアント。
// 本人用リンク(/m/{slug}#k={token})で受け取ったトークンを端末に記憶し、
// 以後の保存・一覧・削除はサーバーAPI経由で行う。
import type { ScannedCard } from "@/lib/scannedCard";
import { deleteScannedCard, listScannedCards } from "@/lib/scannedStore";

const CRED_KEY = "xenocard:scanCred";

export type ScanCredential = { slug: string; token: string };

export function saveScanCredential(cred: ScanCredential): void {
  try {
    window.localStorage.setItem(CRED_KEY, JSON.stringify(cred));
  } catch {
    /* localStorage不可の環境は無視 */
  }
}

export function loadScanCredential(): ScanCredential | null {
  try {
    const raw = window.localStorage.getItem(CRED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ScanCredential;
    if (parsed && typeof parsed.slug === "string" && typeof parsed.token === "string") {
      return parsed.slug && parsed.token ? parsed : null;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearScanCredential(): void {
  try {
    window.localStorage.removeItem(CRED_KEY);
  } catch {
    /* ignore */
  }
}

type ApiError = { error?: string };

async function parseJson<T>(response: Response): Promise<T & ApiError> {
  return (await response.json().catch(() => ({}))) as T & ApiError;
}

// 保存(画像+項目を1リクエストで)
export async function saveRemoteScan(
  cred: ScanCredential,
  fields: Omit<ScannedCard, "id" | "image" | "imageUrl" | "createdAt">,
  image: Blob,
): Promise<ScannedCard> {
  const formData = new FormData();
  formData.append("slug", cred.slug);
  formData.append("fields", JSON.stringify(fields));
  formData.append(
    "image",
    new File([image], "scan.webp", { type: image.type || "image/webp" }),
  );
  const response = await fetch("/api/scans", {
    method: "POST",
    headers: { "x-scan-token": cred.token },
    body: formData,
  });
  const data = await parseJson<ScannedCard>(response);
  if (!response.ok) throw new Error(data.error || "保存に失敗しました。");
  return data;
}

export async function listRemoteScans(cred: ScanCredential): Promise<ScannedCard[]> {
  const response = await fetch(`/api/scans?slug=${encodeURIComponent(cred.slug)}`, {
    headers: { "x-scan-token": cred.token },
  });
  const data = await parseJson<{ items?: ScannedCard[] }>(response);
  if (!response.ok) throw new Error(data.error || "読み込みに失敗しました。");
  return data.items || [];
}

export async function deleteRemoteScan(cred: ScanCredential, id: string): Promise<void> {
  const response = await fetch("/api/scans", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      "x-scan-token": cred.token,
    },
    body: JSON.stringify({ id, slug: cred.slug }),
  });
  const data = await parseJson<{ ok?: boolean }>(response);
  if (!response.ok) throw new Error(data.error || "削除に失敗しました。");
}

// 端末内(IndexedDB)に残っている名刺をサーバーへ移行する。
// 成功した分だけローカルから削除し、移行件数を返す。
export async function migrateLocalScans(cred: ScanCredential): Promise<number> {
  const locals = await listScannedCards();
  let migrated = 0;
  for (const card of locals) {
    if (!card.id || !card.image) continue;
    try {
      await saveRemoteScan(
        cred,
        {
          name: card.name,
          company: card.company,
          department: card.department,
          title: card.title,
          phone: card.phone,
          email: card.email,
          website: card.website,
          address: card.address,
          memo: card.memo,
        },
        card.image,
      );
      await deleteScannedCard(card.id);
      migrated += 1;
    } catch {
      // 失敗した分はローカルに残す(次回再試行)
    }
  }
  return migrated;
}
