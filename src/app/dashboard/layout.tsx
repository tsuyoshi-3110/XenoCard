import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "名刺編集 | XenoCard",
  description: "XenoCardの名刺情報とデザインを編集します。",
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

