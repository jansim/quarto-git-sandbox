// Builds the optional VS Code view into the extension's resources:
//
//   cd vscode && npm install && npm run build
//
// The output is an ES module (workbench.js) plus the chunks, workers and
// assets it loads. sandbox-ui.js only fetches it when a learner opens the
// VS Code tab, so pages that never open it pay nothing for it.
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

const outDir = fileURLToPath(new URL('../_extensions/git-sandbox/resources/vscode', import.meta.url))

export default defineConfig({
  // relative URLs, so the bundle works wherever Quarto copies it
  base: './',
  logLevel: 'warn',
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2022',
    // assets must stay files: workers and fonts are loaded by URL
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 100000,
    modulePreload: false,
    reportCompressedSize: false,
    rollupOptions: {
      input: { workbench: fileURLToPath(new URL('./src/main.js', import.meta.url)) },
      preserveEntrySignatures: 'exports-only',
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    }
  },
  worker: {
    format: 'es',
    rollupOptions: {
      output: { entryFileNames: 'workers/[name]-[hash].js', chunkFileNames: 'workers/[name]-[hash].js' }
    }
  },
  plugins: [
    {
      // The workbench lives in a shadow root, away from the page's styles.
      // VS Code's stylesheets must then arrive as strings, which
      // monaco-vscode-api adopts into that shadow root itself.
      name: 'vscode-css-as-string',
      enforce: 'pre',
      async resolveId(source, importer, options) {
        const resolved = await this.resolve(source, importer, options)
        if (resolved && /node_modules\/(@codingame\/monaco-vscode|vscode|monaco-editor).*\.css$/.test(resolved.id)) {
          return { ...resolved, id: resolved.id + '?inline' }
        }
        return null
      }
    }
  ]
})
