import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepository, parseLibrary, validateDraft } from '../src/core/repository.ts';
import { ConflictError, DATA_DIR, GLOBAL_PATH, LIBRARY_PATH, matchedProfile, type Files } from '../src/core/types.ts';

const fixture = (initial: string | null = '# 团队规则\n先运行检查。\n') => {
  const disk = new Map<string, string>(); if (initial !== null) disk.set(GLOBAL_PATH, initial);
  const writes: string[] = []; let sequence = 0;
  const files: Files = {
    read: async path => disk.get(path) ?? null,
    write: async (path, content) => { writes.push(path); disk.set(path, content); },
    list: async path => [...disk.keys()].filter(key => key.startsWith(path + '/')).map(key => key.slice(path.length + 1)),
  };
  const repo = createRepository(files, () => 1_800_000_000_000 + sequence, () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`);
  const prepare = async () => {
    let loaded = await repo.load(true); loaded = await repo.save(loaded, { name: '代码审查', content: '# 审查规则\n关注变更风险。\n' });
    return { loaded, review: await repo.reviewProfile(loaded, loaded.library.profiles.at(-1)!.id) };
  };
  return { disk, writes, files, repo, prepare };
};
test('status reads never create a library; initial import preserves global byte for byte', async () => {
  const f = fixture(); const before = f.disk.get(GLOBAL_PATH);
  assert.equal((await f.repo.load(false)).library.profiles.length, 0); assert.deepEqual(f.writes, []);
  const loaded = await f.repo.load(true); assert.equal(matchedProfile(loaded)?.name, '现有全局规则');
  assert.equal(f.disk.get(GLOBAL_PATH), before); assert.deepEqual(f.writes, [LIBRARY_PATH]);
});
test('saving and reviewing do not activate; apply backs up before writing and reads back', async () => {
  const f = fixture(); const before = f.disk.get(GLOBAL_PATH); const { loaded, review } = await f.prepare();
  assert.equal(f.disk.get(GLOBAL_PATH), before);
  const result = await f.repo.apply(loaded, review); assert.equal(result.global.content, review.content);
  const backup = await f.repo.readBackup(result.backup!); assert.equal(backup.content, before);
  assert.match(f.writes.at(-2)!, /backups\/.*\.json$/); assert.equal(f.writes.at(-1), GLOBAL_PATH);
});
test('missing global can be created; identical content makes no writes', async () => {
  const f = fixture(null); const { loaded, review } = await f.prepare();
  assert.equal((await f.repo.apply(loaded, review)).backup, null);
  const next = await f.repo.load(); const again = await f.repo.reviewProfile(next, review.profileId!);
  f.writes.length = 0; await f.repo.apply(next, again); assert.deepEqual(f.writes, []);
});
test('backup write failure aborts activation', async () => {
  const f = fixture(); const { loaded, review } = await f.prepare(); const before = f.disk.get(GLOBAL_PATH);
  f.files.write = async () => { throw new Error('disk full'); };
  await assert.rejects(f.repo.apply(loaded, review), /disk full/); assert.equal(f.disk.get(GLOBAL_PATH), before);
});
test('backup readback failure aborts activation', async () => {
  const f = fixture(); const { loaded, review } = await f.prepare(); const before = f.disk.get(GLOBAL_PATH);
  f.files.write = async (path) => { f.disk.set(path, 'corrupted'); };
  await assert.rejects(f.repo.apply(loaded, review), /备份校验失败/); assert.equal(f.disk.get(GLOBAL_PATH), before);
});
test('external edit after preview is preserved', async () => {
  const f = fixture(); const { loaded, review } = await f.prepare(); f.disk.set(GLOBAL_PATH, 'external');
  await assert.rejects(f.repo.apply(loaded, review), ConflictError); assert.equal(f.disk.get(GLOBAL_PATH), 'external'); assert.equal((await f.repo.listBackups()).length, 0);
});
test('external edit during backup is preserved', async () => {
  const f = fixture(); const { loaded, review } = await f.prepare(); const write = f.files.write;
  f.files.write = async (path, content) => { await write(path, content); if (path.includes('/backups/')) f.disk.set(GLOBAL_PATH, 'concurrent edit'); };
  await assert.rejects(f.repo.apply(loaded, review), ConflictError); assert.equal(f.disk.get(GLOBAL_PATH), 'concurrent edit');
});
test('profile library edited during backup aborts activation', async () => {
  const f = fixture(); const { loaded, review } = await f.prepare(); const write = f.files.write; const before = f.disk.get(GLOBAL_PATH);
  f.files.write = async (path, content) => { await write(path, content); if (path.includes('/backups/')) f.disk.set(LIBRARY_PATH, 'external revision'); };
  await assert.rejects(f.repo.apply(loaded, review), ConflictError); assert.equal(f.disk.get(GLOBAL_PATH), before);
});
test('global write failure retains the recoverable backup', async () => {
  const f = fixture(); const { loaded, review } = await f.prepare(); const write = f.files.write; const before = f.disk.get(GLOBAL_PATH);
  f.files.write = async (path, content) => { if (path === GLOBAL_PATH) throw new Error('write refused'); await write(path, content); };
  await assert.rejects(f.repo.apply(loaded, review), /write refused/);
  assert.equal((await f.repo.readBackup((await f.repo.listBackups())[0])).content, before);
});
test('global readback detects a writer that won after activation', async () => {
  const f = fixture(); const { loaded, review } = await f.prepare(); const write = f.files.write;
  f.files.write = async (path, content) => { await write(path, content); if (path === GLOBAL_PATH) f.disk.set(path, 'newer writer'); };
  await assert.rejects(f.repo.apply(loaded, review), /写入后文件内容/); assert.equal(f.disk.get(GLOBAL_PATH), 'newer writer');
});
test('corrupt libraries are not reset; stale edits and simultaneous initialization are rejected', async () => {
  const f = fixture(); f.disk.set(LIBRARY_PATH, '{broken'); await assert.rejects(f.repo.load(true), /格式有误/); assert.deepEqual(f.writes, []);
  f.disk.delete(LIBRARY_PATH); const old = await f.repo.load(true);
  await f.repo.save(old, { name: 'First', content: 'A' });
  await assert.rejects(f.repo.save(old, { name: 'Second', content: 'B' }), ConflictError);
  const fresh = fixture(); const read = fresh.files.read; let intercepted = false;
  fresh.files.read = async path => { if (path === LIBRARY_PATH && !intercepted) { intercepted = true; return null; } if (path === LIBRARY_PATH) return '{"version":1,"profiles":[]}'; return read(path); };
  await assert.rejects(fresh.repo.load(true), ConflictError); assert.deepEqual(fresh.writes, []);
});
test('archive is reversible, and refuses the profile matching actual global contents', async () => {
  const f = fixture(); const { loaded, review } = await f.prepare();
  await assert.rejects(f.repo.archive(loaded, loaded.library.profiles[0].id, true), /当前全局文件一致/);
  let next = await f.repo.archive(loaded, review.profileId!, true); assert.equal(next.library.profiles.at(-1)!.archived, true);
  await assert.rejects(f.repo.reviewProfile(next, review.profileId!), /未归档/);
  next = await f.repo.archive(next, review.profileId!, false); assert.equal(next.library.profiles.at(-1)!.archived, false);
});
test('restoring a backup first backs up the current global file', async () => {
  const f = fixture(); const before = f.disk.get(GLOBAL_PATH); const { loaded, review } = await f.prepare();
  const applied = await f.repo.apply(loaded, review); const restore = await f.repo.reviewBackup(applied.backup!);
  const restored = await f.repo.apply(await f.repo.load(), restore);
  assert.equal(restored.global.content, before); assert.equal((await f.repo.readBackup(restored.backup!)).content, review.content);
});
test('empty rules are backed up and may be restored', async () => {
  const f = fixture(''); const { loaded, review } = await f.prepare(); const result = await f.repo.apply(loaded, review);
  assert.equal((await f.repo.readBackup(result.backup!)).content, '');
});
test('validation rejects malformed files, traversal, duplicate names and oversized drafts', async () => {
  const f = fixture(); const loaded = await f.repo.load(true);
  assert.throws(() => parseLibrary('{"version":9,"profiles":[]}'), /格式有误/);
  const broken = structuredClone(loaded.library); broken.profiles[0].id = '../escape'; assert.throws(() => parseLibrary(JSON.stringify(broken)), /格式有误/);
  assert.throws(() => validateDraft(' ', ''), /名称/); assert.throws(() => validateDraft('valid', '\0'), /空字节/);
  assert.throws(() => validateDraft('valid', 'a'.repeat(100001)), /100,000/);
  await assert.rejects(f.repo.save(loaded, { name: '现有全局规则', content: '' }), /同名/);
  await assert.rejects(f.repo.readBackup('../../AGENTS'), /编号无效/);
  await assert.rejects(f.repo.exportProfile({ ...loaded.library.profiles[0], id: '../escape' }), /编号无效/);
});
test('exports contain exact saved plain text without changing the global file', async () => {
  const f = fixture(); const loaded = await f.repo.load(true); const profile = loaded.library.profiles[0]; f.writes.length = 0;
  const path = await f.repo.exportProfile(profile); assert.equal(f.disk.get(path), profile.content); assert.ok(path.startsWith(`${DATA_DIR}/exports/`)); assert.deepEqual(f.writes, [path]);
});
