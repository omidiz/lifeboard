import './style.css';
import { remoteChanges } from './data/changes';
import { initFocusTimer } from './focus/timer';
import { todayKey } from './logic/dates';
import { parseRoute, parseRouteParam, routeHash, TAB_ROUTES, type Route } from './logic/routes';
import { renderPlaceholder, VIEWS } from './views/placeholders';
import { createFocusView } from './views/focus';
import { createProjectsView } from './views/projects';
import { createSettingsView } from './views/settings';
import { createSyncIndicator } from './views/syncIndicator';
import { createTodayView } from './views/today';
import type { View } from './views/view';
import { initSync } from './sync/sync';

const app = document.querySelector<HTMLDivElement>('#app')!;

app.innerHTML = `
  <main id="view" class="content" tabindex="-1"></main>
  <nav class="tabbar" aria-label="Main">
    ${TAB_ROUTES.map(
      (route) => `
      <a class="tab" href="${routeHash(route)}" data-route="${route}">
        ${VIEWS[route].icon}
        <span>${VIEWS[route].label}</span>
      </a>`,
    ).join('')}
  </nav>
`;

app.prepend(createSyncIndicator());

const viewEl = app.querySelector<HTMLElement>('#view')!;
const tabs = app.querySelectorAll<HTMLAnchorElement>('.tab');

let current: View | null = null;
let currentRoute: Route | null = null;
let renderedOn = todayKey();

function createView(route: Route, param: string | null): View {
  if (route === 'today') return createTodayView(param);
  if (route === 'focus') return createFocusView();
  if (route === 'projects') return createProjectsView(param);
  if (route === 'settings') return createSettingsView();
  return { el: renderPlaceholder(route) };
}

function show(): void {
  const route = parseRoute(location.hash);
  const param = parseRouteParam(location.hash);

  current?.destroy?.();
  current = createView(route, param);
  viewEl.replaceChildren(current.el);
  renderedOn = todayKey();

  document.title = `${VIEWS[route].title} · Lifeboard`;
  // Pages outside the bottom navigation belong under Settings.
  const activeTab = VIEWS[route].tab;
  tabs.forEach((tab) => {
    if (tab.dataset.route === activeTab) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });
  if (route !== currentRoute) window.scrollTo(0, 0);
  currentRoute = route;
}

// Restore a timer left running before the page loads any screen.
initFocusTimer();

window.addEventListener('hashchange', show);

// Coming back to the app after midnight: refresh so "Today" means today.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && todayKey() !== renderedOn) show();
});

// Sync brought in changes from another device: reload the screen, but never
// while typing (that would lose the cursor); then wait until the field is left.
let refreshPending = false;
const isTyping = () => {
  const active = document.activeElement;
  return (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) && viewEl.contains(active);
};
function refreshAfterSync(): void {
  if (isTyping()) refreshPending = true;
  else show();
}
let refreshQueued = false;
remoteChanges.on(() => {
  // Several files can arrive in one sync: refresh once.
  if (refreshQueued) return;
  refreshQueued = true;
  queueMicrotask(() => {
    refreshQueued = false;
    refreshAfterSync();
  });
});
viewEl.addEventListener('focusout', () => {
  if (!refreshPending) return;
  // Wait for focus to land, so moving between fields doesn't trigger a refresh.
  window.setTimeout(() => {
    if (refreshPending && !isTyping()) {
      refreshPending = false;
      show();
    }
  }, 0);
});

show();
initSync();
