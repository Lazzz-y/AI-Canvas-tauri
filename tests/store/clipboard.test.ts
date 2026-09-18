import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import type { BaseNodeData } from '../../src/types';

const fileMocks = vi.hoisted(() => ({
  copyFileToProjectData: vi.fn(),
  moveToUndoTrash: vi.fn(async () => undefined),
}));

vi.mock('../../src/services/fileService', () => ({
  ...fileMocks,
  setBaseDataDir: vi.fn(),
  syncAuthorizedDirectories: vi.fn(async () => undefined),
  waitForPendingNodeFileDeletions: vi.fn(async () => undefined),
  resolveGroupUndoTrashPaths: vi.fn(async () => []),
  resolveNodeUndoTrashPaths: vi.fn(async () => []),
  collectNodeFileReferences: vi.fn(() => new Set<string>()),
  deleteNodeFiles: vi.fn(async () => undefined),
  deletedGroupFolderNames: vi.fn(() => []),
}));

vi.mock('../../src/services/pollManager', () => ({
  cancelNodePolling: vi.fn(),
  clearProjectTasks: vi.fn(),
  resumePendingTasks: vi.fn(async () => undefined),
}));

import { useAppStore } from '../../src/store/useAppStore';
import { createNodeDuplicateDrag } from '../../src/store/store.nodes';

function node(id: string): Node<BaseNodeData> {
  return {
    id,
    type: 'ai-text',
    position: { x: 0, y: 0 },
    data: { label: id, type: 'ai-text', status: 'success' },
  };
}

function mediaNode(id: string, projectId: string): Node<BaseNodeData> {
  return {
    id,
    type: 'ai-image',
    position: { x: 0, y: 0 },
    data: {
      label: id,
      type: 'ai-image',
      status: 'success',
      filePath: `/data/${projectId}/original.png`,
      relativePath: 'original.png',
      assetId: 'asset-from-source-project',
      imageUrl: `asset:///data/${projectId}/original.png`,
      thumbnailUrl: `asset:///data/${projectId}/original.png`,
    },
  };
}

function directorNode(
  id: string,
  runtime: 'lightweight-web' | 'blender',
  status: 'loading' | 'error',
): Node<BaseNodeData> {
  return {
    id,
    type: 'ai-director',
    position: { x: 0, y: 0 },
    data: {
      label: id,
      type: 'ai-director',
      role: 'source',
      status,
      error: '源节点的瞬时错误',
      directorRuntimeKind: runtime,
      directorInstanceId: id,
      directorStatus: 'ready',
      directorCaptureUrls: ['asset:///director/frame-a.png'],
      directorCaptureFilePaths: ['/data/project-a/frame-a.png'],
      imageUrl: 'asset:///director/frame-a.png',
      thumbnailUrl: 'asset:///director/frame-a.png',
      videoUrl: 'asset:///director/reference.mp4',
      filePath: '/data/project-a/reference.mp4',
    },
  };
}

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  fileMocks.copyFileToProjectData.mockReset();
  fileMocks.copyFileToProjectData.mockImplementation(async (_source: string, projectId: string) => ({
    filePath: `/data/${projectId}/copied.png`,
    assetUrl: `asset:///data/${projectId}/copied.png`,
    fileName: 'copied.png',
  }));
});

