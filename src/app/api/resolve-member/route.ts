import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";

export async function POST(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";

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
    const email = String(body.email ?? "").trim().toLowerCase();
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
      return NextResponse.json(
        { error: "Pageitにこのメールアドレスのアカウントがありません。" },
        { status: 404 },
      );
    }

    const message =
      error instanceof Error ? error.message : "メンバーを確認できませんでした。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
