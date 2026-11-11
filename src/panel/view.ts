import {
  mountBadge,
  mountButton,
  mountSelect,
  mountTabs,
  mountTextField,
  type ButtonHandle,
  type ButtonVariant,
  type Tone,
} from '@openchamber/sdk/ui';
import type { I18n } from '../shared/i18n.ts';
import { diffLines } from '../core/diff.ts';
import {
  GLOBAL_PATH,
  TOKEN_WARN_BUDGET,
  countLines,
  estimateTokens,
  extractMarkdownHeadings,
  matchedProfile,
  type Backup,
  type Loaded,
  type Review,
} from '../core/types.ts';

export type Draft = { id?: string; name: string; content: string };
export type State = {
  loaded: Loaded | null;
  draft: Draft;
  dirty: boolean;
  busy: boolean;
  tab: 'profiles' | 'backups';
  showArchived: boolean;
  review: Review | null;
  reviewInvalid: boolean;
  pending: boolean;
  backups: string[];
  backup: Backup | null;
  message: string;
  tone: 'info' | 'success' | 'error' | 'warning';
};
export type Action =
  | 'refresh'
  | 'new'
  | 'copy'
  | 'import'
  | 'importGlobal'
  | 'diffGlobal'
  | 'diffDraft'
  | 'copyContent'
  | 'copyPath'
  | 'save'
  | 'preview'
  | 'export'
  | 'archive'
  | 'archives'
  | 'guardSave'
  | 'guardDiscard'
  | 'guardCancel'
  | 'back'
  | 'apply'
  | 'restore';

export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export const currentLabel = (loaded: Loaded, t: (source: string) => string = source => source): string => (
  matchedProfile(loaded)?.name
  ?? (loaded.global.exists ? (loaded.global.content ? t('未匹配已保存方案') : t('全局规则为空')) : t('尚无全局规则文件'))
);

export const statusMeta = (loaded: Loaded | null, t: (source: string) => string): { label: string; tone: Tone } => {
  if (!loaded) return { label: t('读取中'), tone: 'neutral' };
  if (matchedProfile(loaded)) return { label: t('已匹配方案'), tone: 'success' };
  if (!loaded.global.exists) return { label: t('尚无文件'), tone: 'neutral' };
  if (!loaded.global.content.trim()) return { label: t('全局为空'), tone: 'neutral' };
  return { label: t('未匹配方案'), tone: 'warning' };
};

const formatCompactTokens = (tokens: number, locale: string): string => (
  tokens >= 1000 ? `${(tokens / 1000).toLocaleString(locale, { maximumFractionDigits: 1 })}k` : tokens.toLocaleString(locale)
);

