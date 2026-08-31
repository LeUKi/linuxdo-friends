import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const args = parseArgs(process.argv.slice(2));
const manifest = readZipJson(args.zip, "manifest.json");
const version = args.tag.replace(/^v/, "");

assertEqual("manifest version", manifest.version, version);

if (args.browser === "chrome") {
  assertEqual("Chrome background service worker", manifest.background?.service_worker, "service-worker.js");
  assertEqual("Chrome side panel", manifest.side_panel?.default_path, "src/side-panel/index.html");
  assertIncludes("Chrome sidePanel permission", manifest.permissions, "sidePanel");
  assertAbsent("Chrome sidebar_action", manifest.sidebar_action);
} else {
  assertEqual("Firefox background script", manifest.background?.scripts?.[0], "service-worker.js");
  assertEqual("Firefox background type", manifest.background?.type, "module");
  assertEqual("Firefox sidebar", manifest.sidebar_action?.default_panel, "src/side-panel/index.html");
  assertEqual("Firefox gecko id", manifest.browser_specific_settings?.gecko?.id, "linuxdo-friends@lafish");
  assertEqual("Firefox min version", manifest.browser_specific_settings?.gecko?.strict_min_version, "140.0");
  assertArrayEqual("Firefox required data collection", manifest.browser_specific_settings?.gecko?.data_collection_permissions?.required, ["none"]);
  assertArrayEqual("Firefox optional data collection", manifest.browser_specific_settings?.gecko?.data_collection_permissions?.optional, [
    "authenticationInfo",
    "personallyIdentifyingInfo",
    "personalCommunications",
    "websiteContent",
    "technicalAndInteraction"
  ]);
  assertAbsent("Firefox side_panel", manifest.side_panel);
  assertNotIncludes("Firefox sidePanel permission", manifest.permissions, "sidePanel");
}

for (const fileName of ["service-worker.js", "content-script.js", "cloud-save-complete.js"]) {
  if (!zipContains(args.zip, fileName)) {
    throw new Error(`${args.zip} is missing ${fileName}`);
  }
}

assertSelfContained(readZipText(args.zip, "content-script.js"), `${args.zip}:content-script.js`);

console.log(`${args.browser} package verification passed: ${args.zip}`);

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    values.set(argv[index], argv[index + 1]);
  }
  const browser = values.get("--browser");
  const zip = values.get("--zip");
  const tag = values.get("--tag");
  if (browser !== "chrome" && browser !== "firefox") throw new Error("--browser must be chrome or firefox");
  if (!zip || !existsSync(zip)) throw new Error(`Package not found: ${zip ?? "<missing>"}`);
  if (!tag || !/^v[0-9]+\.[0-9]+\.[0-9]+$/.test(tag)) throw new Error(`--tag must match v1.0.0 style: ${tag ?? "<missing>"}`);
  return { browser, zip, tag };
}

function readZipJson(zipPath, fileName) {
  return JSON.parse(readZipText(zipPath, fileName));
}

function readZipText(zipPath, fileName) {
  const result = spawnSync("unzip", ["-p", zipPath, fileName], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`Failed to read ${fileName} from ${zipPath}: ${result.stderr}`);
  }
  return result.stdout;
}

function zipContains(zipPath, fileName) {
  const result = spawnSync("unzip", ["-Z1", zipPath], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`Failed to list ${zipPath}: ${result.stderr}`);
  }
  return result.stdout.split(/\r?\n/).includes(fileName);
}

function assertSelfContained(source, label) {
  for (const line of source.split(/\r?\n/)) {
    if (/^\s*(import|export)\s/.test(line)) {
      throw new Error(`${label} contains top-level import/export: ${line.trim()}`);
    }
  }
}

function assertEqual(label, actual, expected) {
  if (actual !== expected) {
    throw new Error(`${label} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertArrayEqual(label, actual, expected) {
  if (!Array.isArray(actual) || actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Error(`${label} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertIncludes(label, actual, expected) {
  if (!Array.isArray(actual) || !actual.includes(expected)) {
    throw new Error(`${label} expected to include ${expected}`);
  }
}

function assertNotIncludes(label, actual, expected) {
  if (Array.isArray(actual) && actual.includes(expected)) {
    throw new Error(`${label} expected not to include ${expected}`);
  }
}

function assertAbsent(label, actual) {
  if (actual !== undefined) {
    throw new Error(`${label} expected to be absent`);
  }
}
