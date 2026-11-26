/**
 * Sync errors and the messages shown for them. Messages are fixed text
 * chosen by kind: they never include request details, headers or the
 * token, so an error can be shown or logged safely.
 */

export type SyncErrorKind =
  | 'offline' // no network, or GitHub can't be reached
  | 'auth' // 401: token wrong, expired or revoked
  | 'forbidden' // 403: token lacks access or permission
  | 'not-found' // 404: repo doesn't exist or the token isn't granted it
  | 'read-only' // token can read but not write
  | 'rate-limit' // 403/429 with rate-limit signals
  | 'conflict' // the file changed on GitHub meanwhile (stale SHA)
  | 'server' // 5xx
  | 'bad-response' // GitHub answered with something unexpected
  | 'not-configured'
  | 'local'; // this device's storage failed

export class SyncError extends Error {
  readonly kind: SyncErrorKind;
  /** HTTP status, when there was one. */
  readonly status: number | null;

  constructor(kind: SyncErrorKind, status: number | null = null) {
    super(syncErrorMessage(kind, status));
    this.name = 'SyncError';
    this.kind = kind;
    this.status = status;
  }
}

export function syncErrorMessage(kind: SyncErrorKind, status: number | null = null): string {
  switch (kind) {
    case 'offline':
      return 'You’re offline or GitHub can’t be reached. Changes are kept on this device and will sync later.';
    case 'auth':
      return 'GitHub didn’t accept the token. It may be mistyped, expired or revoked. Paste a new one.';
    case 'forbidden':
      return 'The token doesn’t have access. Give it access to this repo with “Contents: Read and write”.';
    case 'not-found':
      return 'Repo not found. Check the username and repo name, and that the token is granted access to this repo.';
    case 'read-only':
      return 'The token can read but not write. Change its “Contents” permission to “Read and write”.';
    case 'rate-limit':
      return 'GitHub is limiting requests for now. Lifeboard will try again in a few minutes.';
    case 'conflict':
      return 'A file changed on GitHub while syncing. Lifeboard will try again.';
    case 'server':
      return 'GitHub is having trouble right now. Lifeboard will try again shortly.';
    case 'bad-response':
      return status ? `GitHub sent an unexpected response (${status}). Lifeboard will try again.` : 'GitHub sent an unexpected response. Lifeboard will try again.';
    case 'not-configured':
      return 'Add your GitHub username, repo and token to sync.';
    case 'local':
      return 'Couldn’t read this device’s storage, so sync was skipped.';
  }
}

/** Errors that won't fix themselves: stop retrying until the settings change. */
export function isPermanentSyncError(kind: SyncErrorKind): boolean {
  return kind === 'auth' || kind === 'forbidden' || kind === 'not-found' || kind === 'read-only' || kind === 'not-configured';
}

export interface ResponseSignals {
  /** The x-ratelimit-remaining header. */
  rateLimitRemaining?: string | null;
  /** The retry-after header. */
  retryAfter?: string | null;
}

/** The kind of error for a failed GitHub response. */
export function classifyStatus(status: number, signals: ResponseSignals = {}): SyncErrorKind {
  if (status === 401) return 'auth';
  if (status === 429) return 'rate-limit';
  if (status === 403) {
    // GitHub uses 403 for both "no permission" and rate limits.
    return signals.rateLimitRemaining === '0' || signals.retryAfter ? 'rate-limit' : 'forbidden';
  }
  if (status === 404) return 'not-found';
  if (status === 409) return 'conflict';
  if (status >= 500) return 'server';
  return 'bad-response';
}

/** Delay before an automatic retry after a temporary error: 30 s, 2 min, 10 min, then every 10 min. */
export function retryDelayMs(attempt: number): number {
  const delays = [30_000, 120_000, 600_000];
  return delays[Math.min(Math.max(attempt, 0), delays.length - 1)];
}
