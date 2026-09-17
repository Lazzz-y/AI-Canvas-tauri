import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import type { BaseNodeData } from '../../src/types';

const PROJECT_DIR = 'D:/data/proj-1';

const { ensureGroupFolder, renameGroupFolder, moveProjectFileToFolder } = vi.hoisted(() => ({
  ensureGroupFolder: vi.fn(async () => null),
  renameGroupFolder: vi.fn(async () => true),
  // 假磁盘：只按目标目录算出新路径，已在目标目录时返回 null（不移动）
  moveProjectFileToFolder: vi.fn(async (filePath: string | undefined, dir: string, folder: string | null, options?: { preserveSource?: boolean; forceCopy?: boolean }) => {
    if (!filePath) return null;
    const name = filePath.replaceAll('\\', '/').split('/').pop()!;
    const target = folder ? `${dir}/${folder}/${name}` : `${dir}/${name}`;
    return target === filePath && !options?.forceCopy ? null : target;
  }),
}));

vi.mock('../../src/services/fileService', () => ({
  setBaseDataDir: vi.fn(),
  syncAuthorizedDirectories: vi.fn(async () => undefined),
  ensureGroupFolder,
  renameGroupFolder,
  moveProjectFileToFolder,
  copyFileToProjectData: vi.fn(async (_path: string, _project: string) => ({ filePath: 'D:/data/proj-1/copied.png', assetUrl: 'asset://D:/data/proj-1/copied.png', fileName: 'copied.png' })),
  getProjectDataDir: vi.fn(async () => PROJECT_DIR),
  getAssetUrlFromPath: vi.fn(async (p: string) => `asset://${p}`),
  sanitizeFolderName: (name: string) => name.replace(/[<>:"|?*/\\]/g, '_'),
}));

vi.mock('../../src/services/pollManager', () => ({
  cancelNodePolling: vi.fn(),
  clearProjectTasks: vi.fn(),
  resumePendingTasks: vi.fn(async () => undefined),
}));

import { useAppStore } from '../../src/store/useAppStore';

function node(id: string): Node<BaseNodeData> {
  return {
    id,
    type: 'ai-text',
    position: { x: 0, y: 0 },
    data: { label: id, type: 'ai-text', status: 'success' },
  };
}

function createGroup(nodeIds: string[]) {
  useAppStore.setState({ selectedNodeIds: nodeIds });
  useAppStore.getState().groupSelectedNodes();
}

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({ currentProjectId: 'p1', nodes: [node('a'), node('b'), node('c'), node('d')] });
  ensureGroupFolder.mockClear();
  renameGroupFolder.mockClear();
  moveProjectFileToFolder.mockClear();
});

