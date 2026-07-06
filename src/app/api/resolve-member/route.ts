import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { adminAuth, adminDb } from "@/lib/firebase-admin";

function buildExternalMemberUid(email: string): string {
  // Auth未登録メンバー向けに、メールから安定したUIDを生成する
  const digest = createHash("sha256").update(email).digest("hex");
  return `external-${digest.slice(0, 28)}`;
}

export async function POST(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  let email = "";

  if (!token) {
    return NextResponse.json(
      { error: "ログイン情報がありません。" },
      { status: 401 },
    );
  }

  try {
    const caller = await adminAuth.verifyIdToken(token);
    const callerProfile = await adminDb
      .collection("xenocardUsers")
      .doc(caller.uid)
      .get();

    if (
      !callerProfile.exists ||
      callerProfile.data()?.role !== "admin" ||
      callerProfile.data()?.enabled !== true
    ) {
      return NextResponse.json(
        { error: "XenoCard管理者権限がありません。" },
        { status: 403 },
      );
    }

    const body = (await request.json()) as { email?: string };
    email = String(body.email ?? "").trim().toLowerCase();
    if (!email) {
      return NextResponse.json(
        { error: "メールアドレスを入力してください。" },
        { status: 400 },
      );
    }

    const member = await adminAuth.getUserByEmail(email);
    return NextResponse.json({ uid: member.uid, email: member.email ?? email });
  } catch (error) {
    const code =
      typeof error === "object" && error && "code" in error
        ? String(error.code)
        : "";

    if (code === "auth/user-not-found") {
      return NextResponse.json({ uid: buildExternalMemberUid(email), email });
    }

    const message =
      error instanceof Error ? error.message : "メンバーを確認できませんでした。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
