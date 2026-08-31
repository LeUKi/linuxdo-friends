import { readFileSync } from "node:fs";
import { createManifest } from "./manifest.mjs";

const tag = parseTag(process.argv.find((arg) => arg.startsWith("--tag="))?.slice("--tag=".length) ?? process.env.GITHUB_REF_NAME);
const packageJson = readJson("package.json");
const lockJson = readJson("package-lock.json");

assertVersion("package-lock.json", lockJson.version, packageJson.version);
assertVersion("package-lock.json packages[\"\"]", lockJson.packages?.[""]?.version, packageJson.version);
assertVersion("Chrome generated manifest", createManifest("chrome").version, packageJson.version);
assertVersion("Firefox generated manifest", createManifest("firefox").version, packageJson.version);

if (tag) {
  assertVersion("tag", tag.replace(/^v/, ""), packageJson.version);
}

console.log(`Version check passed for ${packageJson.version}`);

function parseTag(rawTag) {
  if (!rawTag) return undefined;
  if (!/^v[0-9]+\.[0-9]+\.[0-9]+$/.test(rawTag)) {
    throw new Error(`Tag must match v1.0.0 style: ${rawTag}`);
  }
  return rawTag;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function assertVersion(label, actual, expected) {
  if (actual !== expected) {
    throw new Error(`${label} version ${actual ?? "<missing>"} does not match package.json ${expected}`);
  }
}
