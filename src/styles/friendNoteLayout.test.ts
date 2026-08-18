import { readFileSync } from "node:fs";
import { join } from "node:path";

const listCss = readFileSync(join(process.cwd(), "src/styles/parts/04-list-feed.css"), "utf8");
const modalCss = readFileSync(join(process.cwd(), "src/styles/parts/05-modal-management.css"), "utf8");

describe("friend note layout styles", () => {
  it("keeps note previews content-sized, single-line, and shrinkable", () => {
    const preview = cssBlock(".friend-note-preview", listCss);
    expect(preview).toContain("width: fit-content;");
    expect(preview).toContain("min-width: 0;");
    expect(preview).toContain("max-width: 100%;");
    expect(preview).toContain("overflow: hidden;");
    expect(preview).toContain("text-overflow: ellipsis;");
    expect(preview).toContain("white-space: nowrap;");
    expect(preview).toContain("color: var(--text-muted);");

    expect(cssBlock(".friend-note-preview-side-panel,\n.friend-note-preview-user-card", listCss)).toContain("max-width: min(240px, 100%);");
    expect(cssBlock(".friend-note-preview-settings", listCss)).toContain("max-width: min(280px, 100%);");
    expect(cssBlock(".friend-note-preview-profile", listCss)).toContain("max-width: min(420px, 100%);");

    const post = cssBlock(".friend-note-preview-post", listCss);
    expect(post).toContain("max-width: min(160px, 40vw);");
    expect(post).toContain("display: inline-block;");
  });

  it("uses theme color only for notes injected into linux.do pages", () => {
    const pageNotes = cssBlock(
      ".friend-note-preview-profile,\n.friend-note-preview-post,\n.friend-note-preview-user-card",
      listCss
    );
    expect(pageNotes).toContain("color: var(--accent-strong);");

    const placeholder = cssBlock(
      ".friend-note-inline-row-profile .friend-note-placeholder,\n.friend-note-inline-row-user-card .friend-note-placeholder",
      listCss
    );
    expect(placeholder).toContain("color: color-mix(in srgb, var(--accent-strong) 64%, var(--text-subtle));");

    const controls = cssBlock(":is(.friend-note-placeholder, .friend-note-edit-button)", listCss);
    expect(controls).toContain("color: var(--text-subtle);");
    const tooltip = cssBlock(".friend-note-tooltip", modalCss);
    expect(tooltip).toContain("color: var(--text-strong);");
  });

  it("keeps topic post notes inline without changing floor-header height", () => {
    const root = cssBlock(".linuxdo-friends-post-note-root", listCss);
    expect(root).toContain("display: inline-flex;");
    expect(root).toContain("min-width: 0;");
    expect(root).toContain("max-width: min(160px, 40vw);");
    expect(root).toContain("margin-inline-start: 0.45em;");
    expect(root).toContain("vertical-align: baseline;");
  });

  it("keeps the inline note row shrinkable with a fixed pencil control", () => {
    const row = cssBlock(".friend-note-inline-row", listCss);
    expect(row).toContain("display: flex;");
    expect(row).toContain("min-width: 0;");
    expect(row).toContain("max-width: 100%;");

    const editButton = cssBlock(".friend-note-edit-button", listCss);
    expect(editButton).toContain("flex: 0 0 24px;");
    expect(editButton).toContain("width: 24px;");
    expect(editButton).toContain("height: 24px;");

    const placeholder = cssBlock(".friend-note-placeholder", listCss);
    expect(placeholder).toContain("overflow: hidden;");
    expect(placeholder).toContain("text-overflow: ellipsis;");
    expect(placeholder).toContain("white-space: nowrap;");
  });

  it("keeps the full-note tooltip above page overflow and inside the viewport", () => {
    const tooltip = cssBlock(".friend-note-tooltip", modalCss);
    expect(tooltip).toContain("position: fixed;");
    expect(tooltip).toContain("max-width: min(320px, calc(100vw - 24px));");
    expect(tooltip).toContain("overflow-wrap: anywhere;");
    expect(tooltip).toContain("white-space: normal;");
  });

  it("keeps friend rows shrinkable so notes cannot move their actions", () => {
    expect(cssBlock(".friend-split-card", listCss)).toContain("grid-template-columns: minmax(0, 1fr) 44px;");
    expect(cssBlock(".friend-main-button", listCss)).toContain("min-width: 0;");
    expect(cssBlock(".candidate-row", modalCss)).toContain("grid-template-columns: minmax(0, 1fr) minmax(0, auto);");
    expect(cssBlock(".candidate-identity", modalCss)).toContain("min-width: 0;");
  });
});

function cssBlock(selector: string, css: string) {
  const match = new RegExp(`(?:^|\\n)${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`).exec(css);
  expect(match).toBeTruthy();
  return match?.[1] ?? "";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
