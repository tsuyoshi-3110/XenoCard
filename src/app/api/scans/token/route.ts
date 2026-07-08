import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

const TOKENS = "xenocardScanTokens";

// 管理者が対象メンバー(slug)の本人用スキャントークンを取得/発行する。
// 本人用リンク: {origin}/m/{slug}#k={token}
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

    const body = (await request.json()) as { slug?: string };
    const slug = String(body.slug || "").trim().slice(0, 100);
    if (!slug) return NextResponse.json({ error: "slugが必要です。" }, { status: 400 });

    // 管理者確認
    const cardSnap = await adminDb.collection("xenocardPublicCards").doc(slug).get();
    if (!cardSnap.exists) {
      return NextResponse.json({ error: "名刺が見つかりません。" }, { status: 404 });
    }
    const groupId = String(cardSnap.data()?.groupId || "");
    const groupSnap = await adminDb.collection("xenocardGroups").doc(groupId).get();
    if (groupSnap.data()?.adminUid !== uid) {
      return NextResponse.json({ error: "このグループの管理者ではありません。" }, { status: 403 });
    }

    // 既存トークンがあれば再利用、無ければ発行
    const tokenRef = adminDb.collection(TOKENS).doc(slug);
    const tokenSnap = await tokenRef.get();
    let token = String(tokenSnap.data()?.token || "");
    if (!token) {
      token = randomUUID().replace(/-/g, "");
      await tokenRef.set({
        token,
        slug,
        groupId,
        adminUid: uid,
        createdAt: Date.now(),
      });
    }

    return NextResponse.json({ token });
  } catch (error) {
    console.error("Scan token issue failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "トークン発行に失敗しました。" },
      { status: 500 },
    );
  }
}
