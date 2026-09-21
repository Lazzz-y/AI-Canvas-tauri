/**
 * Seedance 官方能力与自定义接口快速适配模板。
 *
 * 能力语义来自火山方舟模型文档；HTTP 字段和任务响应属于传输层，必须按
 * 火山原生或已确认的中转协议分别生成，不能因为模型同名就共用请求体。
 */
import type {
  ModelExecutionProfile,
  NormalizedModelExecutionProtocol,
  VideoModelCapability,
} from '../../types/aiTypes';

export type SeedanceModelVariant = '2.0-standard' | '2.0-fast' | '2.0-mini' | '2.5';
export type SeedanceQuickAdaptTransport = 'volcengine' | 'apimart';

export interface SeedanceQuickAdaptOption {
  id: `${SeedanceModelVariant}:${SeedanceQuickAdaptTransport}`;
  model: SeedanceModelVariant;
  transport: SeedanceQuickAdaptTransport;
  label: string;
  description: string;
}

export interface SeedanceQuickAdaptTemplate {
  capability: VideoModelCapability;
  executionProfile: ModelExecutionProfile;
}

const FIXED_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];
const ALL_RATIOS = [...FIXED_RATIOS, 'adaptive'];
const SD20_OPERATIONS = ['text-to-video', 'image-to-video', 'video-to-video'] as const;

const OFFICIAL_CAPABILITIES: Record<SeedanceModelVariant, VideoModelCapability> = {
  '2.0-standard': {
    operations: [...SD20_OPERATIONS],
    resolutions: ['480p', '720p', '1080p', '4k'],
    defaultResolution: '720p',
    ratios: ALL_RATIOS,
    defaultRatio: '16:9',
    minDuration: 4,
    maxDuration: 15,
    defaultDuration: 5,
    supportsAudio: true,
    maxImageReferences: 9,
    maxVideoReferences: 3,
    maxAudioReferences: 3,
  },
  '2.0-fast': {
    operations: [...SD20_OPERATIONS],
    resolutions: ['480p', '720p'],
    defaultResolution: '720p',
    ratios: ALL_RATIOS,
    defaultRatio: '16:9',
    minDuration: 4,
    maxDuration: 15,
    defaultDuration: 5,
    supportsAudio: true,
    maxImageReferences: 9,
    maxVideoReferences: 3,
    maxAudioReferences: 3,
  },
  '2.0-mini': {
    operations: [...SD20_OPERATIONS],
    resolutions: ['480p', '720p'],
    defaultResolution: '720p',
    ratios: ALL_RATIOS,
    defaultRatio: '16:9',
    minDuration: 4,
    maxDuration: 15,
    defaultDuration: 5,
    supportsAudio: true,
    maxImageReferences: 9,
    maxVideoReferences: 3,
    maxAudioReferences: 3,
  },
  '2.5': {
    operations: [...SD20_OPERATIONS],
    resolutions: ['480p', '720p', '1080p'],
    defaultResolution: '720p',
    ratios: ALL_RATIOS,
    defaultRatio: 'adaptive',
    minDuration: 4,
    maxDuration: 30,
    automaticDurationValue: -1,
    supportsAudio: true,
    supportsStandaloneAudio: true,
    maxImageReferences: 30,
    maxVideoReferences: 10,
    maxAudioReferences: 10,
    inputModeCapabilities: {
      keyframe: { ratios: ['adaptive'], defaultRatio: 'adaptive' },
    },
    operationCapabilities: {
      'video-to-video': {
        ratios: ['adaptive'],
        defaultRatio: 'adaptive',
        automaticDurationOnly: true,
      },
    },
  },
};

