import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminStorage } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

async function verifyUid(request: NextRequest): Promise<string | null> {
  const authorization = request.headers.get("authorization") ?? "";
  const idToken = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  if (!idToken) return null;
  try {
    const decoded = await adminAuth.verifyIdToken(idToken, true);
    return decoded.uid;
  } catch {
    return null;
  }
}

// 取り込んだ名刺画像を本人専用パスへ保存する
export async function POST(request: NextRequest) {
  try {
    const uid = await verifyUid(request);
    if (!uid) {
      return NextResponse.json(
        { error: "ログイン情報を確認できませんでした。" },
        { status: 401 },
      );
    }

    const formData = await request.formData();
    const image = formData.get("image");
    if (!(image instanceof File)) {
      return NextResponse.json(
        { error: "画像データが正しくありません。" },
        { status: 400 },
      );
    }
    if (!image.type.startsWith("image/") || image.size > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { error: "画像形式またはファイルサイズを確認してください。" },
        { status: 400 },
      );
    }

    const extension = image.type === "image/webp" ? "webp" : "jpg";
    const objectPath = `xenocard/scanned/${uid}/${randomUUID()}.${extension}`;
    const downloadToken = randomUUID();
    const bucket = adminStorage.bucket();
    const file = bucket.file(objectPath);
    const bytes = Buffer.from(await image.arrayBuffer());

    await file.save(bytes, {
      resumable: false,
      contentType: image.type,
      metadata: {
        cacheControl: "public,max-age=31536000,immutable",
        metadata: { firebaseStorageDownloadTokens: downloadToken },
      },
    });

    const downloadUrl =
      `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}` +
      `/o/${encodeURIComponent(objectPath)}?alt=media&token=${downloadToken}`;

    return NextResponse.json({ imageUrl: downloadUrl, imagePath: objectPath });
  } catch (error) {
    console.error("Scanned card image upload failed:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "画像を保存できませんでした。",
      },
      { status: 500 },
    );
  }
}

// 取り込んだ名刺画像を削除する(本人のパスのみ)
export async function DELETE(request: NextRequest) {
  try {
    const uid = await verifyUid(request);
    if (!uid) {
      return NextResponse.json(
        { error: "ログイン情報を確認できませんでした。" },
        { status: 401 },
      );
    }

    const { imagePath } = (await request.json()) as { imagePath?: string };
    const path = String(imagePath || "");
    if (!path.startsWith(`xenocard/scanned/${uid}/`)) {
      return NextResponse.json(
        { error: "この画像を削除する権限がありません。" },
        { status: 403 },
      );
    }

    await adminStorage
      .bucket()
      .file(path)
      .delete({ ignoreNotFound: true });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Scanned card image delete failed:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "画像を削除できませんでした。",
      },
      { status: 500 },
    );
  }
}
