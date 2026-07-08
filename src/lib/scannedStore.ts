// 取り込んだ名刺をこの端末内(IndexedDB)に保存するストア。
// 認証不要・端末ローカル。画像はBlobのまま保持する。
import type { ScannedCard } from "@/lib/scannedCard";

const DB_NAME = "xenocard";
const STORE_NAME = "scannedCards";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("この端末では保存機能を利用できません。"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("保存領域を開けませんでした。"));
  });
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function addScannedCard(
  card: Omit<ScannedCard, "id" | "createdAt">,
): Promise<ScannedCard> {
  const db = await openDb();
  const record: ScannedCard = {
    ...card,
    id: createId(),
    createdAt: Date.now(),
  };
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("保存に失敗しました。"));
    });
    return record;
  } finally {
    db.close();
  }
}

export async function listScannedCards(): Promise<ScannedCard[]> {
  const db = await openDb();
  try {
    const items = await new Promise<ScannedCard[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result as ScannedCard[]);
      request.onerror = () => reject(request.error ?? new Error("読み込みに失敗しました。"));
    });
    // 新しい順
    return items.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  } finally {
    db.close();
  }
}

export async function deleteScannedCard(id: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("削除に失敗しました。"));
    });
  } finally {
    db.close();
  }
}
