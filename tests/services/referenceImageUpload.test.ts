import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mapReferenceImagesInOrder, prepareReferenceImageUpload } from '../../src/services/ai/referenceImageUpload';

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

function jpeg(width = 3840, height = 2160): Blob {
  return new Blob([Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03,
    0x01, 0x11, 0x00,
    0x02, 0x11, 0x00,
    0x03, 0x11, 0x00,
    0xff, 0xd9,
  ])], { type: 'image/jpeg' });
}

function webp(width = 3840, height = 2160, flags = 0): Blob {
  const bytes = new Uint8Array(30);
  bytes.set(new TextEncoder().encode('RIFF'), 0);
  bytes.set(new TextEncoder().encode('WEBP'), 8);
  bytes.set(new TextEncoder().encode('VP8X'), 12);
  bytes[20] = flags;
  const writeU24 = (offset: number, value: number) => {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >> 8) & 0xff;
    bytes[offset + 2] = (value >> 16) & 0xff;
  };
  writeU24(24, width - 1);
  writeU24(27, height - 1);
  return new Blob([bytes], { type: 'image/webp' });
}

const close = vi.fn();
const decode = vi.fn();
const draw = vi.fn();
const encode = vi.fn();
const readPixels = vi.fn();
const sizes: number[][] = [];
beforeEach(() => {
  vi.clearAllMocks(); sizes.length = 0;
  decode.mockResolvedValue({ width: 3648, height: 2048, close });
  encode.mockResolvedValue(new Blob(['jpeg'], { type: 'image/jpeg' }));
  readPixels.mockImplementation((_x, _y, width, height) => ({ data: new Uint8ClampedArray(width * height * 4).fill(255) }));
  vi.stubGlobal('createImageBitmap', decode);
  vi.stubGlobal('OffscreenCanvas', class {
    constructor(width: number, height: number) { sizes.push([width, height]); }
    getContext() { return { drawImage: draw, getImageData: readPixels }; }
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

  it('将 4K PNG 等比缩到 2K 长边后再编码', async () => {
    const original = png(2, undefined, 3840);
    decode.mockImplementationOnce(async (_blob, options?: ImageBitmapOptions) => ({
      width: options?.resizeWidth ?? 3840,
      height: options?.resizeHeight ?? 2048,
      close,
    }));

    const uploaded = await prepareReferenceImageUpload(original);

    expect(uploaded.type).toBe('image/jpeg');
    expect(decode).toHaveBeenCalledWith(original, {
      resizeWidth: 2048,
      resizeHeight: 1092,
      resizeQuality: 'high',
    });
    expect(sizes).toEqual([[2048, 1092]]);
    expect(draw).toHaveBeenCalledWith(expect.any(Object), 0, 0, 2048, 1092);
  });

  it('小体积 4K JPEG 也会缩到 2K，而普通 JPEG 不做无意义重编码', async () => {
    const original = jpeg();
    decode.mockImplementationOnce(async (_blob, options?: ImageBitmapOptions) => ({
      width: options?.resizeWidth ?? 3840,
      height: options?.resizeHeight ?? 2160,
      close,
    }));

    expect((await prepareReferenceImageUpload(original)).type).toBe('image/jpeg');
    expect(decode).toHaveBeenCalledWith(original, {
      resizeWidth: 2048,
      resizeHeight: 1152,
      resizeQuality: 'high',
    });
    expect(sizes).toEqual([[2048, 1152]]);
  });

  it('静态 4K WebP 会缩放，动画 WebP 保留原字节', async () => {
    const still = webp();
    decode.mockImplementationOnce(async (_blob, options?: ImageBitmapOptions) => ({
      width: options?.resizeWidth ?? 3840,
      height: options?.resizeHeight ?? 2160,
      close,
    }));

    expect((await prepareReferenceImageUpload(still)).type).toBe('image/jpeg');
    expect(sizes).toEqual([[2048, 1152]]);
    const animated = webp(3840, 2160, 0x02);
    expect(await prepareReferenceImageUpload(animated)).toBe(animated);
    expect(decode).toHaveBeenCalledOnce();
  });

  it('4K 透明 PNG 缩放后仍输出 PNG', async () => {
    const original = png(6, undefined, 3840);
    decode.mockImplementationOnce(async (_blob, options?: ImageBitmapOptions) => ({
      width: options?.resizeWidth ?? 3840,
      height: options?.resizeHeight ?? 2048,
      close,
    }));
    readPixels.mockImplementation((_x, _y, width, height) => {
      const data = new Uint8ClampedArray(width * height * 4).fill(255);
      data[data.length - 1] = 0;
      return { data };
    });
    encode.mockImplementationOnce(async (options: ImageEncodeOptions) => (
      new Blob(['png'], { type: options.type })
    ));

    const uploaded = await prepareReferenceImageUpload(original);

    expect(uploaded.type).toBe('image/png');
    expect(encode).toHaveBeenCalledWith({ type: 'image/png' });
    expect(sizes).toEqual([[2048, 1092]]);
  });

  it.each([png(2, 'acTL'), png(3), png(2, undefined, 20000)])(
    '动画、索引色及超大图片保持原字节', async (original) => {
      expect(await prepareReferenceImageUpload(original)).toBe(original);
      expect(decode).not.toHaveBeenCalled();
    },
  );

  it.each([png(6), png(2, 'tRNS')])('声明 alpha 但像素全不透明时仍可压缩', async (original) => {
    expect((await prepareReferenceImageUpload(original)).type).toBe('image/jpeg');
    expect(readPixels).toHaveBeenCalledTimes(16);
    expect(readPixels.mock.calls.every((args) => args[3] <= 128)).toBe(true);
    expect(close).toHaveBeenCalledOnce();
  });

  it.each([0, 254])('保留任何真实透明像素，包括 alpha=%s', async (alpha) => {
    readPixels.mockImplementation((_x, y, width, height) => {
      const data = new Uint8ClampedArray(width * height * 4).fill(255);
      if (y === 1920) data[data.length - 1] = alpha;
      return { data };
    });
    const original = png(6);
    expect(await prepareReferenceImageUpload(original)).toBe(original);
    expect(encode).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it('alpha 检测失败时保留原图', async () => {
    readPixels.mockImplementationOnce(() => { throw new Error('unavailable'); });
    const original = png(6);
    expect(await prepareReferenceImageUpload(original)).toBe(original);
    expect(encode).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

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
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
  });

  it('跨调用共用一个解码槽，排队取消不解码，也不抢占仍在编码的槽', async () => {
    let release!: (blob: Blob) => void;
    encode.mockImplementationOnce(() => new Promise<Blob>((resolve) => { release = resolve; }));
    const first = prepareReferenceImageUpload(png());
    await vi.waitFor(() => expect(encode).toHaveBeenCalledOnce());
    const controller = new AbortController();
    const cancelled = prepareReferenceImageUpload(png(), controller.signal);
    const stopped = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    const third = prepareReferenceImageUpload(png());
    controller.abort();
    await stopped;
    expect(decode).toHaveBeenCalledOnce();
    release(new Blob(['first'], { type: 'image/jpeg' }));
    expect(await (await first).text()).toBe('first');
    expect(await (await third).text()).toBe('jpeg');
    expect(decode).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('双并发乱序完成仍保留每个引用的位置和重复项', async () => {
    const releases: Array<() => void> = [];
    const started: number[] = [];
    const pending = mapReferenceImagesInOrder(['A', 'B', 'A'], async (value, index) => {
      started.push(index);
      await new Promise<void>((resolve) => { releases[index] = resolve; });
      return value;
    });
    expect(started).toEqual([0, 1]);
    releases[1]();
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2]));
    releases[2](); releases[0]();
    expect(await pending).toEqual(['A', 'B', 'A']);
  });

  it('取消正在编码的图片后，后续图片等资源真正释放才解码', async () => {
    let release!: (blob: Blob) => void;
    encode.mockImplementationOnce(() => new Promise<Blob>((resolve) => { release = resolve; }));
    const controller = new AbortController();
    const active = prepareReferenceImageUpload(png(), controller.signal);
    await vi.waitFor(() => expect(encode).toHaveBeenCalledOnce());
    const stopped = expect(active).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await stopped;
    const next = prepareReferenceImageUpload(png());
    await Promise.resolve();
    expect(decode).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    release(new Blob(['cancelled'], { type: 'image/jpeg' }));
    expect(await (await next).text()).toBe('jpeg');
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('失败或取消时不领取后续图片，不返回删掉失败项的数组', async () => {
    const prepare = vi.fn(async (value: string) => { if (value === 'A') throw new Error('读取失败'); return value; });
    await expect(mapReferenceImagesInOrder(['A', 'B', 'C'], prepare)).rejects.toThrow('读取失败');
    expect(prepare).toHaveBeenCalledTimes(2);
    const controller = new AbortController();
    const cancel = vi.fn(async () => { controller.abort(); return 'image'; });
    await expect(mapReferenceImagesInOrder(['A', 'B', 'C'], cancel, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancel).toHaveBeenCalledOnce();
  });
});
