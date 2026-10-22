export const GLOBAL_PATH = '~/.config/opencode/AGENTS.md';
export const DATA_DIR = '~/.config/openchamber/agents-manager';
export const LIBRARY_PATH = `${DATA_DIR}/library.json`;
export const MAX_CONTENT = 100_000;
export const MAX_PROFILES = 100;
export type Profile = { id: string; name: string; content: string; createdAt: number; updatedAt: number; archived: boolean };
export type Library = { version: 1; profiles: Profile[] };
export type Snapshot = { exists: boolean; content: string };
export type Loaded = { library: Library; raw: string | null; global: Snapshot };
export type Backup = { version: 1; id: string; createdAt: number; label: string; content: string };
export type Review = { name: string; content: string; before: Snapshot; source: 'profile' | 'backup'; profileId?: string };
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
