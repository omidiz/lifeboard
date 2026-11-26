import './style.css';
import { parseRoute, routeHash, ROUTES, type Route } from './logic/routes';
import { renderPlaceholder, VIEWS } from './views/placeholders';

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

function show(route: Route): void {
  viewEl.replaceChildren(renderPlaceholder(route));
  document.title = `${VIEWS[route].title} · Lifeboard`;
  tabs.forEach((tab) => {
    if (tab.dataset.route === route) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', () => show(parseRoute(location.hash)));
show(parseRoute(location.hash));
