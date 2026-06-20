import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { hashSsoCode } from "@/lib/sso";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { code?: string };
    const code = String(body.code ?? "");

    if (!code || code.length > 200) {
      return NextResponse.json(
        { error: "SSOコードが正しくありません。" },
        { status: 400 },
      );
    }

    const codeRef = adminDb
      .collection("xenocardSsoCodes")
      .doc(hashSsoCode(code));

    const uid = await adminDb.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(codeRef);
      if (!snapshot.exists) throw new Error("invalid-code");

      const data = snapshot.data();
      const expiresAt = data?.expiresAt?.toMillis?.();
      const codeUid = data?.uid;

      transaction.delete(codeRef);

      if (
        typeof expiresAt !== "number" ||
        expiresAt <= Date.now() ||
        typeof codeUid !== "string" ||
        !codeUid
      ) {
        throw new Error("expired-code");
      }

      return codeUid;
    });

    const [customToken, profileSnapshot] = await Promise.all([
      adminAuth.createCustomToken(uid, {
        source: "pageit-sso",
      }),
      adminDb.collection("xenocardUsers").doc(uid).get(),
    ]);
    const profile = profileSnapshot.exists ? profileSnapshot.data() : null;

    return NextResponse.json({
      customToken,
      profile: profile
        ? {
            enabled: profile.enabled !== false,
            role: typeof profile.role === "string" ? profile.role : null,
            cardSlug:
              typeof profile.cardSlug === "string" ? profile.cardSlug : null,
          }
        : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status =
      message === "invalid-code" || message === "expired-code" ? 410 : 500;

    return NextResponse.json(
      {
        error:
          status === 410
            ? "SSOリンクの有効期限が切れています。Pageitからもう一度開いてください。"
            : "XenoCardへのログインに失敗しました。",
      },
      { status },
    );
  }
}
