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
  waitForPendingNodeFileDeletions: vi.fn(async () => undefined),
  resolveGroupUndoTrashPaths: vi.fn(async () => []),
  resolveNodeUndoTrashPaths: vi.fn(async () => []),
  collectNodeFileReferences: vi.fn(() => new Set<string>()),
  deletedGroupFolderNames: vi.fn(() => []),
  deleteNodeFiles: vi.fn(async () => undefined),
  setBaseDataDir: vi.fn(),
  syncAuthorizedDirectories: vi.fn(async () => undefined),
  ensureGroupFolder,
  renameGroupFolder,
  moveProjectFileToFolder,
  removeEmptyProjectGroupFolder: vi.fn(async () => undefined),
  finishProjectFileRelocation: vi.fn(async () => undefined),
  copyFileToProjectData: vi.fn(async (_path: string, _project: string) => ({ filePath: 'D:/data/proj-1/copied.png', assetUrl: 'asset://D:/data/proj-1/copied.png', fileName: 'copied.png' })),
  getProjectDataDir: vi.fn(async () => PROJECT_DIR),
  getAssetUrlFromPath: vi.fn(async (p: string) => `asset://${p}`),
  sanitizeFolderName: (name: string) => name.replace(/[<>:"|?*/\\]/g, '_'),
}));

vi.mock('../../src/services/indexedDb/mediaRelocations', async (original) => ({
  ...await original<typeof import('../../src/services/indexedDb/mediaRelocations')>(),
  persistMediaRelocation: vi.fn(async () => undefined),
  pendingMediaRelocations: vi.fn(async () => []),
  completeMediaRelocation: vi.fn(async () => undefined),
}));

vi.mock('../../src/services/pollManager', () => ({
  cancelNodePolling: vi.fn(),
  clearProjectTasks: vi.fn(),
  resumePendingTasks: vi.fn(async () => undefined),
}));

import { useAppStore } from '../../src/store/useAppStore';
import { finishProjectFileRelocation } from '../../src/services/fileService';
import { persistMediaRelocation, pendingMediaRelocations } from '../../src/services/indexedDb/mediaRelocations';

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
  useAppStore.setState({ saveCurrentProjectSilent: vi.fn(async () => 'p1') });
  ensureGroupFolder.mockClear();
  renameGroupFolder.mockClear();
  moveProjectFileToFolder.mockClear();
  vi.mocked(finishProjectFileRelocation).mockClear();
});

describe('展开分组内创建和拖入空节点', () => {
  function setup() {
    const group: Node<BaseNodeData> = {
      id: 'group-test', type: 'group', position: { x: 100, y: 100 },
      data: { label: '分组', type: 'comment', groupId: 'group-test' },
      style: { width: 300, height: 200 },
      width: 1000, height: 700, measured: { width: 1000, height: 700 },
    };
    const empty: Node<BaseNodeData> = {
      id: 'empty', type: 'ai-image', position: { x: 700, y: 400 },
      data: { label: '空图像', type: 'ai-image', status: 'idle', nodeWidth: 280, nodeHeight: 160 },
    };
    useAppStore.setState({
      nodes: [group], edges: [],
      groups: [{ id: group.id, name: '分组', nodeIds: [], color: '#888888', createdAt: 0 }],
    });
    return { group, empty };
  }

  it('在扩大后的分组空白区新建无内容节点，位置和成员关系一起撤销', async () => {
    const { group, empty } = setup();
    useAppStore.getState().addNode(empty);
    expect(useAppStore.getState().nodes[1]).toMatchObject({ parentId: group.id, position: { x: 600, y: 300 } });
    expect(useAppStore.getState().groups[0].nodeIds).toEqual(['empty']);
    await useAppStore.getState().undo();
    expect(useAppStore.getState().nodes.map((n) => n.id)).toEqual([group.id]);
    expect(useAppStore.getState().groups[0].nodeIds).toEqual([]);
    await useAppStore.getState().redo();
    expect(useAppStore.getState().nodes[1].parentId).toBe(group.id);
  });

  it('连线创建节点时同时入组，一次撤销清除节点、连线和成员关系', async () => {
    const { group, empty } = setup();
    useAppStore.setState({ nodes: [group, node('source')] });
    useAppStore.getState().addNodeWithEdge(empty, { id: 'edge', source: 'source', target: 'empty' });
    expect(useAppStore.getState().nodes[2].parentId).toBe(group.id);
    expect(useAppStore.getState().edges).toHaveLength(1);
    await useAppStore.getState().undo();
    expect(useAppStore.getState().nodes).toHaveLength(2);
    expect(useAppStore.getState().edges).toEqual([]);
    expect(useAppStore.getState().groups[0].nodeIds).toEqual([]);
  });

  it('空节点早于分组创建，拖入后父节点在前，且保留其他空分组', () => {
    const { group, empty } = setup();
    const other = { ...group, id: 'other', position: { x: 2000, y: 0 }, data: { ...group.data, groupId: 'other' } };
    useAppStore.setState({ nodes: [empty, group, other], groups: [
      ...useAppStore.getState().groups,
      { id: 'other', name: '空分组', nodeIds: [], color: '#888888', createdAt: 0 },
    ] });
    useAppStore.getState().settleNodeGroupingOnDragStop(empty);
    const state = useAppStore.getState();
    expect(state.nodes.find((n) => n.id === 'empty')).toMatchObject({ parentId: group.id, position: { x: 600, y: 300 } });
    expect(state.nodes.findIndex((n) => n.id === group.id)).toBeLessThan(state.nodes.findIndex((n) => n.id === 'empty'));
    expect(state.groups.find((g) => g.id === 'other')).toBeDefined();
  });

  it('拖动使用节点实际尺寸，不因历史业务尺寸过大误判在组外', () => {
    const { group, empty } = setup();
    const dragged = { ...empty, measured: { width: 100, height: 100 }, position: { x: 1000, y: 600 }, data: { ...empty.data, nodeWidth: 1000 } };
    useAppStore.setState({ nodes: [group, dragged] });
    useAppStore.getState().settleNodeGroupingOnDragStop(dragged);
    expect(useAppStore.getState().nodes[1].parentId).toBe(group.id);
  });

  it('拖出分组还原绝对坐标，不影响其他分组的成员', () => {
    const { group, empty } = setup();
    useAppStore.getState().addNode(empty);
    const moved = { ...useAppStore.getState().nodes[1], position: { x: 1400, y: 900 } };
    useAppStore.getState().settleNodeGroupingOnDragStop(moved);
    expect(useAppStore.getState().nodes.find((n) => n.id === empty.id)).toMatchObject({ parentId: undefined, position: { x: 1500, y: 1000 } });
    expect(useAppStore.getState().groups.some((g) => g.id === group.id)).toBe(false);
  });

  it('新建节点不会自动藏进折叠分组，显式父节点保持原坐标', () => {
    const { group, empty } = setup();
    useAppStore.setState({ nodes: [{ ...group, data: { ...group.data, groupCollapsed: true } }] });
    useAppStore.getState().addNode(empty);
    expect(useAppStore.getState().nodes[1].parentId).toBeUndefined();
    useAppStore.getState().addNode({ ...empty, id: 'child', parentId: group.id, position: { x: 20, y: 30 } });
    expect(useAppStore.getState().nodes[2]).toMatchObject({ parentId: group.id, position: { x: 20, y: 30 } });
  });
});

