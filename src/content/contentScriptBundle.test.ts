import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("content script build output", () => {
  it("keeps extension content scripts self-contained after build", () => {
    const bundlePaths = [
      resolve(__dirname, "../../dist/content-script.js"),
      resolve(__dirname, "../../dist/cloud-save-complete.js")
    ];
    for (const bundlePath of bundlePaths) {
      if (!existsSync(bundlePath)) continue;
      const bundle = readFileSync(bundlePath, "utf8");
      expect(bundle).not.toMatch(/^import\b|^export\b|import\(|import\{/m);
    }
  });

  it("does not leave a separate content-script CSS asset after build", () => {
    const assetsPath = resolve(__dirname, "../../dist/assets");
    if (!existsSync(assetsPath)) return;
    expect(readdirSync(assetsPath).filter((fileName) => /^linuxdo-friends-.*\.css(?:\.map)?$/.test(fileName))).toEqual([]);
  });
});
