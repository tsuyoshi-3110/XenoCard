import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/auth/AuthProvider";
import PwaRegister from "@/components/PwaRegister";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  ),
  title: {
    default: "XenoCard",
    template: "%s | XenoCard",
  },
  description: "QRコード付きデジタル名刺を表示・管理するPWAアプリ",
  openGraph: {
    title: "XenoCard",
    description: "QRコード付きデジタル名刺を表示・管理するPWAアプリ",
    images: [
      {
        url: "/ogpLogo-1200x630.png",
        width: 1200,
        height: 630,
        alt: "XenoCard OGP",
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "XenoCard",
    description: "QRコード付きデジタル名刺を表示・管理するPWAアプリ",
    images: ["/ogpLogo-1200x630.png"],
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "XenoCard",
  },
  icons: {
    apple: "/xenocard-192.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className="bg-black text-stone-900 antialiased"
      >
        <PwaRegister />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
