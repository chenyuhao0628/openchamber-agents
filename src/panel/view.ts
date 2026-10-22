import { mountButton, mountSelect, mountTabs, mountTextField, type ButtonHandle, type ButtonVariant } from '@openchamber/sdk/ui';
import { diffLines } from '../core/diff.ts';
import { GLOBAL_PATH, matchedProfile, type Backup, type Loaded, type Review } from '../core/types.ts';

export type Draft = { id?: string; name: string; content: string };
export type State = {
  loaded: Loaded | null; draft: Draft; dirty: boolean; busy: boolean; tab: 'profiles' | 'backups';
  showArchived: boolean; review: Review | null; reviewInvalid: boolean; pending: boolean;
  backups: string[]; backup: Backup | null; message: string; tone: 'info' | 'success' | 'error' | 'warning';
};
export type Action = 'refresh' | 'new' | 'copy' | 'import' | 'save' | 'preview' | 'export' | 'archive' | 'archives' | 'guardSave' | 'guardDiscard' | 'guardCancel' | 'back' | 'apply' | 'restore';
export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
export const currentLabel = (loaded: Loaded): string => matchedProfile(loaded)?.name ?? (loaded.global.exists ? (loaded.global.content ? '未匹配已保存方案' : '全局规则为空') : '尚无全局规则文件');

