import { readFileSync } from "node:fs";
import { join } from "node:path";

const headerCss = readFileSync(join(process.cwd(), "src/styles/parts/03-options-settings.css"), "utf8");
const findsCss = readFileSync(join(process.cwd(), "src/styles/parts/06-lao-finds-dredge.css"), "utf8");

describe("header layout styles", () => {
  it("keeps request statistics content-sized and highlights today's count", () => {
    const chipBlock = cssBlock(".request-stats-chip");
    expect(chipBlock).toContain("width: max-content;");
    expect(chipBlock).toContain("max-width: none;");
    expect(chipBlock).toContain("flex: 0 0 auto;");
    expect(chipBlock).toContain("overflow: visible;");

    expect(cssBlock(".request-stats-today")).toContain("color: var(--accent-text);");
    expect(cssBlock(".request-stats-total")).toContain("color: var(--text-muted);");
  });

  it("keeps cloud archive success border bright and idle dredging muted", () => {
    expect(cssBlock(".cloud-archive-same")).toContain("border-color: var(--accent-border);");

    const idleBlock = cssBlock(".timed-refresh-idle .timed-refresh-icon,\n.timed-refresh-idle .timed-refresh-copy");
    expect(idleBlock).toContain("color: var(--text-muted);");
  });

  it("keeps the version update capsule on one line until the parent must wrap", () => {
    const badgeBlock = cssBlock(".version-badge");
    expect(badgeBlock).toContain("max-width: 100%;");
    expect(badgeBlock).toContain("flex: 0 1 auto;");
    expect(badgeBlock).toContain("flex-wrap: wrap;");
    expect(badgeBlock).toContain("justify-content: flex-start;");
    expect(badgeBlock).toContain("overflow: visible;");

    const updateLinkBlock = cssBlock(".version-update-link");
    expect(updateLinkBlock).toContain("max-width: 100%;");
    expect(updateLinkBlock).toContain("flex: 0 0 auto;");
    expect(updateLinkBlock).toContain("overflow: visible;");
    expect(updateLinkBlock).toContain("white-space: nowrap;");
    expect(updateLinkBlock).not.toContain("max-width: 76px;");
    expect(updateLinkBlock).not.toContain("flex-wrap: wrap;");
  });

  it("keeps Lao Finds actions ordered as button, count, then right-aligned settings", () => {
    expect(cssBlock(".finds-action-row", findsCss)).toContain("justify-content: flex-start;");
    expect(cssBlock(".finds-dredge-button", findsCss)).toContain("flex: 0 1 154px;");
    expect(cssBlock(".finds-count", findsCss)).toContain("flex: 0 0 auto;");
    expect(cssBlock(".finds-rules-button", findsCss)).toContain("margin-left: auto;");
  });

  it("keeps the timed dredging dropdown enable item as a two-line option and settings icon-free", () => {
    expect(cssBlock(".refresh-menu-option-with-note")).toContain("min-height: 64px;");
    expect(cssBlock(".refresh-menu-option-with-note")).toContain("grid-template-columns: minmax(0, 1fr) 20px;");
    expect(cssBlock(".refresh-menu-option-no-icon")).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(cssBlock(".refresh-menu-option > span.refresh-menu-label")).toContain("display: flex;");
    expect(cssBlock(".refresh-menu-option > span.refresh-menu-label")).toContain("flex-direction: column;");
    expect(cssBlock(".refresh-menu-label-note")).toContain("font-size: 11px;");
    expect(cssBlock(".refresh-menu-label-main")).toContain("display: block;");
    expect(cssBlock(".refresh-menu-label-note")).toContain("display: block;");
    expect(cssBlock(".refresh-menu-label-note")).toContain("white-space: normal;");
  });
});

function cssBlock(selector: string, css = headerCss) {
  const match = new RegExp(`(?:^|\\n)${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`).exec(css);
  expect(match).toBeTruthy();
  return match?.[1] ?? "";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
