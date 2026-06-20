import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { createSsoCode, hashSsoCode, SSO_CODE_TTL_MS } from "@/lib/sso";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  const idToken = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";

  if (!idToken) {
    return NextResponse.json(
      { error: "Pageitのログイン情報がありません。" },
      { status: 401 },
    );
  }

  try {
    const decoded = await adminAuth.verifyIdToken(idToken, true);
    const code = createSsoCode();
    const codeHash = hashSsoCode(code);
    const now = Date.now();

    await adminDb.collection("xenocardSsoCodes").doc(codeHash).set({
      uid: decoded.uid,
      email: decoded.email ?? "",
      createdAt: Timestamp.fromMillis(now),
      expiresAt: Timestamp.fromMillis(now + SSO_CODE_TTL_MS),
    });

    const appUrl = (
      process.env.NEXT_PUBLIC_APP_URL || "https://xeno-card.vercel.app"
    ).replace(/\/$/, "");

    return NextResponse.json({
      redirectUrl: `${appUrl}/sso?code=${encodeURIComponent(code)}`,
    });
  } catch {
    return NextResponse.json(
      { error: "Pageitのログイン情報を確認できませんでした。" },
      { status: 401 },
    );
  }
}
