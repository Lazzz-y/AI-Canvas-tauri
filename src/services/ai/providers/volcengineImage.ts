/**
 * ai/providers/volcengineImage — 火山方舟 Seedream 图片生成
 *
 * 与标准 OpenAI 兼容流程的差异：
 *  - 使用 normalizeSeedreamSize 归一化画质到模型支持的尺寸
 *  - 请求体含 sequential_image_generation / watermark 等专属字段
 *  - 参考图通过 image 字段传递（非 image_urls）
 */
import { parseResponseError, buildAuthHeaders } from '../httpUtils';
import { extractModelName, normalizeSeedreamSize, parseGeneralImageResponse } from '../helpers';
import { mapImageDimensions } from '../../aiDimensions';
import { getImageCapability } from '../mediaModelCapabilities';
import { runBatchTasks } from '../batchUtils';
import type { BatchImageResult } from '../../../types/aiTypes';
import { corsSafeFetch } from '../httpTransport';
import { mapImageParameters } from '../imageParameterMappings';

export interface VolcengineImageParams {
  apiKey: string;
  baseUrl: string;
  /** 原始 model value（含 provider/ 前缀） */
  model: string;
  /** provider id，用于 extractModelName */
  provider: string;
  prompt: string;
  imageSize: string;
  aspectRatio: string;
  imageUrls?: string[];
}

export async function generateVolcengineImage(
  params: VolcengineImageParams,
  signal?: AbortSignal,
): Promise<{ url: string; width: number; height: number }> {
  const { apiKey, baseUrl, model, provider, prompt, imageSize, aspectRatio, imageUrls = [] } = params;

  const modelName = extractModelName(model, provider);
  const seedreamSize = normalizeSeedreamSize(modelName, imageSize);
  const apiUrl = baseUrl.replace(/\/+$/, '') + '/images/generations';

  // Seedream 5.0 Pro 固定比例使用官方像素表；自适应只传分辨率档位。
  // 不能把 2K 当短边直接换算，否则 16:9 会超过方舟的总像素上限。
  const isPro = modelName.startsWith('doubao-seedream-5-0-pro');
  const adaptiveRatio = aspectRatio === '自适应' || aspectRatio === 'auto';
  const capability = isPro ? getImageCapability(modelName) : undefined;
  const preset = adaptiveRatio ? undefined : capability?.dimensionPresets?.[seedreamSize]?.[aspectRatio];
  const dimensions = preset
    ? { width: preset[0], height: preset[1] }
    : mapImageDimensions(seedreamSize, adaptiveRatio ? '1:1' : aspectRatio);
  const requestSize = isPro && !adaptiveRatio
    ? `${dimensions.width}x${dimensions.height}`
    : seedreamSize;

  const requestBody = mapImageParameters('volcengine', modelName, {
    model: modelName,
    prompt,
    imageSize: requestSize,
    referenceImageUrls: imageUrls,
  });
  if (!isPro) {
    requestBody.sequential_image_generation = 'disabled';
  }
  if (imageUrls.length > 0) {
    requestBody.image = imageUrls;
  }

  const response = await corsSafeFetch(apiUrl, {
    method: 'POST',
    headers: buildAuthHeaders(apiKey),
    body: JSON.stringify(requestBody),
    signal,
  });

  if (!response.ok) {
    await parseResponseError(response, `图片生成失败 (${response.status})`);
  }

  const json = await response.json();
  const imageUrl = parseGeneralImageResponse(json);
  if (!imageUrl) throw new Error('图片生成返回结果为空');

  return { url: imageUrl, width: dimensions.width, height: dimensions.height };
}

export async function generateVolcengineImagesBatch(
  params: VolcengineImageParams,
  count: number,
  signal?: AbortSignal,
): Promise<BatchImageResult> {
  const requestedCount = Math.max(1, Math.floor(count));
  const settled = await runBatchTasks(
    requestedCount,
    3,
    () => generateVolcengineImage(params, signal),
  );
  if (settled.results.length === 0) {
    throw new Error('批量图片生成失败：所有火山方舟请求均失败');
  }
  return { requestedCount, ...settled };
}
