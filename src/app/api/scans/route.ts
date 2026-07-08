import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb, adminStorage } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const SCANS = "xenocardScans";
const TOKENS = "xenocardScanTokens";

type AuthResult =
  | { ok: true; mode: "token"; slug: string; groupId: string; adminUid: string }
  | { ok: true; mode: "admin"; uid: string }
  | { ok: false; status: number; message: string };

// 本人トークン(x-scan-token) または 管理者IDトークン(Authorization) で認可する
async function authorize(request: NextRequest, slug: string): Promise<AuthResult> {
  const scanToken = request.headers.get("x-scan-token") || "";
  if (scanToken && slug) {
    const tokenSnap = await adminDb.collection(TOKENS).doc(slug).get();
    const data = tokenSnap.data();
    if (tokenSnap.exists && data?.token === scanToken) {
      return {
        ok: true,
        mode: "token",
        slug,
        groupId: String(data.groupId || ""),
        adminUid: String(data.adminUid || ""),
      };
    }
    return { ok: false, status: 401, message: "本人用リンクが無効です。管理者に再発行を依頼してください。" };
  }

  const authorization = request.headers.get("authorization") || "";
  const idToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (idToken) {
    try {
      const decoded = await adminAuth.verifyIdToken(idToken);
      return { ok: true, mode: "admin", uid: decoded.uid };
    } catch {
      return { ok: false, status: 401, message: "ログイン情報を確認できませんでした。" };
    }
  }
  return { ok: false, status: 401, message: "認証情報がありません。" };
}

// 管理者uidが対象slugのグループ管理者か確認し、groupIdを返す
async function verifyAdminForSlug(uid: string, slug: string): Promise<string | null> {
  const cardSnap = await adminDb.collection("xenocardPublicCards").doc(slug).get();
  const groupId = String(cardSnap.data()?.groupId || "");
  if (!groupId) return null;
  const groupSnap = await adminDb.collection("xenocardGroups").doc(groupId).get();
  return groupSnap.data()?.adminUid === uid ? groupId : null;
}

// 管理者uidが自分のグループIDを取得(全件一覧用)
async function adminGroupId(uid: string): Promise<string | null> {
  const groupSnap = await adminDb.collection("xenocardGroups").doc(`group-${uid}`).get();
  if (groupSnap.exists && groupSnap.data()?.adminUid === uid) return groupSnap.id;
  const q = await adminDb
    .collection("xenocardGroups")
    .where("adminUid", "==", uid)
    .limit(1)
    .get();
  return q.docs[0]?.id ?? null;
}

function pickString(value: unknown, max = 300): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

// ── 保存 ─────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const slug = pickString(formData.get("slug"), 100);
    const image = formData.get("image");
    const fieldsRaw = pickString(formData.get("fields"), 5000);

    if (!slug || !(image instanceof File) || !fieldsRaw) {
      return NextResponse.json({ error: "データが正しくありません。" }, { status: 400 });
    }
    if (!image.type.startsWith("image/") || image.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "画像形式またはサイズを確認してください。" }, { status: 400 });
    }

    const auth = await authorize(request, slug);
    if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

    let groupId: string;
    let adminUid: string;
    if (auth.mode === "token") {
      groupId = auth.groupId;
      adminUid = auth.adminUid;
    } else {
      const gid = await verifyAdminForSlug(auth.uid, slug);
      if (!gid) return NextResponse.json({ error: "この名刺を操作する権限がありません。" }, { status: 403 });
      groupId = gid;
      adminUid = auth.uid;
    }

    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(fieldsRaw) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "項目データが正しくありません。" }, { status: 400 });
    }

    // 画像保存
    const extension = image.type === "image/webp" ? "webp" : "jpg";
    const imagePath = `xenocard/scans/${slug}/${randomUUID()}.${extension}`;
    const downloadToken = randomUUID();
    const bucket = adminStorage.bucket();
    await bucket.file(imagePath).save(Buffer.from(await image.arrayBuffer()), {
      resumable: false,
      contentType: image.type,
      metadata: {
        cacheControl: "public,max-age=31536000,immutable",
        metadata: { firebaseStorageDownloadTokens: downloadToken },
      },
    });
    const imageUrl =
      `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}` +
      `/o/${encodeURIComponent(imagePath)}?alt=media&token=${downloadToken}`;

    const record = {
      slug,
      groupId,
      adminUid,
      name: pickString(parsed.name),
      company: pickString(parsed.company),
      department: pickString(parsed.department),
      title: pickString(parsed.title),
      phone: pickString(parsed.phone),
      email: pickString(parsed.email),
      website: pickString(parsed.website),
      address: pickString(parsed.address),
      memo: pickString(parsed.memo, 1000),
      imageUrl,
      imagePath,
      inherited: false,
      createdAt: Date.now(),
    };
    const docRef = await adminDb.collection(SCANS).add(record);

    return NextResponse.json({ id: docRef.id, ...record });
  } catch (error) {
    console.error("Scan save failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存に失敗しました。" },
      { status: 500 },
    );
  }
}

// ── 一覧 ─────────────────────────────────────────────
// ?slug=xxx : その名刺の取り込み一覧(本人トークン or 管理者)
// ?all=1    : 管理者の全グループ分
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const slug = pickString(searchParams.get("slug"), 100);
    const all = searchParams.get("all") === "1";

    const auth = await authorize(request, slug);
    if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

    let query: FirebaseFirestore.Query;
    if (all) {
      if (auth.mode !== "admin") {
        return NextResponse.json({ error: "管理者のみ利用できます。" }, { status: 403 });
      }
      const gid = await adminGroupId(auth.uid);
      if (!gid) return NextResponse.json({ error: "グループが見つかりません。" }, { status: 404 });
      query = adminDb.collection(SCANS).where("groupId", "==", gid);
    } else {
      if (!slug) return NextResponse.json({ error: "slugが必要です。" }, { status: 400 });
      if (auth.mode === "admin") {
        const gid = await verifyAdminForSlug(auth.uid, slug);
        if (!gid) return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
      }
      query = adminDb.collection(SCANS).where("slug", "==", slug);
    }

    const snap = await query.get();
    const items = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort(
        (a, b) =>
          ((b as { createdAt?: number }).createdAt ?? 0) -
          ((a as { createdAt?: number }).createdAt ?? 0),
      );
    return NextResponse.json({ items });
  } catch (error) {
    console.error("Scan list failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "読み込みに失敗しました。" },
      { status: 500 },
    );
  }
}

// ── 個別削除 ──────────────────────────────────────────
export async function DELETE(request: NextRequest) {
  try {
    const body = (await request.json()) as { id?: string; slug?: string };
    const id = pickString(body.id, 100);
    const slug = pickString(body.slug, 100);
    if (!id) return NextResponse.json({ error: "idが必要です。" }, { status: 400 });

    const auth = await authorize(request, slug);
    if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

    const docRef = adminDb.collection(SCANS).doc(id);
    const snap = await docRef.get();
    if (!snap.exists) return NextResponse.json({ ok: true });
    const data = snap.data() as { slug?: string; groupId?: string; imagePath?: string };

    if (auth.mode === "token") {
      if (data.slug !== auth.slug) {
        return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
      }
    } else {
      const gid = await adminGroupId(auth.uid);
      if (!gid || data.groupId !== gid) {
        return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
      }
    }

    await docRef.delete();
    if (data.imagePath?.startsWith("xenocard/scans/")) {
      await adminStorage.bucket().file(data.imagePath).delete({ ignoreNotFound: true });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Scan delete failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "削除に失敗しました。" },
      { status: 500 },
    );
  }
}
