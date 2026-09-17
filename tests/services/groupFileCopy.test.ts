import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const disk = vi.hoisted(() => new Set<string>());
const native = vi.hoisted(() => ({ copy: vi.fn(), rename: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(async (path: string) => disk.has(path)),
  mkdir: vi.fn(async (path: string) => { disk.add(path); }),
  copyFile: native.copy, rename: native.rename,
  readDir: vi.fn(), readFile: vi.fn(), stat: vi.fn(), watch: vi.fn(), writeFile: vi.fn(),
}));
import { moveProjectFileToFolder } from '../../src/services/fs/core';

beforeEach(() => {
  disk.clear();
  disk.add('/p/original.png');
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
  native.copy.mockReset();
  native.rename.mockReset();
  native.copy.mockImplementation(async (source: string, target: string) => {
    if (!disk.has(source) || disk.has(target)) throw new Error('invalid copy');
    disk.add(target);
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('group file allocation', () => {
  it('puts two legacy shared images in one folder as independent files', async () => {
    const a = await moveProjectFileToFolder('/p/original.png', '/p', 'group', { preserveSource: true, forceCopy: true });
    const b = await moveProjectFileToFolder('/p/original.png', '/p', 'group', { preserveSource: true, forceCopy: true });
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
    expect(disk.has(a!)).toBe(true);
    expect(disk.has(b!)).toBe(true);
    expect(disk.has('/p/original.png')).toBe(true);
    expect(native.rename).not.toHaveBeenCalled();
    expect(await moveProjectFileToFolder(a!, '/p', 'group', { preserveSource: true })).toBeNull();
  });

  it('leaves an outside reference and old history readable after moving between groups', async () => {
    const grouped = await moveProjectFileToFolder('/p/original.png', '/p', 'one', { preserveSource: true });
    const moved = await moveProjectFileToFolder(grouped!, '/p', 'two', { preserveSource: true });
    expect(disk.has('/p/original.png')).toBe(true);
    expect(disk.has(grouped!)).toBe(true);
    expect(disk.has(moved!)).toBe(true);
  });
});
