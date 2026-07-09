import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb, adminStorage } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const maxDuration = 60;

const SCANS = "xenocardScans";

// メンバー削除時のスキャンデータ処理(管理者のみ)。
// action: "delete"  → データ+画像を完全削除
// action: "inherit" → 管理者に引き継いで保持(本人トークンのみ無効化)
export async function POST(request: NextRequest) {
  try {
    const authorization = request.headers.get("authorization") || "";
    const idToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!idToken) {
      return NextResponse.json({ error: "ログイン情報がありません。" }, { status: 401 });
    }
    let uid: string;
    try {
      uid = (await adminAuth.verifyIdToken(idToken)).uid;
    } catch {
      return NextResponse.json({ error: "ログイン情報を確認できませんでした。" }, { status: 401 });
    }

    const body = (await request.json()) as { slug?: string; action?: string };
    const slug = String(body.slug || "").trim().slice(0, 100);
    const action = body.action === "delete" ? "delete" : "inherit";
    if (!slug) return NextResponse.json({ error: "slugが必要です。" }, { status: 400 });

    // 対象slugのスキャンを取得し、管理者権限(groupId一致)を確認
    const snap = await adminDb.collection(SCANS).where("slug", "==", slug).get();
    const bucket = adminStorage.bucket();
    let processed = 0;

    for (const docSnap of snap.docs) {
      const data = docSnap.data() as {
        adminUid?: string;
        imagePath?: string;
        imageBackPath?: string;
      };
      if (data.adminUid !== uid) continue; // 他グループのデータは触らない
      if (action === "delete") {
        await docSnap.ref.delete();
        for (const path of [data.imagePath, data.imageBackPath]) {
          if (path?.startsWith("xenocard/scans/")) {
            await bucket.file(path).delete({ ignoreNotFound: true });
          }
        }
      } else {
        await docSnap.ref.set({ inherited: true }, { merge: true });
      }
      processed += 1;
    }

    return NextResponse.json({ ok: true, processed, action });
  } catch (error) {
    console.error("Scan member cleanup failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "処理に失敗しました。" },
      { status: 500 },
    );
  }
}
