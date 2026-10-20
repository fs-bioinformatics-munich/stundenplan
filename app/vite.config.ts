import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// BASE_URL lets the same build run under https://<user>.github.io/<repo>/ later.
export default defineConfig({
  base: process.env.BASE_URL ?? './',
  plugins: [preact()],
  test: { include: ['tests/**/*.test.ts'] },
});
