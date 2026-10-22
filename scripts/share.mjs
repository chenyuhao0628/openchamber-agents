// npm run share：生成可发给其他用户安装的 zip。
//
// 产物包含宿主（OpenChamber 2.4.0）zip 安装所需的全部文件：
//   openchamber-agents/package.json
//   openchamber-agents/panel/index.html · main.js · section.html · section.js
//   openchamber-agents/README.md · 安装说明.md
//
// 归档按宿主的解包校验构造：单一根目录、deflate、无 zip64、无加密、无数据
// 描述符，且远低于 500 个文件 / 40 MiB 上限。生成后在同一脚本内读回归档，
// 复核成员、尺寸、CRC 与内容，再写出到 dist/。
//
// 不做的事：不读取全局规则或方案库，不联网，不修改发行文件。

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const extensionDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(extensionDir, 'dist');
const rootFolder = 'openchamber-agents';
const shipFiles = [
  'package.json',
  'README.md',
  '安装说明.md',
  'panel/index.html',
  'panel/main.js',
  'panel/section.html',
  'panel/section.js',
];

const fail = (message) => {
  console.error(`打包失败：${message}`);
  process.exit(1);
};

// ---- 构建与收集发行文件 -----------------------------------------------------

try {
  execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: extensionDir, stdio: 'inherit' });
} catch {
  fail('构建未通过；先在扩展目录运行 npm ci 和 npm run build 排查。');
}

const manifest = JSON.parse(readFileSync(path.join(extensionDir, 'package.json'), 'utf8'));
if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
  fail('package.json 缺少 version。');
}

for (const relativePath of shipFiles) {
  try {
    readFileSync(path.join(extensionDir, relativePath));
  } catch {
    fail(`缺少发行文件 ${relativePath}。`);
  }
}

// 生成脚本必须是宿主可直接加载的成品；语法检查只验证可解析性。
for (const relativePath of ['panel/main.js', 'panel/section.js']) {
  try {
    execFileSync(process.execPath, ['--check', path.join(extensionDir, relativePath)], { stdio: 'pipe' });
  } catch {
    fail(`${relativePath} 语法检查未通过，先修复构建。`);
  }
}

const entries = [];
for (const relativePath of shipFiles) {
  entries.push({
    name: `${rootFolder}/${relativePath}`,
    data: readFileSync(path.join(extensionDir, relativePath)),
  });
}

const directoryNames = new Set();
for (const entry of entries) {
  const segments = entry.name.split('/');
  for (let index = 1; index < segments.length; index += 1) {
    directoryNames.add(`${segments.slice(0, index).join('/')}/`);
  }
}