describe('canvas clipboard', () => {
  it('keeps incoming connections without copying outgoing external connections', () => {
    const incomingEdge: Edge = {
      id: 'edge-source-copy',
      source: 'source',
      target: 'copy',
      sourceHandle: 'output',
      targetHandle: 'prompt',
      type: 'smoothstep',
      animated: true,
      data: { channel: 'reference' },
    };
    const outgoingEdge: Edge = {
      id: 'edge-copy-downstream',
      source: 'copy',
      target: 'downstream',
    };
    useAppStore.setState({
      nodes: [node('source'), node('copy'), node('downstream')],
      edges: [incomingEdge, outgoingEdge],
      selectedNodeIds: ['copy'],
      showToast: vi.fn(),
    });

    useAppStore.getState().copySelectedNodes();
    useAppStore.getState().pasteNodes({ x: 30, y: 30 });

    const pastedNode = useAppStore.getState().nodes.find((item) => (
      !['source', 'copy', 'downstream'].includes(item.id)
    ));
    expect(pastedNode).toBeDefined();

    const pastedIncomingEdge = useAppStore.getState().edges.find((edge) => (
      edge.source === 'source' && edge.target === pastedNode?.id
    ));
    expect(pastedIncomingEdge).toMatchObject({
      sourceHandle: 'output',
      targetHandle: 'prompt',
      type: 'smoothstep',
      animated: true,
      data: { channel: 'reference' },
    });
    expect(useAppStore.getState().edges).not.toContainEqual(expect.objectContaining({
      source: pastedNode?.id,
      target: 'downstream',
    }));
  });

  it('remaps both ends of connections between copied nodes', () => {
    useAppStore.setState({
      nodes: [node('first'), node('second')],
      edges: [{ id: 'edge-first-second', source: 'first', target: 'second' }],
      selectedNodeIds: ['first', 'second'],
      showToast: vi.fn(),
    });

    useAppStore.getState().copySelectedNodes();
    useAppStore.getState().pasteNodes({ x: 30, y: 30 });

    const pastedIds = useAppStore.getState().nodes
      .filter((item) => !['first', 'second'].includes(item.id))
      .map((item) => item.id);
    const pastedEdges = useAppStore.getState().edges.filter((edge) => (
      pastedIds.includes(edge.source) && pastedIds.includes(edge.target)
    ));
    expect(pastedEdges).toHaveLength(1);
  });

  it('copies director outputs but creates an independent runtime instance', () => {
    const source = directorNode('director-source', 'blender', 'error');
    useAppStore.setState({
      currentProjectId: 'project-a',
      nodes: [source],
      edges: [],
      selectedNodeIds: [source.id],
      showToast: vi.fn(),
    });

    useAppStore.getState().copySelectedNodes();
    useAppStore.getState().pasteNodes({ x: 30, y: 30 });

    const pasted = useAppStore.getState().nodes.find((item) => item.id !== source.id);
    expect(pasted).toBeDefined();
    expect(pasted?.data).toMatchObject({
      directorRuntimeKind: 'blender',
      directorInstanceId: pasted?.id,
      directorStatus: 'idle',
      status: 'success',
      directorCaptureUrls: ['asset:///director/frame-a.png'],
      directorCaptureFilePaths: ['/data/project-a/frame-a.png'],
      imageUrl: 'asset:///director/frame-a.png',
      videoUrl: 'asset:///director/reference.mp4',
      filePath: '/data/project-a/reference.mp4',
    });
    expect(pasted?.data.error).toBeUndefined();
    expect(pasted?.data.directorCaptureUrls).not.toBe(source.data.directorCaptureUrls);
    expect(useAppStore.getState().directorDeskRuntimeRequest).toBeNull();
  });
});

