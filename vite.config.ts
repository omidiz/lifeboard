import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/lifeboard/',
  test: {
    include: ['src/**/*.test.ts'],
  },
});
