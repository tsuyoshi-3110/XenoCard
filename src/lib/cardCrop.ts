// 名刺写真の四隅を自動推定し、台形補正(射影変換)でまっすぐ切り抜くための幾何処理。
// 外部ライブラリ不要。座標は画像に対する正規化値(0〜1)で扱う。

export type Point = { x: number; y: number };
export type Quad = { tl: Point; tr: Point; br: Point; bl: Point };

function insetQuad(margin: number): Quad {
  const a = margin;
  const b = 1 - margin;
  return {
    tl: { x: a, y: a },
    tr: { x: b, y: a },
    br: { x: b, y: b },
    bl: { x: a, y: b },
  };
}

function dist(p: Point, q: Point): number {
  return Math.hypot(p.x - q.x, p.y - q.y);
}

// 正規化四隅の面積(シューレース、0〜1)
function quadArea(q: Quad): number {
  const pts = [q.tl, q.tr, q.br, q.bl];
  let area = 0;
  for (let i = 0; i < 4; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2;
}

type SmallImage = { w: number; h: number; data: Uint8ClampedArray };
type Corners = { tl: Point; tr: Point; br: Point; bl: Point };

// 画像を縮小して画素配列を得る(検出処理の高速化のため)
function toSmallImage(img: HTMLImageElement, maxDim: number): SmallImage | null {
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(2, Math.round(img.naturalWidth * scale));
  const h = Math.max(2, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  return { w, h, data: ctx.getImageData(0, 0, w, h).data };
}

// 大津の二値化しきい値(0〜255)
function otsuThreshold(hist: Uint32Array, total: number): number {
  let sumAll = 0;
  for (let i = 0; i < 256; i += 1) sumAll += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let maxVar = -1;
  let threshold = 0;
  for (let t = 0; t < 256; t += 1) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) {
      maxVar = between;
      threshold = t;
    }
  }
  return threshold;
}

// 画像外周(背景とみなす)の中央値色を求める
function borderBackground(si: SmallImage, thickness: number): [number, number, number] {
  const { w, h, data } = si;
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const edge = x < thickness || x >= w - thickness || y < thickness || y >= h - thickness;
      if (!edge) continue;
      const i = (y * w + x) * 4;
      rs.push(data[i]);
      gs.push(data[i + 1]);
      bs.push(data[i + 2]);
    }
  }
  const median = (arr: number[]) => {
    arr.sort((a, b) => a - b);
    return arr[Math.floor(arr.length / 2)] || 0;
  };
  return [median(rs), median(gs), median(bs)];
}

// マスクの最大連結成分(4近傍)の四隅を返す
function largestComponentCorners(
  mask: Uint8Array,
  w: number,
  h: number,
): (Corners & { size: number }) | null {
  const total = w * h;
  const label = new Uint8Array(total);
  const stack = new Int32Array(total);
  let best: (Corners & { size: number }) | null = null;

  for (let start = 0; start < total; start += 1) {
    if (mask[start] === 0 || label[start] !== 0) continue;
    let sp = 0;
    stack[sp++] = start;
    label[start] = 1;
    let size = 0;
    let minSum = Infinity;
    let maxSum = -Infinity;
    let minDiff = Infinity;
    let maxDiff = -Infinity;
    let tl: Point = { x: 0, y: 0 };
    let tr: Point = { x: 0, y: 0 };
    let br: Point = { x: 0, y: 0 };
    let bl: Point = { x: 0, y: 0 };

    while (sp > 0) {
      const idx = stack[--sp];
      const x = idx % w;
      const y = (idx / w) | 0;
      size += 1;
      const s = x + y;
      const d = x - y;
      if (s < minSum) { minSum = s; tl = { x, y }; }
      if (s > maxSum) { maxSum = s; br = { x, y }; }
      if (d > maxDiff) { maxDiff = d; tr = { x, y }; }
      if (d < minDiff) { minDiff = d; bl = { x, y }; }

      if (x > 0) { const n = idx - 1; if (mask[n] && !label[n]) { label[n] = 1; stack[sp++] = n; } }
      if (x < w - 1) { const n = idx + 1; if (mask[n] && !label[n]) { label[n] = 1; stack[sp++] = n; } }
      if (y > 0) { const n = idx - w; if (mask[n] && !label[n]) { label[n] = 1; stack[sp++] = n; } }
      if (y < h - 1) { const n = idx + w; if (mask[n] && !label[n]) { label[n] = 1; stack[sp++] = n; } }
    }

    if (!best || size > best.size) best = { tl, tr, br, bl, size };
  }
  return best;
}

