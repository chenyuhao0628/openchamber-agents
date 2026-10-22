export type DiffLine = { kind: 'same' | 'add' | 'remove'; text: string; oldLine: number | null; newLine: number | null };
export const diffLines = (before: string, after: string): { lines: DiffLine[]; added: number; removed: number; coarse: boolean } => {
  const split = (text: string): string[] => text === '' ? [] : text.replace(/\r\n/g, '\n').split('\n');
  const a = split(before), b = split(after);
  const raw: Array<{ kind: DiffLine['kind']; text: string }> = [];
  let start = 0, endA = a.length, endB = b.length;
  while (start < endA && start < endB && a[start] === b[start]) { raw.push({ kind: 'same', text: a[start] }); start++; }
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const n = endA - start, m = endB - start;
  const coarse = n * m > 250_000;
  if (coarse) {
    a.slice(start, endA).forEach(text => raw.push({ kind: 'remove', text }));
    b.slice(start, endB).forEach(text => raw.push({ kind: 'add', text }));
  } else {
    const matrix = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) matrix[i][j] = a[start + i] === b[start + j] ? matrix[i + 1][j + 1] + 1 : Math.max(matrix[i + 1][j], matrix[i][j + 1]);
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[start + i] === b[start + j]) { raw.push({ kind: 'same', text: a[start + i++] }); j++; }
      else if (i < n && (j === m || matrix[i + 1][j] >= matrix[i][j + 1])) raw.push({ kind: 'remove', text: a[start + i++] });
      else raw.push({ kind: 'add', text: b[start + j++] });
    }
  }
  a.slice(endA).forEach(text => raw.push({ kind: 'same', text }));
  let oldLine = 0, newLine = 0;
  return {
    lines: raw.map(line => ({ ...line, oldLine: line.kind === 'add' ? null : ++oldLine, newLine: line.kind === 'remove' ? null : ++newLine })),
    added: raw.filter(line => line.kind === 'add').length, removed: raw.filter(line => line.kind === 'remove').length, coarse,
  };
};