describe('分组与本地文件夹同步', () => {
  it('复制节点使用独立文件，入组和重新生成不影响另一节点', async () => {
    const original = `${PROJECT_DIR}/original.png`;
    useAppStore.setState({ nodes: [{
      ...node('a'), type: 'ai-image',
      data: { label: 'image', type: 'ai-image', filePath: original, imageUrl: `asset://${original}` },
    }, node('b')] });
    await useAppStore.getState().duplicateNode('a');
    const clone = useAppStore.getState().nodes.find((n) => n.id !== 'a' && n.id !== 'b')!;
    createGroup(['a', 'b']);
    await useAppStore.getState().syncGroupFiles();
    expect(useAppStore.getState().nodes.find((n) => n.id === clone.id)?.data.filePath).toBe(`${PROJECT_DIR}/copied.png`);

    const regenerated = `${PROJECT_DIR}/regenerated.png`;
    useAppStore.getState().updateNodeData('a', { filePath: regenerated, imageUrl: `asset://${regenerated}` });
    await useAppStore.getState().syncGroupFiles();
    expect(useAppStore.getState().nodes.find((n) => n.id === 'a')?.data.filePath)
      .toBe(`${PROJECT_DIR}/分组/regenerated.png`);
    expect(useAppStore.getState().nodes.find((n) => n.id === clone.id)?.data.imageUrl).toBe(`asset://${PROJECT_DIR}/copied.png`);
  });

  it('旧分镜格与图片共用文件时，归档要求独立副本并保留源文件', async () => {
    const path = `${PROJECT_DIR}/shared.png`;
    useAppStore.setState({ nodes: [
      { ...node('a'), data: { ...node('a').data, filePath: path, imageUrl: `asset://${path}` } },
      { ...node('b'), data: { ...node('b').data, storyboardOverrides: [{ filePath: path.replaceAll('/', '\\'), url: `asset://${path}` }] } },
    ] });
    createGroup(['a', 'b']);
    await useAppStore.getState().syncGroupFiles();
    const calls = moveProjectFileToFolder.mock.calls.filter(([file]) => !!file);
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call[3]?.forceCopy && call[3]?.preserveSource)).toBe(true);
  });

  it('文件移动期间切换项目，不把旧结果写入新项目的同名节点', async () => {
    const path = `${PROJECT_DIR}/a.png`;
    useAppStore.setState({ nodes: [{ ...node('a'), data: { ...node('a').data, filePath: path } }, node('b')] });
    createGroup(['a', 'b']);
    let finish!: (path: string) => void;
    moveProjectFileToFolder.mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve; }));
    const syncing = useAppStore.getState().syncGroupFiles();
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    useAppStore.setState({ currentProjectId: 'p2', nodes: [{ ...node('a'), data: { ...node('a').data, filePath: path } }] });
    finish(`${PROJECT_DIR}/分组/a.png`);
    await syncing;
    expect(useAppStore.getState().nodes[0].data.filePath).toBe(path);
  });

  it('创建分组时用不重名的分组名建文件夹', () => {
    createGroup(['a', 'b']);
    createGroup(['c', 'd']);

    expect(useAppStore.getState().groups.map((g) => g.name)).toEqual(['分组', '分组 2']);
    expect(ensureGroupFolder.mock.calls).toEqual([
      ['p1', '分组'],
      ['p1', '分组 2'],
    ]);
  });

  it('改名时同步重命名文件夹并更新分组节点标签', () => {
    createGroup(['a', 'b']);
    const groupId = useAppStore.getState().groups[0].id;

    useAppStore.getState().renameGroup(groupId, '镜头一');

    expect(ensureGroupFolder).toHaveBeenCalledWith('p1', '镜头一');
    expect(renameGroupFolder).not.toHaveBeenCalled();
    expect(useAppStore.getState().groups[0].name).toBe('镜头一');
    expect(useAppStore.getState().nodes.find((n) => n.id === groupId)?.data.label).toBe('镜头一');
  });

  it('文件跟着分组走：入组搬进分组文件夹，出组搬回项目根目录', async () => {
    const media = (id: string): Node<BaseNodeData> => ({
      id,
      type: 'ai-image',
      position: { x: 0, y: 0 },
      data: {
        label: id,
        type: 'ai-image',
        filePath: `${PROJECT_DIR}/${id}.png`,
        imageUrl: `asset://${PROJECT_DIR}/${id}.png`,
        thumbnailUrl: `asset://${PROJECT_DIR}/${id}.png`,
      },
    });
    useAppStore.setState({ nodes: [media('a'), media('b')] });

    createGroup(['a', 'b']);
    await useAppStore.getState().syncGroupFiles();

    const grouped = useAppStore.getState().nodes.find((n) => n.id === 'a')!;
    expect(grouped.data.filePath).toBe(`${PROJECT_DIR}/分组/a.png`);
    expect(grouped.data.relativePath).toBe('分组/a.png');
    expect(grouped.data.imageUrl).toBe(`asset://${PROJECT_DIR}/分组/a.png`);
    expect(grouped.data.thumbnailUrl).toBe(`asset://${PROJECT_DIR}/分组/a.png`);

    // 再跑一次：文件已在目标目录，不应重复搬运
    moveProjectFileToFolder.mockClear();
    await useAppStore.getState().syncGroupFiles();
    expect(useAppStore.getState().nodes.find((n) => n.id === 'a')!.data.filePath)
      .toBe(`${PROJECT_DIR}/分组/a.png`);

    useAppStore.setState({ selectedNodeIds: ['a', 'b'] });
    useAppStore.getState().ungroupSelectedNodes();
    await useAppStore.getState().syncGroupFiles();

    const ungrouped = useAppStore.getState().nodes.find((n) => n.id === 'a')!;
    expect(ungrouped.data.filePath).toBe(`${PROJECT_DIR}/a.png`);
    expect(ungrouped.data.relativePath).toBe('a.png');
  });

  it('分组改名后节点路径改写到新文件夹', async () => {
    useAppStore.setState({
      nodes: [{
        id: 'a',
        type: 'ai-image',
        parentId: 'g1',
        position: { x: 0, y: 0 },
        data: {
          label: 'a',
          type: 'ai-image',
          filePath: `${PROJECT_DIR}/分组/a.png`,
          imageUrl: `asset://${PROJECT_DIR}/分组/a.png`,
          relativePath: '分组/a.png',
          storyboardOverrides: [{ url: `asset://${PROJECT_DIR}/分组/cell.png`, filePath: `${PROJECT_DIR}/分组/cell.png` }],
        },
      } as Node<BaseNodeData>],
      groups: [{ id: 'g1', name: '分组', nodeIds: ['a'], color: '#fff', createdAt: 0 }],
    });

    useAppStore.getState().renameGroup('g1', 'Na');
    await vi.waitFor(() => {
      expect(useAppStore.getState().nodes[0].data.filePath).toBe(`${PROJECT_DIR}/Na/a.png`);
    });

    const data = useAppStore.getState().nodes[0].data;
    expect(data.relativePath).toBe('Na/a.png');
    expect(data.imageUrl).toBe(`asset://${PROJECT_DIR}/Na/a.png`);
    expect(data.storyboardOverrides?.[0]?.filePath).toBe(`${PROJECT_DIR}/Na/cell.png`);
    expect(data.storyboardOverrides?.[0]?.url).toBe(`asset://${PROJECT_DIR}/Na/cell.png`);
  });

  it('同名改名不触发文件夹操作', () => {
    createGroup(['a', 'b']);
    const groupId = useAppStore.getState().groups[0].id;

    useAppStore.getState().renameGroup(groupId, '分组');

    expect(renameGroupFolder).not.toHaveBeenCalled();
  });
});