const VOLCENGINE_PROTOCOL: NormalizedModelExecutionProtocol = {
  version: 2,
  mode: 'async',
  submit: {
    method: 'POST',
    path: '/contents/generations/tasks',
    body: {
      model: '{{model}}',
      content: '{{seedanceContent}}',
      resolution: '{{seedanceResolution}}',
      ratio: '{{seedanceRatio}}',
      duration: '{{seedanceDuration}}',
      generate_audio: '{{generateAudio}}',
      watermark: false,
    },
  },
  response: {
    type: 'json',
    taskIdPath: 'id',
    errorPath: 'error.message',
  },
  poll: {
    method: 'GET',
    path: '/contents/generations/tasks/{{submit.id}}',
    response: {
      statusPath: 'status',
      successValues: ['succeeded'],
      failureValues: ['failed', 'cancelled'],
      result: { urlPath: 'content.video_url', mimeType: 'video/mp4' },
      errorPath: 'error.message',
    },
    intervalMs: 5000,
  },
};

const APIMART_PROTOCOL: NormalizedModelExecutionProtocol = {
  version: 2,
  mode: 'async',
  submit: {
    method: 'POST',
    path: '/videos/generations',
    body: {
      model: '{{model}}',
      prompt: '{{prompt}}',
      resolution: '{{seedanceResolution}}',
      size: '{{seedanceRatio}}',
      duration: '{{seedanceDuration}}',
      generate_audio: '{{generateAudio}}',
      image_with_roles: '{{imageWithRoles}}',
      video_urls: '{{videoUrls}}',
      audio_urls: '{{audioUrls}}',
    },
  },
  response: {
    type: 'json',
    taskIdPath: 'data.0.task_id',
    errorPath: 'error.message',
  },
  poll: {
    method: 'GET',
    path: '/tasks/{{submit.data.0.task_id}}',
    query: { language: 'zh' },
    response: {
      statusPath: 'data.status',
      successValues: ['completed'],
      failureValues: ['failed', 'error', 'cancelled'],
      result: { urlPath: 'data.result.videos.*.url', mimeType: 'video/mp4' },
      errorPath: 'data.error.message',
      progressPath: 'data.progress',
    },
    intervalMs: 3000,
  },
};

const MODEL_LABELS: Record<SeedanceModelVariant, string> = {
  '2.0-standard': 'Seedance 2.0',
  '2.0-fast': 'Seedance 2.0 Fast',
  '2.0-mini': 'Seedance 2.0 Mini',
  '2.5': 'Seedance 2.5',
};

const TRANSPORT_LABELS: Record<SeedanceQuickAdaptTransport, string> = {
  volcengine: '火山原生',
  apimart: 'APIMart 兼容',
};

export const SEEDANCE_QUICK_ADAPT_OPTIONS: readonly SeedanceQuickAdaptOption[] = (
  Object.keys(MODEL_LABELS) as SeedanceModelVariant[]
).flatMap((model) => (
  (Object.keys(TRANSPORT_LABELS) as SeedanceQuickAdaptTransport[]).map((transport) => ({
    id: `${model}:${transport}` as const,
    model,
    transport,
    label: `${MODEL_LABELS[model]} · ${TRANSPORT_LABELS[transport]}`,
    description: transport === 'volcengine'
      ? '火山方舟 contents/generations/tasks 原生协议'
      : 'APIMart /videos/generations 与 /tasks 查询协议',
  }))
));

export function getOfficialSeedanceCapability(model: SeedanceModelVariant): VideoModelCapability {
  return structuredClone(OFFICIAL_CAPABILITIES[model]);
}

function getTransportCapability(
  model: SeedanceModelVariant,
  transport: SeedanceQuickAdaptTransport,
): VideoModelCapability {
  const capability = getOfficialSeedanceCapability(model);
  if (transport === 'volcengine') return capability;

  capability.allowFrameAndReferenceMix = false;
  if (model === '2.5') {
    capability.resolutions = ['480p', '720p'];
    capability.defaultDuration = 5;
    delete capability.automaticDurationValue;
    delete capability.operationCapabilities;
  }
  return capability;
}

export function createSeedanceQuickAdaptTemplate(
  model: SeedanceModelVariant,
  transport: SeedanceQuickAdaptTransport,
): SeedanceQuickAdaptTemplate {
  const protocol = transport === 'volcengine' ? VOLCENGINE_PROTOCOL : APIMART_PROTOCOL;
  return {
    capability: getTransportCapability(model, transport),
    executionProfile: {
      preset: 'custom',
      protocol: structuredClone(protocol),
    },
  };
}
