"use client";

import {
  FormEvent,
  Suspense,
  useMemo,
  useState,
} from "react";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useRouter, useSearchParams } from "next/navigation";
import { CreditCard, LogOut } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { auth, db } from "@/lib/firebase";

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
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState("");

  const nextPath = useMemo(() => {
    const value = searchParams.get("next");
    return value?.startsWith("/") ? value : null;
  }, [searchParams]);

  const handleSignOut = async () => {
    setSigningOut(true);
    await signOut(auth);
    setSigningOut(false);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const { user: loggedInUser } = await signInWithEmailAndPassword(
        auth,
        email.trim(),
        password,
      );

      // ロールを確認してリダイレクト先を決定
      const profileSnap = await getDoc(doc(db, "xenocardUsers", loggedInUser.uid));
      const profile = profileSnap.exists() ? profileSnap.data() : null;

      if (profile?.enabled === false) {
        await signOut(auth);
        setError("このアカウントはXenoCardを利用できません。");
        return;
      }

      if (profile?.role === "member" && profile?.cardSlug) {
        router.replace(`/m/${encodeURIComponent(profile.cardSlug)}`);
      } else {
        router.replace(nextPath ?? "/admin");
      }
    } catch (loginError) {
      setError(authErrorMessage(loginError));
    } finally {
      setSubmitting(false);
    }
  };

  // ログイン済みの場合はアカウント管理画面を表示
  if (!loading && user) {
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-[#f4f1eb] px-4 py-10">
        <div className="w-full max-w-sm rounded-3xl border border-black/10 bg-white p-7 shadow-xl">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-stone-900 text-white">
            <CreditCard className="h-5 w-5" />
          </div>
          <p className="mt-6 text-[10px] font-semibold tracking-[0.28em] text-stone-900">
            XENOCARD
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-stone-900">アカウント</h1>
          <p className="mt-2 text-sm text-stone-500">{user.email}</p>

          <button
            type="button"
            onClick={() => void handleSignOut()}
            disabled={signingOut}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm font-semibold text-stone-700 transition hover:bg-stone-50 disabled:opacity-50"
          >
            <LogOut className="h-4 w-4" />
            {signingOut ? "ログアウト中..." : "ログアウト"}
          </button>

          <button
            type="button"
            onClick={() => router.back()}
            className="mt-3 w-full rounded-xl bg-stone-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-black"
          >
            戻る
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="grid min-h-[100dvh] place-items-center bg-[#f4f1eb] px-4 py-10">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-3xl border border-black/10 bg-white p-7 shadow-xl"
      >
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-stone-900 text-white">
          <CreditCard className="h-5 w-5" />
        </div>
        <p className="mt-6 text-[10px] font-semibold tracking-[0.28em] text-stone-900">
          XENOCARD
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-stone-900">ログイン</h1>
        <p className="mt-2 text-sm text-stone-700">
          マイ名刺を表示・編集するためにログインしてください。
        </p>

        {error && (
          <p className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        <label className="mt-6 block">
          <span className="text-xs font-semibold text-stone-900">
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
          <span className="text-xs font-semibold text-stone-900">
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
          disabled={submitting || loading}
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
          読み込み中...
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
