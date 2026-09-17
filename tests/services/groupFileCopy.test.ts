import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const disk = vi.hoisted(() => new Set<string>());
const native = vi.hoisted(() => ({ copy: vi.fn(), rename: vi.fn(), exists: vi.fn(), lstat: vi.fn(), remove: vi.fn(), readDir: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: native.exists,
  mkdir: vi.fn(async (path: string) => { disk.add(path); }),
  copyFile: native.copy, rename: native.rename,
  lstat: native.lstat, remove: native.remove, readDir: native.readDir,
  readFile: vi.fn(), stat: vi.fn(), watch: vi.fn(), writeFile: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path: string) => path,
  invoke: (_command: string, args: { sourcePath: string; destinationPath: string }) => native.copy(args.sourcePath, args.destinationPath) }));
import { moveProjectFileToFolder, resolveUniqueDestPath, finishProjectFileRelocation } from '../../src/services/fs/core';

beforeEach(() => {
  disk.clear();
  disk.add('/p/original.png');
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {}, dispatchEvent: vi.fn() });
  native.copy.mockReset();
  native.rename.mockReset();
  native.exists.mockImplementation(async (path: string) => disk.has(path));
  native.lstat.mockReset().mockImplementation(async (path: string) => {
    if (!disk.has(path)) throw new Error('missing');
    return { isFile: path.endsWith('.png'), isDirectory: !path.endsWith('.png'), isSymlink: false, size: 42 };
  });
  native.remove.mockReset().mockImplementation(async (path: string) => { disk.delete(path); });
  native.readDir.mockReset().mockImplementation(async (path: string) => [...disk].filter((file) => file.startsWith(`${path}/`)));
  native.copy.mockImplementation(async (source: string, target: string) => {
    if (!disk.has(source) || disk.has(target)) throw new Error('invalid copy');
    disk.add(target);
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('group file allocation', () => {
  it('removes the committed source and empty group directory, keeping the destination', async () => {
    for (const path of ['/p/group', '/p/group/old.png', '/p/new.png']) disk.add(path);
    await finishProjectFileRelocation('/p/group/old.png', '/p/new.png', '/p');
    expect(disk.has('/p/group/old.png')).toBe(false);
    expect(disk.has('/p/group')).toBe(false);
    expect(disk.has('/p/new.png')).toBe(true);
  });

  it('keeps nonempty folders and never removes the project root', async () => {
    for (const path of ['/p/group', '/p/group/old.png', '/p/group/other.png', '/p/new.png']) disk.add(path);
    await finishProjectFileRelocation('/p/group/old.png', '/p/new.png', '/p');
    expect(disk.has('/p/group')).toBe(true);
    await finishProjectFileRelocation('/p/original.png', '/p/new.png', '/p');
    expect(native.remove).not.toHaveBeenCalledWith('/p');
  });

  it('preserves the source when the target is missing or content size changed', async () => {
    await expect(finishProjectFileRelocation('/p/original.png', '/p/missing.png', '/p')).rejects.toThrow();
    disk.add('/p/new.png');
    native.lstat.mockResolvedValueOnce({ isFile: true, size: 99 });
    await expect(finishProjectFileRelocation('/p/original.png', '/p/new.png', '/p')).rejects.toThrow();
    expect(native.remove).not.toHaveBeenCalled();
  });

  it('rejects cleanup outside the project or through traversal paths', async () => {
    await expect(finishProjectFileRelocation('/elsewhere/a.png', '/p/new.png', '/p')).rejects.toThrow();
    await expect(finishProjectFileRelocation('/p/../a.png', '/p/new.png', '/p')).rejects.toThrow();
    expect(native.remove).not.toHaveBeenCalled();
  });
  it('allocates distinct destinations even before concurrent writers create their files', async () => {
    const paths = await Promise.all(Array.from({ length: 20 }, () => resolveUniqueDestPath('/p', 'result.png', true)));
    expect(new Set(paths).size).toBe(20);
  });

  it('aborts allocation when checking the destination fails', async () => {
    native.exists.mockRejectedValueOnce(new Error('denied'));
    await expect(resolveUniqueDestPath('/p', 'result.png')).rejects.toThrow('denied');
  });

  it('ungroups an older result while a same-named newer result exists without replacing it', async () => {
    disk.add('/p/group/result.png');
    disk.add('/p/result.png');
    const result = await moveProjectFileToFolder('/p/group/result.png', '/p', null, { preserveSource: true });
    expect(result).not.toBe('/p/result.png');
    expect(result).toBeTruthy();
    expect(disk.has('/p/result.png')).toBe(true);
    expect(disk.has('/p/group/result.png')).toBe(true);
  });
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
