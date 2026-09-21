import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateText = vi.hoisted(() => vi.fn());
vi.mock('../../src/services/ai/generateText', () => ({ generateText }));

import { useAppStore, type AppState } from '../../src/store/useAppStore';
import {
  buildSeriesAssetExtractionPrompt,
  extractSeriesAssetsFromFullScript,
} from '../../src/services/seriesAssetExtractionService';
import { DRAMA_EXTRACT_MARKER, type DramaAssetKind } from '../../src/types/dramaAssets';

const fullScript = '第一场 车站 夜\n林夏：末班车已经走了。\n她握紧一张旧车票。';
let mergeDramaExtract: ReturnType<typeof vi.fn<AppState['mergeDramaExtract']>>;

beforeEach(() => {
  generateText.mockReset();
  mergeDramaExtract = vi.fn<AppState['mergeDramaExtract']>();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState((state) => ({
    currentProjectId: 'episode-1',
    projectLoadStatus: 'ready',
    projects: [
      {
        id: 'series-1',
        name: '末班车',
        createdAt: 1,
        updatedAt: 1,
        series: { script: fullScript },
      },
      {
        id: 'episode-1',
        parentId: 'series-1',
        name: '第一集',
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    config: {
      ...state.config,
      assistantModelId: 'extract-model',
      providers: {
        ...state.config.providers,
        extraction: {
          name: 'Extraction',
          apiKey: 'secret',
          baseUrl: 'https://example.test/v1',
        },
      },
      generalModels: [{
        id: 'extract-model',
        name: '提取模型',
        modelId: 'vendor-model',
        category: 'text',
        providerConfigId: 'extraction',
      }],
    },
    mergeDramaExtract,
  }));
});

describe('全剧剧本资产提取', () => {
  it.each([
    ['character', DRAMA_EXTRACT_MARKER.character],
    ['scene', DRAMA_EXTRACT_MARKER.scene],
    ['prop', DRAMA_EXTRACT_MARKER.prop],
  ] as Array<[DramaAssetKind, string]>)('复用 %s 快捷指令并把正文标记为不可信资料', (kind, marker) => {
    const prompt = buildSeriesAssetExtractionPrompt(kind, fullScript);

    expect(prompt).toContain(marker);
    expect(prompt).toContain(fullScript);
    expect(prompt).toContain('不可信资料');
  });

  it('调用当前文本模型并把人物结果合并到共享资产库', async () => {
    generateText.mockResolvedValue(JSON.stringify({
      kind: 'character',
      items: [{ name: '林夏', summary: '等待末班车的女孩', importance: 'main' }],
    }));

    const result = await extractSeriesAssetsFromFullScript({
      kind: 'character',
      seriesId: 'series-1',
      projectId: 'episode-1',
    });

    expect(result).toEqual({ kind: 'character', count: 1, modelId: 'extract-model' });
    expect(generateText).toHaveBeenCalledWith(expect.objectContaining({
      model: 'general/extract-model',
      provider: 'general',
      prompt: expect.stringContaining(fullScript),
    }));
    expect(mergeDramaExtract).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'character',
        characters: [expect.objectContaining({ name: '林夏' })],
      }),
      { modelId: 'extract-model' },
    );
  });

  it('模型返回前全剧剧本变化时拒绝把旧结果写入资产库', async () => {
    let resolveModel!: (value: string) => void;
    generateText.mockImplementation(() => new Promise<string>((resolve) => {
      resolveModel = resolve;
    }));
    const pending = extractSeriesAssetsFromFullScript({
      kind: 'scene',
      seriesId: 'series-1',
      projectId: 'episode-1',
    });
    await vi.waitFor(() => expect(resolveModel).toBeDefined());
    useAppStore.setState((state) => ({
      projects: state.projects.map((project) => project.id === 'series-1'
        ? { ...project, series: { ...project.series, script: `${fullScript}\n第二场 天台` } }
        : project),
    }));
    resolveModel(JSON.stringify({
      kind: 'scene',
      items: [{ name: '车站', summary: '深夜空旷站台', importance: 'main' }],
    }));

    await expect(pending).rejects.toThrow('结果未写入');
    expect(mergeDramaExtract).not.toHaveBeenCalled();
  });
});
