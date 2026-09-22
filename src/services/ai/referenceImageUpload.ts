import { readRasterImageDimensions } from '../rasterImageDimensions';

export const MIN_REFERENCE_REENCODE_BYTES = 4 * 1024 * 1024;
export const FOUR_K_REFERENCE_LONG_EDGE = 3840;
export const TWO_K_REFERENCE_LONG_EDGE = 2048;
const MAX_REENCODE_PIXELS = 24_000_000;
let compressionTail: Promise<unknown> = Promise.resolve();

/** 只接受 8 位 RGB/RGBA 静态 PNG；动画和未知格式保留原始字节。 */
function inspectPng(bytes: Uint8Array): { checkAlpha: boolean } | undefined {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 33 || !signature.every((value, index) => bytes[index] === value)) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452 || bytes[24] !== 8 || ![2, 6].includes(bytes[25])) return;
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (!width || !height || width * height > MAX_REENCODE_PIXELS) return;
  let checkAlpha = bytes[25] === 6;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = view.getUint32(offset);
    const type = view.getUint32(offset + 4);
    if (offset + length + 12 > bytes.length || type === 0x6163544c) return; // acTL
    if (type === 0x74524e53) checkAlpha = true; // tRNS
    if (type === 0x49454e44) return length === 0 ? { checkAlpha } : undefined; // IEND
    offset += length + 12;
  }
}

function inspectWebp(bytes: Uint8Array): { checkAlpha: boolean } | undefined {
  if (bytes.length < 21
    || String.fromCharCode(...bytes.subarray(0, 4)) !== 'RIFF'
    || String.fromCharCode(...bytes.subarray(8, 12)) !== 'WEBP') return;
  const chunk = String.fromCharCode(...bytes.subarray(12, 16));
  if (chunk === 'VP8X') {
    if ((bytes[20] & 0x02) !== 0) return; // animated WebP
    return { checkAlpha: (bytes[20] & 0x10) !== 0 };
  }
  if (chunk === 'VP8L') return { checkAlpha: true };
  if (chunk === 'VP8 ') return { checkAlpha: false };
}

function targetSize(width: number, height: number): { width: number; height: number } | undefined {
  const longEdge = Math.max(width, height);
  if (longEdge < FOUR_K_REFERENCE_LONG_EDGE || width * height > MAX_REENCODE_PIXELS) return;
  const scale = TWO_K_REFERENCE_LONG_EDGE / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function hasTransparentPixels(
  context: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  signal?: AbortSignal,
): Promise<boolean> {
  // 分条读取 alpha，避免再分配整张 RGBA；允许取消消息进入事件循环。
  for (let y = 0; y < height; y += 128) {
    signal?.throwIfAborted();
    const { data } = context.getImageData(0, y, width, Math.min(128, height - y));
    for (let index = 3; index < data.length; index += 4) {
      if (data[index] !== 255) return true;
    }
    if (y % 512 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return false;
}

async function compressReferenceImage(
  blob: Blob,
  resize: { width: number; height: number } | undefined,
  signal?: AbortSignal,
): Promise<Blob> {
  let bitmap: ImageBitmap | undefined;
  let canvas: OffscreenCanvas | undefined;
  try {
    signal?.throwIfAborted();
    const mimeType = blob.type.split(';')[0].trim().toLowerCase();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    signal?.throwIfAborted();
    const metadata = mimeType === 'image/png'
      ? inspectPng(bytes)
      : mimeType === 'image/webp'
        ? inspectWebp(bytes)
        : mimeType === 'image/jpeg' || mimeType === 'image/jpg'
          ? { checkAlpha: false }
          : undefined;
    if (!metadata) return blob;
    bitmap = resize
      ? await createImageBitmap(blob, {
          resizeWidth: resize.width,
          resizeHeight: resize.height,
          resizeQuality: 'high',
        })
      : await createImageBitmap(blob);
    signal?.throwIfAborted();
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > MAX_REENCODE_PIXELS) return blob;
    const outputWidth = resize?.width ?? bitmap.width;
    const outputHeight = resize?.height ?? bitmap.height;
    canvas = new OffscreenCanvas(outputWidth, outputHeight);
    const context = canvas.getContext('2d');
    if (!context) return blob;
    context.drawImage(bitmap, 0, 0, outputWidth, outputHeight);
    const transparent = metadata.checkAlpha
      ? await hasTransparentPixels(context, outputWidth, outputHeight, signal)
      : false;
    if (transparent && !resize) return blob;
    signal?.throwIfAborted();
    const encoded = transparent
      ? await canvas.convertToBlob({ type: 'image/png' })
      : await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
    signal?.throwIfAborted();
    if (!encoded.size || (transparent ? encoded.type !== 'image/png' : encoded.type !== 'image/jpeg')) {
      return blob;
    }
    return resize || encoded.size < blob.size * 0.8 ? encoded : blob;
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
    return blob;
  } finally {
    bitmap?.close();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}

/** 仅压缩上传副本；所有调用方共用一个解码槽，取消不提前释放仍在编码的槽。 */
export async function prepareReferenceImageUpload(blob: Blob, signal?: AbortSignal): Promise<Blob> {
  signal?.throwIfAborted();
  const mimeType = blob.type.split(';')[0].trim().toLowerCase();
  if (!['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(mimeType)
    || typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return blob;
  const dimensions = await readRasterImageDimensions(blob).catch(() => null);
  signal?.throwIfAborted();
  const resize = dimensions ? targetSize(dimensions.width, dimensions.height) : undefined;
  const shouldCompressLargePng = mimeType === 'image/png' && blob.size > MIN_REFERENCE_REENCODE_BYTES;
  if (!resize && !shouldCompressLargePng) return blob;
  const operation = compressionTail.then(() => compressReferenceImage(blob, resize, signal));
  compressionTail = operation.catch(() => undefined);
  if (!signal) return operation;
  return new Promise<Blob>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    if (signal.aborted) onAbort();
  });
}

/** 最多同时准备两张，按原下标存放；失败停止领取新图，禁止过滤后发送错位的引用。 */
export async function mapReferenceImagesInOrder<T, R>(
  inputs: readonly T[],
  prepare: (input: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  signal?.throwIfAborted();
  const results = new Array<R>(inputs.length);
  let nextIndex = 0;
  let failed = false;
  let failure: unknown;
  const worker = async () => {
    while (!failed && nextIndex < inputs.length) {
      const index = nextIndex++;
      try {
        signal?.throwIfAborted();
        results[index] = await prepare(inputs[index], index);
        signal?.throwIfAborted();
      } catch (error) {
        if (!failed) failure = error;
        failed = true;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, inputs.length) }, worker));
  if (failed) throw failure;
  return results;
}
