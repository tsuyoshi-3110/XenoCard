import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "マイ名刺 | XenoCard",
  description: "営業時にそのまま提示できる全画面デジタル名刺です。",
};

export default function MyCardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

