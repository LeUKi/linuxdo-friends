import { readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { getTargetBrowser, getTargetOutDir } from "./scripts/manifest.mjs";

const targetBrowser = getTargetBrowser();
const outDir = getTargetOutDir(targetBrowser);

export default defineConfig({
  publicDir: false,
  plugins: [
    react(),
    {
      name: "drop-content-css-asset",
      enforce: "post",
      generateBundle(_options, bundle) {
        for (const fileName of Object.keys(bundle)) {
          if (fileName.endsWith(".css")) {
            delete bundle[fileName];
          }
        }
      },
      async closeBundle() {
        await removeEmittedContentCssAssets();
      }
    }
  ],
  define: {
    __TARGET_BROWSER__: JSON.stringify(targetBrowser),
    "process.env.NODE_ENV": JSON.stringify("production")
  },
  resolve: {
    alias: [
      {
        find: /^react$/,
        replacement: resolve(__dirname, "node_modules/react/cjs/react.production.js")
      },
      {
        find: /^react\/jsx-runtime$/,
        replacement: resolve(__dirname, "node_modules/react/cjs/react-jsx-runtime.production.js")
      },
      {
        find: /^react-dom\/client$/,
        replacement: resolve(__dirname, "node_modules/react-dom/cjs/react-dom-client.production.js")
      }
    ]
  },
  build: {
    outDir,
    emptyOutDir: false,
    cssCodeSplit: false,
    sourcemap: true,
    lib: {
      entry: resolve(__dirname, "src/content/contentScript.ts"),
      name: "LinuxDoFriendsContentScript",
      formats: ["iife"],
      fileName: () => "content-script.js"
    },
    rollupOptions: {
      output: {
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});

async function removeEmittedContentCssAssets() {
  const assetsDir = resolve(__dirname, outDir, "assets");
  let entries: string[];
  try {
    entries = await readdir(assetsDir);
  } catch (error) {
    if (!isMissingDirectoryError(error)) {
      throw error;
    }
    return;
  }
  await Promise.all(
    entries
      .filter((fileName) => fileName.startsWith("linuxdo-friends-") && (fileName.endsWith(".css") || fileName.endsWith(".css.map")))
      .map((fileName) => rm(join(assetsDir, fileName), { force: true }))
  );
}

function isMissingDirectoryError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
