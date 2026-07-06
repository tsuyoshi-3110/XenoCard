"use client";

import { Suspense, useEffect, useState } from "react";
import { signInWithCustomToken, signOut } from "firebase/auth";
import { useRouter, useSearchParams } from "next/navigation";
import { auth } from "@/lib/firebase";
import LoadingState from "@/components/LoadingState";

function SsoContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState("");
  const [status, setStatus] = useState("安全な接続を準備しています…");
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const code = searchParams.get("code");
    if (!code) {
      setError("SSOコードがありません。Pageitからもう一度開いてください。");
      return;
    }

    let active = true;
    const slowTimer = window.setTimeout(() => {
      if (active) setSlow(true);
    }, 7000);

    void (async () => {
      try {
        setStatus("Pageitアカウントを確認しています…");
        const response = await fetch("/api/sso/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });
        const json = (await response.json()) as {
          customToken?: string;
          error?: string;
          profile?: {
            enabled?: boolean;
            role?: string | null;
            cardSlug?: string | null;
          } | null;
        };

        if (!response.ok || !json.customToken) {
          throw new Error(json.error || "XenoCardへログインできませんでした。");
        }

        setStatus("XenoCardへログインしています…");
        await signInWithCustomToken(auth, json.customToken);
        const profile = json.profile;

        if (!active) return;

        setStatus("管理画面を準備しています…");
        if (profile?.enabled === false) {
          await signOut(auth);
          router.replace("/login?error=xenocard-disabled");
        } else if (profile?.role === "member" && profile?.cardSlug) {
          router.replace(`/m/${encodeURIComponent(profile.cardSlug)}`);
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
      window.clearTimeout(slowTimer);
    };
  }, [router, searchParams]);

  if (!error) {
    return (
      <LoadingState
        title="Pageitアカウントを確認中"
        message={status}
        slow={slow}
      />
    );
  }

  return (
    <main className="grid min-h-[100dvh] place-items-center bg-[#f4f1eb] px-6 text-center text-stone-900">
      <div className="w-full max-w-sm rounded-3xl border border-black/10 bg-white p-8 shadow-xl">
        <p className="text-[10px] font-semibold tracking-[0.28em] text-stone-500">
          XENOCARD
        </p>
        <h1 className="mt-2 text-xl font-semibold">
          ログインできませんでした
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-stone-600">
          {error}
        </p>
        <a
          href="/login"
          className="mt-6 inline-flex rounded-full bg-stone-900 px-5 py-3 text-sm font-semibold text-white"
        >
          XenoCardログインへ
        </a>
      </div>
    </main>
  );
}

export default function SsoPage() {
  return (
    <Suspense
      fallback={
        <LoadingState
          title="接続を準備中"
          message="XenoCardを起動しています…"
          compact
        />
      }
    >
      <SsoContent />
    </Suspense>
  );
}