export const mountView = (root: HTMLElement, i18n: I18n, callbacks: {
  action: (action: Action) => void;
  change: (field: 'name' | 'content', value: string) => void;
  select: (id: string) => void;
  tab: (id: string) => void;
  backup: (id: string) => void;
  file: (file: File) => void;
}) => {
  const { t } = i18n;
  const app = el('main', 'ext ext-container ag');
  const header = el('header', 'ag-header');
  const heading = el('div', 'ag-heading');
  const statusMain = el('div', 'ag-status-main');
  const statusBadgeSlot = el('span', 'ag-badge-slot');
  const title = el('h1', 'ag-title', t('正在连接 OpenChamber…'));
  statusMain.append(statusBadgeSlot, title);
  const refreshSlot = el('div', 'ag-header-actions');
  heading.append(statusMain, refreshSlot);

  const metaRow = el('div', 'ag-meta-row');
  const pathText = el('code', 'ag-path', GLOBAL_PATH);
  const copyPathSlot = el('div');
  metaRow.append(pathText, copyPathSlot);

  const tabsSlot = el('div', 'ag-tabs');
  header.append(heading, metaRow, tabsSlot);

  const scroll = el('div', 'ag-scroll');
  const message = el('p', 'ext-notice ag-message');
  message.setAttribute('role', 'status');
  message.setAttribute('aria-live', 'polite');

  const guard = el('div', 'ag-guard ag-message');
  guard.setAttribute('role', 'group');
  guard.setAttribute('aria-label', t('处理未保存草稿'));
  const guardText = el('p', '', t('有未保存的修改，如何继续？'));
  const guardActions = el('div', 'ext-actions');
  guard.append(guardText, guardActions);

  const unmatchedBanner = el('div', 'ag-unmatched ag-message');
  unmatchedBanner.hidden = true;
  const unmatchedText = el('p', 'ag-unmatched-text', t('当前全局 AGENTS.md 未匹配任何已保存方案。'));
  const unmatchedActions = el('div', 'ext-actions');
  unmatchedBanner.append(unmatchedText, unmatchedActions);

  const profiles = el('section', 'ag-stack');
  profiles.setAttribute('aria-label', t('规则方案编辑'));
  const selectSlot = el('div');
  const tools = el('div', 'ext-actions ag-tools');
  const nameSlot = el('div', 'ag-field');
  const editorHead = el('div', 'ag-editor-head');
  const headingJumpSlot = el('div', 'ag-heading-jump');
  const editorQuickActions = el('div', 'ext-actions ag-editor-actions');
  editorHead.append(headingJumpSlot, editorQuickActions);
  const editorSlot = el('div', 'ag-field ag-editor');
  const budgetNote = el('p', 'ext-notice ag-budget-note');
  budgetNote.dataset.tone = 'warning';
  budgetNote.hidden = true;

  const more = el('details', 'ag-details');
  const moreSummary = el('summary', '', t('方案管理'));
  more.append(moreSummary);
  const moreActions = el('div', 'ext-actions');
  more.append(moreActions);
  profiles.append(selectSlot, tools, nameSlot, editorHead, editorSlot, budgetNote, more);

  const backups = el('section', 'ag-stack');
  backups.setAttribute('aria-label', t('全局规则备份'));
  const backupSelectSlot = el('div');
  const backupNote = el('p', 'ext-muted');
  const backupText = el('pre', 'ag-preview');
  backupText.tabIndex = 0;
  backupText.setAttribute('aria-label', t('备份内容'));
  const backupActions = el('div', 'ext-actions');
  backups.append(backupNote, backupSelectSlot, backupText, backupActions);

  const review = el('section', 'ag-stack');
  review.setAttribute('aria-label', t('启用差异预览'));
  const reviewTitle = el('h2', 'ag-review-title');
  reviewTitle.tabIndex = -1;
  const reviewNote = el('p', 'ext-notice');
  const summary = el('p', 'ext-muted ag-diff-summary');
  const diff = el('div', 'ag-diff');
  diff.tabIndex = 0;
  diff.setAttribute('aria-label', t('规则差异，左侧为原行号，右侧为新行号'));
  const reviewActions = el('div', 'ext-actions');
  const reviewHint = el('p', 'ext-muted', t('写入前备份当前文件。已有会话是否重新加载规则由 OpenCode 决定，建议在新会话确认。'));
  review.append(reviewTitle, reviewNote, summary, diff, reviewHint, reviewActions);

  const foot = el('footer', 'ag-footer');
  const saveNote = el('p', 'ext-muted ag-save-note');
  const saveActions = el('div', 'ext-actions');
  foot.append(saveNote, saveActions);

  scroll.append(message, guard, unmatchedBanner, profiles, backups, review);
  app.append(header, scroll, foot);
  root.append(app);

  const statusBadge = mountBadge(statusBadgeSlot, { label: t('读取中'), tone: 'neutral' });
  const buttons = new Map<Action, ButtonHandle>();
  const button = (slot: HTMLElement, action: Action, label: string, variant: ButtonVariant = 'ghost') => {
    const handle = mountButton(slot, { label: t(label), size: 'sm', variant, onClick: () => callbacks.action(action) });
    buttons.set(action, handle);
  };

  button(refreshSlot, 'refresh', '重新读取');
  button(copyPathSlot, 'copyPath', '复制路径');
  button(unmatchedActions, 'importGlobal', '读取全局为草稿', 'outline');
  button(unmatchedActions, 'diffGlobal', '对比全局差异');
  button(tools, 'new', '新建');
  button(tools, 'copy', '复制');
  button(tools, 'import', '导入');
  button(editorQuickActions, 'diffDraft', '对比更改');
  button(editorQuickActions, 'copyContent', '复制全文');
  button(moreActions, 'export', '导出文件');
  button(moreActions, 'archive', '归档');
  button(moreActions, 'archives', '显示归档');
  button(saveActions, 'save', '保存方案', 'outline');
  button(saveActions, 'preview', '预览启用', 'default');
  button(guardActions, 'guardSave', '保存后继续', 'outline');
  button(guardActions, 'guardDiscard', '放弃修改');
  button(guardActions, 'guardCancel', '继续编辑');
  button(reviewActions, 'back', '返回编辑', 'outline');
  button(reviewActions, 'apply', '确认启用', 'default');
  button(backupActions, 'restore', '预览恢复', 'outline');

  const tabs = mountTabs(tabsSlot, {
    items: [{ id: 'profiles', label: t('方案') }, { id: 'backups', label: t('备份') }],
    activeId: 'profiles',
    trackBackground: true,
    onChange: callbacks.tab,
  });
  const select = mountSelect(selectSlot, {
    label: t('规则方案'),
    value: null,
    options: [],
    searchable: true,
    searchPlaceholder: t('搜索方案…'),
    placeholder: t('新建方案'),
    onChange: callbacks.select,
  });
  const name = mountTextField(nameSlot, {
    label: t('方案名称'),
    value: '',
    placeholder: t('例如：日常开发'),
    onChange: value => callbacks.change('name', value),
  });
  const editor = mountTextField(editorSlot, {
    label: t('规则内容 · Markdown'),
    value: '',
    mono: true,
    multiline: true,
    rows: 12,
    placeholder: t('# 开发约定\n\n在这里填写全局工作规则…'),
    onChange: value => callbacks.change('content', value),
  });

  let currentHeadings = extractMarkdownHeadings('');
  const jumpToHeading = (offsetKey: string) => {
    const target = currentHeadings.find(item => String(item.offset) === offsetKey);
    const textarea = editorSlot.querySelector<HTMLTextAreaElement>('textarea');
    if (!target || !textarea) return;
    textarea.focus();
    textarea.setSelectionRange(target.offset, target.offset);
    const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 20;
    textarea.scrollTop = Math.max(0, (target.line - 2) * lineHeight);
    headingJump.update({ value: null });
  };
  const headingJump = mountSelect(headingJumpSlot, {
    value: null,
    options: [],
    placeholder: t('章节速跳…'),
    onChange: jumpToHeading,
  });
  headingJumpSlot.querySelector('.oc-sdk-trigger')?.setAttribute('aria-label', t('章节导航'));

  const backupSelect = mountSelect(backupSelectSlot, {
    label: t('备份时间'),
    value: null,
    options: [],
    searchable: true,
    searchPlaceholder: t('搜索时间…'),
    placeholder: t('选择备份'),
    onChange: callbacks.backup,
  });
  const input = el('input');
  input.type = 'file';
  input.accept = '.md,.txt,text/plain,text/markdown';
  input.hidden = true;
  app.append(input);
  input.addEventListener('change', () => {
    if (input.files?.[0]) callbacks.file(input.files[0]);
    input.value = '';
  });

  for (const [slot, id] of [[nameSlot, 'name-note'], [editorSlot, 'content-note']] as const) {
    slot.querySelector('.oc-sdk-field-note')!.id = id;
    slot.querySelector('input,textarea')!.setAttribute('aria-describedby', id);
  }
  const nameInput = nameSlot.querySelector<HTMLInputElement>('input')!;
  const editorTextarea = editorSlot.querySelector<HTMLTextAreaElement>('textarea')!;
  nameInput.maxLength = 60;
  editorTextarea.spellcheck = false;
  nameInput.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    if (event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    editorTextarea.focus();
  });

  let lastTab = 'profiles';
  let lastReview: Review | null = null;
  let lastMessage = '';
  let lastPending = false;
  let lastContentForHeadings = '\0';

  const reviewHeaderLabel = (item: Review): string => {
    if (item.source === 'backup') return t('{action}：{name}', { action: t('恢复备份'), name: item.name });
    if (item.source === 'draft-saved') return t('{action}：{name}', { action: t('对比草稿与已保存方案'), name: item.name });
    if (item.source === 'draft-global') return t('{action}：{name}', { action: t('对比草稿与全局规则'), name: item.name });
    return t('{action}：{name}', { action: t('启用方案'), name: item.name });
  };

  const paintReview = (item: Review) => {
    const result = diffLines(item.before.content, item.content);
    diff.replaceChildren();
    reviewTitle.textContent = reviewHeaderLabel(item);
    if (item.readonly) {
      reviewNote.textContent = t('当前为只读差异对比，不会修改全局 AGENTS.md。');
      reviewNote.dataset.tone = 'info';
    } else {
      reviewNote.textContent = item.content === ''
        ? t('此操作将清空全局 AGENTS.md 的内容。')
        : t('此操作将替换当前连接的 OpenCode 全局 AGENTS.md，影响共享此文件的项目。');
      reviewNote.dataset.tone = item.content === '' ? 'warning' : 'info';
    }
    summary.textContent = t('新增 {added} 行 · 删除 {removed} 行', { added: result.added, removed: result.removed })
      + (result.coarse ? t(' · 大段变更按整块展示') : '')
      + (item.before.content !== item.content && !result.added && !result.removed ? t(' · 仅换行格式变化') : '')
      + (!item.before.exists && !item.readonly ? t(' · 将创建文件') : '');
    if (item.before.exists && item.before.content === item.content) summary.textContent += t(' · 内容一致，无需写入');
    let shown = 0;
    let skipped = 0;
    const gap = () => {
      if (skipped) {
        diff.append(el('p', 'ag-diff-gap', t('省略 {count} 行未变更内容', { count: skipped })));
        skipped = 0;
      }
    };
    for (let i = 0; i < result.lines.length; i++) {
      const line = result.lines[i];
      if (line.kind === 'same' && i > 2 && i < result.lines.length - 3 && result.lines.slice(Math.max(0, i - 3), i + 4).every(row => row.kind === 'same')) {
        skipped++;
        continue;
      }
      if (shown >= 400) {
        gap();
        diff.append(el('p', 'ag-diff-gap', t('预览达到 400 行，后续差异未展示。请返回编辑器或备份内容检查完整文本。')));
        break;
      }
      gap();
      shown++;
      const row = el('div', 'ag-diff-line');
      row.dataset.kind = line.kind;
      row.append(
        el('span', 'ag-diff-num', String(line.oldLine ?? '')),
        el('span', 'ag-diff-num', String(line.newLine ?? '')),
        el('span', 'ag-diff-mark', line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '),
        el('code', '', line.text),
      );
      diff.append(row);
    }
    gap();
    if (!result.lines.length) diff.append(el('p', 'ag-diff-gap', t('文件内容为空')));
  };

  const localize = () => {
    guard.setAttribute('aria-label', t('处理未保存草稿'));
    guardText.textContent = t('有未保存的修改，如何继续？');
    unmatchedText.textContent = t('当前全局 AGENTS.md 未匹配任何已保存方案。');
    profiles.setAttribute('aria-label', t('规则方案编辑'));
    moreSummary.textContent = t('方案管理');
    backups.setAttribute('aria-label', t('全局规则备份'));
    backupText.setAttribute('aria-label', t('备份内容'));
    review.setAttribute('aria-label', t('启用差异预览'));
    diff.setAttribute('aria-label', t('规则差异，左侧为原行号，右侧为新行号'));
    reviewHint.textContent = t('写入前备份当前文件。已有会话是否重新加载规则由 OpenCode 决定，建议在新会话确认。');
    buttons.get('refresh')!.update({ label: t('重新读取') });
    buttons.get('copyPath')!.update({ label: t('复制路径') });
    buttons.get('importGlobal')!.update({ label: t('读取全局为草稿') });
    buttons.get('diffGlobal')!.update({ label: t('对比全局差异') });
    buttons.get('new')!.update({ label: t('新建') });
    buttons.get('copy')!.update({ label: t('复制') });
    buttons.get('import')!.update({ label: t('导入') });
    buttons.get('diffDraft')!.update({ label: t('对比更改') });
    buttons.get('copyContent')!.update({ label: t('复制全文') });
    buttons.get('export')!.update({ label: t('导出文件') });
    buttons.get('save')!.update({ label: t('保存方案') });
    buttons.get('preview')!.update({ label: t('预览启用') });
    buttons.get('guardSave')!.update({ label: t('保存后继续') });
    buttons.get('guardDiscard')!.update({ label: t('放弃修改') });
    buttons.get('guardCancel')!.update({ label: t('继续编辑') });
    buttons.get('restore')!.update({ label: t('预览恢复') });
    tabs.update({ items: [{ id: 'profiles', label: t('方案') }, { id: 'backups', label: t('备份') }] });
    select.update({ label: t('规则方案'), searchPlaceholder: t('搜索方案…'), placeholder: t('新建方案') });
    name.update({ label: t('方案名称'), placeholder: t('例如：日常开发') });
    editor.update({ label: t('规则内容 · Markdown'), placeholder: t('# 开发约定\n\n在这里填写全局工作规则…') });
    headingJump.update({ placeholder: t('章节速跳…') });
    headingJumpSlot.querySelector('.oc-sdk-trigger')?.setAttribute('aria-label', t('章节导航'));
    backupSelect.update({ label: t('备份时间'), searchPlaceholder: t('搜索时间…'), placeholder: t('选择备份') });
    lastReview = null;
    lastMessage = '';
    lastTab = '';
    lastContentForHeadings = '\0';
  };

  return {
    pickFile: () => input.click(),
    focusName: () => nameInput.focus(),
    localize,
    render(state: State) {
      const { locale } = i18n;
      const loaded = state.loaded;
      const selected = loaded?.library.profiles.find(item => item.id === state.draft.id);
      const archived = Boolean(selected?.archived);
      const blocked = state.busy || !loaded || state.pending;

      const meta = statusMeta(loaded, t);
      statusBadge.update({ label: meta.label, tone: meta.tone });
      title.textContent = loaded ? currentLabel(loaded, t) : state.busy ? t('正在读取规则…') : t('规则尚未读取');
      title.title = title.textContent;

      message.hidden = !state.message;
      message.textContent = state.message;
      message.dataset.tone = state.tone;
      guard.hidden = !state.pending;

      const unmatchedGlobal = Boolean(
        loaded
        && !state.review
        && state.tab === 'profiles'
        && loaded.global.exists
        && loaded.global.content.trim() !== ''
        && !matchedProfile(loaded)
        && state.draft.content !== loaded.global.content,
      );
      unmatchedBanner.hidden = !unmatchedGlobal;

      if ((state.message !== lastMessage && state.tone === 'error') || (state.pending && !lastPending)) scroll.scrollTop = 0;
      lastMessage = state.message;
      lastPending = state.pending;

      const showProfiles = Boolean(loaded) && !state.review && state.tab === 'profiles';
      profiles.hidden = !showProfiles;
      foot.hidden = !showProfiles;
      backups.hidden = !loaded || Boolean(state.review) || state.tab !== 'backups';
      review.hidden = !state.review;
      tabsSlot.hidden = Boolean(state.review);

      if (state.tab !== lastTab) {
        tabs.update({ activeId: state.tab });
        lastTab = state.tab;
      }

      select.update({
        value: state.draft.id ?? null,
        disabled: blocked,
        options: (loaded?.library.profiles ?? [])
          .filter(item => state.showArchived || !item.archived)
          .map(item => {
            const tok = formatCompactTokens(estimateTokens(item.content), locale);
            const hint = item.archived
              ? t('已归档')
              : loaded?.global.exists && item.content === loaded.global.content
                ? t('与全局一致 · ~{tokens} tok', { tokens: tok })
                : t('~{tokens} tok', { tokens: tok });
            return { id: item.id, label: item.name, hint };
          }),
      });

      name.update({ value: state.draft.name, disabled: blocked || archived });

      const lines = countLines(state.draft.content);
      const tokens = estimateTokens(state.draft.content);
      editor.update({
        value: state.draft.content,
        disabled: blocked || archived,
        helper: `${t('{lines} 行 · {count} 字符 · ~{tokens} tokens', {
          lines: lines.toLocaleString(locale),
          count: state.draft.content.length.toLocaleString(locale),
          tokens: tokens.toLocaleString(locale),
        })}${state.dirty || !selected ? t(' · 未保存') : archived ? t(' · 已归档，只读') : t(' · 已保存')}`,
      });

      budgetNote.hidden = tokens <= TOKEN_WARN_BUDGET;
      if (!budgetNote.hidden) {
        budgetNote.textContent = t('约 {tokens} tokens，建议将全局规则精简在 {budget} tokens 内以留出会话上下文空间。', {
          tokens: tokens.toLocaleString(locale),
          budget: TOKEN_WARN_BUDGET.toLocaleString(locale),
        });
      }

      if (state.draft.content !== lastContentForHeadings) {
        lastContentForHeadings = state.draft.content;
        currentHeadings = extractMarkdownHeadings(state.draft.content);
        headingJumpSlot.hidden = currentHeadings.length === 0;
        headingJump.update({
          value: null,
          options: currentHeadings.map(item => ({
            id: String(item.offset),
            label: `${item.level === 1 ? '# ' : item.level === 2 ? '## ' : '### '}${item.title}`,
            hint: `L${item.line}`,
          })),
        });
      }
      headingJump.update({ disabled: blocked || currentHeadings.length === 0 });

      saveNote.textContent = state.dirty
        ? t('保存仅更新方案库；保存后可预览启用。')
        : archived
          ? t('恢复归档后可继续编辑和启用。')
          : selected
            ? t('选中方案不会改变全局规则。')
            : t('填写或导入规则，保存你的第一个方案。');

      for (const handle of buttons.values()) handle.update({ disabled: blocked });
      buttons.get('refresh')!.update({ disabled: state.busy || state.pending, loading: state.busy && !loaded });
      buttons.get('copyPath')!.update({ disabled: state.busy });
      for (const action of ['guardSave', 'guardDiscard', 'guardCancel'] as const) buttons.get(action)!.update({ disabled: state.busy });

      const canDiffDraft = Boolean(
        loaded && (
          (state.dirty && selected && selected.content !== state.draft.content)
          || (loaded.global.content !== state.draft.content)
        ),
      );
      buttons.get('diffDraft')!.update({ disabled: blocked || !canDiffDraft });
      buttons.get('copyContent')!.update({ disabled: state.busy || !state.draft.content });
      buttons.get('save')!.update({ disabled: blocked || archived || !state.dirty });
      buttons.get('preview')!.update({ disabled: blocked || archived || !selected || state.dirty });
      buttons.get('copy')!.update({ disabled: blocked || !state.draft.name });
      buttons.get('export')!.update({ disabled: blocked || !selected || state.dirty });
      buttons.get('archive')!.update({ label: archived ? t('恢复归档') : t('归档'), disabled: blocked || !selected || state.dirty });
      buttons.get('archives')!.update({ label: state.showArchived ? t('隐藏归档') : t('显示归档') });

      backupSelect.update({
        value: state.backup?.id ?? null,
        disabled: blocked,
        options: state.backups.map(id => ({ id, label: new Date(Number(id.split('-')[0])).toLocaleString(locale), hint: id.slice(-4) })),
      });
      backupNote.textContent = state.backups.length
        ? t('显示最近 {count} 份备份；恢复前也会备份当前文件。', { count: state.backups.length })
        : t('暂无备份。首次替换已有全局文件时会自动创建。');
      backupText.hidden = !state.backup;
      backupText.textContent = state.backup?.content ?? '';
      backupText.setAttribute('aria-label', state.backup?.label ?? t('备份内容'));
      buttons.get('restore')!.update({ disabled: blocked || !state.backup });

      const isReadonlyReview = Boolean(state.review?.readonly);
      reviewHint.hidden = isReadonlyReview;
      const applyButtonEl = reviewActions.lastElementChild as HTMLElement | null;
      if (applyButtonEl) applyButtonEl.hidden = isReadonlyReview;
      buttons.get('back')!.update({ label: state.review?.source === 'backup' ? t('返回备份') : t('返回编辑'), disabled: state.busy });
      buttons.get('apply')!.update({
        label: state.review?.source === 'backup' ? t('确认恢复') : t('确认启用'),
        disabled: isReadonlyReview || state.busy || state.reviewInvalid || !state.review || (state.review.before.exists && state.review.before.content === state.review.content),
        loading: state.busy && Boolean(state.review) && !isReadonlyReview,
      });

      if (state.review !== lastReview) {
        lastReview = state.review;
        if (state.review) {
          paintReview(state.review);
          scroll.scrollTop = 0;
          reviewTitle.focus();
        }
      }
    },
  };
};
