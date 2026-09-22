import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { shallow } from 'zustand/shallow';
import { modelProtocolUsesVariable } from '../../src/services/ai/modelProtocol';
import { analyzeModelProtocolExamples } from '../../src/services/ai/modelProtocolImport';
import { resolveVideoSubmissionControls } from '../../src/services/ai/videoRequestResolver';
import VideoParamSelector, {
  resolveGeneralVideoControlSupport,
  resolveGeneralVideoModel,
  resolveGeneralVideoParameterDisplayState,
  resolveEffectiveVideoParameterCapability,
  resolveVideoParameterInputMode,
  selectConnectedVideoSourceNodes,
} from '../../src/components/nodes/shared/VideoParamSelector';
import type { AppState } from '../../src/store/useAppStore';

describe('ComfyUI 时长显示与提交一致', () => {
  it.each([
    { name: '没有保存秒数和帧数', controls: {}, seconds: 5 },
    { name: '明确选择 3 秒', controls: { seedanceDuration: 3 }, seconds: 3 },
    { name: '旧节点保留 77 帧', controls: { videoFrames: 77, videoFps: 24 }, seconds: 3 },
    { name: '3 秒优先于旧的 121 帧', controls: { seedanceDuration: 3, videoFrames: 121 }, seconds: 3 },
  ])('$name', ({ controls, seconds }) => {
    const props = { provider: 'comfyui', selectedModel: 'builtin-minimax-h3-i2v', ...controls };
    const html = renderToStaticMarkup(createElement(VideoParamSelector, props));
    const submitted = resolveVideoSubmissionControls({ ...props, workflowId: props.selectedModel });

    expect(submitted.seedanceDuration).toBe(seconds);
    expect(html).toContain(`时长${seconds}s`);
  });
});

