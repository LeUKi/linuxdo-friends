import { resolve } from "node:path";
import { defineConfig } from "vite";
import { getTargetBrowser, getTargetOutDir } from "./scripts/manifest.mjs";

const targetBrowser = getTargetBrowser();
const outDir = getTargetOutDir(targetBrowser);

export default defineConfig({
  publicDir: false,
  define: {
    __TARGET_BROWSER__: JSON.stringify(targetBrowser),
    "process.env.NODE_ENV": JSON.stringify("production")
  },
  build: {
    outDir,
    emptyOutDir: false,
    sourcemap: true,
    lib: {
      entry: resolve(__dirname, "src/content/cloudSaveComplete.ts"),
      name: "LinuxDoFriendsCloudSaveComplete",
      formats: ["iife"],
      fileName: () => "cloud-save-complete.js"
    },
    rollupOptions: {
      output: {
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});
