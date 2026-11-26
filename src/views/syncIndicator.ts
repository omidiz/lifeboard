/** Small sync status pill in the top corner; hidden while sync isn't set up. Opens Settings. */
import { routeHash } from '../logic/routes';
import { syncShortLabel, syncStatusLine, type SyncStatus } from '../logic/syncStatus';
import { getSyncStatus, onSyncStatus } from '../sync/sync';

export function createSyncIndicator(): HTMLAnchorElement {
  const el = document.createElement('a');
  el.className = 'sync-pill';
  el.href = routeHash('settings');
  el.innerHTML = `<span class="sync-dot" aria-hidden="true"></span><span class="sync-text" aria-hidden="true"></span>`;
  const text = el.querySelector<HTMLElement>('.sync-text')!;

  const render = (status: SyncStatus) => {
    el.hidden = status.state === 'off';
    el.dataset.state = status.state;
    // "Synced" is the calm, normal state: just the dot.
    text.textContent = status.state === 'synced' ? '' : syncShortLabel(status);
    const line = syncStatusLine(status);
    el.setAttribute('aria-label', `Sync: ${line} Open settings.`);
    el.title = line;
  };

  onSyncStatus(render);
  render(getSyncStatus());
  return el;
}
