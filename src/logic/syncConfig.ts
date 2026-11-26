/** The GitHub sync settings: username, repo and a fine-grained token. */

export interface SyncConfig {
  owner: string;
  repo: string;
  token: string;
}

export const DEFAULT_REPO = 'lifeboard-data';

// GitHub usernames: letters, digits and single hyphens, up to 39 characters.
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
// Repo names: letters, digits, ".", "-" and "_", up to 100 characters.
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
// Fine-grained tokens look like github_pat_…; classic ones ghp_…. Only word characters either way.
const TOKEN_RE = /^[A-Za-z0-9_]{20,255}$/;

/** Accepts "omidiz", "@omidiz" or "https://github.com/omidiz". */
export function normalizeOwner(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/^@/, '')
    .split('/')[0];
}

/** Accepts "lifeboard-data" or "lifeboard-data.git". */
export function normalizeRepo(input: string): string {
  return input.trim().replace(/\.git$/i, '');
}

export function normalizeToken(input: string): string {
  return input.trim();
}

export const isValidOwner = (owner: string) => OWNER_RE.test(owner);
export const isValidRepo = (repo: string) => REPO_RE.test(repo) && repo !== '.' && repo !== '..';
export const isValidToken = (token: string) => TOKEN_RE.test(token);

/** A problem with the settings, phrased for the user; null when all is fine. */
export function configProblem(config: Partial<SyncConfig>): string | null {
  if (!config.owner) return 'Add your GitHub username.';
  if (!isValidOwner(config.owner)) return 'That doesn’t look like a GitHub username.';
  if (!config.repo) return 'Add the repo name.';
  if (!isValidRepo(config.repo)) return 'That doesn’t look like a repo name.';
  return tokenProblem(config.token ?? '');
}

/** A problem with the token, phrased for the user (never repeating it); null when it looks right. */
export function tokenProblem(token: string): string | null {
  if (!token) return 'Add your token.';
  if (!isValidToken(token)) return 'That doesn’t look like a GitHub token. Copy it again from GitHub.';
  return null;
}

export function isCompleteConfig(config: Partial<SyncConfig> | null | undefined): config is SyncConfig {
  return !!config && configProblem(config) === null;
}

/** Identifies the repo the local sync bookkeeping belongs to (GitHub names are case-insensitive). */
export function syncTarget(config: Pick<SyncConfig, 'owner' | 'repo'>): string {
  return `${config.owner}/${config.repo}`.toLowerCase();
}
