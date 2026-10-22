import test from 'node:test';
import assert from 'node:assert/strict';
import { diffLines } from '../src/core/diff.ts';
test('diff counts edits and preserves line mapping', () => {
  const result = diffLines('title\nold\nend', 'title\nnew\nend');
  assert.equal(result.added, 1); assert.equal(result.removed, 1);
  assert.deepEqual(result.lines.map(row => [row.kind, row.oldLine, row.newLine]), [['same',1,1],['remove',2,null],['add',null,2],['same',3,3]]);
});
test('empty, trailing newline and CRLF are represented consistently', () => {
  assert.equal(diffLines('', '').lines.length, 0); assert.equal(diffLines('', 'A').added, 1);
  assert.equal(diffLines('A\n', 'A').removed, 1); assert.equal(diffLines('A\r\nB', 'A\nB').added, 0);
});
test('large changed blocks use bounded fallback and retain both texts', () => {
  const a = Array.from({ length: 800 }, (_, i) => 'old' + i).join('\n');
  const b = Array.from({ length: 800 }, (_, i) => 'new' + i).join('\n'); const result = diffLines(a, b);
  assert.equal(result.coarse, true); assert.equal(result.added, 800); assert.equal(result.removed, 800);
  assert.equal(result.lines.filter(row => row.kind !== 'add').map(row => row.text).join('\n'), a);
  assert.equal(result.lines.filter(row => row.kind !== 'remove').map(row => row.text).join('\n'), b);
});