export const mountView = (root: HTMLElement, callbacks: {
  action: (action: Action) => void; change: (field: 'name' | 'content', value: string) => void;
  select: (id: string) => void; tab: (id: string) => void; backup: (id: string) => void; file: (file: File) => void;
}) => {
  const app = el('main', 'ext ag');
  const header = el('header', 'ag-header'); const heading = el('div', 'ag-heading');
  const status = el('div'); const title = el('h1', 'ag-title', '正在连接 OpenChamber…');
  status.append(el('p', 'ext-muted', '当前全局文件'), title);
  status.firstElementChild!.classList.add('ag-scope');
  const refreshSlot = el('div'); heading.append(status, refreshSlot);
  const tabsSlot = el('div', 'ag-tabs');
  header.append(heading, el('p', 'ext-muted ag-scope', '当前连接的 OpenCode · 全局'), tabsSlot);
  const scroll = el('div', 'ag-scroll'); const message = el('p', 'ext-notice ag-message');
  message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
  const guard = el('div', 'ag-guard ag-message'); guard.setAttribute('role', 'group'); guard.setAttribute('aria-label', '处理未保存草稿');
  guard.append(el('p', '', '有未保存的修改，如何继续？'));
  const guardActions = el('div', 'ext-actions'); guard.append(guardActions);
  const profiles = el('section', 'ag-stack'); profiles.setAttribute('aria-label', '规则方案编辑');
  const selectSlot = el('div'); const tools = el('div', 'ext-actions');
  const nameSlot = el('div', 'ag-field'); const editorSlot = el('div', 'ag-field ag-editor');
  const more = el('details', 'ag-details'); more.append(el('summary', '', '方案管理'));
  const moreActions = el('div', 'ext-actions'); more.append(moreActions);
  const foot = el('footer', 'ag-footer'); const saveNote = el('p', 'ext-muted'); const saveActions = el('div', 'ext-actions'); foot.append(saveNote, saveActions);
  profiles.append(selectSlot, tools, nameSlot, editorSlot, more, foot);
  const backups = el('section', 'ag-stack'); backups.setAttribute('aria-label', '全局规则备份');
  const backupSelectSlot = el('div'); const backupNote = el('p', 'ext-muted'); const backupText = el('pre', 'ag-preview'); backupText.tabIndex = 0; backupText.setAttribute('aria-label', '备份内容');
  const backupActions = el('div', 'ext-actions'); backups.append(backupNote, backupSelectSlot, backupText, backupActions);
  const review = el('section', 'ag-stack'); review.setAttribute('aria-label', '启用差异预览');
  const reviewTitle = el('h2', 'ag-review-title'); reviewTitle.tabIndex = -1;
  const reviewNote = el('p', 'ext-notice'); const summary = el('p', 'ext-muted');
  const diff = el('div', 'ag-diff'); diff.tabIndex = 0; diff.setAttribute('aria-label', '规则差异，左侧为原行号，右侧为新行号');
  const reviewActions = el('div', 'ext-actions');
  review.append(reviewTitle, reviewNote, summary, diff, el('p', 'ext-muted', '写入前备份当前文件。已有会话是否重新加载规则由 OpenCode 决定，建议在新会话确认。'), reviewActions);
  const path = el('p', 'ext-muted ag-path', GLOBAL_PATH);
  scroll.append(message, guard, profiles, backups, review, path); app.append(header, scroll); root.append(app);
  const buttons = new Map<Action, ButtonHandle>();
  const button = (slot: HTMLElement, action: Action, label: string, variant: ButtonVariant = 'ghost') => {
    const handle = mountButton(slot, { label, size: 'sm', variant, onClick: () => callbacks.action(action) }); buttons.set(action, handle);
  };
  button(refreshSlot, 'refresh', '重新读取'); button(tools, 'new', '新建'); button(tools, 'copy', '复制'); button(tools, 'import', '导入');
  button(moreActions, 'export', '导出文件'); button(moreActions, 'archive', '归档'); button(moreActions, 'archives', '显示归档');
  button(saveActions, 'save', '保存方案', 'outline'); button(saveActions, 'preview', '预览启用', 'default');
  button(guardActions, 'guardSave', '保存后继续', 'outline'); button(guardActions, 'guardDiscard', '放弃修改'); button(guardActions, 'guardCancel', '继续编辑');
  button(reviewActions, 'back', '返回编辑', 'outline'); button(reviewActions, 'apply', '确认启用', 'default');
  button(backupActions, 'restore', '预览恢复', 'outline');
  const tabs = mountTabs(tabsSlot, { items: [{ id: 'profiles', label: '方案' }, { id: 'backups', label: '备份' }], activeId: 'profiles', onChange: callbacks.tab });
  const select = mountSelect(selectSlot, { label: '规则方案', value: null, options: [], searchable: true, searchPlaceholder: '搜索方案…', placeholder: '新建方案', onChange: callbacks.select });
  const name = mountTextField(nameSlot, { label: '方案名称', value: '', placeholder: '例如：日常开发', onChange: value => callbacks.change('name', value) });
  const editor = mountTextField(editorSlot, { label: '规则内容 · Markdown', value: '', mono: true, multiline: true, rows: 12, placeholder: '# 开发约定\n\n在这里填写全局工作规则…', onChange: value => callbacks.change('content', value) });
  const backupSelect = mountSelect(backupSelectSlot, { label: '备份时间', value: null, options: [], searchable: true, searchPlaceholder: '搜索时间…', placeholder: '选择备份', onChange: callbacks.backup });
  const input = el('input'); input.type = 'file'; input.accept = '.md,.txt,text/plain,text/markdown'; input.hidden = true; app.append(input);
  input.addEventListener('change', () => { if (input.files?.[0]) callbacks.file(input.files[0]); input.value = ''; });
  // Associate kit notes explicitly; the kit's wrapping label provides the visible label.
  for (const [slot, id] of [[nameSlot, 'name-note'], [editorSlot, 'content-note']] as const) {
    slot.querySelector('.oc-sdk-field-note')!.id = id;
    slot.querySelector('input,textarea')!.setAttribute('aria-describedby', id);
  }
  nameSlot.querySelector('input')!.maxLength = 60;
  editorSlot.querySelector('textarea')!.spellcheck = false;
  let lastTab = 'profiles'; let lastReview: Review | null = null; let lastMessage = ''; let lastPending = false;
  const paintReview = (item: Review) => {
    const result = diffLines(item.before.content, item.content); diff.replaceChildren();
    reviewTitle.textContent = `${item.source === 'backup' ? '恢复备份' : '启用方案'}：${item.name}`;
    reviewNote.textContent = item.content === '' ? '此操作将清空全局 AGENTS.md 的内容。' : '此操作将替换当前连接的 OpenCode 全局 AGENTS.md，影响共享此文件的项目。';
    reviewNote.dataset.tone = item.content === '' ? 'warning' : 'info';
    summary.textContent = `新增 ${result.added} 行 · 删除 ${result.removed} 行${result.coarse ? ' · 大段变更按整块展示' : ''}${item.before.content !== item.content && !result.added && !result.removed ? ' · 仅换行格式变化' : ''}${!item.before.exists ? ' · 将创建文件' : ''}`;
    if (item.before.exists && item.before.content === item.content) summary.textContent += ' · 内容一致，无需写入';
    let shown = 0, skipped = 0;
    const gap = () => { if (skipped) { diff.append(el('p', 'ag-diff-gap', `省略 ${skipped} 行未变更内容`)); skipped = 0; } };
    for (let i = 0; i < result.lines.length; i++) {
      const line = result.lines[i];
      if (line.kind === 'same' && i > 2 && i < result.lines.length - 3 && result.lines.slice(Math.max(0, i - 3), i + 4).every(row => row.kind === 'same')) { skipped++; continue; }
      if (shown >= 400) { gap(); diff.append(el('p', 'ag-diff-gap', '预览达到 400 行，后续差异未展示。请返回编辑器或备份内容检查完整文本。')); break; }
      gap(); shown++;
      const row = el('div', 'ag-diff-line'); row.dataset.kind = line.kind;
      row.append(el('span', '', String(line.oldLine ?? '')), el('span', '', String(line.newLine ?? '')), el('span', '', line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '), el('code', '', line.text)); diff.append(row);
    }
    gap(); if (!result.lines.length) diff.append(el('p', 'ag-diff-gap', '文件内容为空'));
  };
  return {
    pickFile: () => input.click(),
    focusName: () => nameSlot.querySelector('input')!.focus(),
    render(state: State) {
      const loaded = state.loaded; const selected = loaded?.library.profiles.find(item => item.id === state.draft.id);
      const archived = Boolean(selected?.archived); const blocked = state.busy || !loaded || state.pending;
      title.textContent = loaded ? currentLabel(loaded) : state.busy ? '正在读取规则…' : '规则尚未读取';
      message.hidden = !state.message; message.textContent = state.message; message.dataset.tone = state.tone;
      guard.hidden = !state.pending;
      if ((state.message !== lastMessage && state.tone === 'error') || (state.pending && !lastPending)) scroll.scrollTop = 0;
      lastMessage = state.message; lastPending = state.pending;
      profiles.hidden = !loaded || Boolean(state.review) || state.tab !== 'profiles';
      backups.hidden = !loaded || Boolean(state.review) || state.tab !== 'backups';
      review.hidden = !state.review;
      tabsSlot.hidden = Boolean(state.review);
      if (state.tab !== lastTab) { tabs.update({ activeId: state.tab }); lastTab = state.tab; }
      select.update({ value: state.draft.id ?? null, disabled: blocked, options: (loaded?.library.profiles ?? []).filter(item => state.showArchived || !item.archived).map(item => ({ id: item.id, label: item.name, hint: item.archived ? '已归档' : loaded?.global.exists && item.content === loaded.global.content ? '与全局一致' : undefined })) });
      name.update({ value: state.draft.name, disabled: blocked || archived });
      editor.update({ value: state.draft.content, disabled: blocked || archived, helper: `${state.draft.content.length.toLocaleString('zh-CN')} 字符 · ${state.draft.content ? state.draft.content.split('\n').length : 0} 行${state.dirty || !selected ? ' · 未保存' : archived ? ' · 已归档，只读' : ' · 已保存'}` });
      saveNote.textContent = state.dirty ? '保存仅更新方案库；保存后可预览启用。' : archived ? '恢复归档后可继续编辑和启用。' : selected ? '选中方案不会改变全局规则。' : '填写或导入规则，保存你的第一个方案。';
      for (const handle of buttons.values()) handle.update({ disabled: blocked });
      buttons.get('refresh')!.update({ disabled: state.busy || state.pending, loading: state.busy && !loaded });
      for (const action of ['guardSave', 'guardDiscard', 'guardCancel'] as const) buttons.get(action)!.update({ disabled: state.busy });
      buttons.get('save')!.update({ disabled: blocked || archived || !state.dirty });
      buttons.get('preview')!.update({ disabled: blocked || archived || !selected || state.dirty });
      buttons.get('copy')!.update({ disabled: blocked || !state.draft.name });
      buttons.get('export')!.update({ disabled: blocked || !selected || state.dirty });
      buttons.get('archive')!.update({ label: archived ? '恢复归档' : '归档', disabled: blocked || !selected || state.dirty });
      buttons.get('archives')!.update({ label: state.showArchived ? '隐藏归档' : '显示归档' });
      backupSelect.update({ value: state.backup?.id ?? null, disabled: blocked, options: state.backups.map(id => ({ id, label: new Date(Number(id.split('-')[0])).toLocaleString('zh-CN'), hint: id.slice(-4) })) });
      backupNote.textContent = state.backups.length ? `显示最近 ${state.backups.length} 份备份；恢复前也会备份当前文件。` : '暂无备份。首次替换已有全局文件时会自动创建。';
      backupText.hidden = !state.backup;
      backupText.textContent = state.backup?.content ?? '';
      backupText.setAttribute('aria-label', state.backup?.label ?? '备份内容');
      buttons.get('restore')!.update({ disabled: blocked || !state.backup });
      buttons.get('back')!.update({ label: state.review?.source === 'backup' ? '返回备份' : '返回编辑', disabled: state.busy });
      buttons.get('apply')!.update({ label: state.review?.source === 'backup' ? '确认恢复' : '确认启用', disabled: state.busy || state.reviewInvalid || !state.review || (state.review.before.exists && state.review.before.content === state.review.content), loading: state.busy && Boolean(state.review) });
      if (state.review !== lastReview) { lastReview = state.review; if (state.review) { paintReview(state.review); scroll.scrollTop = 0; reviewTitle.focus(); } }
    },
  };
};
