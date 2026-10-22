import { navigationResult } from './preview-navigation.js';
const params = new URLSearchParams(location.search);
let dark = params.get('theme') === 'dark', section = params.get('surface') === 'status', width = Number(params.get('width') || 400);
let directory = params.get('directory') === 'none' ? null : params.get('directory') === 'unicode' ? '/fixture/中文项目' : '/fixture/project';
let failBackup = false, denied = params.get('state') === 'denied', globalWrites = 0;
const globalPath = '~/.config/opencode/AGENTS.md', dataDir = '~/.config/openchamber/agents-manager';
const frame = document.querySelector('iframe'), shell = document.querySelector('.shell'), audit = document.querySelector('#audit');
const disk = new Map(params.get('state') === 'empty' ? [] : [[globalPath, '# 全局开发规则\n\n- 使用中文沟通。\n- 修改后运行相关检查。\n']]);
if (params.get('state') === 'corrupt') disk.set(dataDir + '/library.json', '{broken');
const tokens = dark => ({ background: dark ? '#20201e' : '#faf9f7', elevated: dark ? '#282724' : '#f2f1ee', foreground: dark ? '#dedbd3' : '#484744', muted: dark ? '#a7a39b' : '#77736c', subtle: dark ? '#817d76' : '#a29e98', border: dark ? '#3c3a35' : '#e3e0db', hover: dark ? '#ffffff0a' : '#00000005', selection: dark ? '#4a3327' : '#f2e6dc', focus: '#b07750', primary: dark ? '#d59a6f' : '#a4663b', mutedSurface: dark ? '#272622' : '#f1efec', elevatedForeground: dark ? '#dedbd3' : '#484744', active: dark ? '#ffffff12' : '#00000009', selectionForeground: dark ? '#f2d4bc' : '#724324', primaryForeground: '#ffffff', primaryText: dark ? '#e3b18c' : '#965421', successText: dark ? '#a0b48c' : '#4f6a3b', warningText: dark ? '#d6b774' : '#8b6322', errorText: dark ? '#e39b8b' : '#b34635', infoText: dark ? '#9eb4c9' : '#496d88', success: '#759862', warning: '#c3944d', error: '#ce6a55', info: '#6995bb', font: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', mono: 'ui-monospace,SFMono-Regular,monospace', radius: '7px' });
const paint = () => { document.body.classList.toggle('dark', dark); document.documentElement.style.setProperty('--width', width + 'px'); shell.style.height = section ? '260px' : '820px'; audit.textContent = `全局写入 ${globalWrites} 次 · 方案库 ${disk.has(dataDir + '/library.json') ? '已创建' : '未创建'} · 备份 ${[...disk.keys()].filter(path => path.includes('/backups/')).length} 份`; };
const ready = () => frame.contentWindow.postMessage({ channel: 'openchamber.sdk', v: 1, type: 'ready', payload: { theme: { mode: dark ? 'dark' : 'light', tokens: tokens(dark) }, locale: 'zh-CN', directory, session: null, surface: section ? 'status' : 'panel', connection: { connected: true, account: 'fixture' }, settings: {}, item: null } }, '*');
const result = (target, id, payload) => target.postMessage({ channel: 'openchamber.sdk', v: 1, type: 'result', id, ok: true, payload }, '*');
const reject = (target, id, code, error) => target.postMessage({ channel: 'openchamber.sdk', v: 1, type: 'result', id, ok: false, code, error }, '*');
const show = () => { frame.src = section ? '/panel/section.html' : '/panel/index.html'; document.querySelector('.caption').textContent = section ? '全局规则 · 工作状态' : '规则方案'; paint(); };
window.addEventListener('message', async event => {
  const msg = event.data; if (event.source !== frame.contentWindow || msg?.channel !== 'openchamber.sdk') return;
  if (msg.type === 'hello') { ready(); return; }
  if (msg.type === 'open-surface') {
    const next = navigationResult(msg.payload?.surfaceId, directory);
    if (next === 'unknown') { reject(event.source, msg.id, 'HOST_REJECTED', 'Unknown surface.'); return; }
    result(event.source, msg.id);
    if (next === 'open') { section = false; show(); }
    return;
  }
  if (!msg.type.startsWith('file-')) { result(event.source, msg.id); return; }
  await new Promise(resolve => setTimeout(resolve, 60));
  if (denied) { reject(event.source, msg.id, 'NOT_GRANTED', 'Fixture permission denied'); return; }
  // Reproduce 2.4.0's header construction failure, including for global files.
  try { if (directory) new Headers().set('x-opencode-directory', directory); }
  catch { reject(event.source, msg.id, 'HOST_REJECTED', 'Extension operation failed.'); return; }
  const { path, content } = msg.payload;
  if (path !== globalPath && !path.startsWith(dataDir + '/')) { reject(event.source, msg.id, 'BAD_PATH', 'Fixture path outside grant'); return; }
  if (msg.type === 'file-read') {
    if (disk.has(path)) result(event.source, msg.id, { content: disk.get(path) });
    else reject(event.source, msg.id, 'NOT_FOUND', 'Fixture missing file');
  } else if (msg.type === 'file-write') {
    if (failBackup && path.includes('/backups/')) { reject(event.source, msg.id, 'DENIED', 'Fixture backup failure'); return; }
    disk.set(path, content); if (path === globalPath) globalWrites++; result(event.source, msg.id, { written: true }); paint();
  } else if (msg.type === 'file-list') result(event.source, msg.id, { entries: [...disk.keys()].filter(key => key.startsWith(path + '/')).map(key => ({ name: key.slice(path.length + 1), kind: 'file' })) });
});
document.querySelector('#theme').onclick = () => { dark = !dark; paint(); ready(); };
document.querySelector('#narrow').onclick = () => { width = width === 280 ? 400 : 280; paint(); };
document.querySelector('#external').onclick = () => { disk.set(globalPath, (disk.get(globalPath) ?? '') + '\n- 这是外部编辑器添加的合成规则。'); audit.textContent = '已模拟外部修改；扩展不应覆盖预览后的变化。'; };
document.querySelector('#failure').onclick = event => { failBackup = !failBackup; event.target.textContent = failBackup ? '恢复备份写入' : '模拟备份失败'; };
document.querySelector('#permission').onclick = event => { denied = !denied; event.target.textContent = denied ? '恢复文件权限' : '模拟权限不足'; };
document.querySelector('#status').onclick = () => { section = !section; show(); };
const directoryButton = document.querySelector('#directory');
document.querySelector('#unicode').onclick = () => { directory = '/fixture/中文项目'; paintDirectory(); ready(); };
const paintDirectory = () => { directoryButton.textContent = directory ? '取消项目选择' : '选择示例项目'; };
directoryButton.onclick = () => { directory = directory ? null : '/fixture/project'; paintDirectory(); ready(); };
paintDirectory();
show();
