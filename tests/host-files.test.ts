import test from 'node:test';
import assert from 'node:assert/strict';
import type { HostClient } from '@openchamber/sdk';
import { explainError, FileOperationError, hostFiles } from '../src/platform/host-files.ts';
import { DATA_DIR, GLOBAL_PATH, LIBRARY_PATH } from '../src/core/types.ts';
const contextMock = () => ({ onReady: () => () => {}, onDirectory: () => () => {} });
test('missing file is empty state; denied file is an error, never empty data', async () => {
  const mock = (code: string) => ({ ...contextMock(), readFile: async () => { throw { code }; }, listDir: async () => { throw { code }; } }) as unknown as HostClient;
  const missing = hostFiles(mock('NOT_FOUND')); assert.equal(await missing.read('fixture'), null); assert.deepEqual(await missing.list('fixture'), []);
  const denied = hostFiles(mock('NOT_GRANTED')); await assert.rejects(denied.read('fixture')); await assert.rejects(denied.list('fixture'));
});

test('global file errors identify the operation and current directory compatibility issue without disclosing paths', async () => {
  let directoryChanged: (directory: string | null) => void = () => {};
  const failure = Object.assign(new Error('Extension operation failed.'), { code: 'HOST_REJECTED' });
  const mock = {
    onReady: (listener: (context: { directory: string | null }) => void) => { listener({ directory: '/fixture/中文目录' }); return () => {}; },
    onDirectory: (listener: typeof directoryChanged) => { directoryChanged = listener; return () => {}; },
    readFile: async () => { throw failure; },
    writeFile: async () => { throw failure; },
    listDir: async () => { throw failure; },
  } as unknown as HostClient;
  const files = hostFiles(mock);
  for (const [request, label] of [
    [() => files.read(GLOBAL_PATH), '读取全局规则失败'],
    [() => files.read(LIBRARY_PATH), '读取方案库失败'],
    [() => files.list(`${DATA_DIR}/backups`), '读取备份列表失败'],
  ] as const) {
    await assert.rejects(request(), error => {
      assert.ok(error instanceof FileOperationError);
      assert.equal(error.code, 'HOST_REJECTED'); assert.equal(error.cause, failure);
      const message = explainError(error);
      assert.ok(message.includes(label)); assert.match(message, /目录含中文/);
      assert.doesNotMatch(message, /fixture|中文目录|Extension operation failed/);
      return true;
    });
  }
  await assert.rejects(files.write(GLOBAL_PATH, 'synthetic'), /写入全局规则失败.*勿直接重复写入/);
  for (const directory of [null, '/fixture/ascii', '/fixture/café']) {
    directoryChanged(directory);
    await assert.rejects(files.read(GLOBAL_PATH), error => {
      assert.match(explainError(error), /未提供具体原因/);
      assert.doesNotMatch(explainError(error), /目录含中文/);
      return true;
    });
  }
});

test('failure diagnosis uses the directory observed when the request starts', async () => {
  let directoryChanged: (directory: string | null) => void = () => {};
  const mock = {
    ...contextMock(),
    onDirectory: (listener: typeof directoryChanged) => { directoryChanged = listener; return () => {}; },
    readFile: async () => { directoryChanged('/fixture/中文目录'); throw Object.assign(new Error('Extension operation failed.'), { code: 'HOST_REJECTED' }); },
  } as unknown as HostClient;
  await assert.rejects(hostFiles(mock).read(GLOBAL_PATH), error => {
    assert.match(explainError(error), /未提供具体原因/); assert.doesNotMatch(explainError(error), /目录含中文/); return true;
  });
});

test('permission and timeout failures remain distinct from host compatibility errors', async () => {
  for (const [code, expected] of [['NOT_GRANTED', /设置 → 扩展/], ['DENIED', /文件权限不足/], ['HOST_TIMEOUT', /宿主响应超时/], ['BAD_PATH', /授权范围/]] as const) {
    const error = new FileOperationError('read', LIBRARY_PATH, { code }, true);
    assert.match(explainError(error), expected); assert.doesNotMatch(explainError(error), /目录含中文/);
  }
});
