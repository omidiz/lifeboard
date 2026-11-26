# Lifeboard

A calm personal life dashboard: sleep & energy, focus, habits, projects — and a garden that grows from your days.

Live: https://omidiz.github.io/lifeboard/

```bash
npm install
npm run dev     # local dev server
npm test        # unit tests (Vitest)
npm run build   # type-check + production build
```

## Sync with GitHub

Lifeboard saves everything on the device first and works fully offline.
To sync between devices, it can keep your data in a **private** repo of
your own (e.g. `lifeboard-data`):

1. Create a private repo named `lifeboard-data` (it can be empty).
2. Create a [fine-grained token](https://github.com/settings/personal-access-tokens/new)
   with access to **only that repo** and the permission
   **Contents: Read and write**.
3. In Lifeboard → Settings → GitHub sync, enter your username, the repo
   name and the token, then tap **Test connection**.

The token is stored only in this device's IndexedDB, shown masked, never
logged, and only ever sent to `api.github.com`. **Disconnect** removes it
from the device; your data stays.

Sync runs on app open, a few seconds after changes, and when you're back
online. If the same day was edited on two devices, the changes are merged
(habit ticks, focus sessions and check-in answers from both are kept);
nothing is overwritten blindly.