describe('modifier-drag duplication', () => {
  it('moves only the new identity and restores the entire duplication with one undo', async () => {
    const source = { ...node('original'), selected: true, position: { x: 40, y: 60 },
      data: { ...node('original').data, displayId: 87 } };
    useAppStore.setState({ nodes: [source], selectedNodeIds: ['original'] });
    useAppStore.getState().commitToHistory();
    const drag = createNodeDuplicateDrag(useAppStore.getState, source.id);
    const move = (x: number, dragging: boolean) => useAppStore.getState().onNodesChange(drag.mapChanges([
      { type: 'position', id: source.id, position: { x, y: 200 }, dragging },
    ]));
    move(100, true);
    await Promise.resolve();
    move(300, true);
    expect(useAppStore.getState().nodes.find((item) => item.id === source.id)).toMatchObject(source);
    expect(useAppStore.getState().nodes.find((item) => item.id === source.id)?.data).toBe(source.data);
    expect(drag.getNode()?.position).toEqual({ x: 300, y: 200 });
    move(320, false);
    const clone = await drag.finish();
    expect(clone).toMatchObject({ position: { x: 320, y: 200 }, dragging: false, selected: true,
      data: { displayId: 88 } });
    expect(useAppStore.getState().nodes.find((item) => item.id === source.id)).toMatchObject({
      position: { x: 40, y: 60 }, data: { displayId: 87 }, selected: false,
    });
    expect(useAppStore.getState().selectedNodeIds).toEqual([clone!.id]);
    expect(await useAppStore.getState().undo()).toBe(true);
    expect(useAppStore.getState().nodes).toHaveLength(1);
    expect(useAppStore.getState().nodes[0]).toMatchObject({ id: source.id, position: source.position,
      data: { displayId: 87 } });
    expect(await useAppStore.getState().redo()).toBe(true);
    expect(useAppStore.getState().nodes.find((item) => item.id === clone!.id)?.position)
      .toEqual({ x: 320, y: 200 });
  });

  it('keeps the latest drop position when independent media copying finishes after pointer release', async () => {
    let finish!: (value: unknown) => void;
    fileMocks.copyFileToProjectData.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const source = mediaNode('source', 'a');
    useAppStore.setState({ currentProjectId: 'a', nodes: [source], showToast: vi.fn() });
    const drag = createNodeDuplicateDrag(useAppStore.getState, source.id);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    useAppStore.getState().onNodesChange(drag.mapChanges([
      { type: 'position', id: source.id, position: { x: 400, y: 500 }, dragging: false },
    ]));
    const stopped = drag.finish();
    expect(useAppStore.getState().nodes).toMatchObject([source]);
    finish({ filePath: '/data/a/copy.png', assetUrl: 'asset:///data/a/copy.png' });
    const clone = await stopped;
    expect(clone).toMatchObject({ position: { x: 400, y: 500 }, dragging: false,
      data: { filePath: '/data/a/copy.png' } });
    expect(useAppStore.getState().nodes.find((item) => item.id === source.id)).toMatchObject(source);
  });

  it('leaves the original untouched when media copying fails', async () => {
    fileMocks.copyFileToProjectData.mockRejectedValueOnce(new Error('copy failed'));
    const source = mediaNode('source', 'a');
    useAppStore.setState({ currentProjectId: 'a', nodes: [source], showToast: vi.fn() });
    const drag = createNodeDuplicateDrag(useAppStore.getState, source.id);
    useAppStore.getState().onNodesChange(drag.mapChanges([
      { type: 'position', id: source.id, position: { x: 400, y: 500 }, dragging: true },
    ]));
    expect(await drag.finish()).toBeUndefined();
    expect(useAppStore.getState().nodes).toMatchObject([source]);
  });

  it('does not apply a completed drag to a different project', async () => {
    useAppStore.setState({ currentProjectId: 'a', nodes: [node('source')] });
    const drag = createNodeDuplicateDrag(useAppStore.getState, 'source');
    await Promise.resolve();
    useAppStore.setState({ currentProjectId: 'b', nodes: [node('other')] });
    expect(await drag.finish()).toBeUndefined();
    expect(useAppStore.getState().nodes.map((item) => item.id)).toEqual(['other']);
  });

  it('preserves original group membership and adds the clone independently', async () => {
    useAppStore.setState({ nodes: [node('source')], groups: [{ id: 'group', name: 'group',
      nodeIds: ['source'], color: '#6366f1', createdAt: 1 }] });
    const cloneId = await useAppStore.getState().duplicateNode('source');
    expect(useAppStore.getState().groups[0].nodeIds).toEqual(['source', cloneId]);
  });
  it('does not publish a late copy into a different project', async () => {
    let finish!: (value: unknown) => void;
    fileMocks.copyFileToProjectData.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    useAppStore.setState({ currentProjectId: 'a', nodes: [mediaNode('source', 'a')], showToast: vi.fn() });
    const pending = useAppStore.getState().duplicateNode('source');
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    useAppStore.setState({ currentProjectId: 'b', nodes: [] });
    finish({ filePath: '/data/a/copy.png', assetUrl: 'asset:///data/a/copy.png' });
    await pending;
    expect(useAppStore.getState().nodes).toHaveLength(0);
    expect(fileMocks.moveToUndoTrash).toHaveBeenCalledWith('/data/a/copy.png');
  });

  it('does not replace a newly generated result while an older copy is pending', async () => {
    let finish!: (value: unknown) => void;
    fileMocks.copyFileToProjectData.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    useAppStore.setState({ currentProjectId: 'a', nodes: [mediaNode('source', 'a')], showToast: vi.fn() });
    const pending = useAppStore.getState().duplicateNode('source');
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    useAppStore.getState().updateNodeData('source', { filePath: '/data/a/new.png', imageUrl: 'asset:///data/a/new.png' });
    finish({ filePath: '/data/a/copy.png', assetUrl: 'asset:///data/a/copy.png' });
    await pending;
    expect(useAppStore.getState().nodes).toHaveLength(1);
    expect(useAppStore.getState().nodes[0].data.filePath).toBe('/data/a/new.png');
  });

  it('keeps incoming connections on both nodes without inheriting outgoing connections', () => {
    const incomingEdge: Edge = {
      id: 'edge-source-dragged',
      source: 'source',
      target: 'dragged',
      sourceHandle: 'output',
      targetHandle: 'prompt',
      type: 'smoothstep',
      animated: true,
      data: { channel: 'reference' },
    };
    useAppStore.setState({
      nodes: [node('source'), node('dragged'), node('downstream')],
      edges: [
        incomingEdge,
        { id: 'edge-dragged-downstream', source: 'dragged', target: 'downstream' },
      ],
    });

    useAppStore.getState().duplicateNode('dragged');

    const draggedClone = useAppStore.getState().nodes.find((item) => (
      !['source', 'dragged', 'downstream'].includes(item.id)
    ));
    expect(draggedClone).toBeDefined();

    const incomingEdges = useAppStore.getState().edges.filter((edge) => edge.source === 'source');
    expect(incomingEdges).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: draggedClone?.id }),
      expect.objectContaining({
        target: 'dragged',
        sourceHandle: 'output',
        targetHandle: 'prompt',
        type: 'smoothstep',
        animated: true,
        data: { channel: 'reference' },
      }),
    ]));
    expect(useAppStore.getState().edges).not.toContainEqual(expect.objectContaining({
      source: draggedClone?.id,
      target: 'downstream',
    }));
    expect(useAppStore.getState().edges).toContainEqual(expect.objectContaining({
      source: 'dragged',
      target: 'downstream',
    }));
    expect(useAppStore.getState().edges.find((edge) => edge.id === incomingEdge.id)).toBe(incomingEdge);
  });

  it('keeps director media while resetting the cloned runtime session', () => {
    const source = directorNode('director-dragged', 'lightweight-web', 'loading');
    useAppStore.setState({ nodes: [source], edges: [] });

    useAppStore.getState().duplicateNode(source.id);

    const clone = useAppStore.getState().nodes.find((item) => item.id !== source.id);
    expect(clone).toBeDefined();
    expect(clone?.data).toMatchObject({
      directorRuntimeKind: 'lightweight-web',
      directorInstanceId: clone?.id,
      directorStatus: 'idle',
      status: 'success',
      directorCaptureUrls: ['asset:///director/frame-a.png'],
      imageUrl: 'asset:///director/frame-a.png',
      videoUrl: 'asset:///director/reference.mp4',
    });
    expect(clone?.data.error).toBeUndefined();
    expect(clone?.data.directorCaptureUrls).not.toBe(source.data.directorCaptureUrls);
    expect(useAppStore.getState().directorDeskRuntimeRequest).toBeNull();
  });
});