describe('VideoParamSelector 自定义协议参数识别', () => {
  it('手动首帧与同图连线合并，其他连线图片仍保留参考语义', () => {
    const frames = [{ role: 'first_frame' as const, url: 'https://test/first.png' }];
    const connected = { image: 1, video: 0, audio: 0, imageUrls: ['https://test/first.png'] };
    const mode = resolveVideoParameterInputMode(frames, 0, connected);
    expect(mode).toBe('keyframe');
    expect(resolveEffectiveVideoParameterCapability({
      ratios: ['16:9', 'adaptive'],
      inputModeCapabilities: { keyframe: { ratios: ['adaptive'] } },
    }, mode, 'image-to-video')?.ratios).toEqual(['adaptive']);
    expect(resolveVideoParameterInputMode(frames, 0, {
      ...connected, image: 2, imageUrls: [...connected.imageUrls, 'https://test/ref.png'],
    })).toBe('mixed');
    expect(resolveVideoParameterInputMode([], 0, connected)).toBe('reference');
  });
  it('连接素材 selector 始终返回扁平节点数组，避免 React 外部快照循环', () => {
    const imageNode = {
      id: 'image',
      type: 'ai-image',
      position: { x: 0, y: 0 },
      data: { type: 'ai-image', label: '参考图', imageUrl: 'image.png' },
    } as AppState['nodes'][number];
    const state = {
      nodes: [imageNode],
      edges: [{ id: 'edge', source: 'image', target: 'video' }],
    } as Pick<AppState, 'nodes' | 'edges'>;

    const selected = selectConnectedVideoSourceNodes(state, 'video');
    expect(Array.isArray(selected)).toBe(true);
    expect(selected).toEqual([imageNode]);
    expect(selectConnectedVideoSourceNodes(state, undefined)).toEqual([]);
    expect(shallow([], [])).toBe(true);
    expect(shallow(
      { imageNodes: [], videoCount: 0, audioCount: 0 },
      { imageNodes: [], videoCount: 0, audioCount: 0 },
    )).toBe(false);
  });

  it('保留导入协议的比例、分辨率和秒数变量', () => {
    const imported = analyzeModelProtocolExamples({
      submitRequest: `
curl https://api.paipu.net/v1/videos \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "future-provider-video-model",
    "prompt": "cinematic train station",
    "duration": 5,
    "aspect_ratio": "16:9",
    "resolution": "720p"
  }'`,
      submitResponse: '{"id":"task_1","status":"queued"}',
      pollRequest: 'curl https://api.paipu.net/v1/videos/task_1 -H "Authorization: Bearer YOUR_API_KEY"',
      pollResponse: '{"id":"task_1","status":"completed","metadata":{"url":"https://cdn.example/video.mp4"}}',
    });
    const source = JSON.stringify(imported.protocol);

    expect(modelProtocolUsesVariable(source, 'aspectRatio', 'seedanceRatio')).toBe(true);
    expect(modelProtocolUsesVariable(source, 'resolution', 'seedanceResolution')).toBe(true);
    expect(modelProtocolUsesVariable(source, 'duration', 'seedanceDuration')).toBe(true);
    expect(modelProtocolUsesVariable(source, 'videoFrames')).toBe(false);
  });

  it('兼容模板变量花括号内的空格', () => {
    expect(modelProtocolUsesVariable('{"resolution":"{{ seedanceResolution }}"}', 'seedanceResolution'))
      .toBe(true);
  });

  it('兼容节点保存的内部 ID、真实模型 ID 和 Provider 前缀引用', () => {
    const models = [{
      id: 'provider-custom-abc123',
      name: 'H3video 2K',
      modelId: 'lec-h3video-2k',
      category: 'video' as const,
      providerConfigId: 'custom-video',
      videoCapability: { ratios: ['16:9'], frameRates: [24] },
    }];

    expect(resolveGeneralVideoModel(models, 'general/provider-custom-abc123', 'general'))
      .toBe(models[0]);
    expect(resolveGeneralVideoModel(models, 'lec-h3video-2k', 'custom-video'))
      .toBe(models[0]);
    expect(resolveGeneralVideoModel(models, 'custom-video/lec-h3video-2k', 'custom-video'))
      .toBe(models[0]);
  });

  it('通用视频控件只暴露 capability 明确声明的能力', () => {
    expect(resolveGeneralVideoControlSupport({
      ratios: ['16:9'],
      frameRates: [24],
      supportsAudio: false,
    })).toEqual({
      resolution: false,
      ratio: true,
      duration: false,
      frameRate: true,
      audio: false,
    });
  });

  it('Seedance 自动时长哨兵也会开启时长控件并作为默认显示', () => {
    const capability = { automaticDurationValue: -1 };
    expect(resolveGeneralVideoControlSupport(capability).duration).toBe(true);
    expect(resolveGeneralVideoParameterDisplayState(capability, {}).duration).toBe(-1);
  });

  it('火山 Seedance 2.5 未指定时长时显示自动而不是截成 4 秒', () => {
    const html = renderToStaticMarkup(createElement(VideoParamSelector, {
      provider: 'volcengine',
      selectedModel: 'doubao-seedance-2-5',
    }));

    expect(html).toContain('时长自动');
  });

  it('首尾帧输入使用输入形态覆盖的自适应比例', () => {
    const capability = resolveEffectiveVideoParameterCapability({
      ratios: ['16:9', '9:16', 'adaptive'],
      defaultRatio: '16:9',
      inputModeCapabilities: {
        keyframe: { ratios: ['adaptive'], defaultRatio: 'adaptive' },
      },
    }, 'keyframe', 'image-to-video');

    expect(capability?.ratios).toEqual(['adaptive']);
    expect(capability?.defaultRatio).toBe('adaptive');
  });

  it('缺少 capability 时保持未知，不套用 Seedance 参数', () => {
    expect(resolveGeneralVideoControlSupport(undefined)).toEqual({
      resolution: false,
      ratio: false,
      duration: false,
      frameRate: false,
      audio: false,
    });
  });

  it('可选枚举和单侧范围不会被误当成模型默认值', () => {
    expect(resolveGeneralVideoParameterDisplayState({
      resolutions: ['2K'],
      ratios: ['7:4'],
      frameRates: [30],
      minDuration: 10,
      supportsAudio: true,
    }, {})).toEqual({
      resolution: undefined,
      ratio: undefined,
      duration: undefined,
      frameRate: undefined,
      generateAudio: undefined,
    });

    expect(resolveGeneralVideoParameterDisplayState({
      defaultResolution: '2K',
      defaultRatio: '7:4',
      defaultFrameRate: 30,
      defaultDuration: 20,
    }, {})).toMatchObject({
      resolution: '2K',
      ratio: '7:4',
      frameRate: 30,
      duration: 20,
    });
  });
});
