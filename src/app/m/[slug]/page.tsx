import { adminDb } from "@/lib/firebase-admin";
import MemberPageClient, { type MemberCard } from "./MemberPageClient";

// PWA起動を速くするため、名刺データはサーバー側で取得してHTMLに含める
// (クライアントでのFirebase SDK起動・接続待ちを無くす)
export const dynamic = "force-dynamic";

export default async function MemberPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug || "");

  let card: MemberCard | null = null;
  if (slug) {
    try {
      const snapshot = await adminDb
        .collection("xenocardPublicCards")
        .doc(slug)
        .get();
      if (snapshot.exists) {
        const data = snapshot.data() as Record<string, unknown>;
        card = {
          slug,
          name: String(data.name || ""),
          company: String(data.company || ""),
          title: String(data.title || ""),
          logoUrl: String(data.logoUrl || ""),
          mainColor: String(data.mainColor || "#c9a96e"),
          textColor: String(data.textColor || "#ffffff"),
        };
      }
    } catch (error) {
      console.error("Member card fetch failed:", error);
    }
  }

  if (!card) {
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-white px-6 text-center text-black">
        <div>
          <p className="text-xs tracking-[0.2em] text-black/40">404</p>
          <h1 className="mt-3 text-xl font-semibold">ページが見つかりません</h1>
        </div>
      </main>
    );
  }

  return <MemberPageClient card={card} />;
}
