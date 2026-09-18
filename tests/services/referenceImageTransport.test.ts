import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ transport: vi.fn(), invoke: vi.fn(), native: false }));
vi.mock('../../src/services/ai/httpTransport', () => ({ corsSafeFetch: mocks.transport }));
vi.mock('@tauri-apps/api/core', async (original) => ({ ...await original<object>(), invoke: mocks.invoke }));
vi.mock('../../src/services/fs/core', async (original) => ({
  ...await original<object>(), isTauriEnv: () => mocks.native,
  getAssetUrlFromPath: async () => 'asset://localhost/native-reference.png',
}));

import { generateImagesBatch } from '../../src/services/ai/generateImage';
import { resolveImageDataUrlArray, resolveImageUrlArray } from '../../src/services/ai/imageUtils';
import { generateImageStandard } from '../../src/services/ai/providers/standardImage';
import { uploadRunningHubMedia } from '../../src/services/ai/providers/runninghubClient';
import { resolveMediaReferenceUrl, uploadToRemote } from '../../src/services/uploadService';
import { previewModelProtocolRequest } from '../../src/services/ai/modelProtocol';
import { useAppStore } from '../../src/store/useAppStore';

// 请求链测试模拟浏览器编解码，标记每张图片身份；真实保真不由这些合成夹具证明。
function png(marker: number, megabytes = 5): Blob {
  const chunk = (name: string, payload: Uint8Array) => {
    const bytes = new Uint8Array(payload.length + 12);
    new DataView(bytes.buffer).setUint32(0, payload.length);
    bytes.set(new TextEncoder().encode(name), 4); bytes.set(payload, 8);
    return bytes;
  };
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, 1024); view.setUint32(4, 1024); header[8] = 8; header[9] = 2;
  const payload = new Uint8Array(megabytes * 1024 * 1024); payload[0] = marker;
  return new Blob([
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', payload), chunk('IEND', new Uint8Array()),
  ], { type: 'image/png' });
}
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const asDataUrl = async (blob: Blob) => `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`;
const decode = vi.fn();
const encode = vi.fn();
const close = vi.fn();
const localFetch = vi.fn();

