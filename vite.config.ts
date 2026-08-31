import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createManifest, getTargetBrowser, getTargetOutDir } from "./scripts/manifest.mjs";

const isWatchMode = process.argv.includes("--watch") || process.argv.includes("-w");
const targetBrowser = getTargetBrowser();
const outDir = getTargetOutDir(targetBrowser);

export default defineConfig({
  publicDir: false,
  define: {
    __TARGET_BROWSER__: JSON.stringify(targetBrowser)
  },
  plugins: [
    react(),
    {
      name: "write-extension-manifest",
      closeBundle() {
        mkdirSync(resolve(__dirname, outDir), { recursive: true });
        cpSync(resolve(__dirname, "public/icons"), resolve(__dirname, outDir, "icons"), { recursive: true });
        writeFileSync(
          join(resolve(__dirname, outDir), "manifest.json"),
          `${JSON.stringify(createManifest(targetBrowser), null, 2)}\n`
        );
      }
    }
  ],
  build: {
    outDir,
    emptyOutDir: !isWatchMode,
    sourcemap: true,
    rollupOptions: {
      input: {
        sidePanel: resolve(__dirname, "src/side-panel/index.html"),
        options: resolve(__dirname, "src/options/index.html"),
        serviceWorker: resolve(__dirname, "src/background/serviceWorker.ts")
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === "serviceWorker") return "service-worker.js";
          return "assets/[name]-[hash].js";
        },
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});
