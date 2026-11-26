import './style.css';
import { initFocusTimer } from './focus/timer';
import { todayKey } from './logic/dates';
import { parseRoute, parseRouteParam, routeHash, ROUTES, type Route } from './logic/routes';
import { renderPlaceholder, VIEWS } from './views/placeholders';
import { createFocusView } from './views/focus';
import { createSettingsView } from './views/settings';
import { createTodayView } from './views/today';
import type { View } from './views/view';

const app = document.querySelector<HTMLDivElement>('#app')!;

app.innerHTML = `
  <main id="view" class="content" tabindex="-1"></main>
  <nav class="tabbar" aria-label="Main">
    ${ROUTES.map(
      (route) => `
      <a class="tab" href="${routeHash(route)}" data-route="${route}">
        ${VIEWS[route].icon}
        <span>${VIEWS[route].label}</span>
      </a>`,
    ).join('')}
  </nav>
`;

const viewEl = app.querySelector<HTMLElement>('#view')!;
const tabs = app.querySelectorAll<HTMLAnchorElement>('.tab');

let current: View | null = null;
let currentRoute: Route | null = null;
let renderedOn = todayKey();

function createView(route: Route, param: string | null): View {
  if (route === 'today') return createTodayView(param);
  if (route === 'focus') return createFocusView();
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
  tabs.forEach((tab) => {
    if (tab.dataset.route === route) tab.setAttribute('aria-current', 'page');
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

show();
