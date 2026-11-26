import { defineConfig } from 'vitest/config';

/**
 * Content Security Policy for the built app. connect-src limits network
 * requests to this site and api.github.com, so the sync token can't be sent
 * anywhere else even by mistake. Build only: the dev server needs a websocket.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://api.github.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export default defineConfig({
  base: '/lifeboard/',
  plugins: [
    {
      name: 'lifeboard-csp',
      apply: 'build',
      transformIndexHtml: (html) =>
        html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
    },
  ],
  test: {
    include: ['src/**/*.test.ts'],
  },
});
