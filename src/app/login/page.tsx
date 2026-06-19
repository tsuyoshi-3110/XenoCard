"use client";

import {
  FormEvent,
  Suspense,
  useEffect,
  useMemo,
  useState,
} from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { useRouter, useSearchParams } from "next/navigation";
import { CreditCard } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { auth } from "@/lib/firebase";

function authErrorMessage(error: unknown): string {
  const code =
    typeof error === "object" && error && "code" in error
      ? String(error.code)
      : "";

  if (
    code === "auth/invalid-credential" ||
    code === "auth/user-not-found" ||
    code === "auth/wrong-password"
  ) {
    return "メールアドレスまたはパスワードが正しくありません。";
  }
  if (code === "auth/invalid-email") {
    return "メールアドレスの形式を確認してください。";
  }
  return "ログインに失敗しました。しばらくしてから再度お試しください。";
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const nextPath = useMemo(() => {
    const value = searchParams.get("next");
    return value?.startsWith("/") ? value : "/my-card";
  }, [searchParams]);

  useEffect(() => {
    if (!loading && user) router.replace(nextPath);
  }, [loading, nextPath, router, user]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      router.replace(nextPath);
    } catch (loginError) {
      setError(authErrorMessage(loginError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="grid min-h-[100dvh] place-items-center bg-[#f4f1eb] px-4 py-10">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-3xl border border-black/10 bg-white p-7 shadow-xl"
      >
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-stone-900 text-white">
          <CreditCard className="h-5 w-5" />
        </div>
        <p className="mt-6 text-[10px] font-semibold tracking-[0.28em] text-stone-500">
          XENOCARD
        </p>
        <h1 className="mt-1 text-2xl font-semibold">ログイン</h1>
        <p className="mt-2 text-sm text-stone-500">
          マイ名刺を表示・編集するためにログインしてください。
        </p>

        {error && (
          <p className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        <label className="mt-6 block">
          <span className="text-xs font-semibold text-stone-600">
            メールアドレス
          </span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-2 w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 outline-none focus:border-stone-500"
          />
        </label>

        <label className="mt-4 block">
          <span className="text-xs font-semibold text-stone-600">
            パスワード
          </span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-2 w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 outline-none focus:border-stone-500"
          />
        </label>

        <button
          type="submit"
          disabled={submitting}
          className="mt-6 w-full rounded-xl bg-stone-900 px-4 py-3 font-semibold text-white transition hover:bg-black disabled:opacity-50"
        >
          {submitting ? "ログイン中..." : "ログイン"}
        </button>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="grid min-h-[100dvh] place-items-center bg-[#f4f1eb] text-sm text-stone-500">
          ログイン画面を読み込んでいます...
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
