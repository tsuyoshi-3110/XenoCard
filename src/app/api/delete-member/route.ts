import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error:
        "Firebase AuthenticationはPageitと共用です。XenoCardからPageitアカウントは削除できません。",
    },
    { status: 410 },
  );
}