describe('cross-project paste (跨项目粘贴)', () => {
  it('把媒体文件复制到目标项目，副本不再引用源项目', async () => {
    useAppStore.setState({
      currentProjectId: 'project-a',
      nodes: [mediaNode('media', 'project-a')],
      edges: [],
      selectedNodeIds: ['media'],
      showToast: vi.fn(),
    });
    useAppStore.getState().copySelectedNodes();

    useAppStore.setState({ currentProjectId: 'project-b', nodes: [], edges: [] });
    useAppStore.getState().pasteNodes({ x: 30, y: 30 });

    await vi.waitFor(() => expect(fileMocks.copyFileToProjectData).toHaveBeenCalledTimes(1));
    expect(fileMocks.copyFileToProjectData)
      .toHaveBeenCalledWith('/data/project-a/original.png', 'project-b', { redactErrors: true });
    await vi.waitFor(() => {
      expect(useAppStore.getState().nodes[0].data.filePath).toBe('/data/project-b/copied.png');
    });

    const pasted = useAppStore.getState().nodes[0];
    // 源项目的资产身份必须清掉，否则保存时会把副本认成源项目那份资产
    expect(pasted.data.assetId).toBeUndefined();
    expect(pasted.data.relativePath).toBeUndefined();
    expect(pasted.data.imageUrl).toBe('asset:///data/project-b/copied.png');
    expect(pasted.data.thumbnailUrl).toBe('asset:///data/project-b/copied.png');
  });

  it('复制失败时不插入共享源文件的副本', async () => {
    fileMocks.copyFileToProjectData.mockResolvedValue(null);
    const showToast = vi.fn();
    useAppStore.setState({
      currentProjectId: 'project-a',
      nodes: [mediaNode('media', 'project-a')],
      edges: [],
      selectedNodeIds: ['media'],
      showToast,
    });
    useAppStore.getState().copySelectedNodes();

    useAppStore.setState({ currentProjectId: 'project-b', nodes: [], edges: [], showToast });
    await useAppStore.getState().pasteNodes({ x: 30, y: 30 });
    expect(useAppStore.getState().nodes).toHaveLength(0);
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('复制失败'), 'error');
  });

  it('同项目内粘贴也复制独立文件', async () => {
    useAppStore.setState({
      currentProjectId: 'project-a',
      nodes: [mediaNode('media', 'project-a')],
      edges: [],
      selectedNodeIds: ['media'],
      showToast: vi.fn(),
    });
    useAppStore.getState().copySelectedNodes();
    await useAppStore.getState().pasteNodes({ x: 30, y: 30 });
    expect(fileMocks.copyFileToProjectData).toHaveBeenCalledTimes(1);
    const pasted = useAppStore.getState().nodes.find((item) => item.id !== 'media');
    expect(pasted?.data.filePath).toBe('/data/project-a/copied.png');
  });

  it('复制后编辑源节点不会改到剪贴板内容', () => {
    useAppStore.setState({
      currentProjectId: 'project-a',
      nodes: [node('text')],
      edges: [],
      selectedNodeIds: ['text'],
      showToast: vi.fn(),
    });
    useAppStore.getState().copySelectedNodes();
    useAppStore.getState().updateNodeData('text', { label: '改过的标题' });

    expect(useAppStore.getState().clipboard.nodes[0].data.label).toBe('text');
  });
});
