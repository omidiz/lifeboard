import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUTE, parseRoute, parseRouteParam, routeHash, ROUTES } from './routes';

describe('parseRoute', () => {
  it('parses each known route', () => {
    for (const route of ROUTES) {
      expect(parseRoute(routeHash(route))).toBe(route);
    }
  });

  it('parses pages outside the bottom navigation', () => {
    expect(parseRoute('#/projects')).toBe('projects');
    expect(parseRoute('#/projects/abc')).toBe('projects');
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

describe('routeHash', () => {
  it('adds an encoded param', () => {
    expect(routeHash('projects', 'a b/c')).toBe('#/projects/a%20b%2Fc');
    expect(parseRouteParam(routeHash('projects', 'a b/c'))).toBe('a b/c');
  });
});

describe('parseRouteParam', () => {
  it('returns the segment after the route', () => {
    expect(parseRouteParam('#/today/2026-11-25')).toBe('2026-11-25');
    expect(parseRouteParam('#/today/2026-11-25?x=1')).toBe('2026-11-25');
  });

  it('returns null when there is none', () => {
    expect(parseRouteParam('#/today')).toBeNull();
    expect(parseRouteParam('#/today/')).toBeNull();
    expect(parseRouteParam('')).toBeNull();
  });
});