// 四隅(px)を正規化Quadにし、妥当性(面積・辺長)を確認する
function finalizeQuad(c: Corners, w: number, h: number): Quad | null {
  const quad: Quad = {
    tl: { x: c.tl.x / w, y: c.tl.y / h },
    tr: { x: c.tr.x / w, y: c.tr.y / h },
    br: { x: c.br.x / w, y: c.br.y / h },
    bl: { x: c.bl.x / w, y: c.bl.y / h },
  };
  const area = quadArea(quad);
  const minSide = Math.min(
    dist(quad.tl, quad.tr),
    dist(quad.tr, quad.br),
    dist(quad.br, quad.bl),
    dist(quad.bl, quad.tl),
  );
  if (area < 0.15 || area > 0.995 || minSide < 0.1) return null;
  return quad;
}

// 主手法: 外周を背景とみなし、色が異なる最大の塊(=名刺)を切り出す
function segmentQuad(si: SmallImage): Quad | null {
  const { w, h, data } = si;
  const [br, bg, bb] = borderBackground(si, Math.max(2, Math.round(Math.min(w, h) * 0.03)));

  const distMap = new Float32Array(w * h);
  const hist = new Uint32Array(256);
  const norm = 255 / 442;
  for (let p = 0, i = 0; p < w * h; p += 1, i += 4) {
    const dr = data[i] - br;
    const dg = data[i + 1] - bg;
    const db = data[i + 2] - bb;
    const dd = Math.sqrt(dr * dr + dg * dg + db * db);
    distMap[p] = dd;
    hist[Math.min(255, Math.round(dd * norm))] += 1;
  }
  const threshBin = otsuThreshold(hist, w * h);
  const threshDist = threshBin / norm;

  const mask = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p += 1) mask[p] = distMap[p] > threshDist ? 1 : 0;

  const comp = largestComponentCorners(mask, w, h);
  if (!comp || comp.size < w * h * 0.12) return null;
  return finalizeQuad(comp, w, h);
}

// 保険: Sobelエッジの (x±y) 端点から四隅を推定する
function sobelQuad(si: SmallImage): Quad | null {
  const { w, h, data } = si;
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  const mag = new Float32Array(w * h);
  let maxMag = 0;
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const idx = y * w + x;
      const gx =
        -gray[idx - w - 1] - 2 * gray[idx - 1] - gray[idx + w - 1] +
        gray[idx - w + 1] + 2 * gray[idx + 1] + gray[idx + w + 1];
      const gy =
        -gray[idx - w - 1] - 2 * gray[idx - w] - gray[idx - w + 1] +
        gray[idx + w - 1] + 2 * gray[idx + w] + gray[idx + w + 1];
      const m = Math.hypot(gx, gy);
      mag[idx] = m;
      if (m > maxMag) maxMag = m;
    }
  }
  if (maxMag <= 0) return null;

  const bins = 64;
  const hist = new Uint32Array(bins);
  let edgeTotal = 0;
  for (let i = 0; i < mag.length; i += 1) {
    if (mag[i] > 0) {
      hist[Math.min(bins - 1, Math.floor((mag[i] / maxMag) * bins))] += 1;
      edgeTotal += 1;
    }
  }
  const keep = edgeTotal * 0.1;
  let acc = 0;
  let threshBin = bins - 1;
  for (let b = bins - 1; b >= 0; b -= 1) {
    acc += hist[b];
    if (acc >= keep) { threshBin = b; break; }
  }
  const thr = (threshBin / bins) * maxMag;

  let minSum = Infinity;
  let maxSum = -Infinity;
  let minDiff = Infinity;
  let maxDiff = -Infinity;
  let tl: Point = { x: 0, y: 0 };
  let br: Point = { x: w, y: h };
  let tr: Point = { x: w, y: 0 };
  let bl: Point = { x: 0, y: h };
  let found = 0;
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      if (mag[y * w + x] < thr) continue;
      found += 1;
      const s = x + y;
      const d = x - y;
      if (s < minSum) { minSum = s; tl = { x, y }; }
      if (s > maxSum) { maxSum = s; br = { x, y }; }
      if (d > maxDiff) { maxDiff = d; tr = { x, y }; }
      if (d < minDiff) { minDiff = d; bl = { x, y }; }
    }
  }
  if (found < 20) return null;
  return finalizeQuad({ tl, tr, br, bl }, w, h);
}

// 名刺の四隅を自動推定する。
// まず背景色セグメンテーション、だめならSobelエッジ、最後は内側の矩形を返す(手動調整前提)。
export function detectCardQuad(img: HTMLImageElement): Quad {
  const fallback = insetQuad(0.08);
  try {
    const si = toSmallImage(img, 480);
    if (!si) return fallback;
    return segmentQuad(si) ?? sobelQuad(si) ?? fallback;
  } catch {
    return fallback;
  }
}

