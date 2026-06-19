"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getDoc,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { signOut } from "firebase/auth";
import { Bot, Check, ChevronDown, ChevronUp, Copy, Plus, Save, Share2, Sparkles, Trash2, UserRound, WandSparkles, X } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { auth, createMemberAuth, db, storage } from "@/lib/firebase";
import {
  buildVCard,
  createCardSlug,
  EMPTY_BUSINESS_CARD,
  type BusinessCard,
} from "@/lib/businessCard";
import { compressImageToWebP } from "@/lib/imageCompression";
import BusinessCardPreview from "@/components/business-card/BusinessCardPreview";
import PhoneMockup from "@/components/PhoneMockup";

// グループ共通設定の型
type GroupSettings = {
  company: string;
  logoUrl: string;
  backgroundUrl: string;
  mainColor: string;
  textColor: string;
};

const EMPTY_GROUP: GroupSettings = {
  company: "",
  logoUrl: "",
  backgroundUrl: "",
  mainColor: "#c9a96e",
  textColor: "#ffffff",
};

// メンバー個人情報のフィールド（会社・ロゴ・背景・カラーはグループ共通なので除外）
const MEMBER_FIELDS: Array<{
  name: keyof BusinessCard;
  label: string;
  placeholder: string;
  type?: string;
}> = [
  { name: "name", label: "氏名", placeholder: "山田 太郎" },
  { name: "title", label: "肩書き", placeholder: "代表取締役" },
  { name: "department", label: "追加情報（任意）", placeholder: "営業部 / 資格名 など" },
  { name: "phone", label: "電話番号", placeholder: "090-1234-5678", type: "tel" },
  { name: "email", label: "メールアドレス", placeholder: "hello@example.com", type: "email" },
  { name: "website", label: "WebサイトURL", placeholder: "https://example.com", type: "url" },
  { name: "address", label: "住所", placeholder: "東京都〇〇区..." },
];

type Member = { uid: string; email: string; displayName: string; cardSlug: string; isAdmin?: boolean };
type MemberWithCard = Member & { card: BusinessCard | null };

function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : "エラーが発生しました";
}

async function dataUrlToFile(dataUrl: string, filename: string): Promise<File> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], filename, { type: blob.type || "image/png", lastModified: Date.now() });
}

async function uploadImage(file: File, path: string): Promise<string> {
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file, { contentType: file.type });
  return getDownloadURL(storageRef);
}

// ── メンバーカードを作成（グループ設定 + 個人情報をマージ）──────
function buildMemberCard(group: GroupSettings, personal: Partial<BusinessCard>): BusinessCard {
  return {
    ...EMPTY_BUSINESS_CARD,
    ...personal,
    company: group.company,
    logoUrl: group.logoUrl,
    backgroundUrl: group.backgroundUrl,
    mainColor: group.mainColor,
    textColor: group.textColor,
  };
}

