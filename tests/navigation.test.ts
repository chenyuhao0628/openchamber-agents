import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openManager } from '../ui/navigation.ts';

const { openchamber: { contributes: { panel } } } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('management opens the registered side panel without requiring a project', async () => {
  const requests: string[] = [];
  const host = {
    async openSurface(id: string) { requests.push(id); },
    async openPopover() { assert.fail('Management must reuse the side panel'); },
    async openSession() { assert.fail('Management must preserve the conversation'); },
  };
  await openManager(host, panel);
  assert.deepEqual(requests, [`plugin:${panel.id}`]);
});

test('navigation failures identify the target panel', async () => {
  await assert.rejects(openManager({ async openSurface() { throw new Error('UNAVAILABLE'); } }, panel), error => {
    assert.ok(error instanceof Error);
    assert.ok(error.message.includes(panel.name));
    assert.doesNotMatch(error.message, /选择项目|浮层/);
    return true;
  });
});
