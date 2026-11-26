export const ROUTES = ['today', 'focus', 'stats', 'garden', 'settings'] as const;

export type Route = (typeof ROUTES)[number];

export const DEFAULT_ROUTE: Route = 'today';

export function isRoute(value: string): value is Route {
  return (ROUTES as readonly string[]).includes(value);
}

/** Turns a location hash like "#/focus" into a known route, falling back to Today. */
export function parseRoute(hash: string): Route {
  const name = hash.replace(/^#\/?/, '').split(/[/?]/)[0].toLowerCase();
  return isRoute(name) ? name : DEFAULT_ROUTE;
}

export function routeHash(route: Route): string {
  return `#/${route}`;
}
