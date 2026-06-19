import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";

export async function POST(req: NextRequest) {
  try {
    const { uid } = (await req.json()) as { uid: string };
    if (!uid) {
      return NextResponse.json({ error: "uid is required" }, { status: 400 });
    }
    await adminAuth.deleteUser(uid);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
