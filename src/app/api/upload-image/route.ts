import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb, adminStorage } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const authorization = request.headers.get("authorization") ?? "";
    const idToken = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";

    if (!idToken) {
      return NextResponse.json(
        { error: "ログイン情報がありません。" },
        { status: 401 },
      );
    }

    const decoded = await adminAuth.verifyIdToken(idToken, true);
    const formData = await request.formData();
    const image = formData.get("image");
    const groupId = String(formData.get("groupId") ?? "");
    const fileName = String(formData.get("fileName") ?? "");

    if (
      !(image instanceof File) ||
      !groupId ||
      !fileName ||
      !/^[a-zA-Z0-9._-]+$/.test(fileName)
    ) {
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

    const groupSnapshot = await adminDb
      .collection("xenocardGroups")
      .doc(groupId)
      .get();
    if (
      !groupSnapshot.exists ||
      groupSnapshot.get("adminUid") !== decoded.uid
    ) {
      return NextResponse.json(
        { error: "このグループの画像を保存する権限がありません。" },
        { status: 403 },
      );
    }

    const objectPath = `xenocard/groups/${groupId}/${fileName}`;
    const downloadToken = randomUUID();
    const bucket = adminStorage.bucket();
    const file = bucket.file(objectPath);
    const bytes = Buffer.from(await image.arrayBuffer());

    await file.save(bytes, {
      resumable: false,
      contentType: image.type,
      metadata: {
        cacheControl: "public,max-age=31536000,immutable",
        metadata: {
          firebaseStorageDownloadTokens: downloadToken,
        },
      },
    });

    const downloadUrl =
      `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}` +
      `/o/${encodeURIComponent(objectPath)}?alt=media&token=${downloadToken}`;

    return NextResponse.json({ downloadUrl });
  } catch (error) {
    console.error("XenoCard image upload failed:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "画像を保存できませんでした。",
      },
      { status: 500 },
    );
  }
}
