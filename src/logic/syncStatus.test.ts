import { describe, expect, it } from 'vitest';
import { formatAgo, INITIAL_SYNC_STATUS, syncShortLabel, syncStatusLine, type SyncStatus } from './syncStatus';

const NOW = new Date('2026-11-26T12:00:00.000Z');
const status = (patch: Partial<SyncStatus>): SyncStatus => ({ ...INITIAL_SYNC_STATUS, ...patch });

describe('formatAgo', () => {
  it('says how long ago, coarsely', () => {
    expect(formatAgo('2026-11-26T11:59:40.000Z', NOW)).toBe('just now');
    expect(formatAgo('2026-11-26T11:55:00.000Z', NOW)).toBe('5 min ago');
    expect(formatAgo('2026-11-26T09:00:00.000Z', NOW)).toBe('3 h ago');
    expect(formatAgo('2026-11-25T10:00:00.000Z', NOW)).toBe('yesterday');
    expect(formatAgo('2026-11-22T12:00:00.000Z', NOW)).toBe('4 days ago');
    expect(formatAgo('not a date', NOW)).toBe('just now');
  });
});

describe('sync status text', () => {
  it('has a short label for each visible state', () => {
    expect(syncShortLabel(status({ state: 'off' }))).toBe('');
    expect(syncShortLabel(status({ state: 'synced' }))).toBe('Synced');
    expect(syncShortLabel(status({ state: 'syncing' }))).toBe('Syncing');
    expect(syncShortLabel(status({ state: 'offline' }))).toBe('Offline');
    expect(syncShortLabel(status({ state: 'error' }))).toBe('Sync error');
  });

  it('describes each state in one line', () => {
    expect(syncStatusLine(status({ state: 'synced', lastSyncAt: '2026-11-26T11:58:00.000Z' }), NOW)).toBe('Synced 2 min ago.');
    expect(syncStatusLine(status({ state: 'offline', unsynced: 1 }), NOW)).toBe(
      'Offline. 1 change saved on this device will sync when you’re back online.',
    );
    expect(syncStatusLine(status({ state: 'offline' }), NOW)).toBe('Offline. Everything is saved on this device.');
    expect(syncStatusLine(status({ state: 'error', message: 'Repo not found.', unsynced: 3 }), NOW)).toBe(
      'Repo not found. 3 changes saved on this device, waiting to sync.',
    );
    expect(syncStatusLine(status({ state: 'off' }), NOW)).toMatch(/this device only/);
  });
});
