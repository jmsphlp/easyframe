import { defineConfig } from 'vite';

export default defineConfig({
  base: '/easyframe/',
  server: {
    host: true,        // listen on 0.0.0.0 so you can open it on your iPhone over LAN
    port: 5173,
  },
  build: {
    target: 'es2020',
    sourcemap: false,
  },
});