export default function AdminPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [groupId, setGroupId] = useState<string | null>(null);
  const [group, setGroup] = useState<GroupSettings>({ ...EMPTY_GROUP });
  const [groupLogoFile, setGroupLogoFile] = useState<File | null>(null);
  const [groupBgFile, setGroupBgFile] = useState<File | null>(null);
  const [savingGroup, setSavingGroup] = useState(false);
  const [groupMsg, setGroupMsg] = useState("");

  // AI生成
  const [aiOpen, setAiOpen] = useState(false);
  const [aiKind, setAiKind] = useState<"background" | "logo">("background");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiResult, setAiResult] = useState<{ kind: "background" | "logo"; dataUrl: string } | null>(null);
  const [aiStatus, setAiStatus] = useState("");
  const [aiError, setAiError] = useState("");
  const [aiEditPrompt, setAiEditPrompt] = useState("");

  const [members, setMembers] = useState<MemberWithCard[]>([]);
  const [initLoading, setInitLoading] = useState(true);

  // 追加フォーム
  const [showAddForm, setShowAddForm] = useState(false);
  const [addEmail, setAddEmail] = useState("");
  const [addPassword, setAddPassword] = useState("");
  const [addPersonal, setAddPersonal] = useState<Partial<BusinessCard>>({});
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");

  // 編集
  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [editPersonal, setEditPersonal] = useState<Partial<BusinessCard>>({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  // URL共有
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  const handleCopy = (slug: string) => {
    const url = `${process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || window.location.origin}/m/${slug}`;
    const doCopy = () => {
      setCopiedSlug(slug);
      setTimeout(() => setCopiedSlug(null), 2000);
    };
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(url).then(doCopy);
    } else {
      // HTTP環境フォールバック（execCommand）
      const el = document.createElement("textarea");
      el.value = url;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      doCopy();
    }
  };

  const handleShare = (slug: string, name: string) => {
    const url = `${process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || window.location.origin}/m/${slug}`;
    const subject = encodeURIComponent(`${name}の名刺`);
    const body = encodeURIComponent(`${name}のデジタル名刺はこちらからご確認いただけます。\n\n${url}`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  // 認証チェック
  useEffect(() => {
    if (!loading && !user) router.replace("/login?next=/admin");
  }, [loading, user, router]);

  // グループ初期化 & メンバー購読
  useEffect(() => {
    if (!user) return;
    let active = true;

    const init = async () => {
      const userRef = doc(db, "users", user.uid);
      let gId = "";

      const groupsSnap = await getDocs(
        query(collection(db, "groups"), where("adminUid", "==", user.uid), limit(1)),
      );
      const myGroup = groupsSnap.docs[0];

      if (myGroup) {
        gId = myGroup.id;
        // グループ設定を読み込む
        const gData = myGroup.data();
        if (active) {
          setGroup({
            company: gData.company ?? "",
            logoUrl: gData.logoUrl ?? "",
            backgroundUrl: gData.backgroundUrl ?? "",
            mainColor: gData.mainColor ?? "#c9a96e",
            textColor: gData.textColor ?? "#ffffff",
          });
        }
      } else {
        gId = `group-${user.uid}`;
        await setDoc(doc(db, "groups", gId), {
          name: "メイングループ",
          adminUid: user.uid,
          createdAt: serverTimestamp(),
        });
        await setDoc(userRef, { role: "admin", groupId: gId, email: user.email ?? "" });
      }

      if (!active) return;
      setGroupId(gId);

      // 管理者自身がメンバー一覧に存在しない場合は追加する
      const adminMemberRef = doc(db, "groups", gId, "members", user.uid);
      const adminMemberSnap = await getDoc(adminMemberRef);
      if (!adminMemberSnap.exists()) {
        // ダッシュボードの既存カードがあれば取得してマイグレーション
        const existingCardsSnap = await getDocs(
          query(collection(db, "users", user.uid, "cards"), limit(1)),
        );
        const existingCard = existingCardsSnap.empty
          ? null
          : existingCardsSnap.docs[0].data() as BusinessCard;

        const slug = existingCard?.slug || createCardSlug(existingCard?.name ?? user.email ?? "admin");
        const cardId = `card-${Date.now()}`;
        const cardData = {
          ...EMPTY_BUSINESS_CARD,
          ...(existingCard ?? {}),
          slug,
          updatedAt: serverTimestamp(),
        };

        await setDoc(doc(db, "groups", gId, "members", user.uid, "cards", cardId), cardData);
        await setDoc(doc(db, "publicCards", slug), cardData);
        await setDoc(adminMemberRef, {
          uid: user.uid,
          email: user.email ?? "",
          displayName: existingCard?.name ?? user.email ?? "",
          cardSlug: slug,
          isAdmin: true,
        });
      }

      const unsub = onSnapshot(collection(db, "groups", gId, "members"), async (snap) => {
        const list: MemberWithCard[] = await Promise.all(
          snap.docs.map(async (d) => {
            const m = d.data() as Member;
            const cardsSnap = await getDocs(
              collection(db, "groups", gId, "members", m.uid, "cards"),
            );
            const card = cardsSnap.empty
              ? null
              : ({ ...EMPTY_BUSINESS_CARD, ...cardsSnap.docs[0].data() } as BusinessCard);
            return { ...m, card };
          }),
        );
        if (active) { setMembers(list); setInitLoading(false); }
      });
      return unsub;
    };

    let unsubFn: (() => void) | undefined;
    init()
      .then((u) => { unsubFn = u; })
      .catch(() => { if (active) setInitLoading(false); });

    return () => { active = false; unsubFn?.(); };
  }, [user]);

  // プレビュー用: グループ設定 + 個人情報をリアルタイムマージ
  const groupLogoPreview = useMemo(
    () => (groupLogoFile ? URL.createObjectURL(groupLogoFile) : ""),
    [groupLogoFile],
  );
  const groupBgPreview = useMemo(
    () => (groupBgFile ? URL.createObjectURL(groupBgFile) : ""),
    [groupBgFile],
  );
  useEffect(() => {
    return () => {
      if (groupLogoPreview) URL.revokeObjectURL(groupLogoPreview);
      if (groupBgPreview) URL.revokeObjectURL(groupBgPreview);
    };
  }, [groupLogoPreview, groupBgPreview]);

  const previewGroup: GroupSettings = {
    ...group,
    logoUrl: groupLogoPreview || group.logoUrl,
    backgroundUrl: groupBgPreview || group.backgroundUrl,
  };

  // ── AI画像生成 ────────────────────────────────────────────────
  const generateAiImage = async (editImageDataUrl?: string) => {
    const promptToUse = editImageDataUrl ? aiEditPrompt : aiPrompt;
    if (!user || aiGenerating || !promptToUse.trim()) return;
    setAiGenerating(true);
    setAiError("");
    if (!editImageDataUrl) setAiResult(null);
    setAiStatus(
      editImageDataUrl
        ? "AIが画像を編集しています。通常30秒〜2分ほどかかります。"
        : "OpenAIへ画像生成を依頼しています。通常30秒〜2分ほどかかります。",
    );
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 150_000);

    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/ai-image", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          kind: aiKind,
          prompt: promptToUse,
          company: group.company,
          mainColor: group.mainColor,
          ...(editImageDataUrl ? { editImageDataUrl } : {}),
        }),
        signal: controller.signal,
      });
      const json = (await response.json()) as { imageDataUrl?: string; error?: string };
      if (!response.ok || !json.imageDataUrl) throw new Error(json.error || "AI画像を生成できませんでした。");
      setAiResult({ kind: aiKind, dataUrl: json.imageDataUrl });
      setAiEditPrompt("");
      setAiStatus("完了しました。画像を確認して採用してください。");
    } catch (err) {
      setAiError(
        err instanceof DOMException && err.name === "AbortError"
          ? "タイムアウトしました。もう一度お試しください。"
          : errorMessage(err),
      );
      setAiStatus("");
    } finally {
      window.clearTimeout(timeout);
      setAiGenerating(false);
    }
  };

  const applyAiResult = async () => {
    if (!aiResult) return;
    const file = await dataUrlToFile(aiResult.dataUrl, `ai-${aiResult.kind}-${Date.now()}.png`);
    if (aiResult.kind === "logo") setGroupLogoFile(file);
    else setGroupBgFile(file);
    setAiResult(null);
    setAiStatus("");
    setAiOpen(false);
  };

  // ── グループ設定保存 ───────────────────────────────────────────
  const handleSaveGroup = async () => {
    if (!groupId) return;
    setSavingGroup(true);
    setGroupMsg("");

    try {
      const [logoUrl, backgroundUrl] = await Promise.all([
        groupLogoFile
          ? compressImageToWebP(groupLogoFile, { maxBytes: 300 * 1024, maxWidth: 1200, maxHeight: 1200 })
              .then((f) => uploadImage(f, `groups/${groupId}/logo-${Date.now()}.webp`))
          : Promise.resolve(group.logoUrl),
        groupBgFile
          ? compressImageToWebP(groupBgFile, { maxBytes: 500 * 1024, maxWidth: 1440, maxHeight: 2560 })
              .then((f) => uploadImage(f, `groups/${groupId}/background-${Date.now()}.webp`))
          : Promise.resolve(group.backgroundUrl),
      ]);

      const updatedGroup = { ...group, logoUrl, backgroundUrl };
      await setDoc(doc(db, "groups", groupId), updatedGroup, { merge: true });
      setGroup(updatedGroup);
      setGroupLogoFile(null);
      setGroupBgFile(null);

      // 既存メンバーのカードにもグループ設定を反映
      await Promise.all(
        members.map(async (m) => {
          if (!m.card || !m.cardSlug) return;
          const cardsSnap = await getDocs(
            collection(db, "groups", groupId, "members", m.uid, "cards"),
          );
          if (cardsSnap.empty) return;
          const cardRef = cardsSnap.docs[0].ref;
          const patch = {
            company: updatedGroup.company,
            logoUrl: updatedGroup.logoUrl,
            backgroundUrl: updatedGroup.backgroundUrl,
            mainColor: updatedGroup.mainColor,
            textColor: updatedGroup.textColor,
            updatedAt: serverTimestamp(),
          };
          await setDoc(cardRef, patch, { merge: true });
          await setDoc(doc(db, "publicCards", m.cardSlug), patch, { merge: true });
        }),
      );

      setGroupMsg("保存しました（全メンバーのカードに反映済み）");
    } catch (err) {
      setGroupMsg(errorMessage(err));
    } finally {
      setSavingGroup(false);
    }
  };

  // ── メンバー追加 ──────────────────────────────────────────────
  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupId) return;
    setAddError("");
    setAdding(true);

    try {
      const newUid = await createMemberAuth(addEmail, addPassword);
      const slug = createCardSlug(String(addPersonal.name ?? ""));
      const cardId = `card-${Date.now()}`;

      const cardData = {
        ...buildMemberCard(group, addPersonal),
        slug,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      await setDoc(doc(db, "groups", groupId, "members", newUid, "cards", cardId), cardData);
      await setDoc(doc(db, "publicCards", slug), cardData);
      await setDoc(doc(db, "groups", groupId, "members", newUid), {
        uid: newUid,
        email: addEmail,
        displayName: addPersonal.name ?? "",
        cardSlug: slug,
      });
      await setDoc(doc(db, "users", newUid), {
        role: "member",
        groupId,
        email: addEmail,
        displayName: addPersonal.name ?? "",
        cardSlug: slug,
      });

      setShowAddForm(false);
      setAddEmail("");
      setAddPassword("");
      setAddPersonal({});
    } catch (err) {
      setAddError(errorMessage(err));
    } finally {
      setAdding(false);
    }
  };

  // ── メンバー削除 ──────────────────────────────────────────────
  const handleDeleteMember = async (m: MemberWithCard) => {
    if (!groupId) return;
    if (!window.confirm(`「${m.displayName || m.email}」を削除しますか？`)) return;

    try {
      const cardsSnap = await getDocs(
        collection(db, "groups", groupId, "members", m.uid, "cards"),
      );
      await Promise.all(cardsSnap.docs.map((d) => deleteDoc(d.ref)));
      if (m.cardSlug) await deleteDoc(doc(db, "publicCards", m.cardSlug));
      await deleteDoc(doc(db, "groups", groupId, "members", m.uid));
      await deleteDoc(doc(db, "users", m.uid));
      await fetch("/api/delete-member", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: m.uid }),
      });
      if (editingUid === m.uid) setEditingUid(null);
    } catch (err) {
      alert(errorMessage(err));
    }
  };

  // ── 編集開始 ──────────────────────────────────────────────────
  const startEdit = (m: MemberWithCard) => {
    setEditingUid(m.uid);
    // 個人情報だけ抽出（グループ共通項目は除く）
    setEditPersonal({
      name: m.card?.name ?? "",
      title: m.card?.title ?? "",
      department: m.card?.department ?? "",
      phone: m.card?.phone ?? "",
      email: m.card?.email ?? "",
      website: m.card?.website ?? "",
      address: m.card?.address ?? "",
      slug: m.card?.slug ?? "",
    });
    setSaveMsg("");
  };

  // ── カード保存 ────────────────────────────────────────────────
  const handleSaveCard = async () => {
    if (!groupId || !editingUid) return;
    setSaving(true);
    setSaveMsg("");

    try {
      const cardsSnap = await getDocs(
        collection(db, "groups", groupId, "members", editingUid, "cards"),
      );
      const cardId = cardsSnap.empty ? `card-${Date.now()}` : cardsSnap.docs[0].id;
      const slug = String(editPersonal.slug || createCardSlug(String(editPersonal.name ?? "")));

      const updated = {
        ...buildMemberCard(group, editPersonal),
        slug,
        updatedAt: serverTimestamp(),
      };

      await setDoc(
        doc(db, "groups", groupId, "members", editingUid, "cards", cardId),
        updated,
        { merge: true },
      );
      await setDoc(doc(db, "publicCards", slug), updated, { merge: true });

      // メンバードキュメントの表示名を更新
      await setDoc(
        doc(db, "groups", groupId, "members", editingUid),
        { displayName: editPersonal.name ?? "" },
        { merge: true },
      );

      setSaveMsg("保存しました");
    } catch (err) {
      setSaveMsg(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  // ── レンダリング ─────────────────────────────────────────────
  if (loading || initLoading) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f4f1eb] text-sm text-black">
        読み込み中...
      </main>
    );
  }
  if (!user) return null;

  const addPreviewCard = buildMemberCard(previewGroup, addPersonal);
  const editPreviewCard = editingUid
    ? buildMemberCard(group, editPersonal)
    : null;

  return (
    <main className="min-h-screen bg-[#f4f1eb] px-4 py-8 text-black [color-scheme:light]">
      <div className="mx-auto max-w-3xl space-y-6">

        {/* ヘッダー */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.25em] text-black/40">XENOCARD</p>
            <h1 className="mt-0.5 text-2xl font-semibold text-black">管理者パネル</h1>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void signOut(auth)}
              className="rounded-full border border-stone-300 bg-white px-4 py-2 text-xs font-semibold text-black transition hover:bg-stone-50"
            >
              ログアウト
            </button>
          </div>
        </div>

        {/* ── グループ共通設定 ── */}
        <section className="rounded-2xl border border-black/8 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-black">グループ共通設定</h2>
              <p className="mt-0.5 text-xs text-black/50">
                ロゴ・背景・会社名・カラーは全メンバーの名刺に共通で使用されます。
              </p>
            </div>
            <button
              type="button"
              onClick={() => { setAiOpen((v) => !v); setAiError(""); setAiResult(null); setAiStatus(""); }}
              className="flex items-center gap-2 rounded-full bg-violet-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-violet-700"
            >
              <Sparkles className="h-3.5 w-3.5" />
              AIデザイン
            </button>
          </div>

          {/* AI生成パネル */}
          {aiOpen && (
            <div className="mb-5 rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-violet-600 text-white">
                    <Bot className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-black">AIデザイン生成</h3>
                    <p className="mt-0.5 text-xs text-black/50">OpenAIで背景またはロゴを生成します。</p>
                  </div>
                </div>
                <button type="button" onClick={() => { if (!aiGenerating) setAiOpen(false); }} disabled={aiGenerating}>
                  <X className="h-4 w-4 text-black/30" />
                </button>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-white p-1">
                {(["background", "logo"] as const).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => { setAiKind(kind); setAiResult(null); setAiError(""); setAiStatus(""); }}
                    disabled={aiGenerating}
                    className={[
                      "rounded-lg px-3 py-2 text-sm font-semibold transition",
                      aiKind === kind ? "bg-violet-600 text-white" : "text-black/50 hover:bg-violet-50",
                    ].join(" ")}
                  >
                    {kind === "background" ? "背景を作る" : "ロゴを作る"}
                  </button>
                ))}
              </div>

              <label className="mt-4 block">
                <span className="text-xs font-semibold text-black/70">デザイン指示</span>
                <textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  rows={4}
                  maxLength={1200}
                  placeholder={
                    aiKind === "background"
                      ? "例：黒とゴールドを基調にした、建築会社向けの高級感ある幾何学デザイン。"
                      : "例：飛躍と信頼を表す、鷹をモチーフにしたミニマルで力強いシンボル。"
                  }
                  className="mt-2 w-full resize-none rounded-xl border border-violet-200 bg-white px-4 py-3 text-sm text-black outline-none focus:border-violet-500"
                />
              </label>

              {aiKind === "logo" && (
                <p className="mt-2 text-xs text-black/40">
                  ロゴは文字を含めず、透明背景のシンボルマークとして生成します。
                </p>
              )}

              <button
                type="button"
                onClick={() => void generateAiImage()}
                disabled={aiGenerating || !aiPrompt.trim()}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <WandSparkles className="h-4 w-4" />
                {aiGenerating ? "AIが生成しています…" : aiKind === "background" ? "AI背景を生成" : "AIロゴを生成"}
              </button>

              {aiStatus && (
                <div className="mt-4 rounded-xl border border-violet-200 bg-white px-4 py-3 text-sm text-violet-700">
                  <div className="flex items-center gap-3">
                    {aiGenerating && <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" />}
                    <span>{aiStatus}</span>
                  </div>
                </div>
              )}

              {aiError && (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  <p className="font-semibold">画像生成に失敗しました</p>
                  <p className="mt-1">{aiError}</p>
                </div>
              )}

              {aiResult && (
                <div className="mt-4 rounded-2xl border border-violet-200 bg-white p-3">
                  {/* 生成画像プレビュー */}
                  <div className={[
                    "mx-auto overflow-hidden rounded-xl bg-[linear-gradient(45deg,#eee_25%,transparent_25%),linear-gradient(-45deg,#eee_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#eee_75%),linear-gradient(-45deg,transparent_75%,#eee_75%)] bg-[length:20px_20px] bg-[position:0_0,0_10px,10px_-10px,-10px_0px]",
                    aiResult.kind === "logo" ? "aspect-square max-w-48" : "aspect-[2/3] max-w-48",
                  ].join(" ")}>
                    <img src={aiResult.dataUrl} alt="AI生成結果" className="h-full w-full object-cover" />
                  </div>

                  {/* 追加編集エリア */}
                  <div className="mt-3 rounded-xl border border-violet-100 bg-violet-50 p-3">
                    <p className="mb-2 text-[11px] font-semibold text-violet-700">追加で修正指示</p>
                    <textarea
                      value={aiEditPrompt}
                      onChange={(e) => setAiEditPrompt(e.target.value)}
                      rows={2}
                      maxLength={600}
                      placeholder="例：もっと暗くして、金色のアクセントを加えて"
                      className="w-full resize-none rounded-lg border border-violet-200 bg-white px-3 py-2 text-xs text-black outline-none focus:border-violet-500"
                    />
                    <button
                      type="button"
                      onClick={() => void generateAiImage(aiResult.dataUrl)}
                      disabled={aiGenerating || !aiEditPrompt.trim()}
                      className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <WandSparkles className="h-3 w-3" />
                      この画像を編集
                    </button>
                  </div>

                  {/* 採用・再生成ボタン */}
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => void applyAiResult()}
                      className="rounded-xl bg-stone-900 px-4 py-3 text-sm font-semibold text-white hover:bg-black"
                    >
                      {aiResult.kind === "logo" ? "このロゴを採用" : "この背景を採用"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void generateAiImage()}
                      className="rounded-xl border border-stone-200 px-4 py-3 text-sm font-semibold text-black hover:bg-stone-50"
                    >
                      最初から生成
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
            <div className="grid gap-4">
              {/* 会社名 */}
              <label className="block">
                <span className="text-xs font-semibold text-black">会社名</span>
                <input
                  type="text"
                  value={group.company}
                  onChange={(e) => setGroup((g) => ({ ...g, company: e.target.value }))}
                  placeholder="株式会社 Example"
                  className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-black outline-none focus:border-stone-500"
                />
              </label>

              {/* 画像 */}
              <div className="grid grid-cols-2 gap-3">
                <label className="block cursor-pointer">
                  <span className="text-xs font-semibold text-black">ロゴ画像</span>
                  <div className="mt-1 flex h-24 items-center justify-center overflow-hidden rounded-lg border border-dashed border-stone-300 bg-stone-50">
                    {groupLogoPreview || group.logoUrl ? (
                      <img
                        src={groupLogoPreview || group.logoUrl}
                        alt="logo"
                        className="h-full w-full object-contain p-2"
                      />
                    ) : (
                      <span className="text-xs text-stone-400">クリックして選択</span>
                    )}
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => setGroupLogoFile(e.target.files?.[0] ?? null)}
                  />
                </label>

                <label className="block cursor-pointer">
                  <span className="text-xs font-semibold text-black">背景画像</span>
                  <div className="mt-1 flex h-24 items-center justify-center overflow-hidden rounded-lg border border-dashed border-stone-300 bg-stone-50">
                    {groupBgPreview || group.backgroundUrl ? (
                      <img
                        src={groupBgPreview || group.backgroundUrl}
                        alt="background"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="text-xs text-stone-400">クリックして選択</span>
                    )}
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => setGroupBgFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>

              {/* カラー */}
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-semibold text-black">メインカラー</span>
                  <div className="mt-1 flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2">
                    <input
                      type="color"
                      value={group.mainColor}
                      onChange={(e) => setGroup((g) => ({ ...g, mainColor: e.target.value }))}
                      className="h-6 w-6 cursor-pointer rounded border-none bg-transparent p-0"
                    />
                    <span className="text-sm text-black">{group.mainColor}</span>
                  </div>
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-black">文字色</span>
                  <div className="mt-1 flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2">
                    <input
                      type="color"
                      value={group.textColor}
                      onChange={(e) => setGroup((g) => ({ ...g, textColor: e.target.value }))}
                      className="h-6 w-6 cursor-pointer rounded border-none bg-transparent p-0"
                    />
                    <span className="text-sm text-black">{group.textColor}</span>
                  </div>
                </label>
              </div>

              {groupMsg && (
                <p className={`text-xs font-semibold ${groupMsg.startsWith("保存") ? "text-green-600" : "text-red-600"}`}>
                  {groupMsg}
                </p>
              )}

              <button
                type="button"
                onClick={() => void handleSaveGroup()}
                disabled={savingGroup}
                className="flex items-center justify-center gap-2 rounded-xl bg-stone-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-black disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {savingGroup ? "保存中..." : "グループ設定を保存（全メンバーに反映）"}
              </button>
            </div>

            {/* プレビュー */}
            <div className="flex items-start justify-center overflow-visible px-2 py-4">
              <PhoneMockup width={220}>
                <BusinessCardPreview
                  card={{ ...EMPTY_BUSINESS_CARD, ...previewGroup, name: "山田 太郎", title: "代表取締役" }}
                  qrValue="https://xenocard.app/preview"
                  fill
                />
              </PhoneMockup>
            </div>
          </div>
        </section>

        {/* ── メンバー一覧 ── */}
        <section className="rounded-2xl border border-black/8 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-black">メンバー一覧</h2>
            <button
              type="button"
              onClick={() => { setShowAddForm((v) => !v); setAddError(""); }}
              className="flex items-center gap-1.5 rounded-full bg-stone-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-black"
            >
              <Plus className="h-3.5 w-3.5" />
              メンバー追加
            </button>
          </div>

          {/* 追加フォーム */}
          {showAddForm && (
            <form
              onSubmit={(e) => void handleAddMember(e)}
              className="mt-5 rounded-xl border border-stone-200 bg-stone-50 p-5"
            >
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-black">新規メンバー</h3>
                <button type="button" onClick={() => setShowAddForm(false)}>
                  <X className="h-4 w-4 text-black/40" />
                </button>
              </div>

              <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
                <div className="grid gap-3">
                  <p className="text-xs font-semibold text-black/40">ログイン情報</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-xs font-semibold text-black">ログイン用メールアドレス *</span>
                      <input
                        type="email"
                        required
                        value={addEmail}
                        onChange={(e) => setAddEmail(e.target.value)}
                        placeholder="member@example.com"
                        className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-black outline-none focus:border-stone-500"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-semibold text-black">ログイン用パスワード *</span>
                      <input
                        type="password"
                        required
                        minLength={6}
                        value={addPassword}
                        onChange={(e) => setAddPassword(e.target.value)}
                        placeholder="6文字以上"
                        className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-black outline-none focus:border-stone-500"
                      />
                    </label>
                  </div>

                  <p className="mt-2 text-xs font-semibold text-black/40">個人情報</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {MEMBER_FIELDS.map((f) => (
                      <label key={f.name} className="block">
                        <span className="text-xs font-semibold text-black">{f.label}</span>
                        <input
                          type={f.type ?? "text"}
                          value={String(addPersonal[f.name] ?? "")}
                          onChange={(e) =>
                            setAddPersonal((p) => ({ ...p, [f.name]: e.target.value }))
                          }
                          placeholder={f.placeholder}
                          className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-black outline-none focus:border-stone-500"
                        />
                      </label>
                    ))}
                  </div>
                </div>

                {/* プレビュー */}
                <div className="flex justify-center py-4">
                  <PhoneMockup width={200}>
                    <BusinessCardPreview card={addPreviewCard} qrValue={buildVCard(addPreviewCard)} fill />
                  </PhoneMockup>
                </div>
              </div>

              {addError && (
                <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {addError}
                </p>
              )}

              <button
                type="submit"
                disabled={adding}
                className="mt-5 w-full rounded-xl bg-stone-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-black disabled:opacity-50"
              >
                {adding ? "作成中..." : "メンバーを作成"}
              </button>
            </form>
          )}

          {/* メンバーリスト */}
          <div className="mt-5 grid gap-3">
            {members.length === 0 ? (
              <p className="py-6 text-center text-sm text-black/40">まだメンバーがいません</p>
            ) : (
              members.map((m) => (
                <div key={m.uid} className="rounded-xl border border-stone-100 bg-stone-50">
                  <div className="flex items-center justify-between px-4 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="grid h-9 w-9 place-items-center rounded-full bg-stone-200">
                        <UserRound className="h-4 w-4 text-black" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-black">{m.displayName || m.email}</p>
                          {m.isAdmin && (
                            <span className="rounded-full bg-stone-900 px-2 py-0.5 text-[10px] font-semibold text-white">
                              管理者
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-black/50">{m.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {m.cardSlug && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleCopy(m.cardSlug)}
                            className="flex items-center gap-1.5 rounded-full border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-stone-100"
                          >
                            {copiedSlug === m.cardSlug ? (
                              <Check className="h-3 w-3 text-green-600" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                            {copiedSlug === m.cardSlug ? "コピー済み" : "コピー"}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleShare(m.cardSlug, m.displayName)}
                            className="flex items-center gap-1.5 rounded-full border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-stone-100"
                          >
                            <Share2 className="h-3 w-3" />
                            送る
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          editingUid === m.uid ? setEditingUid(null) : startEdit(m)
                        }
                        className="flex items-center gap-1 rounded-full bg-stone-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-black"
                      >
                        編集
                        {editingUid === m.uid ? (
                          <ChevronUp className="h-3 w-3" />
                        ) : (
                          <ChevronDown className="h-3 w-3" />
                        )}
                      </button>
                      {!m.isAdmin && (
                        <button
                          type="button"
                          onClick={() => void handleDeleteMember(m)}
                          className="grid h-7 w-7 place-items-center rounded-full border border-red-200 bg-red-50 text-red-500 transition hover:bg-red-100"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* 編集パネル */}
                  {editingUid === m.uid && editPreviewCard && (
                    <div className="border-t border-stone-200 px-4 pb-5 pt-4">
                      <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
                        <div className="grid gap-3 sm:grid-cols-2">
                          {MEMBER_FIELDS.map((f) => (
                            <label key={f.name} className="block">
                              <span className="text-xs font-semibold text-black">{f.label}</span>
                              <input
                                type={f.type ?? "text"}
                                value={String(editPersonal[f.name] ?? "")}
                                onChange={(e) =>
                                  setEditPersonal((p) => ({ ...p, [f.name]: e.target.value }))
                                }
                                placeholder={f.placeholder}
                                className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-black outline-none focus:border-stone-500"
                              />
                            </label>
                          ))}
                        </div>

                        <div className="flex flex-col items-center gap-3">
                          <div className="py-4">
                            <PhoneMockup width={190}>
                              <BusinessCardPreview
                                card={editPreviewCard}
                                qrValue={buildVCard(editPreviewCard)}
                                fill
                              />
                            </PhoneMockup>
                          </div>
                          {saveMsg && (
                            <p className={`text-center text-xs font-semibold ${saveMsg === "保存しました" ? "text-green-600" : "text-red-600"}`}>
                              {saveMsg}
                            </p>
                          )}
                          <button
                            type="button"
                            onClick={() => void handleSaveCard()}
                            disabled={saving}
                            className="w-full rounded-xl bg-stone-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-black disabled:opacity-50"
                          >
                            {saving ? "保存中..." : "保存"}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
