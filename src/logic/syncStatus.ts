/** Sync status as shown to the user: the indicator and the line in Settings. */

export type SyncState = 'off' | 'synced' | 'syncing' | 'offline' | 'error';

export interface SyncStatus {
  state: SyncState;
  /** Why sync is offline or failing, in plain words. */
  message: string | null;
  /** ISO time of the last sync that completed. */
  lastSyncAt: string | null;
  /** Local files with changes not yet on GitHub. */
  unsynced: number;
}

export const INITIAL_SYNC_STATUS: SyncStatus = { state: 'off', message: null, lastSyncAt: null, unsynced: 0 };

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago". */
export function formatAgo(iso: string, now: Date = new Date()): string {
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

const changes = (n: number) => `${n} change${n === 1 ? '' : 's'}`;

/** Short label for the indicator. */
export function syncShortLabel(status: SyncStatus): string {
  switch (status.state) {
    case 'off':
      return '';
    case 'synced':
      return 'Synced';
    case 'syncing':
      return 'Syncing';
    case 'offline':
      return 'Offline';
    case 'error':
      return 'Sync error';
  }
}

/** One line describing the state, for Settings and the indicator's accessible label. */
export function syncStatusLine(status: SyncStatus, now: Date = new Date()): string {
  const n = status.unsynced;
  switch (status.state) {
    case 'off':
      return 'Sync is off. Your data is saved on this device only.';
    case 'synced':
      return status.lastSyncAt ? `Synced ${formatAgo(status.lastSyncAt, now)}.` : 'Synced.';
    case 'syncing':
      return 'Syncing…';
    case 'offline':
      return n > 0
        ? `Offline. ${changes(n)} saved on this device will sync when you’re back online.`
        : 'Offline. Everything is saved on this device.';
    case 'error': {
      const message = status.message ?? 'Sync failed.';
      return n > 0 ? `${message} ${changes(n)} saved on this device, waiting to sync.` : message;
    }
  }
}
