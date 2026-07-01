import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { viteSingleFile } from 'vite-plugin-singlefile'

// Builds the view into ONE self-contained HTML (JS+CSS inlined) so the artifact
// stays double-click-portable — the property build.py used to give us. Data is
// bundled at build time via `import` of ../companies.json (Vite handles JSON),
// and validate.py gates the build (see package.json "prebuild").
export default defineConfig({
  plugins: [svelte(), viteSingleFile()],
  build: {
    // Emit as app.html (not index.html) so the single-file artifact keeps its name.
    rollupOptions: { input: 'app.html' },
    // Single-file output — no code-splitting/asset URLs to externalize.
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
  },
})
