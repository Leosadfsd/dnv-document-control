import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.DNV_BASE_PATH || './',
  server: { host: '127.0.0.1', port: 4177, strictPort: true },
  preview: { host: '127.0.0.1', port: 4187, strictPort: true },
});
