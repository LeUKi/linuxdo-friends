import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const BROWSERS = ["chrome", "firefox"];

export function getTargetBrowser(input = process.env.TARGET_BROWSER ?? "chrome") {
  if (input !== "chrome" && input !== "firefox") {
    throw new Error(`Invalid TARGET_BROWSER: ${input}. Expected chrome or firefox.`);
  }
  return input;
}

export function getTargetOutDir(browser = getTargetBrowser()) {
  return browser === "firefox" ? "dist-firefox" : "dist-chrome";
}

export function createManifest(browser = getTargetBrowser()) {
  const target = getTargetBrowser(browser);
  const packageJson = readJson("package.json");
  const common = readJson("manifests/common.json");
  const overlay = readJson(`manifests/${target}.json`);
  return deepMerge(common, overlay, { version: packageJson.version });
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(path), "utf8"));
}

function deepMerge(...objects) {
  const result = {};
  for (const object of objects) {
    for (const [key, value] of Object.entries(object)) {
      if (isRecord(value) && isRecord(result[key])) {
        result[key] = deepMerge(result[key], value);
      } else {
        result[key] = value;
      }
    }
  }
  return result;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
