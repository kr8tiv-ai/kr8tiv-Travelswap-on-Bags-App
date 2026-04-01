import { defineConfig } from 'vite';

// Root-level proxy: points Vite to frontend/ directory.
// The frontend's own vite.config.ts handles plugins and server config.
export default defineConfig({
  root: 'frontend',
});