describe('分组与本地文件夹同步', () => {
  it('保存失败时保留源文件，下次同步完成已提交迁移', async () => {
    const path = `${PROJECT_DIR}/a.png`;
    useAppStore.setState({ nodes: [{ ...node('a'), data: { ...node('a').data, filePath: path } }, node('b')] });
    createGroup(['a', 'b']);
    useAppStore.setState({ saveCurrentProjectSilent: vi.fn(async () => undefined) });
    await useAppStore.getState().syncGroupFiles();
    expect(finishProjectFileRelocation).not.toHaveBeenCalled();
    vi.mocked(pendingMediaRelocations).mockResolvedValueOnce([{
      oldPath: path, newPath: `${PROJECT_DIR}/分组/a.png`, projectId: 'p1',
      assetUrl: `asset://${PROJECT_DIR}/分组/a.png`, relativePath: '分组/a.png',
    }]);
    useAppStore.setState({ saveCurrentProjectSilent: vi.fn(async () => 'p1') });
    await useAppStore.getState().syncGroupFiles();
    expect(finishProjectFileRelocation).toHaveBeenCalledWith(path, `${PROJECT_DIR}/分组/a.png`, PROJECT_DIR);
  });

  it('引用事务失败时不删除源文件也不改写节点', async () => {
    const path = `${PROJECT_DIR}/a.png`;
    useAppStore.setState({ nodes: [{ ...node('a'), data: { ...node('a').data, filePath: path } }, node('b')] });
    createGroup(['a', 'b']);
    vi.mocked(persistMediaRelocation).mockRejectedValueOnce(new Error('quota exceeded'));
    await useAppStore.getState().syncGroupFiles();
    expect(finishProjectFileRelocation).not.toHaveBeenCalled();
    expect(useAppStore.getState().nodes.find((item) => item.id === 'a')?.data.filePath).toBe(path);
  });

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

  it('旧分镜格与图片共用文件时，归档先拆分独立副本再迁移最后一个引用', async () => {
    const path = `${PROJECT_DIR}/shared.png`;
    useAppStore.setState({ nodes: [
      { ...node('a'), data: { ...node('a').data, filePath: path, imageUrl: `asset://${path}` } },
      { ...node('b'), data: { ...node('b').data, storyboardOverrides: [{ filePath: path.replaceAll('/', '\\'), url: `asset://${path}` }] } },
    ] });
    createGroup(['a', 'b']);
    await useAppStore.getState().syncGroupFiles();
    const calls = moveProjectFileToFolder.mock.calls.filter(([file]) => !!file);
    expect(calls).toHaveLength(2);
    expect(calls[0][3]?.forceCopy).toBe(true);
    expect(calls[1][3]?.forceCopy).toBe(false);
    expect(calls.every((call) => call[3]?.preserveSource)).toBe(true);
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
