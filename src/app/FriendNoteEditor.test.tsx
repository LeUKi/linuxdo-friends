import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FriendNoteDialog, FriendNoteEditButton, FriendNotePreview, friendNoteTooltipPosition } from "./FriendNoteEditor";

describe("friend note preview", () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("clamps a tooltip inside the viewport and flips below near the top", () => {
    expect(
      friendNoteTooltipPosition(
        { left: 2, right: 82, top: 4, bottom: 24 },
        { width: 200, height: 60 },
        { width: 240, height: 180 }
      )
    ).toEqual({ left: 12, top: 32, placement: "bottom" });

    expect(
      friendNoteTooltipPosition(
        { left: 180, right: 220, top: 140, bottom: 160 },
        { width: 120, height: 40 },
        { width: 240, height: 180 }
      )
    ).toEqual({ left: 108, top: 92, placement: "top" });
  });

  it("shows the full note only when the preview actually overflows", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("friend-note-preview") ? 100 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("friend-note-preview") ? 220 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(180);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(48);
    const tooltipPortalTarget = document.createElement("div");
    document.body.append(tooltipPortalTarget);
    const { host, root } = await render(
      <FriendNotePreview
        note="一段会被组件宽度截断的好友备注全文"
        surface="settings"
        tooltipPortalTarget={tooltipPortalTarget}
      />
    );
    const preview = host.querySelector<HTMLElement>(".friend-note-preview");

    await act(async () => preview?.focus());

    expect(tooltipPortalTarget.querySelector("[role='tooltip']")?.textContent).toBe("一段会被组件宽度截断的好友备注全文");
    expect(document.body.querySelector("[role='tooltip']")?.textContent).toBe("一段会被组件宽度截断的好友备注全文");
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.body.querySelector("[role='tooltip']")).toBeNull();

    await act(async () => preview?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(document.body.querySelector("[role='tooltip']")?.textContent).toBe("一段会被组件宽度截断的好友备注全文");
    const retargetedPointerDown = new Event("pointerdown", { bubbles: true });
    Object.defineProperty(retargetedPointerDown, "composedPath", { value: () => [preview, host, document.body, document] });
    await act(async () => document.dispatchEvent(retargetedPointerDown));
    expect(document.body.querySelector("[role='tooltip']")?.textContent).toBe("一段会被组件宽度截断的好友备注全文");
    const outside = document.createElement("button");
    document.body.append(outside);
    await act(async () => outside.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(document.body.querySelector("[role='tooltip']")).toBeNull();
    await act(async () => root.unmount());
  });

  it("does not make a short note focusable or render a tooltip", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(120);
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(80);
    const { host, root } = await render(<FriendNotePreview note="NAS" surface="side-panel" />);
    const preview = host.querySelector<HTMLElement>(".friend-note-preview");

    expect(preview?.getAttribute("tabindex")).toBeNull();
    await act(async () => preview?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    expect(document.body.querySelector("[role='tooltip']")).toBeNull();
    await act(async () => root.unmount());
  });
});

