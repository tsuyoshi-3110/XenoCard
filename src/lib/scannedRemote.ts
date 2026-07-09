// 取り込んだ名刺のサーバー(Firestore)保存クライアント。
// 端末ごとに自動発行するID(設定・ログイン不要)で自分の取り込み分を識別する。
import type { ScannedCard } from "@/lib/scannedCard";
import { deleteScannedCard, listScannedCards } from "@/lib/scannedStore";

const DEVICE_KEY = "xenocard:deviceId";

// 端末IDを取得(無ければ自動発行して保存)
export function getDeviceId(): string {
  try {
    let id = window.localStorage.getItem(DEVICE_KEY) || "";
    if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) {
      id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
      window.localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return "no-local-storage";
  }
}

type ApiError = { error?: string };

async function parseJson<T>(response: Response): Promise<T & ApiError> {
  return (await response.json().catch(() => ({}))) as T & ApiError;
}

// 保存(画像+項目を1リクエストで。裏面は任意)
export async function saveRemoteScan(
  slug: string,
  fields: Omit<
    ScannedCard,
    "id" | "image" | "imageUrl" | "imageBack" | "imageBackUrl" | "createdAt"
  >,
  image: Blob,
  imageBack?: Blob | null,
): Promise<ScannedCard> {
  const formData = new FormData();
  formData.append("slug", slug);
  formData.append("deviceId", getDeviceId());
  formData.append("fields", JSON.stringify(fields));
  formData.append(
    "image",
    new File([image], "scan.webp", { type: image.type || "image/webp" }),
  );
  if (imageBack) {
    formData.append(
      "imageBack",
      new File([imageBack], "scan-back.webp", {
        type: imageBack.type || "image/webp",
      }),
    );
  }
  const response = await fetch("/api/scans", { method: "POST", body: formData });
  const data = await parseJson<ScannedCard>(response);
  if (!response.ok) throw new Error(data.error || "保存に失敗しました。");
  return data;
}

// この端末で取り込んだ一覧
export async function listRemoteScans(): Promise<ScannedCard[]> {
  const response = await fetch(
    `/api/scans?deviceId=${encodeURIComponent(getDeviceId())}`,
  );
  const data = await parseJson<{ items?: ScannedCard[] }>(response);
  if (!response.ok) throw new Error(data.error || "読み込みに失敗しました。");
  return data.items || [];
}

export async function deleteRemoteScan(id: string): Promise<void> {
  const response = await fetch("/api/scans", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, deviceId: getDeviceId() }),
  });
  const data = await parseJson<{ ok?: boolean }>(response);
  if (!response.ok) throw new Error(data.error || "削除に失敗しました。");
}

// 旧・端末内(IndexedDB)に残っている名刺をサーバーへ移行する。
// 成功した分だけローカルから削除し、移行件数を返す。
export async function migrateLocalScans(slug: string): Promise<number> {
  if (!slug) return 0;
  const locals = await listScannedCards();
  let migrated = 0;
  for (const card of locals) {
    if (!card.id || !card.image) continue;
    try {
      await saveRemoteScan(
        slug,
        {
          name: card.name,
          company: card.company,
          department: card.department,
          title: card.title,
          qualifications: card.qualifications || "",
          phone: card.phone,
          email: card.email,
          website: card.website,
          address: card.address,
          memo: card.memo,
        },
        card.image,
        card.imageBack,
      );
      await deleteScannedCard(card.id);
      migrated += 1;
    } catch {
      // 失敗した分はローカルに残す(次回再試行)
    }
  }
  return migrated;
}
