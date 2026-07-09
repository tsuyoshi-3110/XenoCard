import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb, adminStorage } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const SCANS = "xenocardScans";

// 端末IDは設定不要で自動発行されるため認証は無い。乱用対策はIPレート制限。
const requestHistory = new Map<string, number[]>();
const MAX_WRITES_PER_HOUR = 60;

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  return forwarded.split(",")[0].trim() || "unknown";
}

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const recent = (requestHistory.get(key) || []).filter((t) => t > oneHourAgo);
  if (recent.length >= MAX_WRITES_PER_HOUR) return false;
  recent.push(now);
  requestHistory.set(key, recent);
  return true;
}

function isValidDeviceId(value: string): boolean {
  return /^[A-Za-z0-9-]{8,64}$/.test(value);
}

function pickString(value: unknown, max = 300): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function verifyAdmin(request: NextRequest): Promise<string | null> {
  const authorization = request.headers.get("authorization") || "";
  const idToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!idToken) return null;
  try {
    return (await adminAuth.verifyIdToken(idToken)).uid;
  } catch {
    return null;
  }
}

// 管理者uidの自グループIDを取得
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

// ── 保存(誰でも即Firestore保存。端末IDで自分の分を識別) ──────────
export async function POST(request: NextRequest) {
  try {
    if (!checkRateLimit(clientIp(request))) {
      return NextResponse.json(
        { error: "保存回数が上限に達しました。しばらくして再度お試しください。" },
        { status: 429 },
      );
    }

    const formData = await request.formData();
    const slug = pickString(formData.get("slug"), 100);
    const deviceId = pickString(formData.get("deviceId"), 64);
    const image = formData.get("image");
    const imageBack = formData.get("imageBack"); // 裏面(任意)
    const fieldsRaw = pickString(formData.get("fields"), 5000);

    if (!slug || !isValidDeviceId(deviceId) || !(image instanceof File) || !fieldsRaw) {
      return NextResponse.json({ error: "データが正しくありません。" }, { status: 400 });
    }
    if (!image.type.startsWith("image/") || image.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "画像形式またはサイズを確認してください。" }, { status: 400 });
    }
    if (
      imageBack instanceof File &&
      (!imageBack.type.startsWith("image/") || imageBack.size > MAX_IMAGE_BYTES)
    ) {
      return NextResponse.json({ error: "裏面画像の形式またはサイズを確認してください。" }, { status: 400 });
    }

    // 実在する名刺(slug)に紐づける(管理者の一覧用にグループ情報も付与)
    const cardSnap = await adminDb.collection("xenocardPublicCards").doc(slug).get();
    if (!cardSnap.exists) {
      return NextResponse.json({ error: "名刺ページから開き直してください。" }, { status: 400 });
    }
    const groupId = String(cardSnap.data()?.groupId || "");
    const groupSnap = groupId
      ? await adminDb.collection("xenocardGroups").doc(groupId).get()
      : null;
    const adminUid = String(groupSnap?.data()?.adminUid || "");

    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(fieldsRaw) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "項目データが正しくありません。" }, { status: 400 });
    }

    // 画像保存
    const bucket = adminStorage.bucket();
    const saveImage = async (file: File): Promise<{ url: string; path: string }> => {
      const extension = file.type === "image/webp" ? "webp" : "jpg";
      const path = `xenocard/scans/${slug}/${randomUUID()}.${extension}`;
      const downloadToken = randomUUID();
      await bucket.file(path).save(Buffer.from(await file.arrayBuffer()), {
        resumable: false,
        contentType: file.type,
        metadata: {
          cacheControl: "public,max-age=31536000,immutable",
          metadata: { firebaseStorageDownloadTokens: downloadToken },
        },
      });
      const url =
        `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}` +
        `/o/${encodeURIComponent(path)}?alt=media&token=${downloadToken}`;
      return { url, path };
    };

    const front = await saveImage(image);
    const back = imageBack instanceof File ? await saveImage(imageBack) : null;

    const record = {
      deviceId,
      slug,
      groupId,
      adminUid,
      name: pickString(parsed.name),
      company: pickString(parsed.company),
      department: pickString(parsed.department),
      title: pickString(parsed.title),
      qualifications: pickString(parsed.qualifications),
      phone: pickString(parsed.phone),
      email: pickString(parsed.email),
      website: pickString(parsed.website),
      address: pickString(parsed.address),
      memo: pickString(parsed.memo, 1000),
      imageUrl: front.url,
      imagePath: front.path,
      imageBackUrl: back?.url || "",
      imageBackPath: back?.path || "",
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
// ?deviceId=xxx : この端末で取り込んだ一覧(認証不要)
// ?all=1        : 管理者の全グループ分(要ログイン)
// ?slug=xxx     : 特定メンバー分(管理者のみ)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const deviceId = pickString(searchParams.get("deviceId"), 64);
    const slug = pickString(searchParams.get("slug"), 100);
    const all = searchParams.get("all") === "1";

    let query: FirebaseFirestore.Query;

    if (deviceId) {
      if (!isValidDeviceId(deviceId)) {
        return NextResponse.json({ error: "端末IDが正しくありません。" }, { status: 400 });
      }
      query = adminDb.collection(SCANS).where("deviceId", "==", deviceId);
    } else {
      const uid = await verifyAdmin(request);
      if (!uid) {
        return NextResponse.json({ error: "認証情報がありません。" }, { status: 401 });
      }
      const gid = await adminGroupId(uid);
      if (!gid) {
        return NextResponse.json({ error: "グループが見つかりません。" }, { status: 404 });
      }
      if (all) {
        query = adminDb.collection(SCANS).where("groupId", "==", gid);
      } else if (slug) {
        query = adminDb
          .collection(SCANS)
          .where("groupId", "==", gid)
          .where("slug", "==", slug);
      } else {
        return NextResponse.json({ error: "パラメータが必要です。" }, { status: 400 });
      }
    }

    const snap = await query.get();
    const items = snap.docs
      .map((d) => {
        const data = d.data() as Record<string, unknown>;
        // 端末IDは他者に返さない
        delete data.deviceId;
        return { id: d.id, ...data };
      })
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

// ── 個別削除(自分の端末の分 or 管理者) ─────────────────
export async function DELETE(request: NextRequest) {
  try {
    const body = (await request.json()) as { id?: string; deviceId?: string };
    const id = pickString(body.id, 100);
    const deviceId = pickString(body.deviceId, 64);
    if (!id) return NextResponse.json({ error: "idが必要です。" }, { status: 400 });

    const docRef = adminDb.collection(SCANS).doc(id);
    const snap = await docRef.get();
    if (!snap.exists) return NextResponse.json({ ok: true });
    const data = snap.data() as {
      deviceId?: string;
      groupId?: string;
      imagePath?: string;
      imageBackPath?: string;
    };

    let allowed = false;
    if (deviceId && isValidDeviceId(deviceId) && data.deviceId === deviceId) {
      allowed = true;
    } else {
      const uid = await verifyAdmin(request);
      if (uid) {
        const gid = await adminGroupId(uid);
        allowed = !!gid && data.groupId === gid;
      }
    }
    if (!allowed) {
      return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
    }

    await docRef.delete();
    for (const path of [data.imagePath, data.imageBackPath]) {
      if (path?.startsWith("xenocard/scans/")) {
        await adminStorage.bucket().file(path).delete({ ignoreNotFound: true });
      }
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
