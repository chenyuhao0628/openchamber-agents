import { ConflictError, DATA_DIR, GLOBAL_PATH, LIBRARY_PATH, MAX_CONTENT, MAX_PROFILES, sameSnapshot, type Backup, type Files, type Library, type Loaded, type Profile, type Review, type Snapshot } from './types.ts';

const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value);
export const validateDraft = (name: string, content: string): void => {
  if (!name.trim() || name.trim().length > 60) throw new Error('方案名称需要 1–60 个字符。');
  if (content.length > MAX_CONTENT) throw new Error('规则内容不能超过 100,000 个字符。');
  if (content.includes('\0')) throw new Error('请选择纯文本规则，内容不能包含空字节。');
};
export const parseLibrary = (raw: string): Library => {
  try {
    const data = JSON.parse(raw) as Library;
    if (data.version !== 1 || !Array.isArray(data.profiles) || data.profiles.length > MAX_PROFILES) throw new Error();
    const ids = new Set<string>();
    for (const profile of data.profiles) {
      if (!profile || !validId(profile.id) || ids.has(profile.id) || typeof profile.name !== 'string' || typeof profile.content !== 'string' || typeof profile.archived !== 'boolean' || !Number.isFinite(profile.createdAt) || !Number.isFinite(profile.updatedAt)) throw new Error();
      validateDraft(profile.name, profile.content);
      ids.add(profile.id);
    }
    return data;
  } catch { throw new Error('方案库格式有误，现有文件未修改。请先修复 library.json 或恢复其备份。'); }
};
const sameRaw = async (files: Files, expected: string | null): Promise<void> => {
  if (await files.read(LIBRARY_PATH) !== expected) throw new ConflictError('方案库已被其他窗口修改。请先重新读取，当前草稿会保留。');
};
export const createRepository = (files: Files, now = Date.now, uuid: () => string = () => crypto.randomUUID()) => {
  const readGlobal = async (): Promise<Snapshot> => {
    const content = await files.read(GLOBAL_PATH);
    return { exists: content !== null, content: content ?? '' };
  };
  const writeLibrary = async (library: Library, expected: string | null): Promise<string> => {
    const raw = JSON.stringify(library, null, 2);
    if (raw.length > 1_500_000) throw new Error('方案库已达到容量上限，请先导出并整理内容。');
    await sameRaw(files, expected);
    await files.write(LIBRARY_PATH, raw);
    if (await files.read(LIBRARY_PATH) !== raw) throw new ConflictError('保存后方案库又发生了变化，请重新读取；不要重复覆盖。');
    return raw;
  };
  const load = async (initialize = false): Promise<Loaded> => {
    const [raw, global] = await Promise.all([files.read(LIBRARY_PATH), readGlobal()]);
    if (raw !== null) return { raw, library: parseLibrary(raw), global };
    const library: Library = { version: 1, profiles: [] };
    if (initialize && global.exists) {
      validateDraft('现有全局规则', global.content);
      const stamp = now();
      library.profiles.push({ id: uuid(), name: '现有全局规则', content: global.content, archived: false, createdAt: stamp, updatedAt: stamp });
    }
    return { raw: initialize ? await writeLibrary(library, null) : null, library, global };
  };
  const save = async (loaded: Loaded, draft: { id?: string; name: string; content: string }): Promise<Loaded> => {
    validateDraft(draft.name, draft.content);
    const library = structuredClone(loaded.library);
    const existing = draft.id ? library.profiles.find(profile => profile.id === draft.id) : undefined;
    if (draft.id && !existing) throw new ConflictError('此方案已不在方案库中，请重新读取。');
    if (existing?.archived) throw new Error('请先恢复已归档方案，再编辑。');
    if (library.profiles.some(profile => profile.id !== draft.id && profile.name === draft.name.trim())) throw new Error('已有同名方案，请使用不同名称。');
    if (existing) Object.assign(existing, { name: draft.name.trim(), content: draft.content, updatedAt: now() });
    else {
      if (library.profiles.length >= MAX_PROFILES) throw new Error('最多保存 100 个方案（含归档方案）。');
      library.profiles.push({ id: uuid(), name: draft.name.trim(), content: draft.content, createdAt: now(), updatedAt: now(), archived: false });
    }
    const raw = await writeLibrary(library, loaded.raw);
    return { library, raw, global: loaded.global };
  };
  const archive = async (loaded: Loaded, id: string, archived: boolean): Promise<Loaded> => {
    const library = structuredClone(loaded.library);
    const profile = library.profiles.find(item => item.id === id);
    if (!profile) throw new ConflictError('此方案不存在，请重新读取。');
    const global = await readGlobal();
    if (archived && global.exists && profile.content === global.content) throw new Error('该方案与当前全局文件一致，请先启用其他方案再归档。');
    profile.archived = archived;
    profile.updatedAt = now();
    return { library, raw: await writeLibrary(library, loaded.raw), global };
  };
  const reviewProfile = async (loaded: Loaded, id: string): Promise<Review> => {
    await sameRaw(files, loaded.raw);
    const profile = loaded.library.profiles.find(item => item.id === id && !item.archived);
    if (!profile) throw new Error('请选择一个未归档的已保存方案。');
    return { name: profile.name, content: profile.content, before: await readGlobal(), source: 'profile', profileId: profile.id };
  };
  const apply = async (loaded: Loaded, review: Review): Promise<{ global: Snapshot; backup: string | null }> => {
    if (review.source === 'profile') {
      await sameRaw(files, loaded.raw);
      const profile = loaded.library.profiles.find(item => item.id === review.profileId && !item.archived);
      if (!profile || profile.content !== review.content) throw new ConflictError('方案已变化，请重新预览。');
    }
    let current = await readGlobal();
    if (!sameSnapshot(current, review.before)) throw new ConflictError('全局文件在预览后已被修改，未写入。请返回并重新预览差异。');
    if (current.exists && current.content === review.content) return { global: current, backup: null };
    let backup: string | null = null;
    if (current.exists) {
      const stamp = now();
      backup = `${stamp}-${uuid()}`;
      const item: Backup = { version: 1, id: backup, createdAt: stamp, label: `${review.source === 'backup' ? '恢复' : '启用'}“${review.name}”前`, content: current.content };
      const path = `${DATA_DIR}/backups/${backup}.json`;
      const raw = JSON.stringify(item, null, 2);
      // Backup failure or a changed file aborts before touching the global rules.
      await files.write(path, raw);
      if (await files.read(path) !== raw) throw new Error('备份校验失败，全局文件未修改。');
    }
    if (review.source === 'profile') await sameRaw(files, loaded.raw);
    current = await readGlobal();
    if (!sameSnapshot(current, review.before)) throw new ConflictError('写入前全局文件发生变化，未写入。请重新预览。');
    await files.write(GLOBAL_PATH, review.content);
    const result = await readGlobal();
    if (!result.exists || result.content !== review.content) throw new ConflictError('写入后文件内容与方案不一致，可能有其他编辑器同时写入。请重新读取；切换前的备份仍可查看。');
    return { global: result, backup };
  };
  const listBackups = async (): Promise<string[]> => (await files.list(`${DATA_DIR}/backups`)).filter(name => /^\d{13}-[a-f0-9-]{36}\.json$/.test(name)).sort().reverse().slice(0, 50).map(name => name.slice(0, -5));
  const readBackup = async (id: string): Promise<Backup> => {
    if (!/^\d{13}-[a-f0-9-]{36}$/.test(id)) throw new Error('备份编号无效。');
    const raw = await files.read(`${DATA_DIR}/backups/${id}.json`);
    try {
      const data = JSON.parse(raw ?? '') as Backup;
      if (data.version !== 1 || data.id !== id || !Number.isFinite(data.createdAt) || typeof data.label !== 'string' || typeof data.content !== 'string') throw new Error();
      return data;
    } catch { throw new Error('备份缺失或格式有误，未修改全局文件。'); }
  };
  const reviewBackup = async (id: string): Promise<Review> => {
    const backup = await readBackup(id);
    return { source: 'backup', name: new Date(backup.createdAt).toLocaleString('zh-CN'), content: backup.content, before: await readGlobal() };
  };
  const exportProfile = async (profile: Profile): Promise<string> => {
    if (!validId(profile.id)) throw new Error('方案编号无效。');
    const path = `${DATA_DIR}/exports/${profile.id}.md`;
    await files.write(path, profile.content);
    return path;
  };
  return { load, readGlobal, save, archive, reviewProfile, apply, listBackups, readBackup, reviewBackup, exportProfile };
};
export type Repository = ReturnType<typeof createRepository>;
