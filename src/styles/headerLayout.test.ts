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

  it("pins tab and secondary action typography instead of inheriting the host page size", () => {
    const tabButtonBlock = cssBlock(".tabs button");
    expect(tabButtonBlock).toContain("font-size: 16px;");
    expect(tabButtonBlock).toContain("font-weight: 600;");
    expect(tabButtonBlock).toContain("line-height: 1.2;");

    const manageButtonBlock = cssBlock(".manage-button");
    expect(manageButtonBlock).toContain("display: inline-grid;");
    expect(manageButtonBlock).toContain("align-content: center;");
    expect(manageButtonBlock).toContain("justify-items: center;");
    expect(manageButtonBlock).toContain("gap: 2px;");
    expect(manageButtonBlock).toContain("font-size: 12px;");
    expect(manageButtonBlock).toContain("font-weight: 400;");
    expect(manageButtonBlock).toContain("line-height: 1.15;");
    expect(cssBlock(".manage-button-line")).toContain("display: block;");

    expect(findsCss).toContain(
      ".finds-rules-button {\n  display: inline-grid;\n  align-content: center;\n  justify-items: center;\n  gap: 2px;\n  font-size: 12px;\n  font-weight: 400;\n  line-height: 1.15;\n  margin-left: auto;\n}"
    );
  });

  it("keeps Lao Finds actions ordered as a unified button row", () => {
    expect(cssBlock(".finds-action-row", findsCss)).toContain("justify-content: flex-start;");
    expect(cssBlock(".finds-action-row", findsCss)).toContain("flex-wrap: wrap;");
    expect(cssBlock(".finds-action-row", findsCss)).toContain("overflow: visible;");
    expect(cssBlock(".finds-action-row", findsCss)).not.toContain("margin-top:");
    expect(cssBlock(".finds-dredge-button", findsCss)).toContain("width: 154px;");
    expect(cssBlock(".finds-dredge-button", findsCss)).toContain("max-width: min(154px, 52%);");
    expect(cssBlock(".finds-dredge-button", findsCss)).toContain("flex: 0 1 154px;");
    const secondaryBlock = cssBlock(".finds-open-panel-button,\n.finds-rules-button", findsCss);
    expect(secondaryBlock).toContain("min-height: 50px;");
    expect(secondaryBlock).toContain("flex: 0 0 auto;");
    expect(secondaryBlock).toContain("padding-inline: 10px;");
    expect(cssBlock(".finds-clear-button", findsCss)).toContain("display: inline-grid;");
    expect(cssBlock(".finds-clear-button", findsCss)).toContain("min-height: 50px;");
    expect(cssBlock(".finds-clear-button", findsCss)).toContain("justify-items: center;");
    expect(cssBlock(".finds-clear-meta", findsCss)).toContain("color: var(--text-muted);");
    expect(findsCss).toContain("margin-left: auto;");
  });

  it("keeps the Lao Finds rule modal content-sized instead of stretching controls", () => {
    const modalBlock = cssBlock(".dredge-rule-modal", findsCss);
    expect(modalBlock).toContain("height: auto;");
    expect(modalBlock).toContain("max-height: min(calc(100dvh - 24px), 640px);");

    const draftBlock = cssBlock(".dredge-rule-draft", findsCss);
    expect(draftBlock).toContain("align-content: start;");

    const choiceBlock = cssBlock(".dredge-choice-row", findsCss);
    expect(choiceBlock).toContain("align-items: center;");

    const actionsBlock = cssBlock(".dredge-rule-row-actions,\n.dredge-rule-draft-actions", findsCss);
    expect(actionsBlock).toContain("align-items: center;");
  });

  it("keeps the Telegram config modal compact and content-sized", () => {
    const modalBlock = cssBlock(".telegram-config-modal");
    expect(modalBlock).toContain("width: min(420px, 100%);");
    expect(modalBlock).toContain("height: auto;");
    expect(modalBlock).toContain("max-height: min(calc(100dvh - 24px), 520px);");

    expect(cssBlock(".telegram-config-modal .modal-head")).toContain("align-items: flex-start;");

    const formBlock = cssBlock(".telegram-config-form");
    expect(formBlock).toContain("align-content: start;");
    expect(formBlock).toContain("flex: 0 1 auto;");

    expect(cssBlock(".telegram-modal-actions")).toContain("align-items: center;");
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
