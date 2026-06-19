type CompressOptions = {
  maxBytes: number;
  maxWidth: number;
  maxHeight: number;
};

function canvasToBlob(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("画像のWebP変換に失敗しました。"));
      },
      "image/webp",
      quality,
    );
  });
}

export async function compressImageToWebP(
  file: File,
  options: CompressOptions,
): Promise<File> {
  if (!file.type.startsWith("image/")) {
    throw new Error("画像ファイルを選択してください。");
  }

  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("画像を読み込めませんでした。"));
      element.src = objectUrl;
    });

    const initialScale = Math.min(
      1,
      options.maxWidth / image.naturalWidth,
      options.maxHeight / image.naturalHeight,
    );
    let width = Math.max(1, Math.round(image.naturalWidth * initialScale));
    let height = Math.max(1, Math.round(image.naturalHeight * initialScale));
    let result: Blob | null = null;

    for (let resizeAttempt = 0; resizeAttempt < 4; resizeAttempt += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("画像処理を開始できませんでした。");

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, width, height);

      for (const quality of [0.86, 0.76, 0.66, 0.56, 0.46]) {
        result = await canvasToBlob(canvas, quality);
        if (result.size <= options.maxBytes) break;
      }

      if (result && result.size <= options.maxBytes) break;
      width = Math.max(1, Math.round(width * 0.82));
      height = Math.max(1, Math.round(height * 0.82));
    }

    if (!result) throw new Error("画像を圧縮できませんでした。");

    const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
    return new File([result], `${baseName}.webp`, {
      type: "image/webp",
      lastModified: Date.now(),
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

