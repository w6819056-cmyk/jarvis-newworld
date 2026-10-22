import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist-windows',
    rollupOptions: {
      input: {
        jarvis: 'windows.html',
        holoMap: 'modules/holo-map/index.html',
        rainform: 'modules/rainform/index.html',
      },
    },
  },
});
