import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vendor chunks that change rarely get their own long-cached files:
// - react: react, react-dom, scheduler and the router (needed on every page)
// - three: three.js, requested only by pages / sections that draw 3D
// lucide-react is left to Rollup on purpose: icons are tree-shaken per page, so a
// single icon chunk would pull every page's icons into the first load.
// react-markdown / remark already land in the lazy Markdown chunk.
function vendorChunk(id: string): string | undefined {
  if (!id.includes('node_modules')) return;
  const p = id.replace(/\\/g, '/');
  if (/\/node_modules\/three\//.test(p)) return 'three';
  // react-dom/server is only used by the 3D textures (src/realm/tex.ts): keep it with them
  if (/\/node_modules\/react-dom\/(server|cjs\/react-dom-server)/.test(p)) return;
  if (/\/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|@remix-run\/router)\//.test(p)) return 'react';
}

export default defineConfig({
  plugins: [react()],
  build: {
    // three.js is one ~600 kB module (it cannot be split further) and only loads on 3D views.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: vendorChunk,
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8790',
      '/uploads': 'http://localhost:8790',
      '/p/': 'http://localhost:8790',
    },
  },
});
