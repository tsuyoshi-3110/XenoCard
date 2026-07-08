// 撮影した名刺写真の反射・色かぶりを抑え、書類スキャン風に見やすく補正する。
// 外部ライブラリ不要のCanvas処理。チャンネルごとのオートレベル(パーセンタイル)で
// 紙の白を持ち上げ、照明の色かぶりとテカリを軽減する。

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("画像を読み込めませんでした。"));
    image.src = src;
  });
}

function canvasToWebp(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("画像の変換に失敗しました。"))),
      "image/webp",
      quality,
    );
  });
}

// ヒストグラムから累積割合 p (0〜1) に達する輝度値を返す
function percentile(hist: Uint32Array, total: number, p: number): number {
  const target = total * p;
  let sum = 0;
  for (let v = 0; v < 256; v += 1) {
    sum += hist[v];
    if (sum >= target) return v;
  }
  return 255;
}

// 入力lo〜hiを0〜255へ伸張し、軽いガンマで中間調を持ち上げるLUT
function buildLut(lo: number, hi: number, gamma: number): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);
  const range = Math.max(1, hi - lo);
  for (let v = 0; v < 256; v += 1) {
    const normalized = Math.min(1, Math.max(0, (v - lo) / range));
    lut[v] = Math.round(Math.pow(normalized, gamma) * 255);
  }
  return lut;
}

export async function enhanceCardImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) {
    throw new Error("画像ファイルを選択してください。");
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    const maxDimension = 2200;
    const scale = Math.min(
      1,
      maxDimension / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("画像処理を開始できませんでした。");

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, width, height);

    const imageData = context.getImageData(0, 0, width, height);
    const data = imageData.data;

    // チャンネルごとのヒストグラム(高速化のため間引きサンプリング)
    const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    const pixelCount = width * height;
    const stride = 4 * Math.max(1, Math.floor(pixelCount / 200000));
    let sampled = 0;
    for (let i = 0; i < data.length; i += stride) {
      hist[0][data[i]] += 1;
      hist[1][data[i + 1]] += 1;
      hist[2][data[i + 2]] += 1;
      sampled += 1;
    }

    const gamma = 0.9; // 中間調をやや明るく
    const luts: Uint8ClampedArray[] = [];
    for (let channel = 0; channel < 3; channel += 1) {
      let lo = percentile(hist[channel], sampled, 0.02);
      let hi = percentile(hist[channel], sampled, 0.985);
      // 伸張しすぎ・破綻の防止
      if (hi - lo < 24) {
        lo = 0;
        hi = 255;
      }
      luts.push(buildLut(lo, hi, gamma));
    }

    for (let i = 0; i < data.length; i += 4) {
      data[i] = luts[0][data[i]];
      data[i + 1] = luts[1][data[i + 1]];
      data[i + 2] = luts[2][data[i + 2]];
    }
    context.putImageData(imageData, 0, 0);

    const blob = await canvasToWebp(canvas, 0.85);
    const baseName = file.name.replace(/\.[^.]+$/, "") || "card";
    return new File([blob], `${baseName}-scan.webp`, {
      type: "image/webp",
      lastModified: Date.now(),
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

// FileをdataURL(base64)へ変換(OCR送信用)
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("画像を読み込めませんでした。"));
    reader.readAsDataURL(file);
  });
}
