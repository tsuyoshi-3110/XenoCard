"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
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
import { signOut } from "firebase/auth";
import { AsYouType } from "libphonenumber-js";
import { AlignCenter, AlignLeft, AlignRight, Bot, Check, ChevronDown, ChevronUp, Copy, Eye, Images, Plus, Save, Share2, Sparkles, Trash2, UserRound, WandSparkles, X } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { auth, db } from "@/lib/firebase";
import {
  buildVCard,
  createCardSlug,
  EMPTY_BUSINESS_CARD,
  normalizeCardSlug,
  type BusinessCard,
} from "@/lib/businessCard";
import { compressImageToWebP } from "@/lib/imageCompression";
import BusinessCardPreview from "@/components/business-card/BusinessCardPreview";
import PhoneMockup from "@/components/PhoneMockup";
import LoadingState from "@/components/LoadingState";

// グループ共通設定の型
type GroupSettings = {
  company: string;
  logoUrl: string;
  backgroundUrl: string;
  mainColor: string;
  textColor: string;
  logoSize: number;
  logoX: number;
  logoY: number;
  textAreaX: number;
  textAreaY: number;
  textAreaWidth: number;
  textAlign: "left" | "center" | "right";
};

const EMPTY_GROUP: GroupSettings = {
  company: "",
  logoUrl: "",
  backgroundUrl: "",
  mainColor: "#c9a96e",
  textColor: "#ffffff",
  logoSize: 20, // カード幅に対する%
  logoX: 8,
  logoY: 8,
  textAreaX: 8,      // 文字ブロック 左から%
  textAreaY: 7,      // 文字ブロック 下から%
  textAreaWidth: 84, // 文字ブロック幅%（文字サイズ連動）
  textAlign: "left", // 文字の水平揃え
};

// メンバー個人情報のフィールド（会社・ロゴ・背景・カラーはグループ共通なので除外）
const MEMBER_FIELDS: Array<{
  name: keyof BusinessCard;
  label: string;
  placeholder: string;
  type?: string;
  wide?: boolean;
}> = [
  { name: "name", label: "氏名", placeholder: "山田 太郎" },
  { name: "title", label: "肩書き", placeholder: "代表取締役" },
  { name: "department", label: "追加情報（任意）", placeholder: "営業部 / 資格名 など" },
  { name: "phone", label: "電話番号", placeholder: "090-1234-5678", type: "tel" },
  { name: "email", label: "メールアドレス", placeholder: "hello@example.com", type: "email" },
  { name: "website", label: "WebサイトURL（任意）", placeholder: "https://example.com", type: "url" },
  { name: "address", label: "住所", placeholder: "東京都〇〇区...", wide: true },
];

type Member = { uid: string; email: string; displayName: string; cardSlug: string; isAdmin?: boolean };
type MemberWithCard = Member & { card: BusinessCard | null };

function formatPhoneJP(raw: string): string {
  return new AsYouType("JP").input(raw.replace(/[^\d+]/g, ""));
}

function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : "エラーが発生しました";
}

async function dataUrlToFile(dataUrl: string, filename: string): Promise<File> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], filename, { type: blob.type || "image/png", lastModified: Date.now() });
}

// 画像を指定アスペクト比にセンタークロップ（Canvasで処理）
function cropToAspect(dataUrl: string, ratio: number): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const srcRatio = img.width / img.height;
      let sx = 0, sy = 0, sw = img.width, sh = img.height;
      if (srcRatio > ratio) {
        sw = Math.round(img.height * ratio);
        sx = Math.round((img.width - sw) / 2);
      } else {
        sh = Math.round(img.width / ratio);
        sy = Math.round((img.height - sh) / 2);
      }
      const canvas = document.createElement("canvas");
      canvas.width = sw;
      canvas.height = sh;
      canvas.getContext("2d")!.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      resolve(canvas.toDataURL("image/png"));
    };
    img.src = dataUrl;
  });
}