// 4点対応から射影変換行列(from→to)を解く。返り値は[a,b,c,d,e,f,g,h](i=1固定)
function solveHomography(from: Point[], to: Point[]): number[] {
  const A: number[][] = [];
  const B: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const { x, y } = from[i];
    const { x: X, y: Y } = to[i];
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]);
    B.push(X);
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]);
    B.push(Y);
  }
  // ガウス消去法(部分ピボット選択)
  const n = 8;
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
    }
    [A[col], A[pivot]] = [A[pivot], A[col]];
    [B[col], B[pivot]] = [B[pivot], B[col]];
    const diag = A[col][col] || 1e-9;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const factor = A[r][col] / diag;
      for (let c = col; c < n; c += 1) A[r][c] -= factor * A[col][c];
      B[r] -= factor * B[col];
    }
  }
  const h: number[] = [];
  for (let i = 0; i < n; i += 1) h.push(B[i] / (A[i][i] || 1e-9));
  return h;
}

// 正規化四隅で指定した領域を、台形補正してまっすぐな矩形canvasに描き出す
export function warpToCanvas(img: HTMLImageElement, quad: Quad): HTMLCanvasElement {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  const src: Point[] = [
    { x: quad.tl.x * nw, y: quad.tl.y * nh },
    { x: quad.tr.x * nw, y: quad.tr.y * nh },
    { x: quad.br.x * nw, y: quad.br.y * nh },
    { x: quad.bl.x * nw, y: quad.bl.y * nh },
  ];

  const wTop = dist(src[0], src[1]);
  const wBottom = dist(src[3], src[2]);
  const hLeft = dist(src[0], src[3]);
  const hRight = dist(src[1], src[2]);
  let outW = Math.round(Math.max(wTop, wBottom));
  let outH = Math.round(Math.max(hLeft, hRight));
  const cap = 1800;
  const shrink = Math.min(1, cap / Math.max(outW, outH, 1));
  outW = Math.max(1, Math.round(outW * shrink));
  outH = Math.max(1, Math.round(outH * shrink));

  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = nw;
  sourceCanvas.height = nh;
  const sctx = sourceCanvas.getContext("2d", { willReadFrequently: true });
  if (!sctx) throw new Error("画像処理を開始できませんでした。");
  sctx.drawImage(img, 0, 0);
  const sdata = sctx.getImageData(0, 0, nw, nh).data;

  const dst: Point[] = [
    { x: 0, y: 0 },
    { x: outW, y: 0 },
    { x: outW, y: outH },
    { x: 0, y: outH },
  ];
  // 出力座標→元画像座標 の写像
  const [a, b, c, d, e, f, g, hh] = solveHomography(dst, src);

  const out = document.createElement("canvas");
  out.width = outW;
  out.height = outH;
  const octx = out.getContext("2d");
  if (!octx) throw new Error("画像処理を開始できませんでした。");
  const outImage = octx.createImageData(outW, outH);
  const od = outImage.data;

  for (let y = 0; y < outH; y += 1) {
    for (let x = 0; x < outW; x += 1) {
      const denom = g * x + hh * y + 1;
      const sx = (a * x + b * y + c) / denom;
      const sy = (d * x + e * y + f) / denom;
      const oi = (y * outW + x) * 4;

      if (sx < 0 || sy < 0 || sx > nw - 1 || sy > nh - 1) {
        od[oi] = 255;
        od[oi + 1] = 255;
        od[oi + 2] = 255;
        od[oi + 3] = 255;
        continue;
      }
      // バイリニア補間
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(nw - 1, x0 + 1);
      const y1 = Math.min(nh - 1, y0 + 1);
      const fx = sx - x0;
      const fy = sy - y0;
      const i00 = (y0 * nw + x0) * 4;
      const i10 = (y0 * nw + x1) * 4;
      const i01 = (y1 * nw + x0) * 4;
      const i11 = (y1 * nw + x1) * 4;
      for (let ch = 0; ch < 3; ch += 1) {
        const top = sdata[i00 + ch] * (1 - fx) + sdata[i10 + ch] * fx;
        const bottom = sdata[i01 + ch] * (1 - fx) + sdata[i11 + ch] * fx;
        od[oi + ch] = top * (1 - fy) + bottom * fy;
      }
      od[oi + 3] = 255;
    }
  }
  octx.putImageData(outImage, 0, 0);
  return out;
}

export function canvasToWebpFile(
  canvas: HTMLCanvasElement,
  baseName: string,
  quality = 0.9,
): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("画像の変換に失敗しました。"));
          return;
        }
        resolve(
          new File([blob], `${baseName}.webp`, {
            type: "image/webp",
            lastModified: Date.now(),
          }),
        );
      },
      "image/webp",
      quality,
    );
  });
}
