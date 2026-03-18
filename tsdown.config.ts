import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  deps: {
    neverBundle: ['node-cron', 'pino', 'pino-pretty', 'postgres'],
  },
});