async function uploadImage(
  file: File,
  groupId: string,
  fileName: string,
): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error("ログイン情報がありません。");

  const formData = new FormData();
  formData.set("image", file);
  formData.set("groupId", groupId);
  formData.set("fileName", fileName);

  const response = await fetch("/api/upload-image", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await user.getIdToken()}`,
    },
    body: formData,
  });
  const json = (await response.json()) as {
    downloadUrl?: string;
    error?: string;
  };
  if (!response.ok || !json.downloadUrl) {
    throw new Error(json.error || "画像を保存できませんでした。");
  }
  return json.downloadUrl;
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
    logoSize: group.logoSize,
    logoX: group.logoX,
    logoY: group.logoY,
    textAreaX: group.textAreaX,
    textAreaY: group.textAreaY,
    textAreaWidth: group.textAreaWidth,
    textAlign: group.textAlign,
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

  // Pageit店舗情報の有無（null=未確認、true=あり、false=なし）
  const [hasPageitSite, setHasPageitSite] = useState<boolean | null>(null);

  // AI生成
  const [aiOpen, setAiOpen] = useState(false);
  const [aiKind, setAiKind] = useState<"background" | "logo">("background");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiResult, setAiResult] = useState<{ kind: "background" | "logo"; dataUrl: string } | null>(null);
  const [aiStatus, setAiStatus] = useState("");
  const [aiError, setAiError] = useState("");
  const [aiEditPrompt, setAiEditPrompt] = useState("");
  // AI生成後プレビュー（採用前でもスマホプレビューに即反映）
  const [aiPreviewBg, setAiPreviewBg] = useState<string | null>(null);
  const [aiPreviewLogo, setAiPreviewLogo] = useState<string | null>(null);

  const [members, setMembers] = useState<MemberWithCard[]>([]);
  const [initLoading, setInitLoading] = useState(true);
  const [initStatus, setInitStatus] = useState("ログイン情報を確認しています…");
  const [initSlow, setInitSlow] = useState(false);

  // 追加フォーム
  const [showAddForm, setShowAddForm] = useState(false);
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
  const [copiedMsgSlug, setCopiedMsgSlug] = useState<string | null>(null);
  const [copyPopSlug, setCopyPopSlug] = useState<string | null>(null);
  const [copiedOwnerSlug, setCopiedOwnerSlug] = useState<string | null>(null);
  const [previewModalOpen, setPreviewModalOpen] = useState(false);

  // コピー完了トースト
  const [toast, setToast] = useState("");
  const toastTimer = useRef<number | null>(null);
  const showToast = (message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2000);
  };

  const getCardUrl = (slug: string) =>
    `${process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://xeno-card.vercel.app"}/m/${encodeURIComponent(slug || "")}`;

  const getCardMessage = (name: string, url: string) =>
    `${name}のデジタル名刺はこちらからご確認いただけます。\n\n${url}\n\n※ブラウザで開いてブックマークに登録しておくと便利です。`;

  const handleCopy = (slug: string) => {
    const url = getCardUrl(slug);
    const doCopy = () => {
      setCopiedSlug(slug);
      showToast("URLをコピーしました");
      setCopyPopSlug(null);
      setTimeout(() => setCopiedSlug(null), 1500);
    };
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(url).then(doCopy);
    } else {
      const el = document.createElement("textarea");
      el.value = url;
      el.style.position = "fixed"; el.style.opacity = "0";
      document.body.appendChild(el); el.select();
      document.execCommand("copy"); document.body.removeChild(el);
      doCopy();
    }
  };

  const handleCopyMessage = (slug: string, name: string) => {
    const url = getCardUrl(slug);
    const text = getCardMessage(name, url);
    const doCopy = () => {
      setCopiedMsgSlug(slug);
      showToast("文章をコピーしました");
      setCopyPopSlug(null);
      setTimeout(() => setCopiedMsgSlug(null), 1500);
    };
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(text).then(doCopy);
    } else {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed"; el.style.opacity = "0";
      document.body.appendChild(el); el.select();
      document.execCommand("copy"); document.body.removeChild(el);
      doCopy();
    }
  };

  // 本人用リンク(名刺取り込み用トークン付き)を発行してコピー
  const handleCopyOwnerLink = (slug: string) => {
    const fetchLink = async (): Promise<string> => {
      const idToken = await user?.getIdToken();
      if (!idToken) throw new Error("ログイン情報を確認できませんでした。");
      const response = await fetch("/api/scans/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ slug }),
      });
      const json = (await response.json().catch(() => ({}))) as {
        token?: string;
        error?: string;
      };
      if (!response.ok || !json.token) {
        throw new Error(json.error || "リンクを発行できませんでした。");
      }
      return `${getCardUrl(slug)}#k=${json.token}`;
    };
    const done = () => {
      setCopiedOwnerSlug(slug);
      showToast("本人用リンクをコピーしました");
      setCopyPopSlug(null);
      setTimeout(() => setCopiedOwnerSlug(null), 1500);
    };
    // iOS Safariはfetch後のクリップボード操作を拒否するためClipboardItem(Promise)を優先
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      const item = new ClipboardItem({
        "text/plain": fetchLink().then(
          (link) => new Blob([link], { type: "text/plain" }),
        ),
      });
      void navigator.clipboard
        .write([item])
        .then(done)
        .catch(async () => {
          try {
            const link = await fetchLink();
            await navigator.clipboard.writeText(link);
            done();
          } catch (err) {
            alert(errorMessage(err));
          }
        });
    } else {
      void fetchLink()
        .then(async (link) => {
          await navigator.clipboard.writeText(link);
          done();
        })
        .catch((err) => alert(errorMessage(err)));
    }
  };

  const handleShare = (slug: string, name: string) => {
    const url = getCardUrl(slug);
    if (navigator.share) {
      void navigator.share({ title: `${name}の名刺`, text: getCardMessage(name, url), url });
    } else {
      // Web Share API非対応環境ではメールにフォールバック
      const subject = encodeURIComponent(`${name}の名刺`);
      const body = encodeURIComponent(getCardMessage(name, url));
      window.location.href = `mailto:?subject=${subject}&body=${body}`;
    }
  };

  // 認証チェック
  useEffect(() => {
    if (!loading && !user) router.replace("/login?next=/admin");
  }, [loading, user, router]);

  // グループ初期化 & メンバー購読
  useEffect(() => {
    if (!user) return;
    let active = true;
    const slowTimer = window.setTimeout(() => {
      if (active) setInitSlow(true);
    }, 7000);

    const init = async () => {
      const userRef = doc(db, "xenocardUsers", user.uid);
      setInitStatus("アカウントとグループ情報を読み込んでいます…");
      const [userSnap, groupsSnap, pageitSnap] = await Promise.all([
        getDoc(userRef),
        getDocs(
          query(
            collection(db, "xenocardGroups"),
            where("adminUid", "==", user.uid),
            limit(1),
          ),
        ),
        getDocs(
          query(collection(db, "siteSettings"), where("ownerId", "==", user.uid), limit(1)),
        ).catch(() => null),
      ]);
      if (active) setHasPageitSite(pageitSnap != null && !pageitSnap.empty);
      const userProfile = userSnap.exists() ? userSnap.data() : null;

      if (userProfile && userProfile.role !== "admin") {
        const memberPath =
          typeof userProfile.cardSlug === "string" && userProfile.cardSlug
            ? `/m/${encodeURIComponent(userProfile.cardSlug)}`
            : "/my-card";
        router.replace(memberPath);
        return;
      }

      let gId = "";

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
            logoSize:
              typeof gData.logoSize === "number" &&
              gData.logoSize >= 5 &&
              gData.logoSize <= 90
                ? gData.logoSize
                : 20,
            logoX: gData.logoX ?? 8,
            logoY: gData.logoY ?? 8,
            textAreaX: gData.textAreaX ?? 8,
            textAreaY: gData.textAreaY ?? 7,
            textAreaWidth:
              typeof gData.textAreaWidth === "number" &&
              gData.textAreaWidth >= 20 &&
              gData.textAreaWidth <= 150
                ? gData.textAreaWidth
                : 84,
            textAlign: ["left", "center", "right"].includes(gData.textAlign)
              ? (gData.textAlign as "left" | "center" | "right")
              : "left",
          });
        }
      } else {
        gId = `group-${user.uid}`;
        await setDoc(doc(db, "xenocardGroups", gId), {
          name: "メイングループ",
          adminUid: user.uid,
          createdAt: serverTimestamp(),
        });
      }

      if (!active) return;
      setGroupId(gId);
      setInitStatus("メンバー情報を準備しています…");

      // 管理者自身がメンバー一覧に存在しない場合は追加する
      const adminMemberRef = doc(db, "xenocardGroups", gId, "members", user.uid);
      const [, adminMemberSnap] = await Promise.all([
        setDoc(
          userRef,
          {
            role: "admin",
            groupId: gId,
            email: user.email ?? "",
            enabled: true,
          },
          { merge: true },
        ),
        getDoc(adminMemberRef),
      ]);
      if (!adminMemberSnap.exists()) {
        // ダッシュボードの既存カードがあれば取得してマイグレーション
        const existingCardsSnap = await getDocs(
          query(collection(db, "xenocardUsers", user.uid, "cards"), limit(1)),
        );
        const existingCard = existingCardsSnap.empty
          ? null
          : existingCardsSnap.docs[0].data() as BusinessCard;

        const slug = existingCard?.slug || createCardSlug(existingCard?.name ?? user.email ?? "admin");
        const cardId = `card-${Date.now()}`;
        const cardData = {
          ...EMPTY_BUSINESS_CARD,
          ...(existingCard ?? {}),
          groupId: gId,
          slug,
          updatedAt: serverTimestamp(),
        };

        await Promise.all([
          setDoc(
            doc(
              db,
              "xenocardGroups",
              gId,
              "members",
              user.uid,
              "cards",
              cardId,
            ),
            cardData,
          ),
          setDoc(doc(db, "xenocardPublicCards", slug), cardData),
          setDoc(adminMemberRef, {
            uid: user.uid,
            email: user.email ?? "",
            displayName: existingCard?.name ?? user.email ?? "",
            cardSlug: slug,
            isAdmin: true,
          }),
          setDoc(userRef, { cardSlug: slug }, { merge: true }),
        ]);
      }

      const unsub = onSnapshot(collection(db, "xenocardGroups", gId, "members"), (snap) => {
        const memberList = snap.docs.map((memberDoc) => ({
          ...(memberDoc.data() as Member),
          card: null,
        }));
        if (active) {
          setMembers(memberList);
          setInitLoading(false);
          setInitStatus("名刺データを読み込んでいます…");
          window.clearTimeout(slowTimer);
        }

        void (async () => {
        const list: MemberWithCard[] = await Promise.all(
          memberList.map(async (member) => {
            const cardsSnap = await getDocs(
              collection(
                db,
                "xenocardGroups",
                gId,
                "members",
                member.uid,
                "cards",
              ),
            );
            const card = cardsSnap.empty
              ? null
              : ({ ...EMPTY_BUSINESS_CARD, ...cardsSnap.docs[0].data() } as BusinessCard);
            return { ...member, card };
          }),
        );
          if (active) setMembers(list);
        })();
      });
      return unsub;
    };

    let unsubFn: (() => void) | undefined;
    init()
      .then((u) => { unsubFn = u; })
      .catch(() => {
        if (active) {
          setInitLoading(false);
          window.clearTimeout(slowTimer);
        }
      });

    return () => {
      active = false;
      window.clearTimeout(slowTimer);
      unsubFn?.();
    };
  }, [router, user]);

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
    logoUrl: aiPreviewLogo || groupLogoPreview || group.logoUrl,
    backgroundUrl: aiPreviewBg || groupBgPreview || group.backgroundUrl,
  };

  // ── AI画像生成 ────────────────────────────────────────────────
  const generateAiImage = async (
    editImageDataUrl?: string,
    useStoreContext = false,
  ) => {
    const promptToUse = editImageDataUrl ? aiEditPrompt : aiPrompt;
    if (!user || aiGenerating || (!promptToUse.trim() && !useStoreContext)) return;
    setAiGenerating(true);
    setAiError("");
    if (!editImageDataUrl) setAiResult(null);
    setAiStatus(
      editImageDataUrl
        ? "AIが画像を編集しています。通常30秒〜2分ほどかかります。"
        : useStoreContext
          ? "Pageitの店舗情報を読み込み、お店に似合うデザインを考えています…"
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
          useStoreContext,
          ...(editImageDataUrl ? { editImageDataUrl } : {}),
        }),
        signal: controller.signal,
      });
      const json = (await response.json()) as { imageDataUrl?: string; error?: string };
      if (!response.ok || !json.imageDataUrl) throw new Error(json.error || "AI画像を生成できませんでした。");
      const finalDataUrl = json.imageDataUrl; // クロップせず原寸まま使用（bg-coverに任せる）
      setAiResult({ kind: aiKind, dataUrl: finalDataUrl });
      // 生成直後からプレビューに反映
      if (aiKind === "background") setAiPreviewBg(finalDataUrl);
      else setAiPreviewLogo(finalDataUrl);
      setAiEditPrompt("");
      setAiStatus("完了しました。右のプレビューで確認して採用してください。");
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
    if (aiResult.kind === "logo") {
      setGroupLogoFile(file);
      setAiPreviewLogo(aiResult.dataUrl);
    } else {
      setGroupBgFile(file);
      setAiPreviewBg(aiResult.dataUrl);
    }
    setAiResult(null);
    setAiStatus("");
    setAiOpen(false);
  };

  const cancelAiPreview = () => {
    setAiPreviewBg(null);
    setAiPreviewLogo(null);
    setAiResult(null);
    setAiStatus("");
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
              .then((f) =>
                uploadImage(f, groupId, `logo-${Date.now()}.webp`),
              )
          : Promise.resolve(group.logoUrl),
        groupBgFile
          ? compressImageToWebP(groupBgFile, { maxBytes: 500 * 1024, maxWidth: 1440, maxHeight: 2560 })
              .then((f) =>
                uploadImage(f, groupId, `background-${Date.now()}.webp`),
              )
          : Promise.resolve(group.backgroundUrl),
      ]);

      const updatedGroup = { ...group, logoUrl, backgroundUrl };
      await setDoc(doc(db, "xenocardGroups", groupId), updatedGroup, { merge: true });
      setGroup(updatedGroup);
      setGroupLogoFile(null);
      setGroupBgFile(null);
      setAiPreviewLogo(null);
      setAiPreviewBg(null);

      // 既存メンバーのカードにもグループ設定を反映
      await Promise.all(
        members.map(async (m) => {
          if (!m.card || !m.cardSlug) return;
          const cardsSnap = await getDocs(
            collection(db, "xenocardGroups", groupId, "members", m.uid, "cards"),
          );
          if (cardsSnap.empty) return;
          const cardRef = cardsSnap.docs[0].ref;
          const patch = {
            company: updatedGroup.company,
            logoUrl: updatedGroup.logoUrl,
            backgroundUrl: updatedGroup.backgroundUrl,
            mainColor: updatedGroup.mainColor,
            textColor: updatedGroup.textColor,
            logoSize: updatedGroup.logoSize,
            logoX: updatedGroup.logoX,
            logoY: updatedGroup.logoY,
            textAreaX: updatedGroup.textAreaX,
            textAreaY: updatedGroup.textAreaY,
            textAreaWidth: updatedGroup.textAreaWidth,
            textAlign: updatedGroup.textAlign,
            updatedAt: serverTimestamp(),
          };
          await setDoc(cardRef, patch, { merge: true });
          await setDoc(doc(db, "xenocardPublicCards", m.cardSlug), patch, { merge: true });
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
      const email = String(addPersonal.email ?? "").trim().toLowerCase();
      if (!email) throw new Error("メールアドレスを入力してください。");

      const token = await user?.getIdToken();
      if (!token) throw new Error("ログイン情報を確認できませんでした。");

      const memberResponse = await fetch("/api/resolve-member", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ email }),
      });
      const memberJson = (await memberResponse.json()) as {
        uid?: string;
        email?: string;
        error?: string;
      };
      if (!memberResponse.ok || !memberJson.uid) {
        throw new Error(memberJson.error || "メンバー情報を確認できませんでした。");
      }

      const newUid = memberJson.uid;
      const slug = createCardSlug(String(addPersonal.name ?? ""));
      const cardId = `card-${Date.now()}`;

      const cardData = {
        ...buildMemberCard(group, addPersonal),
        groupId,
        slug,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      await setDoc(doc(db, "xenocardGroups", groupId, "members", newUid, "cards", cardId), cardData);
      await setDoc(doc(db, "xenocardPublicCards", slug), cardData);
      await setDoc(doc(db, "xenocardGroups", groupId, "members", newUid), {
        uid: newUid,
        email: memberJson.email ?? email,
        displayName: addPersonal.name ?? "",
        cardSlug: slug,
      });
      await setDoc(
        doc(db, "xenocardUsers", newUid),
        {
          role: "member",
          groupId,
          email: memberJson.email ?? email,
          cardSlug: slug,
          enabled: true,
        },
        { merge: true },
      );

      setShowAddForm(false);
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

    // 取り込んだ名刺データの扱いを確認
    let scanAction: "delete" | "inherit" = "inherit";
    if (m.cardSlug) {
      scanAction = window.confirm(
        "このメンバーが取り込んだ名刺データも削除しますか？\n\nOK：画像・情報を完全に削除\nキャンセル：管理者に引き継いで残す（管理画面の「取り込んだ名刺」で閲覧可）",
      )
        ? "delete"
        : "inherit";
    }

    try {
      // 取り込んだ名刺の削除/引き継ぎ(本人用リンクは無効化される)
      if (m.cardSlug) {
        try {
          const idToken = await user?.getIdToken();
          if (idToken) {
            await fetch("/api/scans/member", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${idToken}`,
              },
              body: JSON.stringify({ slug: m.cardSlug, action: scanAction }),
            });
          }
        } catch {
          /* スキャン処理の失敗はメンバー削除を妨げない */
        }
      }

      const cardsSnap = await getDocs(
        collection(db, "xenocardGroups", groupId, "members", m.uid, "cards"),
      );
      await Promise.all(cardsSnap.docs.map((d) => deleteDoc(d.ref)));
      if (m.cardSlug) await deleteDoc(doc(db, "xenocardPublicCards", m.cardSlug));
      await deleteDoc(doc(db, "xenocardGroups", groupId, "members", m.uid));
      await setDoc(
        doc(db, "xenocardUsers", m.uid),
        { enabled: false, cardSlug: "" },
        { merge: true },
      );
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
        collection(db, "xenocardGroups", groupId, "members", editingUid, "cards"),
      );
      const cardId = cardsSnap.empty ? `card-${Date.now()}` : cardsSnap.docs[0].id;
      const manualSlug = normalizeCardSlug(String(editPersonal.slug ?? ""));
      const slug = manualSlug || createCardSlug(String(editPersonal.name ?? ""));

      const updated = {
        ...buildMemberCard(group, editPersonal),
        groupId,
        slug,
        updatedAt: serverTimestamp(),
      };

      await setDoc(
        doc(db, "xenocardGroups", groupId, "members", editingUid, "cards", cardId),
        updated,
        { merge: true },
      );
      await setDoc(doc(db, "xenocardPublicCards", slug), updated, { merge: true });

      // メンバードキュメントの表示名を更新
      await setDoc(
        doc(db, "xenocardGroups", groupId, "members", editingUid),
        { displayName: editPersonal.name ?? "", cardSlug: slug },
        { merge: true },
      );
      await setDoc(
        doc(db, "xenocardUsers", editingUid),
        { cardSlug: slug },
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
      <LoadingState
        title="管理画面を準備中"
        message={loading ? "ログイン情報を確認しています…" : initStatus}
        slow={initSlow}
      />
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
        <section className="rounded-2xl border border-black/8 bg-white p-4 sm:p-6 shadow-sm">
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
              aria-label="AIデザイン"
              title="AIデザイン"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-violet-600 text-white transition hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
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

              {hasPageitSite && (
                <>
                  <button
                    type="button"
                    onClick={() => void generateAiImage(undefined, true)}
                    disabled={aiGenerating}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-violet-300 bg-white px-4 py-3 text-sm font-semibold text-violet-700 transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Sparkles className="h-4 w-4" />
                    お店に似合うデザインを作成する
                  </button>
                  <p className="mt-2 text-center text-[11px] leading-relaxed text-black/45">
                    Pageitに登録されている店名・紹介文・サービス・地域情報をAIが読み取り、
                    {aiKind === "background" ? "背景" : "ロゴ"}を提案します。
                  </p>
                </>
              )}

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
                  {/* 生成画像プレビュー — スマホと同じ比率・同じCSSで表示 */}
                  <div className={[
                    "mx-auto overflow-hidden rounded-xl",
                    aiResult.kind === "logo"
                      ? "aspect-square max-w-48 bg-[linear-gradient(45deg,#eee_25%,transparent_25%),linear-gradient(-45deg,#eee_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#eee_75%),linear-gradient(-45deg,transparent_75%,#eee_75%)] bg-[length:20px_20px] bg-[position:0_0,0_10px,10px_-10px,-10px_0px]"
                      : "aspect-[9/20] max-w-28 bg-black",
                  ].join(" ")}>
                    {aiResult.kind === "logo" ? (
                      <img src={aiResult.dataUrl} alt="AI生成ロゴ" className="h-full w-full object-contain" />
                    ) : (
                      /* 背景はカードと完全に同じ描画（bg-cover bg-top）で表示 */
                      <div
                        className="h-full w-full bg-cover bg-top"
                        style={{ backgroundImage: `url("${aiResult.dataUrl}")` }}
                      />
                    )}
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
                      onClick={() => { cancelAiPreview(); void generateAiImage(); }}
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

              {/* 画像 — 両サムネイルを同じ高さ(h-28=112px)に揃える */}
              <div className="flex items-start gap-3">
                {/* ロゴ：正方形 112×112px */}
                <label className="block shrink-0 cursor-pointer">
                  <span className="text-xs font-semibold text-black">ロゴ画像</span>
                  <div className="relative mt-1 flex h-28 w-28 items-center justify-center overflow-hidden rounded-lg border border-dashed border-stone-300 bg-stone-50">
                    {groupLogoPreview || group.logoUrl ? (
                      <>
                        <img
                          src={groupLogoPreview || group.logoUrl}
                          alt="logo"
                          className="h-full w-full object-contain p-2"
                        />
                        <button
                          type="button"
                          aria-label="ロゴ画像を削除"
                          onClick={(e) => {
                            // label内のためファイル選択が開かないよう既定動作を止める
                            e.preventDefault();
                            e.stopPropagation();
                            setGroupLogoFile(null);
                            setGroup((g) => ({ ...g, logoUrl: "" }));
                          }}
                          className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white transition hover:bg-black"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </>
                    ) : (
                      <span className="text-center text-xs text-stone-400">クリックして<br/>選択</span>
                    )}
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => setGroupLogoFile(e.target.files?.[0] ?? null)}
                  />
                </label>

                {/* 背景：スマホと同比率(9:20)・同じ高さ → 幅 = 112×9/20 ≈ 50px */}
                <label className="block shrink-0 cursor-pointer">
                  <span className="text-xs font-semibold text-black">背景画像</span>
                  <div
                    className="relative mt-1 overflow-hidden rounded-lg border border-dashed border-stone-300 bg-stone-50"
                    style={{ height: "112px", width: "50px" }}
                  >
                    {groupBgPreview || group.backgroundUrl ? (
                      <>
                        <div
                          className="h-full w-full bg-cover bg-top"
                          style={{ backgroundImage: `url("${groupBgPreview || group.backgroundUrl}")` }}
                        />
                        <button
                          type="button"
                          aria-label="背景画像を削除"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setGroupBgFile(null);
                            setGroup((g) => ({ ...g, backgroundUrl: "" }));
                          }}
                          className="absolute right-0.5 top-0.5 grid h-5 w-5 place-items-center rounded-full bg-black/60 text-white transition hover:bg-black"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </>
                    ) : (
                      <span className="flex h-full items-center justify-center text-center text-[9px] text-stone-400">選択</span>
                    )}
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => setGroupBgFile(e.target.files?.[0] ?? null)}
                  />
                </label>

                {/* モバイル: プレビューボタン */}
                <div className="flex h-28 items-end lg:hidden" style={{ marginTop: "20px" }}>
                  <button
                    type="button"
                    onClick={() => setPreviewModalOpen(true)}
                    className="flex items-center gap-1.5 rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-xs font-semibold text-black transition hover:bg-stone-50"
                  >
                    <Eye className="h-4 w-4" />
                    プレビュー
                  </button>
                </div>
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

              {/* 文字の配置 */}
              <div>
                <span className="text-xs font-semibold text-black">文字の配置</span>
                <div className="mt-1 grid grid-cols-3 gap-1 rounded-lg border border-stone-200 bg-white p-1">
                  {(
                    [
                      { value: "left", label: "左詰め", Icon: AlignLeft },
                      { value: "center", label: "中央", Icon: AlignCenter },
                      { value: "right", label: "右詰め", Icon: AlignRight },
                    ] as const
                  ).map(({ value, label, Icon }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setGroup((g) => ({ ...g, textAlign: value }))}
                      className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-semibold transition ${
                        group.textAlign === value
                          ? "bg-stone-900 text-white"
                          : "text-black/60 hover:bg-stone-100"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* ロゴがある場合のヒント */}
              {(group.logoUrl || groupLogoPreview) && (
                <p className="text-[11px] text-black/50">
                  右のプレビューのロゴをドラッグして位置を変更、右下の白いハンドルでサイズ変更できます。
                </p>
              )}

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

            {/* プレビュー（ロゴ直接ドラッグ可） */}
            <div className="hidden lg:flex flex-col items-center gap-2 overflow-visible px-2 py-4">
              <PhoneMockup width={220}>
                <BusinessCardPreview
                  card={{ ...EMPTY_BUSINESS_CARD, ...previewGroup, name: "山田 太郎", title: "代表取締役" }}
                  logoPreviewUrl={previewGroup.logoUrl}
                  backgroundPreviewUrl={previewGroup.backgroundUrl}
                  qrValue="https://xenocard.app/preview"
                  fill
                  textScale={1.0}
                  onLogoChange={
                    (group.logoUrl || groupLogoPreview)
                      ? ({ logoX, logoY, logoSize }) =>
                          setGroup((g) => ({ ...g, logoX, logoY, logoSize }))
                      : undefined
                  }
                  onTextAreaChange={({ textAreaX, textAreaY, textAreaWidth }) =>
                    setGroup((g) => ({ ...g, textAreaX, textAreaY, textAreaWidth }))
                  }
                />
              </PhoneMockup>
              <p className="text-center text-[10px] text-black/35">
                ロゴ・文字をドラッグ → 移動　右下◻️ → リサイズ（文字サイズ連動）
              </p>
            </div>
          </div>
        </section>

        {/* モバイル用フルスクリーンプレビューモーダル */}
        {previewModalOpen && (
          <div className="fixed inset-0 z-50 flex flex-col bg-[#0d0d0d] lg:hidden">
            {/* ヘッダー */}
            <div className="flex items-center justify-between px-4 py-3">
              <p className="text-xs font-semibold tracking-wider text-white/50">プレビュー</p>
              <button
                type="button"
                onClick={() => setPreviewModalOpen(false)}
                className="grid h-8 w-8 place-items-center rounded-full bg-white/10 text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {/* 名刺プレビュー */}
            <div className="flex flex-1 items-center justify-center px-6">
              <div className="w-full max-w-xs overflow-hidden rounded-[30px] border border-white/10 shadow-2xl">
                <BusinessCardPreview
                  card={{ ...EMPTY_BUSINESS_CARD, ...previewGroup, name: "山田 太郎", title: "代表取締役" }}
                  logoPreviewUrl={previewGroup.logoUrl}
                  backgroundPreviewUrl={previewGroup.backgroundUrl}
                  qrValue="https://xenocard.app/preview"
                  textScale={1.0}
                  onLogoChange={
                    (group.logoUrl || groupLogoPreview)
                      ? ({ logoX, logoY, logoSize }) =>
                          setGroup((g) => ({ ...g, logoX, logoY, logoSize }))
                      : undefined
                  }
                  onTextAreaChange={({ textAreaX, textAreaY, textAreaWidth }) =>
                    setGroup((g) => ({ ...g, textAreaX, textAreaY, textAreaWidth }))
                  }
                />
              </div>
            </div>
            <p className="pb-4 text-center text-[11px] text-white/30">
              ロゴ・文字をドラッグ → 移動　右下◻️ → リサイズ（文字サイズ連動）
            </p>
          </div>
        )}

        {/* ── メンバー一覧 ── */}
        <section className="rounded-2xl border border-black/8 bg-white p-4 sm:p-6 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-black">メンバー一覧</h2>
            <div className="flex items-center gap-2">
              <Link
                href="/admin/scans"
                className="flex items-center gap-1.5 rounded-full border border-stone-300 bg-white px-4 py-2 text-xs font-semibold text-black transition hover:bg-stone-100"
              >
                <Images className="h-3.5 w-3.5" />
                名刺一覧
              </Link>
              <button
                type="button"
                onClick={() => { setShowAddForm((v) => !v); setAddError(""); }}
                className="flex items-center gap-1.5 rounded-full bg-stone-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-black"
              >
                <Plus className="h-3.5 w-3.5" />
                メンバー追加
              </button>
            </div>
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
                  <p className="text-xs font-semibold text-black/40">個人情報</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {MEMBER_FIELDS.map((f) => (
                      <label key={f.name} className={`block${f.wide ? " sm:col-span-2" : ""}`}>
                        <span className="text-xs font-semibold text-black">{f.label}</span>
                        <input
                          type={f.type ?? "text"}
                          value={String(addPersonal[f.name] ?? "")}
                          onChange={(e) =>
                            setAddPersonal((p) => ({
                              ...p,
                              [f.name]: f.name === "phone" ? formatPhoneJP(e.target.value) : e.target.value,
                            }))
                          }
                          placeholder={f.placeholder}
                          className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-black outline-none focus:border-stone-500"
                        />
                      </label>
                    ))}
                  </div>
                </div>

                {/* プレビュー */}
                <div className="hidden lg:flex justify-center py-4">
                  <PhoneMockup width={200}>
                    <BusinessCardPreview card={addPreviewCard} qrValue={buildVCard(addPreviewCard)} fill textScale={1.0} />
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
                  <div className="px-4 py-3">
                    {/* 名前行 */}
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-stone-200">
                        <UserRound className="h-4 w-4 text-black" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <p className="truncate text-sm font-semibold text-black">{m.displayName || m.email}</p>
                          {m.isAdmin && (
                            <span className="shrink-0 rounded-full bg-stone-900 px-2 py-0.5 text-[10px] font-semibold text-white">
                              管理者
                            </span>
                          )}
                        </div>
                        {m.isAdmin ? (
                          <div className="mt-0.5 space-y-0.5">
                            <p className="truncate text-xs text-black/50">
                              <span className="text-black/30">ログイン用：</span>{m.email}
                            </p>
                            {m.card?.email && (
                              <p className="truncate text-xs text-black/50">
                                <span className="text-black/30">名刺用：</span>{m.card.email}
                              </p>
                            )}
                          </div>
                        ) : (
                          <p className="truncate text-xs text-black/50">{m.email}</p>
                        )}
                      </div>
                    </div>
                    {/* ボタン行 */}
                    <div className="mt-2.5 flex items-center justify-end gap-2">
                      {m.cardSlug && (
                        <>
                          {/* コピーボタン → ポップアップ */}
                          <div className="relative">
                            <button
                              type="button"
                              onClick={() => setCopyPopSlug(copyPopSlug === m.cardSlug ? null : m.cardSlug)}
                              className="flex items-center gap-1.5 rounded-full border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-stone-100"
                            >
                              <Copy className="h-3 w-3" />
                              コピー
                            </button>
                            {/* ポップアップ */}
                            {copyPopSlug === m.cardSlug && (
                              <>
                                {/* 背面タップで閉じる(全画面サイズ共通) */}
                                <button
                                  type="button"
                                  aria-label="コピーメニューを閉じる"
                                  onClick={() => setCopyPopSlug(null)}
                                  className="fixed inset-0 z-40 cursor-default bg-black/30 sm:bg-black/10"
                                />
                                <div
                                  role="dialog"
                                  aria-modal="true"
                                  aria-label="名刺をコピー"
                                  className="fixed inset-x-3 bottom-[max(1rem,env(safe-area-inset-bottom))] z-50 max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl border border-stone-200 bg-white p-3 shadow-2xl sm:absolute sm:inset-x-auto sm:bottom-full sm:right-0 sm:mb-2 sm:w-64 sm:max-h-none sm:overflow-visible sm:shadow-xl"
                                >
                                  <div className="mb-2 flex items-center justify-between px-1">
                                    <p className="text-xs font-semibold text-black">
                                      名刺をコピー
                                    </p>
                                    <button
                                      type="button"
                                      onClick={() => setCopyPopSlug(null)}
                                      className="grid h-8 w-8 place-items-center rounded-full bg-stone-100 text-black transition hover:bg-stone-200"
                                      aria-label="閉じる"
                                    >
                                      <X className="h-4 w-4" />
                                    </button>
                                  </div>

                                {/* ① URLコピー */}
                                <button
                                  type="button"
                                  onClick={() => handleCopy(m.cardSlug)}
                                  className="flex w-full items-center justify-between gap-2 rounded-xl bg-stone-50 px-3 py-2.5 text-left transition hover:bg-stone-100"
                                >
                                  <div className="min-w-0">
                                    <p className="text-[10px] font-semibold text-black/50">① URLをコピー</p>
                                    <p className="truncate text-xs font-medium text-black">{getCardUrl(m.cardSlug)}</p>
                                  </div>
                                  {copiedSlug === m.cardSlug
                                    ? <Check className="h-4 w-4 shrink-0 text-green-600" />
                                    : <Copy className="h-4 w-4 shrink-0 text-black/40" />}
                                </button>
                                {/* ② 文章コピー */}
                                <button
                                  type="button"
                                  onClick={() => handleCopyMessage(m.cardSlug, m.displayName)}
                                  className="mt-1.5 flex w-full items-center justify-between gap-2 rounded-xl bg-stone-50 px-3 py-2.5 text-left transition hover:bg-stone-100"
                                >
                                  <div className="min-w-0">
                                    <p className="text-[10px] font-semibold text-black/50">② 文章をコピー</p>
                                    <p className="line-clamp-2 text-xs text-black/70">
                                      {m.displayName}のデジタル名刺はこちらからご確認いただけます。※ブラウザで開いてブックマークに登録しておくと便利です。
                                    </p>
                                  </div>
                                  {copiedMsgSlug === m.cardSlug
                                    ? <Check className="h-4 w-4 shrink-0 text-green-600" />
                                    : <Copy className="h-4 w-4 shrink-0 text-black/40" />}
                                </button>

                                {/* ③ 本人用リンク(名刺取り込み) */}
                                <button
                                  type="button"
                                  onClick={() => handleCopyOwnerLink(m.cardSlug)}
                                  className="mt-1.5 flex w-full items-center justify-between gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-left transition hover:bg-amber-100"
                                >
                                  <div className="min-w-0">
                                    <p className="text-[10px] font-semibold text-amber-700">③ 本人用リンクをコピー（名刺取り込み用）</p>
                                    <p className="line-clamp-2 text-xs text-black/70">
                                      本人だけに渡す専用リンク。開くと取り込んだ名刺がサーバー保存になり、端末が変わっても引き継げます。
                                    </p>
                                  </div>
                                  {copiedOwnerSlug === m.cardSlug
                                    ? <Check className="h-4 w-4 shrink-0 text-green-600" />
                                    : <Copy className="h-4 w-4 shrink-0 text-black/40" />}
                                </button>

                                {/* iPhone向けの使い方ヒント */}
                                <p className="mt-2 rounded-xl bg-stone-100 px-3 py-2.5 text-[10px] leading-relaxed text-black/55">
                                  📱 iPhoneの場合：URLをコピーしてSafariに貼り付けて開き、共有ボタン →「ホーム画面に追加」をしておくと、アプリのようにワンタップで名刺を開けて便利です。
                                </p>
                                </div>
                              </>
                            )}
                          </div>
                          {/* メール送信 */}
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
                            <label key={f.name} className={`block${f.wide ? " sm:col-span-2" : ""}`}>
                              <span className="text-xs font-semibold text-black">{f.label}</span>
                              <input
                                type={f.type ?? "text"}
                                value={String(editPersonal[f.name] ?? "")}
                                onChange={(e) =>
                                  setEditPersonal((p) => ({
                                    ...p,
                                    [f.name]: f.name === "phone" ? formatPhoneJP(e.target.value) : e.target.value,
                                  }))
                                }
                                placeholder={f.placeholder}
                                className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-black outline-none focus:border-stone-500"
                              />
                            </label>
                          ))}
                          {/* 保存ボタン（モバイルのみ表示） */}
                          <div className="sm:col-span-2 lg:hidden">
                            {saveMsg && (
                              <p className={`mb-2 text-xs font-semibold ${saveMsg === "保存しました" ? "text-green-600" : "text-red-600"}`}>
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

                        <div className="hidden lg:flex flex-col items-center gap-3">
                          <div className="py-4">
                            <PhoneMockup width={190}>
                              <BusinessCardPreview
                                card={editPreviewCard}
                                qrValue={buildVCard(editPreviewCard)}
                                fill
                                textScale={1.0}
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

      {/* コピー完了トースト */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2">
          <div className="flex items-center gap-2 rounded-full bg-stone-900 px-5 py-2.5 text-sm font-semibold text-white shadow-xl">
            <Check className="h-4 w-4 text-green-400" />
            {toast}
          </div>
        </div>
      )}
    </main>
  );
}
