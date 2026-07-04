/// <reference types='vitest' />
import { readdirSync } from 'node:fs';
import { defineConfig } from 'vite';
import angular from '@analogjs/vite-plugin-angular';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const hasProjectRootMarkdown = readdirSync(__dirname).some((entry) => entry.endsWith('.md'));

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/frontend',
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    angular(),
    ...(hasProjectRootMarkdown
      ? viteStaticCopy({
          targets: [{ src: '*.md', dest: '.' }],
        })
      : []),
  ],
  test: {
    name: 'frontend',
    watch: false,
    globals: true,
    environment: 'jsdom',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    setupFiles: ['src/test-setup.ts'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/apps/frontend',
      provider: 'v8' as const,
      reporter: ['lcov', 'text', 'json'],
      include: ['src/app/**/*.ts'],
      exclude: ['src/app/**/*.spec.ts', 'src/app/**/*.stories.ts', 'src/app/testing/**'],
    },
  },
}));
