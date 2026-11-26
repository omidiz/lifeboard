import type { Route } from '../logic/routes';

export interface ViewInfo {
  title: string;
  label: string;
  icon: string;
  blurb: string;
}

const icon = (paths: string) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

export const VIEWS: Record<Route, ViewInfo> = {
  today: {
    title: 'Today',
    label: 'Today',
    icon: icon('<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>'),
    blurb: 'Your morning check-in and the day at a glance.',
  },
  focus: {
    title: 'Focus',
    label: 'Focus',
    icon: icon('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M10 2h4"/>'),
    blurb: 'A calm focus timer with presets and a free stopwatch is coming.',
  },
  stats: {
    title: 'Stats',
    label: 'Stats',
    icon: icon('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
    blurb: 'Trends for sleep, energy, focus and habits will appear here.',
  },
  garden: {
    title: 'Garden',
    label: 'Garden',
    icon: icon('<path d="M12 21v-9"/><path d="M12 14c-4 0-6-2.5-6-6 4 0 6 2.5 6 6zM12 12c0-4 2.5-6.5 6.5-6.5 0 4-2.5 6.5-6.5 6.5z"/><path d="M6 21h12"/>'),
    blurb: 'A garden that grows gently from your days. Seeds are being planted.',
  },
  settings: {
    title: 'Settings',
    label: 'Settings',
    icon: icon('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
    blurb: 'GitHub sync, export and import will be set up here.',
  },
};

export function renderPlaceholder(route: Route): HTMLElement {
  const view = VIEWS[route];
  const section = document.createElement('section');
  section.className = 'view';
  section.innerHTML = `
    <header class="view-header">
      <h1>${view.title}</h1>
    </header>
    <div class="card placeholder">
      <div class="placeholder-icon">${view.icon}</div>
      <p>${view.blurb}</p>
    </div>
  `;
  return section;
}
