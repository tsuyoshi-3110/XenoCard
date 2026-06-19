type Props = {
  children: React.ReactNode;
  width?: number;
};

export default function PhoneMockup({ children, width = 220 }: Props) {
  const h = Math.round(width * 2.17);
  // px固定でiPhone的な円形コーナー（%指定は縦長の要素で楕円になる）
  const bodyR = Math.round(width * 0.145); // ~32px at 220px
  const screenR = Math.round(bodyR * 0.82);  // ~26px

  return (
    <div
      className="relative mx-auto"
      style={{ width, height: h }}
    >
      {/* ドロップシャドウ */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          borderRadius: bodyR,
          boxShadow: "0 24px 60px rgba(0,0,0,0.52), 0 8px 20px rgba(0,0,0,0.32)",
        }}
      />

      {/* 本体 */}
      <div
        className="absolute inset-0"
        style={{
          borderRadius: bodyR,
          background:
            "linear-gradient(165deg,#484848 0%,#2a2a2c 28%,#1a1a1c 60%,#111 100%)",
          boxShadow:
            "inset 0 0 0 1px rgba(255,255,255,0.14), inset 0 1px 0 rgba(255,255,255,0.20)",
        }}
      />

      {/* 左フレーム光沢 */}
      <div
        className="pointer-events-none absolute"
        style={{
          top: "14%",
          bottom: "14%",
          left: 1.5,
          width: 1,
          borderRadius: 99,
          background:
            "linear-gradient(to bottom,transparent,rgba(255,255,255,0.16) 30%,rgba(255,255,255,0.08) 70%,transparent)",
        }}
      />

      {/* 左ボタン: マナーモード */}
      <div
        className="absolute"
        style={{
          left: -4,
          top: "15.5%",
          width: 4,
          height: "5.5%",
          background: "linear-gradient(to right,#181818,#2a2a2a)",
          borderRadius: "2px 0 0 2px",
          boxShadow: "-1px 0 3px rgba(0,0,0,0.55)",
        }}
      />
      {/* 左ボタン: 音量＋ */}
      <div
        className="absolute"
        style={{
          left: -4,
          top: "24%",
          width: 4,
          height: "9%",
          background: "linear-gradient(to right,#181818,#2a2a2a)",
          borderRadius: "2px 0 0 2px",
          boxShadow: "-1px 0 3px rgba(0,0,0,0.55)",
        }}
      />
      {/* 左ボタン: 音量－ */}
      <div
        className="absolute"
        style={{
          left: -4,
          top: "35%",
          width: 4,
          height: "9%",
          background: "linear-gradient(to right,#181818,#2a2a2a)",
          borderRadius: "2px 0 0 2px",
          boxShadow: "-1px 0 3px rgba(0,0,0,0.55)",
        }}
      />
      {/* 右ボタン: 電源 */}
      <div
        className="absolute"
        style={{
          right: -4,
          top: "25%",
          width: 4,
          height: "13%",
          background: "linear-gradient(to left,#181818,#2a2a2a)",
          borderRadius: "0 2px 2px 0",
          boxShadow: "1px 0 3px rgba(0,0,0,0.55)",
        }}
      />

      {/* スクリーン */}
      <div
        className="absolute overflow-hidden"
        style={{
          top: "2.0%",
          left: "4%",
          right: "4%",
          bottom: "2.0%",
          borderRadius: screenR,
          background: "#000",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.07)",
        }}
      >
        {/* Dynamic Island */}
        <div
          className="absolute left-1/2 z-20 -translate-x-1/2"
          style={{
            top: "1.6%",
            width: "31%",
            height: "3.5%",
            background: "#000",
            borderRadius: 99,
          }}
        />

        {/* コンテンツ（h-full で画面を埋める） */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="h-full w-full">{children}</div>
        </div>

        {/* ホームバー */}
        <div
          className="absolute bottom-0 left-0 right-0 z-20 flex justify-center"
          style={{ paddingBottom: "2%" }}
        >
          <div
            style={{
              width: "33%",
              height: 4,
              borderRadius: 99,
              background: "rgba(255,255,255,0.30)",
            }}
          />
        </div>
      </div>

      {/* 本体エッジ下グロウ */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          borderRadius: bodyR,
          boxShadow: "inset 0 -1px 1px rgba(0,0,0,0.6)",
        }}
      />
    </div>
  );
}