beforeEach(() => {
  vi.resetAllMocks(); mocks.native = false;
  useAppStore.setState(useAppStore.getInitialState(), true);
  decode.mockImplementation(async (blob: Blob) => ({
    width: 1024, height: 1024, marker: new Uint8Array(await blob.slice(41, 42).arrayBuffer())[0], close,
  }));
  encode.mockImplementation(async (marker: number) => new Blob([`jpeg-${marker}`], { type: 'image/jpeg' }));
  vi.stubGlobal('fetch', localFetch);
  vi.stubGlobal('createImageBitmap', decode);
  vi.stubGlobal('OffscreenCanvas', class {
    marker = 0;
    getContext() { return { drawImage: (bitmap: { marker: number }) => { this.marker = bitmap.marker; } }; }
    convertToBlob(options: ImageEncodeOptions) { return encode(this.marker, options); }
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('共享参考图压缩的实际请求边界', () => {
  it.each(['gpt-image-2', 'vendor-image'])('标准 multipart 模型 %s 按序发送 JPEG 字节及匹配的文件名', async (modelName) => {
    localFetch.mockImplementation(async (url) => new Response(png(Number(String(url).match(/(\d)\.png$/)![1]))));
    mocks.transport.mockResolvedValue(json({ data: [{ url: 'https://cdn.example/result.png' }] }));
    await generateImageStandard({ apiKey: 'test-key', baseUrl: 'https://relay.example/v1', modelName,
      prompt: '合影', dimensions: { width: 1024, height: 1024 }, imageReferenceRequestMode: 'edits-multipart',
      imageUrls: [1, 2, 3].map((id) => `asset://localhost/${id}.png`),
    });
    const files = (mocks.transport.mock.calls[0][1].body as FormData).getAll('image[]') as File[];
    expect(files.map((file) => [file.type, file.name])).toEqual([1, 2, 3].map((id) => ['image/jpeg', `reference-${id}.jpg`]));
    expect(await Promise.all(files.map((file) => file.text()))).toEqual(['jpeg-1', 'jpeg-2', 'jpeg-3']);
  });

  it.each(['grsai', 'custom-json', 'custom-multipart'])('%s 生成入口发送压缩图并保留自定义路径和顺序', async (route) => {
    const multipart = route === 'custom-multipart';
    const protocol = {
      version: 2 as const, mode: 'sync' as const,
      submit: { method: 'POST' as const, path: '/custom/edit', bodyEncoding: multipart ? 'multipart' as const : 'json' as const,
        body: multipart ? { images: { $file: '{{imageUrls}}', filename: 'reference.png', contentType: 'image/png' } }
          : { images: '{{imageUrls}}' },
      }, response: { type: 'json' as const, result: { urlPath: 'url' } },
    };
    useAppStore.setState((state) => ({ config: { ...state.config,
      providers: { grsai: { name: 'GRSAI', apiKey: 'test-key', baseUrl: 'https://grsai.example/v1' },
        custom: { name: '自定义', apiKey: 'test-key', baseUrl: 'https://custom.example/v1' } },
      generalModels: [{ id: 'compressed-image', modelId: 'vendor-image', name: '自定义', category: 'image', providerConfigId: 'custom',
        imageReferenceRequestMode: 'generation-json-image-data-urls', executionProfile: { preset: 'custom', protocol } }],
    } }));
    const dataUrl = await asDataUrl(png(1));
    localFetch.mockImplementation(async () => new Response(png(2)));
    mocks.transport.mockResolvedValue(json(route === 'grsai'
      ? { status: 'succeeded', results: [{ url: 'https://cdn.example/result.png' }] } : { url: 'https://cdn.example/result.png' }));
    await generateImagesBatch({ provider: route === 'grsai' ? 'grsai' : 'general',
      model: route === 'grsai' ? 'grsai/nano-banana-2' : 'general/compressed-image', prompt: '两人合影',
      image_urls: [dataUrl, 'asset://localhost/second.png'],
    }, 1);
    const [url, init] = mocks.transport.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(route === 'grsai' ? 'https://grsai.example/v1/api/generate' : 'https://custom.example/v1/custom/edit');
    if (multipart) {
      const body = new TextDecoder().decode(init.body as ArrayBuffer);
      expect(body.match(/Content-Type: image\/jpeg/g)).toHaveLength(2);
      expect(body.match(/filename="reference.jpg"/g)).toHaveLength(2);
      expect(body).not.toContain('image/png');
      expect(body.indexOf('jpeg-1')).toBeLessThan(body.indexOf('jpeg-2'));
      const preview = previewModelProtocolRequest({ baseUrl: 'https://custom.example/v1', protocol,
        variables: { imageUrls: ['data:image/jpeg;base64,anBlZy0x'] } });
      expect(preview.body).toEqual({ images: [{ $file: '[data URL image/jpeg, 6 bytes]', filename: 'reference.jpg', contentType: 'image/jpeg' }] });
    } else {
      const references: string[] = JSON.parse(init.body as string).images;
      expect(references.every((value) => value.startsWith('data:image/jpeg;base64,'))).toBe(true);
      expect(references.map((value) => atob(value.split(',')[1]))).toEqual(['jpeg-1', 'jpeg-2']);
    }
    expect(mocks.transport).toHaveBeenCalledOnce();
  });

  it.each(['apimart', 'custom-relay', 'cccapi', 'google', 'xai'])('%s 公网 URL 上传复用压缩并沿用缓存', async (provider) => {
    useAppStore.setState((state) => ({ config: { ...state.config,
      providers: { apimart: { name: 'APIMart', apiKey: 'test-key', baseUrl: 'https://upload.example/v1' } },
    } }));
    localFetch.mockImplementation(async (_url, init?: RequestInit) => init?.method === 'POST'
      ? json(provider === 'apimart' ? { url: 'https://cdn.example/ready.jpg' } : { success: true, files: [{ url: 'https://cdn.example/ready.jpg' }] })
      : new Response(png(7)));
    const source = `asset://localhost/${provider}.png`;
    expect(await uploadToRemote(source, provider)).toBe('https://cdn.example/ready.jpg');
    const [, init] = localFetch.mock.calls.find(([, request]) => request?.method === 'POST')!;
    const file = (init.body as FormData).get(provider === 'apimart' ? 'file' : 'files[]') as File;
    expect([file.type, await file.text()]).toEqual(['image/jpeg', 'jpeg-7']);
    expect(file.name).toMatch(/\.jpg$/);
    await uploadToRemote(source, provider);
    expect(localFetch).toHaveBeenCalledTimes(2);
    expect(decode).toHaveBeenCalledOnce();
  });

  it('桌面图床 IPC 的 multipart 字节也已压缩，MIME 与后缀一致', async () => {
    mocks.native = true;
    localFetch.mockResolvedValue(new Response(png(8)));
    mocks.invoke.mockResolvedValue({ status: 200, body: btoa(JSON.stringify({ success: true, files: [{ url: 'https://cdn.example/native.jpg' }] })) });
    await uploadToRemote('asset://localhost/native.png', 'native-relay');
    const [command, payload] = mocks.invoke.mock.calls[0];
    expect(command).toBe('proxy_fetch');
    const body = atob(payload.req.body);
    expect(body).toContain('Content-Type: image/jpeg');
    expect(body).toMatch(/filename="[^\r\n"]+\.jpg"/);
    expect(body).toContain('jpeg-8');
    expect(body.length).toBeLessThan(1024);
  });

  it('RunningHub 图片上传复用压缩，视频原字节保留', async () => {
    localFetch.mockImplementation(async (url) => new Response(String(url).endsWith('.png') ? png(9) : new Blob(['video'], { type: 'video/mp4' })));
    mocks.transport.mockImplementation(async () => json({ code: 200, data: { filename: 'uploaded', download_url: 'https://cdn.example/uploaded' } }));
    for (const kind of ['image', 'video'] as const) {
      await uploadRunningHubMedia({ baseUrl: 'https://runninghub.example', apiKey: 'test-key' },
        `asset://localhost/reference.${kind === 'image' ? 'png' : 'mp4'}`, kind);
    }
    const files = mocks.transport.mock.calls.map(([, init]) => (init.body as FormData).get('file') as File);
    expect(files.map((file) => [file.type, file.name])).toEqual([['image/jpeg', 'reference.jpg'], ['video/mp4', 'reference.mp4']]);
    expect(await Promise.all(files.map((file) => file.text()))).toEqual(['jpeg-9', 'video']);
    expect(decode).toHaveBeenCalledOnce();
  });

  it('工作流内联媒体引用经过压缩，公网 URL 直传不额外下载转存', async () => {
    const result = await resolveMediaReferenceUrl(await asDataUrl(png(4)), { mode: 'dataUrl', kind: 'image' });
    expect(result).toBe('data:image/jpeg;base64,anBlZy00');
    expect(await resolveImageUrlArray(['https://cdn.example/original.png'], 'other-relay')).toEqual(['https://cdn.example/original.png']);
    expect(localFetch).not.toHaveBeenCalled();
    expect(mocks.transport).not.toHaveBeenCalled();
  });

  it('Base64 路径先压缩再校验 8 MiB 输出边界，但读取仍受 32 MiB 限制', async () => {
    localFetch.mockResolvedValueOnce(new Response(png(3, 9)));
    expect(await resolveImageDataUrlArray(['asset://localhost/large.png'])).toEqual(['data:image/jpeg;base64,anBlZy0z']);
    expect(await resolveImageDataUrlArray([await asDataUrl(png(4, 9))])).toEqual(['data:image/jpeg;base64,anBlZy00']);
    localFetch.mockResolvedValueOnce(new Response(new Blob([new Uint8Array(9 * 1024 * 1024)], { type: 'image/jpeg' })));
    await expect(resolveImageDataUrlArray(['asset://localhost/large.jpg'])).rejects.toThrow('8 MB');
    localFetch.mockResolvedValueOnce(new Response('oversize', { headers: { 'Content-Type': 'image/png', 'Content-Length': String(33 * 1024 * 1024) } }));
    await expect(resolveImageDataUrlArray(['asset://localhost/huge.png'])).rejects.toThrow('32');
    expect(decode).toHaveBeenCalledTimes(2);
  });

  it('Base64 读取只启动两张，即使完成顺序不同也不交换图片位置', async () => {
    const releases: Array<() => void> = [];
    const started: number[] = [];
    localFetch.mockImplementation(async (url) => {
      const index = Number(String(url).match(/(\d)\.png$/)![1]);
      started.push(index);
      await new Promise<void>((resolve) => { releases[index] = resolve; });
      return new Response(`image-${index}`, { headers: { 'Content-Type': 'image/png' } });
    });
    const pending = resolveImageDataUrlArray([0, 1, 2].map((id) => `asset://localhost/${id}.png`));
    expect(started).toEqual([0, 1]);
    releases[1]();
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2]));
    releases[2](); releases[0]();
    expect((await pending).map((value) => atob(value.split(',')[1]))).toEqual(['image-0', 'image-1', 'image-2']);
  });

  it('压缩阶段取消不会向生成端提交原图或重试', async () => {
    const controller = new AbortController();
    localFetch.mockResolvedValue(new Response(png(1)));
    encode.mockImplementationOnce(async () => { controller.abort(); return new Blob(['late'], { type: 'image/jpeg' }); });
    await expect(generateImageStandard({ apiKey: 'test-key', baseUrl: 'https://relay.example/v1', modelName: 'gpt-image-2',
      prompt: '合影', dimensions: { width: 1024, height: 1024 }, imageReferenceRequestMode: 'edits-multipart',
      imageUrls: ['asset://localhost/cancel.png'],
    }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.transport).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
  });

  it('GRSAI 任一参考图读取失败就中止，不丢图继续生成', async () => {
    useAppStore.setState((state) => ({ config: { ...state.config,
      providers: { grsai: { name: 'GRSAI', apiKey: 'test-key', baseUrl: 'https://grsai.example/v1' } },
    } }));
    localFetch.mockImplementation(async (url) => String(url).endsWith('missing.png')
      ? new Response('', { status: 404 }) : new Response(png(1)));
    await expect(generateImagesBatch({ provider: 'grsai', model: 'grsai/nano-banana-2', prompt: '合影',
      image_urls: ['asset://localhost/first.png', 'asset://localhost/missing.png', 'asset://localhost/not-started.png'],
    }, 1)).rejects.toThrow('参考图 2');
    expect(localFetch).toHaveBeenCalledTimes(2);
    expect(mocks.transport).not.toHaveBeenCalled();
  });

  it('仍限制参考图数量与最终 Base64 总字节，不以并发或压缩绕过', async () => {
    await expect(resolveImageDataUrlArray(new Array(7).fill('data:image/jpeg;base64,AAAA'))).rejects.toThrow('6 张');
    const dataUrl = await asDataUrl(new Blob([new Uint8Array(7 * 1024 * 1024)], { type: 'image/jpeg' }));
    await expect(resolveImageDataUrlArray(new Array(4).fill(dataUrl))).rejects.toThrow('24 MB');
    expect(decode).not.toHaveBeenCalled();
    expect(localFetch).not.toHaveBeenCalled();
  });
});
