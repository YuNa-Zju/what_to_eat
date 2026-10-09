// Keep memory and network usage bounded when six full-size photos are selected.
export function uploadQueue(concurrency = 2) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= concurrency) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

export async function compressPhoto(file: File, signal: AbortSignal): Promise<Blob> {
  signal.throwIfAborted();
  let source: CanvasImageSource;
  let width: number;
  let height: number;
  let close: () => void;
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    source = bitmap;
    width = bitmap.width;
    height = bitmap.height;
    close = () => bitmap.close();
  } else {
    const image = new Image();
    const url = URL.createObjectURL(file);
    try {
      image.src = url;
      await image.decode();
    } finally {
      URL.revokeObjectURL(url);
    }
    source = image;
    width = image.naturalWidth;
    height = image.naturalHeight;
    close = () => {
      image.src = '';
    };
  }
  const canvas = document.createElement('canvas');
  try {
    signal.throwIfAborted();
    if (!width || !height || width * height > 25_000_000) {
      throw new Error('图片最多支持 2500 万像素，请缩小后上传');
    }
    let edge = Math.min(1280, Math.max(width, height));
    while (true) {
      signal.throwIfAborted();
      const scale = edge / Math.max(width, height);
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('浏览器无法处理照片，请换个浏览器重试');
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (value) => (value ? resolve(value) : reject(new Error('照片压缩失败，请重新添加'))),
          'image/webp',
          0.6,
        );
      });
      signal.throwIfAborted();
      // Browsers without WebP encoding return PNG; the server converts it.
      if (blob.size <= 300 * 1024 || edge <= 320) return blob;
      edge = Math.max(320, Math.floor(edge * 0.8));
    }
  } finally {
    close();
    canvas.width = canvas.height = 1;
  }
}
