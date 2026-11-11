export const GLOBAL_PATH = '~/.config/opencode/AGENTS.md';
export const DATA_DIR = '~/.config/openchamber/agents-manager';
export const LIBRARY_PATH = `${DATA_DIR}/library.json`;
export const MAX_CONTENT = 100_000;
export const MAX_PROFILES = 100;
export const TOKEN_WARN_BUDGET = 4_000;

export type Profile = {
  id: string;
  name: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
};
export type Library = { version: 1; profiles: Profile[] };
export type Snapshot = { exists: boolean; content: string };
export type Loaded = { library: Library; raw: string | null; global: Snapshot };
export type Backup = { version: 1; id: string; createdAt: number; label: string; content: string };
export type ReviewSource = 'profile' | 'backup' | 'draft-saved' | 'draft-global';
export type Review = {
  name: string;
  content: string;
  before: Snapshot;
  source: ReviewSource;
  profileId?: string;
  readonly?: boolean;
};
export type HeadingItem = {
  level: 1 | 2 | 3;
  title: string;
  line: number;
  offset: number;
};
export interface Files {
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
  list(path: string): Promise<string[]>;
}
export class ConflictError extends Error {}

export const matchedProfile = (loaded: Loaded): Profile | undefined => loaded.global.exists
  ? loaded.library.profiles.find(profile => !profile.archived && profile.content === loaded.global.content)
  : undefined;

export const sameSnapshot = (a: Snapshot, b: Snapshot): boolean => a.exists === b.exists && a.content === b.content;

export const countLines = (text: string): number => (
  text.length === 0 ? 0 : text.split(/\r?\n/).length
);

export const estimateTokens = (text: string): number => {
  if (!text) return 0;
  let cjk = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (
      (code >= 0x4e00 && code <= 0x9fff)
      || (code >= 0x3400 && code <= 0x4dbf)
      || (code >= 0x3000 && code <= 0x30ff)
      || (code >= 0xac00 && code <= 0xd7af)
      || (code >= 0xff00 && code <= 0xffef)
    ) {
      cjk += 1;
    }
  }
  const rest = Math.max(0, text.length - cjk);
  return Math.max(1, Math.round(cjk * 1.45 + rest / 4));
};

export const extractMarkdownHeadings = (text: string): HeadingItem[] => {
  if (!text) return [];
  const headings: HeadingItem[] = [];
  let inFence: '`' | '~' | null = null;
  let offset = 0;
  let lineNumber = 0;
  const parts = text.split(/(\r?\n)/);
  for (let index = 0; index < parts.length; index += 2) {
    const rawLine = parts[index] ?? '';
    const lineBreak = parts[index + 1] ?? '';
    lineNumber += 1;
    const trimmed = rawLine.trimStart();
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      const marker = trimmed[0] as '`' | '~';
      if (inFence === null) inFence = marker;
      else if (inFence === marker) inFence = null;
    } else if (inFence === null) {
      const match = rawLine.match(/^(#{1,3})\s+(.+?)\s*#*\s*$/);
      if (match) {
        const title = match[2].trim();
        if (title) {
          headings.push({
            level: match[1].length as 1 | 2 | 3,
            title: title.slice(0, 80),
            line: lineNumber,
            offset,
          });
        }
      }
    }
    offset += rawLine.length + lineBreak.length;
  }
  return headings;
};
