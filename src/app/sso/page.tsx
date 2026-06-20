"use client";

import { Suspense, useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { signInWithCustomToken, signOut } from "firebase/auth";
import { useRouter, useSearchParams } from "next/navigation";
import { auth, db } from "@/lib/firebase";

function SsoContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState("");

  useEffect(() => {
    const code = searchParams.get("code");
    if (!code) {
      setError("SSOコードがありません。Pageitからもう一度開いてください。");
      return;
    }

    let active = true;

    void (async () => {
      try {
        const response = await fetch("/api/sso/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });
        const json = (await response.json()) as {
          customToken?: string;
          error?: string;
        };

        if (!response.ok || !json.customToken) {
          throw new Error(json.error || "XenoCardへログインできませんでした。");
        }

        const credential = await signInWithCustomToken(auth, json.customToken);
        const profileSnapshot = await getDoc(
          doc(db, "xenocardUsers", credential.user.uid),
        );
        const profile = profileSnapshot.exists()
          ? profileSnapshot.data()
          : null;

        if (!active) return;

        if (profile?.enabled === false) {
          await signOut(auth);
          router.replace("/login?error=xenocard-disabled");
        } else if (profile?.role === "member" && profile?.cardSlug) {
          router.replace(`/m/${profile.cardSlug}`);
        } else {
          router.replace("/admin");
        }
      } catch (ssoError) {
        if (active) {
          setError(
            ssoError instanceof Error
              ? ssoError.message
              : "XenoCardへログインできませんでした。",
          );
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [router, searchParams]);

  return (
    <main className="grid min-h-[100dvh] place-items-center bg-[#f4f1eb] px-6 text-center text-stone-900">
      <div className="w-full max-w-sm rounded-3xl border border-black/10 bg-white p-8 shadow-xl">
        <p className="text-[10px] font-semibold tracking-[0.28em] text-stone-500">
          XENOCARD
        </p>
        <h1 className="mt-2 text-xl font-semibold">
          {error ? "ログインできませんでした" : "Pageitアカウントを確認中"}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-stone-600">
          {error || "現在のPageitアカウントでXenoCardへ接続しています…"}
        </p>
        {error && (
          <a
            href="/login"
            className="mt-6 inline-flex rounded-full bg-stone-900 px-5 py-3 text-sm font-semibold text-white"
          >
            XenoCardログインへ
          </a>
        )}
      </div>
    </main>
  );
}

export default function SsoPage() {
  return (
    <Suspense
      fallback={
        <main className="grid min-h-[100dvh] place-items-center bg-[#f4f1eb] text-sm text-stone-600">
          Pageitアカウントを確認中…
        </main>
      }
    >
      <SsoContent />
    </Suspense>
  );
}