describe("friend note edit button", () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("shows any existing note on hover and focus, then hides it before editing", async () => {
    const onClick = vi.fn();
    const tooltipPortalTarget = document.createElement("div");
    document.body.append(tooltipPortalTarget);
    const { host, root } = await render(
      <FriendNoteEditButton
        ariaLabel="编辑好友备注"
        className="friend-note-edit-button"
        disabled={false}
        note="NAS"
        onClick={onClick}
        showNoteTooltip
        title="编辑好友备注"
        tooltipPortalTarget={tooltipPortalTarget}
        username="neo"
      />
    );
    const button = host.querySelector<HTMLButtonElement>(".friend-note-edit-button");

    expect(button?.classList.contains("has-note")).toBe(true);
    expect(button?.getAttribute("aria-label")).toBe("编辑好友备注");
    expect(button?.getAttribute("title")).toBeNull();
    await act(async () => button?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    expect(tooltipPortalTarget.querySelector("[role='tooltip']")?.textContent).toBe("NAS");

    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.body.querySelector("[role='tooltip']")).toBeNull();

    await act(async () => button?.focus());
    expect(document.body.querySelector("[role='tooltip']")?.textContent).toBe("NAS");

    await act(async () => button?.blur());
    expect(document.body.querySelector("[role='tooltip']")).toBeNull();

    await act(async () => button?.focus());
    expect(document.body.querySelector("[role='tooltip']")?.textContent).toBe("NAS");

    await act(async () => button?.click());
    expect(onClick).toHaveBeenCalledOnce();
    expect(onClick.mock.calls[0]?.[0].type).toBe("click");
    expect(document.body.querySelector("[role='tooltip']")).toBeNull();
    await act(async () => root.unmount());
  });

  it("keeps an empty note subdued without rendering an empty tooltip", async () => {
    const onClick = vi.fn();
    const { host, root } = await render(
      <FriendNoteEditButton disabled={false} note="" onClick={onClick} showNoteTooltip title="编辑好友备注" username="neo" />
    );
    const button = host.querySelector<HTMLButtonElement>(".candidate-note-edit");

    expect(button?.classList.contains("is-empty")).toBe(true);
    expect(button?.getAttribute("title")).toBe("编辑好友备注");
    await act(async () => button?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    await act(async () => button?.focus());
    expect(document.body.querySelector("[role='tooltip']")).toBeNull();

    await act(async () => button?.click());
    expect(onClick).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
  });
});

describe("friend note dialog", () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("normalizes and saves a note with Enter", async () => {
    const onSave = vi.fn(async () => ({ ok: true }));
    const onClose = vi.fn();
    const { host, root } = await render(
      <FriendNoteDialog initialNote="NAS" username="neo" onClose={onClose} onSave={onSave} />
    );
    const input = host.querySelector<HTMLInputElement>(".friend-note-field input");

    await act(async () => {
      setInputValue(input!, "  NAS lab  ");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));

    expect(onSave).toHaveBeenCalledWith("NAS lab");
    expect(onClose).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
  });

  it("keeps an over-limit legacy note until the user shortens it", async () => {
    const onSave = vi.fn(async () => ({ ok: true }));
    const { host, root } = await render(
      <FriendNoteDialog initialNote={"中".repeat(81)} username="neo" onClose={() => undefined} onSave={onSave} />
    );

    expect(host.querySelector(".friend-note-field-meta")?.textContent).toContain("81/80");
    expect(buttonByText(host, "保存").disabled).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("keeps the draft visible when saving fails", async () => {
    const { host, root } = await render(
      <FriendNoteDialog
        initialNote="NAS"
        username="neo"
        onClose={() => undefined}
        onSave={async () => ({ ok: false, error: "保存失败" })}
      />
    );

    await act(async () => buttonByText(host, "保存").click());

    expect(host.querySelector("[role='alert']")?.textContent).toBe("保存失败");
    expect(host.querySelector<HTMLInputElement>(".friend-note-field input")?.value).toBe("NAS");
    await act(async () => root.unmount());
  });

  it("cancels from the button, backdrop, and Escape", async () => {
    const onClose = vi.fn();
    const { host, root } = await render(
      <FriendNoteDialog initialNote="NAS" username="neo" onClose={onClose} onSave={async () => ({ ok: true })} />
    );

    await act(async () => buttonByText(host, "取消").click());
    await act(async () => host.querySelector<HTMLElement>(".friend-note-backdrop")?.click());
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));

    expect(onClose).toHaveBeenCalledTimes(3);
    await act(async () => root.unmount());
  });
});

async function render(element: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(element));
  return { host, root };
}

function setInputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
}

function buttonByText(container: HTMLElement, text: string) {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent === text);
  if (!button) throw new Error(`Button not found: ${text}`);
  return button;
}
