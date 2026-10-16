import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { readFileSync, readdirSync } from "node:fs";

function pdfAssets(): Plugin {
  const directories = ["cmaps", "standard_fonts", "wasm"];
  const root = resolve(import.meta.dirname, "node_modules/pdfjs-dist");
  return {
    name: "packaged-pdf-assets",
    generateBundle() {
      for (const directory of directories) for (const name of readdirSync(resolve(root, directory))) {
        if (name.endsWith(".wasm")) continue; // No executable WASM or CSP relaxation.
        this.emitFile({ type: "asset", fileName: `pdf-assets/${directory}/${name}`, source: readFileSync(resolve(root, directory, name)) });
      }
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const match = /^\/pdf-assets\/(cmaps|standard_fonts|wasm)\/([\w.-]+)$/.exec(request.url ?? "");
        if (!match || match[2].endsWith(".wasm")) return next();
        try { response.end(readFileSync(resolve(root, match[1], match[2]))); } catch { response.statusCode = 404; response.end(); }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), pdfAssets()],
  build: {
    // Chrome extension pages can reject Vite's generated modulepreload links as
    // cross-world resources. Static module imports still load the shared chunks.
    modulePreload: false,
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(import.meta.dirname, "sidepanel.html"),
        background: resolve(import.meta.dirname, "src/background/service-worker.ts"),
        pageExecutor: resolve(import.meta.dirname, "src/content/page-executor.ts"),
        pageRecorder: resolve(import.meta.dirname, "src/content/page-recorder.ts"),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "background"
            ? "background.js"
            : chunk.name === "pageExecutor"
              ? "page-executor.js"
              : chunk.name === "pageRecorder"
                ? "page-recorder.js"
                : "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
