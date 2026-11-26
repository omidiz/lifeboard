import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUTE, parseRoute, routeHash, ROUTES } from './routes';

describe('parseRoute', () => {
  it('parses each known route', () => {
    for (const route of ROUTES) {
      expect(parseRoute(routeHash(route))).toBe(route);
    }
  });

  it('accepts hashes without a slash and in any case', () => {
    expect(parseRoute('#stats')).toBe('stats');
    expect(parseRoute('#/Garden')).toBe('garden');
  });

  it('ignores trailing segments and query strings', () => {
    expect(parseRoute('#/today/2026-11-25')).toBe('today');
    expect(parseRoute('#/focus?preset=25')).toBe('focus');
  });

  it('falls back to the default route', () => {
    expect(parseRoute('')).toBe(DEFAULT_ROUTE);
    expect(parseRoute('#/')).toBe(DEFAULT_ROUTE);
    expect(parseRoute('#/nope')).toBe(DEFAULT_ROUTE);
  });
});
