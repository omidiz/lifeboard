/**
 * Settings card for GitHub sync. Saves as you go, like the rest of the app.
 * The token field is write-only: once saved it is shown masked and can be
 * replaced or removed, never read back.
 */
import { DEFAULT_REPO, normalizeOwner, normalizeRepo } from '../logic/syncConfig';
import { syncStatusLine, type SyncStatus } from '../logic/syncStatus';
import {
  disconnect,
  getSyncSettings,
  getSyncStatus,
  onSyncStatus,
  requestSync,
  saveRepoSettings,
  saveToken,
  testConnection,
  type PublicSyncSettings,
} from '../sync/sync';
import type { View } from './view';

const TEXT_SAVE_DELAY_MS = 400;
const DISCONNECT_CONFIRM_MS = 3000;
const STATUS_REFRESH_MS = 30_000;
const TOKEN_HELP_URL = 'https://github.com/settings/personal-access-tokens/new';

export function createSyncSettings(): View {
  const el = document.createElement('section');
  el.className = 'card sync-card';
  el.setAttribute('aria-labelledby', 'sync-title');
  el.innerHTML = `
    <div class="card-head">
      <h2 id="sync-title">GitHub sync</h2>
    </div>
    <p class="card-sub">Keep your data in your own private GitHub repo and use Lifeboard on several devices.
      Everything is saved on this device first, so it works offline.</p>

    <div class="sync-fields">
      <label class="field">
        <span class="field-label">GitHub username</span>
        <input class="text-input" data-owner autocomplete="off" autocapitalize="none" spellcheck="false"
          enterkeyhint="next" placeholder="your-username" />
      </label>
      <label class="field">
        <span class="field-label">Repo</span>
        <input class="text-input" data-repo autocomplete="off" autocapitalize="none" spellcheck="false"
          enterkeyhint="next" placeholder="${DEFAULT_REPO}" />
      </label>
      <div class="field">
        <label class="field-label" for="sync-token">Fine-grained token</label>
        <div class="token-saved" data-token-saved hidden>
          <span class="token-mask" aria-label="Token saved and hidden">••••••••••••••••</span>
          <button type="button" class="text-button" data-token-replace>Replace</button>
        </div>
        <input id="sync-token" class="text-input" data-token type="password" autocomplete="off"
          autocapitalize="none" spellcheck="false" enterkeyhint="done" placeholder="github_pat_…" />
        <p class="field-hint">
          <a href="${TOKEN_HELP_URL}" target="_blank" rel="noopener noreferrer">Create a token</a>
          with access to only this repo and “Contents: Read and write”. It stays on this device and is only
          ever sent to GitHub.
        </p>
      </div>
    </div>

    <p class="field-error" data-field-error role="alert" hidden></p>

    <div class="sync-actions">
      <button type="button" class="secondary-button" data-test>Test connection</button>
      <button type="button" class="secondary-button" data-sync-now hidden>Sync now</button>
      <button type="button" class="text-button danger" data-disconnect hidden>Disconnect</button>
    </div>
    <p class="sync-result" data-result aria-live="polite" hidden></p>
    <p class="sync-line" data-sync-line aria-live="polite"></p>
  `;

  const ownerInput = el.querySelector<HTMLInputElement>('[data-owner]')!;
  const repoInput = el.querySelector<HTMLInputElement>('[data-repo]')!;
  const tokenInput = el.querySelector<HTMLInputElement>('[data-token]')!;
  const tokenSaved = el.querySelector<HTMLElement>('[data-token-saved]')!;
  const replaceButton = el.querySelector<HTMLButtonElement>('[data-token-replace]')!;
  const fieldError = el.querySelector<HTMLElement>('[data-field-error]')!;
  const testButton = el.querySelector<HTMLButtonElement>('[data-test]')!;
  const syncNowButton = el.querySelector<HTMLButtonElement>('[data-sync-now]')!;
  const disconnectButton = el.querySelector<HTMLButtonElement>('[data-disconnect]')!;
  const result = el.querySelector<HTMLElement>('[data-result]')!;
  const syncLine = el.querySelector<HTMLElement>('[data-sync-line]')!;

  let settings: PublicSyncSettings = { owner: '', repo: '', hasToken: false };
  let repoTimer: number | undefined;
  let disconnectTimer: number | undefined;
  let refreshTimer: number | undefined;
  let destroyed = false;

  function showFieldError(message: string | null): void {
    fieldError.hidden = !message;
    fieldError.textContent = message ?? '';
  }

  function showResult(message: string | null, ok = true): void {
    result.hidden = !message;
    result.textContent = message ?? '';
    result.classList.toggle('error', !ok);
    result.classList.toggle('success', ok);
  }

  function renderToken(): void {
    tokenSaved.hidden = !settings.hasToken;
    tokenInput.hidden = settings.hasToken;
    syncNowButton.hidden = !settings.hasToken;
    disconnectButton.hidden = !settings.hasToken;
  }

  function renderStatus(status: SyncStatus = getSyncStatus()): void {
    syncLine.textContent = syncStatusLine(status);
    syncLine.classList.toggle('error', status.state === 'error');
    syncNowButton.disabled = status.state === 'syncing';
  }

  // ---- Username and repo: saved as you type ----

  function flushRepoSettings(): void {
    if (repoTimer === undefined) return;
    window.clearTimeout(repoTimer);
    repoTimer = undefined;
    const input = { owner: ownerInput.value, repo: repoInput.value };
    saveRepoSettings(input)
      .then((saved) => {
        settings = { ...settings, ...saved };
      })
      .catch(() => showFieldError('Couldn’t save on this device.'));
  }

  for (const input of [ownerInput, repoInput]) {
    input.addEventListener('input', () => {
      showResult(null);
      window.clearTimeout(repoTimer);
      repoTimer = window.setTimeout(flushRepoSettings, TEXT_SAVE_DELAY_MS);
    });
    input.addEventListener('blur', () => {
      flushRepoSettings();
      // Show the cleaned-up value, e.g. "@name" → "name".
      if (input === ownerInput) ownerInput.value = normalizeOwner(ownerInput.value);
      else repoInput.value = normalizeRepo(repoInput.value) || DEFAULT_REPO;
    });
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      (input === ownerInput ? repoInput : settings.hasToken ? testButton : tokenInput).focus();
    });
  }

  // ---- Token: saved when pasted or when leaving the field ----

  async function commitToken(): Promise<void> {
    const value = tokenInput.value;
    if (!value.trim()) {
      showFieldError(null);
      if (settings.hasToken) renderToken(); // Replace cancelled: keep the saved token.
      return;
    }
    try {
      const problem = await saveToken(value);
      if (destroyed) return;
      showFieldError(problem);
      if (problem) return;
      tokenInput.value = '';
      settings = { ...settings, hasToken: true };
      renderToken();
      replaceButton.focus();
      showResult('Token saved on this device.');
    } catch {
      showFieldError('Couldn’t save on this device.');
    }
  }

  tokenInput.addEventListener('change', () => void commitToken());
  tokenInput.addEventListener('paste', () => window.setTimeout(() => void commitToken(), 0));
  tokenInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void commitToken();
    }
  });
  tokenInput.addEventListener('blur', () => {
    if (!tokenInput.value.trim() && settings.hasToken) renderToken();
  });

  replaceButton.addEventListener('click', () => {
    tokenSaved.hidden = true;
    tokenInput.hidden = false;
    tokenInput.value = '';
    tokenInput.focus();
  });

  // ---- Actions ----

  testButton.addEventListener('click', async () => {
    flushRepoSettings();
    testButton.disabled = true;
    testButton.textContent = 'Testing…';
    showResult(null);
    try {
      const outcome = await testConnection();
      if (!destroyed) showResult(outcome.message, outcome.ok);
    } finally {
      if (!destroyed) {
        testButton.disabled = false;
        testButton.textContent = 'Test connection';
      }
    }
  });

  syncNowButton.addEventListener('click', () => {
    showResult(null);
    void requestSync('manual');
  });

  disconnectButton.addEventListener('click', async () => {
    // Two taps, like deleting a habit.
    if (!disconnectButton.classList.contains('armed')) {
      disconnectButton.classList.add('armed');
      disconnectButton.textContent = 'Tap again to disconnect';
      disconnectTimer = window.setTimeout(() => {
        disconnectButton.classList.remove('armed');
        disconnectButton.textContent = 'Disconnect';
      }, DISCONNECT_CONFIRM_MS);
      return;
    }
    window.clearTimeout(disconnectTimer);
    disconnectButton.classList.remove('armed');
    disconnectButton.textContent = 'Disconnect';
    try {
      await disconnect();
      if (destroyed) return;
      settings = { ...settings, hasToken: false };
      renderToken();
      showResult('Disconnected. The token was removed from this device; your data is still here.');
    } catch {
      showResult('Couldn’t remove the token from this device. Try again.', false);
    }
  });

  // ---- Load ----

  const unsubscribe = onSyncStatus((status) => {
    if (!destroyed) renderStatus(status);
  });
  // Keeps "Synced 2 min ago" current.
  refreshTimer = window.setInterval(() => renderStatus(), STATUS_REFRESH_MS);
  renderStatus();
  renderToken();

  getSyncSettings()
    .then((loaded) => {
      if (destroyed) return;
      settings = loaded;
      ownerInput.value = loaded.owner;
      repoInput.value = loaded.repo || DEFAULT_REPO;
      renderToken();
    })
    .catch(() => {
      if (!destroyed) showFieldError('Couldn’t open local storage.');
    });

  return {
    el,
    destroy() {
      flushRepoSettings();
      destroyed = true;
      unsubscribe();
      window.clearTimeout(disconnectTimer);
      window.clearInterval(refreshTimer);
    },
  };
}
