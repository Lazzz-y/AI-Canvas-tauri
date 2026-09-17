import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.resetModules();
});

const move = { projectId: 'p', oldPath: 'D:/p/a.png', newPath: 'D:/p/group/a-new.png',
  oldAssetUrl: 'asset://old', assetUrl: 'asset://new', relativePath: 'group/a-new.png' };

async function put(db: IDBDatabase, store: string, value: unknown) {
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
}
async function read(db: IDBDatabase, store: string, key: string) {
  return new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

it('atomically migrates persisted references and keeps pending cleanup until completed', async () => {
  const { openDB } = await import('../../src/services/indexedDb/schema');
  const service = await import('../../src/services/indexedDb/mediaRelocations');
  const db = await openDB();
  await put(db, 'projects', { id: 'p', nodes: [{ id: 'n', data: { filePath: move.oldPath, imageUrl: move.oldAssetUrl } }] });
  for (const store of ['history', 'chatMessages']) await put(db, store, { id: 'h', filePath: move.oldPath, mediaUrl: move.oldAssetUrl });
  await put(db, 'assetIndex', { assetId: 'a', filePath: move.oldPath, relativePath: 'a.png' });
  await put(db, 'assetMeta', { path: move.oldPath, description: 'keep' });
  await service.persistMediaRelocation(move);
  expect((await read(db, 'projects', 'p'))?.nodes).toEqual([{ id: 'n', data: {
    filePath: move.newPath, imageUrl: move.assetUrl, relativePath: move.relativePath,
  } }]);
  expect(await read(db, 'history', 'h')).toMatchObject({ filePath: move.newPath, mediaUrl: move.assetUrl });
  expect(await read(db, 'chatMessages', 'h')).toMatchObject({ filePath: move.newPath });
  expect(await read(db, 'assetIndex', 'a')).toMatchObject({ assetId: 'a', relativePath: move.relativePath });
  expect(await read(db, 'assetMeta', move.oldPath)).toBeUndefined();
  expect(await read(db, 'assetMeta', move.newPath)).toMatchObject({ description: 'keep' });
  expect(await service.pendingMediaRelocations('p')).toEqual([move]);
  await service.completeMediaRelocation(move);
  expect(await service.pendingMediaRelocations('p')).toEqual([]);
});

it('normalizes a stale history write after relocation and cleanup', async () => {
  const relocation = await import('../../src/services/indexedDb/mediaRelocations');
  const service = await import('../../src/services/indexedDbService');
  await relocation.persistMediaRelocation(move);
  await relocation.completeMediaRelocation(move);
  await service.putHistoryEntry({ id: 'h', projectId: 'p', nodeId: 'n', nodeLabel: 'n', timestamp: 1,
    prompt: 'keep', output: '', nodeType: 'ai-image', model: 'm', provider: 'p', status: 'success',
    filePath: move.oldPath, mediaUrl: move.oldAssetUrl });
  expect((await service.getNodeHistoryEntries('p', 'n'))[0]).toMatchObject({ filePath: move.newPath, mediaUrl: move.assetUrl });
});

it('rolls back all references and the journal if an asset index constraint fails', async () => {
  const service = await import('../../src/services/indexedDb/mediaRelocations');
  const { openDB } = await import('../../src/services/indexedDb/schema');
  const db = await openDB();
  await put(db, 'history', { id: 'h', filePath: move.oldPath });
  await put(db, 'assetIndex', { assetId: 'old', path: move.oldPath });
  await put(db, 'assetIndex', { assetId: 'new', path: move.newPath });
  await expect(service.persistMediaRelocation(move)).rejects.toBeTruthy();
  expect(await read(db, 'history', 'h')).toMatchObject({ filePath: move.oldPath });
  expect(await service.pendingMediaRelocations('p')).toEqual([]);
});

it('updates undo, clipboard and URL references without changing embedded prompts', async () => {
  const { relocateMediaReferences } = await import('../../src/services/indexedDb/mediaRelocations');
  const node = { id: 'n', data: { filePath: 'D:\\p\\a.png', imageUrl: move.oldAssetUrl, prompt: `use ${move.oldPath}` } };
  const result = relocateMediaReferences({ history: [{ nodes: [node] }], clipboard: [node] }, [move]);
  expect(result.history[0].nodes[0].data.filePath).toBe(move.newPath);
  expect(result.clipboard[0].data.imageUrl).toBe(move.assetUrl);
  expect(result.clipboard[0].data.prompt).toBe(`use ${move.oldPath}`);
  expect(node.data.filePath).toBe('D:\\p\\a.png');
});

it('splits shared owners before moving the final owner and normalizes stale shared writes in order', async () => {
  const service = await import('../../src/services/indexedDb/mediaRelocations');
  const { openDB } = await import('../../src/services/indexedDb/schema');
  const db = await openDB();
  const original = { id: 'p', nodes: ['a', 'b'].map((id) => ({ id, data: { filePath: move.oldPath, assetId: 'original-asset' } })) };
  await put(db, 'projects', original);
  await service.persistMediaRelocation(move, 'a');
  expect(await service.pendingMediaRelocations('p')).toEqual([{ ...move, ownerId: 'a' }]);
  await service.completeMediaRelocation(move);
  const last = { ...move, newPath: 'D:/p/group/b.png', relativePath: 'group/b.png' };
  await service.persistMediaRelocation(last);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['projects', 'metadata'], 'readwrite');
    service.withRelocatedMedia(tx, original, (next) => tx.objectStore('projects').put(next));
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
  expect((await read(db, 'projects', 'p'))?.nodes).toEqual([
    { id: 'a', data: { filePath: move.newPath, relativePath: move.relativePath } },
    { id: 'b', data: { filePath: last.newPath, relativePath: last.relativePath, assetId: 'original-asset' } },
  ]);
});
