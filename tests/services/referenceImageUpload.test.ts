import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareReferenceImageUpload } from '../../src/services/ai/referenceImageUpload';

function png(color = 2, extra?: 'tRNS' | 'acTL', width = 3648): Blob {
  const chunk = (name: string, data: Uint8Array) => {
    const bytes = new Uint8Array(data.length + 12);
    new DataView(bytes.buffer).setUint32(0, data.length);
    bytes.set(new TextEncoder().encode(name), 4);
    bytes.set(data, 8);
    return bytes;
  };
  const header = new Uint8Array(13);
  new DataView(header.buffer).setUint32(0, width);
  new DataView(header.buffer).setUint32(4, 2048);
  header[8] = 8; header[9] = color;
  return new Blob([
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    ...(extra ? [chunk(extra, new Uint8Array(8))] : []),
    chunk('IDAT', new Uint8Array(4 * 1024 * 1024)), chunk('IEND', new Uint8Array()),
  ], { type: 'image/png' });
}

const close = vi.fn();
const decode = vi.fn();
const draw = vi.fn();
const encode = vi.fn();
const sizes: number[][] = [];
beforeEach(() => {
  vi.clearAllMocks(); sizes.length = 0;
  decode.mockResolvedValue({ width: 3648, height: 2048, close });
  encode.mockResolvedValue(new Blob(['jpeg'], { type: 'image/jpeg' }));
  vi.stubGlobal('createImageBitmap', decode);
  vi.stubGlobal('OffscreenCanvas', class {
    constructor(width: number, height: number) { sizes.push([width, height]); }
    getContext() { return { drawImage: draw }; }
    convertToBlob = encode;
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('临时参考图上传副本', () => {
  it('大幅减少不透明 PNG 的传输体积，保留像素尺寸并释放解码资源', async () => {
    const original = png();
    const uploaded = await prepareReferenceImageUpload(original);
    expect(uploaded.type).toBe('image/jpeg');
    expect(uploaded.size).toBeLessThan(original.size);
    expect(sizes).toEqual([[3648, 2048]]);
    expect(encode).toHaveBeenCalledWith({ type: 'image/jpeg', quality: 0.95 });
    expect(close).toHaveBeenCalledOnce();
    expect(original.type).toBe('image/png');
  });

  it.each([png(6), png(2, 'tRNS'), png(2, 'acTL'), png(3), png(2, undefined, 20000)])(
    '透明、动画、索引色及超大图片保持原字节', async (original) => {
      expect(await prepareReferenceImageUpload(original)).toBe(original);
      expect(decode).not.toHaveBeenCalled();
    },
  );

  it('小图、JPEG 和不支持解码的运行时保持原字节', async () => {
    const small = new Blob(['png'], { type: 'image/png' });
    const jpeg = new Blob([new Uint8Array(5 * 1024 * 1024)], { type: 'image/jpeg' });
    expect(await prepareReferenceImageUpload(small)).toBe(small);
    expect(await prepareReferenceImageUpload(jpeg)).toBe(jpeg);
    vi.stubGlobal('createImageBitmap', undefined);
    const original = png();
    expect(await prepareReferenceImageUpload(original)).toBe(original);
  });

  it('压缩无收益或失败时保留原图', async () => {
    const original = png();
    encode.mockResolvedValueOnce(new Blob([new Uint8Array(original.size)], { type: 'image/jpeg' }));
    expect(await prepareReferenceImageUpload(original)).toBe(original);
    encode.mockRejectedValueOnce(new Error('encoder failed'));
    expect(await prepareReferenceImageUpload(original)).toBe(original);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('取消时停止处理且释放位图，不回退继续提交原图', async () => {
    const controller = new AbortController();
    encode.mockImplementationOnce(async () => {
      controller.abort();
      return new Blob(['jpeg'], { type: 'image/jpeg' });
    });
    await expect(prepareReferenceImageUpload(png(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(close).toHaveBeenCalledOnce();
  });
});
