import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "デジタル名刺 | XenoCard",
};

export default function MemberLayout({ children }: { children: React.ReactNode }) {
  return children;
}
