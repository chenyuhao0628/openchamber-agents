import { connectHost, type GuestStatusControl } from '@openchamber/sdk';
import { applyHostReady, mountButton } from '@openchamber/sdk/ui';
import { createRepository } from '../core/repository.ts';
import { estimateTokens, matchedProfile } from '../core/types.ts';
import { explainError, hostFiles } from '../platform/host-files.ts';
import { currentLabel, el } from './view.ts';
import native from '../../ui/native.css';
import { openManager } from '../../ui/navigation.ts';
import { installScrollbarActivity } from '../../ui/scrollbar.ts';
import layout from './styles/layout.css';
import components from './styles/components.css';
import { applyDocumentLanguage, i18n } from './i18n.ts';

const { t } = i18n;
const style = document.createElement('style');
style.textContent = native + layout + components;
document.head.append(style);
installScrollbarActivity(document);

const host = connectHost();
const repo = createRepository(hostFiles(host, t), Date.now, () => crypto.randomUUID(), t);
const app = el('section', 'ext ag-section');
const dot = el('span', 'ag-status-dot');
const title = el('p', 'ag-status-value', t('正在读取…'));
title.setAttribute('role', 'status');
const rowLabel = el('span', 'ag-status-label', t('当前方案'));
const valueWrap = el('span', 'ag-status-value-wrap');
valueWrap.append(dot, title);
const row = el('div', 'ag-status-row');
row.append(rowLabel, valueWrap);

const note = el('p', 'ext-muted', t('全局 AGENTS.md'));
const message = el('p', 'ext-notice');
note.title = t('仅表示当前连接服务器的文件状态，不代表已有会话已加载规则。');
message.hidden = true;
message.setAttribute('role', 'status');
const footer = el('div', 'ag-status-footer');
const actions = el('div', 'ext-actions');
footer.append(note, actions);
app.append(row, footer, message);
document.querySelector('#root')!.append(app);

let busy = false;
let initialized = false;
let statusControlsSupported = false;
let statusControlSignature = '';

const triggerManage = () => {
  message.hidden = true;
  void openManager(host, { id: 'agents-manager', name: t('规则方案') }).catch(error => {
    message.hidden = false;
    message.dataset.tone = 'error';
    message.textContent = error instanceof Error ? error.message : explainError(error, t);
  });
};

const syncStatusControls = () => {
  actions.hidden = statusControlsSupported;
  if (!statusControlsSupported) return;
  const controls: GuestStatusControl[] = [
    { kind: 'button', id: 'refresh', label: t('刷新'), disabled: busy || !initialized },
    { kind: 'button', id: 'manage', label: t('管理'), disabled: !initialized },
  ];
  const signature = JSON.stringify(controls);
  if (signature === statusControlSignature) return;
  statusControlSignature = signature;
  void host.setStatusControls(controls).catch(() => {
    statusControlsSupported = false;
    statusControlSignature = '';
    actions.hidden = false;
  });
};

const refresh = async () => {
  if (busy) return;
  busy = true;
  button.update({ loading: true });
  syncStatusControls();
  try {
    const loaded = await repo.load(false);
    title.textContent = currentLabel(loaded, t);
    title.title = title.textContent;
    const matched = Boolean(matchedProfile(loaded));
    dot.dataset.tone = matched
      ? 'success'
      : loaded.global.exists && loaded.global.content.trim()
        ? 'warning'
        : 'neutral';
    const time = new Date().toLocaleTimeString(i18n.locale, { hour: '2-digit', minute: '2-digit' });
    const tokens = loaded.global.exists ? estimateTokens(loaded.global.content) : 0;
    note.textContent = tokens > 0
      ? t('~{tokens} tokens · 读取于 {time}', { tokens: tokens.toLocaleString(i18n.locale), time })
      : t('读取于 {time}', { time });
    message.hidden = true;
  } catch (error) {
    dot.dataset.tone = 'error';
    title.textContent = t('未读取');
    note.textContent = t('全局 AGENTS.md');
    message.textContent = explainError(error, t);
    message.dataset.tone = 'error';
    message.hidden = false;
  } finally {
    busy = false;
    button.update({ loading: false });
    syncStatusControls();
  }
};

const button = mountButton(actions, { label: t('刷新'), size: 'sm', variant: 'ghost', onClick: () => { void refresh(); } });
const manage = mountButton(actions, { label: t('管理'), size: 'sm', variant: 'ghost', onClick: triggerManage });
const manageButton = actions.lastElementChild!;
manageButton.setAttribute('aria-label', t('管理规则方案'));

host.onStatusControl(event => {
  if (event.id === 'refresh') void refresh();
  else if (event.id === 'manage') triggerManage();
});

new ResizeObserver(() => {
  void host.setHeight(Math.ceil(app.getBoundingClientRect().height)).catch(() => {});
}).observe(app);

host.onReady(context => {
  applyHostReady(context, document.documentElement);
  const changed = i18n.setLocale(context.locale);
  applyDocumentLanguage(i18n);
  rowLabel.textContent = t('当前方案');
  note.title = t('仅表示当前连接服务器的文件状态，不代表已有会话已加载规则。');
  button.update({ label: t('刷新') });
  manage.update({ label: t('管理') });
  manageButton.setAttribute('aria-label', t('管理规则方案'));
  statusControlsSupported = context.surface === 'status';
  if (!initialized) {
    initialized = true;
    syncStatusControls();
    void refresh();
  } else if (changed) {
    statusControlSignature = '';
    syncStatusControls();
    note.textContent = t('全局 AGENTS.md');
    void refresh();
  }
});
