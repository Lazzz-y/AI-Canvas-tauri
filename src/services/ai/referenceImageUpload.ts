const MIN_REENCODE_BYTES = 4 * 1024 * 1024;
const MAX_REENCODE_PIXELS = 24_000_000;

/** 只接受 8 位 RGB 静态 PNG；透明、动画和未知格式保留原始字节。 */
function canReencodePng(bytes: Uint8Array): boolean {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 33 || !signature.every((value, index) => bytes[index] === value)) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452 || bytes[24] !== 8 || bytes[25] !== 2) return false;
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (!width || !height || width * height > MAX_REENCODE_PIXELS) return false;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = view.getUint32(offset);
    const type = view.getUint32(offset + 4);
    if (offset + length + 12 > bytes.length) return false;
    if (type === 0x74524e53 || type === 0x6163544c) return false; // tRNS / acTL
    if (type === 0x49454e44) return length === 0; // IEND
    offset += length + 12;
  }
  return false;
}

/** 仅压缩临时上传副本：不降尺寸，保留原文件；无法安全转换时沿用原图。 */
export async function prepareReferenceImageUpload(blob: Blob, signal?: AbortSignal): Promise<Blob> {
  signal?.throwIfAborted();
  if (blob.type !== 'image/png' || blob.size <= MIN_REENCODE_BYTES
    || typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return blob;
  let bitmap: ImageBitmap | undefined;
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    signal?.throwIfAborted();
    if (!canReencodePng(bytes)) return blob;
    bitmap = await createImageBitmap(blob);
    signal?.throwIfAborted();
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    if (!context) return blob;
    context.drawImage(bitmap, 0, 0);
    const encoded = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
    signal?.throwIfAborted();
    return encoded.type === 'image/jpeg' && encoded.size > 0 && encoded.size < blob.size * 0.8 ? encoded : blob;
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
    return blob;
  } finally {
    bitmap?.close();
  }
}
