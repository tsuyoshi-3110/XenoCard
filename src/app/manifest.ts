import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "XenoCard - デジタル名刺",
    short_name: "XenoCard",
    description: "QRコード付きデジタル名刺を表示・管理するアプリ",
    // start_urlは指定しない: ホーム画面に追加した時に開いていたページで起動させる
    // (固定するとログイン必須ページに飛ばされてしまう)
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    orientation: "portrait",
    icons: [
      {
        src: "/xenocard-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/xenocard-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

