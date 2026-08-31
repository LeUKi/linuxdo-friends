import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createManifest } from "./manifest.mjs";

const packageVersion = JSON.parse(readFileSync("package.json", "utf8")).version;

describe("generated manifests", () => {
  it("keeps Chrome on MV3 service worker and side_panel", () => {
    const manifest = createManifest("chrome");

    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.version, packageVersion);
    assert.deepEqual(manifest.background, { service_worker: "service-worker.js", type: "module" });
    assert.deepEqual(manifest.side_panel, { default_path: "src/side-panel/index.html" });
    assert.equal(manifest.sidebar_action, undefined);
    assert.ok(manifest.permissions.includes("sidePanel"));
    assert.equal(manifest.browser_specific_settings, undefined);
  });

  it("keeps Firefox on module background scripts and sidebar_action", () => {
    const manifest = createManifest("firefox");

    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.version, packageVersion);
    assert.deepEqual(manifest.background, { scripts: ["service-worker.js"], type: "module" });
    assert.deepEqual(manifest.sidebar_action, { default_panel: "src/side-panel/index.html", default_title: "佬朋友" });
    assert.equal(manifest.side_panel, undefined);
    assert.ok(!manifest.permissions.includes("sidePanel"));
    assert.equal(manifest.browser_specific_settings.gecko.id, "linuxdo-friends@lafish");
    assert.equal(manifest.browser_specific_settings.gecko.strict_min_version, "140.0");
  });

  it("declares the approved Firefox optional data collection categories only", () => {
    const firefox = createManifest("firefox");
    const dataCollection = firefox.browser_specific_settings.gecko.data_collection_permissions;

    assert.deepEqual(dataCollection.required, ["none"]);
    assert.deepEqual(dataCollection.optional, [
      "authenticationInfo",
      "personallyIdentifyingInfo",
      "personalCommunications",
      "websiteContent",
      "technicalAndInteraction"
    ]);
    assert.ok(dataCollection.required.includes("none"));
  });
});
