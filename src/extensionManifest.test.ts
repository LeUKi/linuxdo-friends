import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(resolve(__dirname, "../public/manifest.json"), "utf8"));
const appCss = readFileSync(resolve(__dirname, "styles/app.css"), "utf8");

describe("extension manifest safety", () => {
  it("declares the MV3 extension surfaces inside the linux.do boundary", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.action.default_title).toBe("佬朋友");
    expect(manifest.action.default_popup).toBeUndefined();
    expect(manifest.side_panel.default_path).toBe("src/side-panel/index.html");
    expect(manifest.options_page).toBe("src/options/index.html");
    expect(manifest.background).toMatchObject({ service_worker: "service-worker.js", type: "module" });
    expect(manifest.content_scripts).toEqual([
      {
        matches: ["https://linux.do/*"],
        js: ["content-script.js"],
        run_at: "document_idle"
      },
      {
        matches: ["https://linuxdo-cloud-save.lafish.workers.dev/auth/complete/browser_code*"],
        js: ["cloud-save-complete.js"],
        run_at: "document_idle"
      }
    ]);
    expect(manifest.host_permissions).toEqual([
      "https://api.telegram.org/*",
      "https://api.github.com/*",
      "https://github-api.lafish.workers.dev/*",
      "https://linuxdo-cloud-save.lafish.workers.dev/*",
      "https://linux.do/*"
    ]);
  });

  it("only adds alarms for best-effort scheduled stats sync, without cookie, proxy, or external messaging surfaces", () => {
    expect(manifest.permissions).toEqual(["storage", "tabs", "sidePanel", "alarms"]);
    expect(manifest.permissions).not.toContain("cookies");
    expect(manifest.permissions).not.toContain("identity");
    expect(manifest.permissions).not.toContain("proxy");
    expect(manifest.permissions).not.toContain("webRequest");
    expect(manifest.permissions).not.toContain("declarativeNetRequest");
    expect(manifest.externally_connectable).toBeUndefined();
  });

  it("keeps theme mode automatic without a persisted extension setting", () => {
    expect(appCss).toContain("color-scheme: light");
    expect(appCss).toContain("@media (prefers-color-scheme: dark)");
    expect(appCss).toContain('.linuxdo-friends-menu-root[data-linuxdo-friends-theme="light"]');
    expect(appCss).toContain('.linuxdo-friends-menu-root[data-linuxdo-friends-theme="dark"]');
    expect(appCss).not.toContain("themeMode");
  });

  it("keeps the header dredging capsule constrained for narrow side panels", () => {
    expect(appCss).toContain(".header-status {\n  display: grid;\n  justify-items: end;\n  gap: 5px;\n  min-width: 0;");
    expect(appCss).toContain(".header-account-row {\n  display: flex;\n  max-width: 100%;\n  min-width: 0;");
    expect(appCss).toContain(".header-operation-row {\n  display: flex;\n  max-width: 100%;\n  min-width: 0;");
    expect(appCss).toContain("align-items: center;");
    expect(appCss).toContain(".timed-refresh-control {\n  position: relative;\n  display: inline-block;");
    expect(appCss).toContain("width: 104px;");
    expect(appCss).toContain("max-width: 100%;");
    expect(appCss).toContain(".timed-refresh-waiting {\n  width: 190px;");
    expect(appCss).toContain(".timed-refresh-running {\n  width: 180px;");
    expect(appCss).toContain(".timed-refresh-main {\n  min-width: 0;\n  display: grid;");
    expect(appCss).toContain("grid-template-columns: 28px minmax(0, 1fr) 22px;");
    expect(appCss).toContain(".refresh-menu.timed-refresh-menu {\n  right: 0;\n  left: auto;");
    expect(appCss).toContain("width: min(190px, calc(100vw - 32px));");
    expect(appCss).toContain("max-width: calc(100vw - 32px);");
    expect(appCss).toContain(".refresh-menu-option {\n  display: grid;");
    expect(appCss).toContain("grid-template-columns: minmax(0, 1fr) 20px;");
    expect(appCss).toContain(".refresh-menu-option.is-selected {\n  background: var(--accent-soft);");
    expect(appCss).toContain(".refresh-menu-check {\n  display: inline-flex;");
    expect(appCss).toContain("justify-self: end;");
    expect(appCss).toContain(".refresh-menu-option.is-selected .refresh-menu-check {\n  background: var(--surface);");
    expect(appCss).toContain(".refresh-menu-group {\n  display: grid;\n  gap: 0;\n  margin-top: 8px;\n  border-top: 1px solid var(--border);");
    expect(appCss).toContain(".feed-refresh-button {\n  max-width: min(154px, 100%);");
    expect(appCss).not.toContain(".refresh-menu-feed");
    expect(appCss).toContain(".account-badge > span {\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;");
    expect(appCss).not.toContain(".timed-refresh-copy strong");
    expect(appCss).not.toContain(".timed-refresh-copy span");
  });

  it("keeps feed filters roomy without reintroducing the old bottom padding", () => {
    expect(appCss).toContain(".tab-bottom-spacer {\n  height: 200px;");
    expect(appCss).not.toContain(".tab-bottom-spacer {\n  height: 300px;");
    expect(appCss).toContain("max-height: var(--filter-menu-max-height, 230px);");
    expect(appCss).toContain("overscroll-behavior: contain;");
    expect(appCss).toContain(".filter-popover-kind .filter-popover-menu {\n  --filter-menu-width: 200px;\n  --filter-menu-max-height: min(320px, calc(100dvh - 160px), calc(100vh - 160px));");
    expect(appCss).toContain(".filter-popover-user .filter-popover-menu {\n  --filter-menu-width: 220px;\n  --filter-menu-max-height: min(460px, calc(100dvh - 160px), calc(100vh - 160px));");
  });
});
