import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "デジタル名刺 | XenoCard",
  description: "名刺の閲覧とvCard形式での連絡先保存ができます。",
};

export default function PublicCardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

