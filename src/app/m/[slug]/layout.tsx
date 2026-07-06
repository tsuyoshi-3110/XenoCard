import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "デジタル名刺 | XenoCard",
  description: "名刺の閲覧とvCard形式での連絡先保存ができます。",
  openGraph: {
    images: [
      {
        url: "/ogpLogo-1200x630.png",
        width: 1200,
        height: 630,
        alt: "XenoCard OGP",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/ogpLogo-1200x630.png"],
  },
};

export default function MemberLayout({ children }: { children: React.ReactNode }) {
  return children;
}
