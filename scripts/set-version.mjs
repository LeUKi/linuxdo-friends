import { readFileSync, writeFileSync } from "node:fs";

const version = normalizeVersion(process.argv[2]);

updateJson("package.json", (json) => {
  json.version = version;
});

updateJson("package-lock.json", (json) => {
  json.version = version;
  if (json.packages?.[""]) {
    json.packages[""].version = version;
  }
});

console.log(`Version set to ${version}`);

function normalizeVersion(input) {
  if (!input) {
    console.error("Usage: npm run set-version -- 1.0.0");
    process.exit(1);
  }
  const version = input.trim().replace(/^v/, "");
  if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version)) {
    console.error(`Invalid version: ${input}. Expected 1.0.0 or v1.0.0.`);
    process.exit(1);
  }
  return version;
}

function updateJson(path, update) {
  const json = JSON.parse(readFileSync(path, "utf8"));
  update(json);
  writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
}