// ---- zip 构造（store/deflate，信息齐全的本地头） --------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const zipBuffer = (() => {
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const chunks = [];
  const centralRecords = [];
  let offset = 0;

  const writeEntry = (name, data, isDirectory) => {
    const nameBytes = Buffer.from(name, 'utf8');
    const flags = /[^\x00-\x7f]/.test(name) ? 0x0800 : 0; // 非 ASCII 名标记 UTF-8
    const payload = isDirectory ? Buffer.alloc(0) : deflateRawSync(data);
    const crc = isDirectory ? 0 : crc32(data);
    const method = isDirectory ? 0 : 8;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBytes, payload);

    centralRecords.push({ nameBytes, flags, method, crc, compressedSize: payload.length, uncompressedSize: data.length, offset, isDirectory });
    offset += local.length + nameBytes.length + payload.length;
  };

  for (const name of [...directoryNames].sort()) {
    writeEntry(name, Buffer.alloc(0), true);
  }
  for (const entry of entries) {
    writeEntry(entry.name, entry.data, false);
  }

  const centralStart = offset;
  const centralChunks = [];
  for (const record of centralRecords) {
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // 由 UNIX 生成，权限位有效
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(record.flags, 8);
    central.writeUInt16LE(record.method, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(record.crc, 16);
    central.writeUInt32LE(record.compressedSize, 20);
    central.writeUInt32LE(record.uncompressedSize, 24);
    central.writeUInt16LE(record.nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((record.isDirectory ? 0o40755 << 16 : 0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(record.offset, 42);
    centralChunks.push(central, record.nameBytes);
    offset += central.length + record.nameBytes.length;
  }

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(centralRecords.length, 8);
  end.writeUInt16LE(centralRecords.length, 10);
  end.writeUInt32LE(offset - centralStart, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, ...centralChunks, end]);
})();

// ---- 读回验证：按宿主的解包约束复核成员 ------------------------------------

const verifyZip = (buffer) => {
  const problems = [];
  const seen = new Map();
  let offset = 0;
  let fileCount = 0;
  let totalUncompressed = 0;
  let sawCentralDirectory = false;

  while (offset + 4 <= buffer.length) {
    const signature = buffer.readUInt32LE(offset);
    if (signature === 0x02014b50) {
      sawCentralDirectory = true;
      break;
    }
    if (signature !== 0x04034b50 || offset + 30 > buffer.length) {
      problems.push(`偏移 ${offset} 处不是有效的本地文件头`);
      break;
    }
    const flags = buffer.readUInt16LE(offset + 6);
    const method = buffer.readUInt16LE(offset + 8);
    const crc = buffer.readUInt32LE(offset + 14);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const uncompressedSize = buffer.readUInt32LE(offset + 22);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    if ((flags & 0x0001) !== 0) problems.push('存在加密标志');
    if ((flags & 0x0008) !== 0) problems.push('存在数据描述符标志（宿主拒绝）');
    if (method !== 0 && method !== 8) problems.push(`不支持的压缩方法 ${method}`);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) problems.push('出现 zip64 尺寸');

    const nameStart = offset + 30;
    const nameEnd = nameStart + nameLength;
    const dataStart = nameEnd + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) {
      problems.push('数据被截断');
      break;
    }
    const name = buffer.subarray(nameStart, nameEnd).toString('utf8');
    offset = dataEnd;
    if (name.endsWith('/')) continue;
    if (!name.startsWith(`${rootFolder}/`) || name.includes('\\') || name.startsWith('/') || name.split('/').some((segment) => segment === '..' || segment === '')) {
      problems.push(`成员的名称不安全：${name}`);
      continue;
    }
    fileCount += 1;
    totalUncompressed += uncompressedSize;
    if (fileCount > 500 || totalUncompressed > 40 * 1024 * 1024) {
      problems.push('超出宿主的解包限额');
    }
    const payload = buffer.subarray(dataStart, dataEnd);
    let data;
    try {
      data = method === 0
        ? payload
        : inflateRawSync(payload, { maxOutputLength: Math.max(1, uncompressedSize) });
    } catch {
      problems.push(`${name} 无法解压`);
      continue;
    }
    if (data.length !== uncompressedSize) problems.push(`${name} 解压后长度不符`);
    if (crc32(data) !== crc) problems.push(`${name} 的 CRC 不符`);
    seen.set(name, data);
  }

  if (!sawCentralDirectory) problems.push('缺少中央目录');
  if (fileCount !== entries.length) {
    problems.push(`成员数不符：归档 ${fileCount} 个，应为 ${entries.length} 个`);
  }
  for (const entry of entries) {
    const data = seen.get(entry.name);
    if (!data || !data.equals(entry.data)) {
      problems.push(`成员内容与来源不一致：${entry.name}`);
    }
  }
  return problems;
};

const problems = verifyZip(zipBuffer);
if (problems.length > 0) {
  fail(problems.join('\n        '));
}

// ---- 写出 -------------------------------------------------------------------

mkdirSync(distDir, { recursive: true });
const zipPath = path.join(distDir, `openchamber-agents-${manifest.version}.zip`);
writeFileSync(zipPath, zipBuffer);

const sha256 = createHash('sha256').update(zipBuffer).digest('hex');
const kib = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;
console.log(`已生成 ${path.relative(process.cwd(), zipPath)}`);
console.log(`  版本 ${manifest.version} · ${entries.length} 个成员 + ${directoryNames.size} 个目录`);
console.log(`  压缩后 ${kib(zipBuffer.length)} · sha256 ${sha256}`);
console.log('接收方安装：OpenChamber → 设置 → 扩展 → 添加扩展 → 选择该 zip（无需解压）。');
