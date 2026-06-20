"use client";

type LoadingStateProps = {
  title: string;
  message: string;
  slow?: boolean;
  compact?: boolean;
};

export default function LoadingState({
  title,
  message,
  slow = false,
  compact = false,
}: LoadingStateProps) {
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-[#f4f1eb] px-6 text-center text-stone-900">
      <div
        className={`w-full max-w-sm rounded-3xl border border-black/10 bg-white shadow-xl ${
          compact ? "p-7" : "p-8"
        }`}
        role="status"
        aria-live="polite"
      >
        <p className="text-[10px] font-semibold tracking-[0.28em] text-stone-500">
          XENOCARD
        </p>
        <div className="mx-auto mt-5 h-11 w-11 rounded-full border-[3px] border-stone-200 border-t-stone-800 motion-safe:animate-spin" />
        <h1 className="mt-5 text-xl font-semibold">{title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-stone-600">{message}</p>
        <div className="mx-auto mt-5 flex w-20 justify-center gap-1.5">
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              className="h-1.5 w-1.5 rounded-full bg-stone-400 motion-safe:animate-pulse"
              style={{ animationDelay: `${index * 180}ms` }}
            />
          ))}
        </div>
        {slow && (
          <p className="mt-4 rounded-xl bg-stone-100 px-3 py-2 text-xs leading-relaxed text-stone-500">
            通信に少し時間がかかっています。画面を閉じずにそのままお待ちください。
          </p>
        )}
      </div>
    </main>
  );
}
