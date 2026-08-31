import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe("content-script session storage adapter", () => {
  it("routes reads and writes through background messages", async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === "sessionStorageGet") return { ok: true, data: { value: 1 } };
      return { ok: true, data: null };
    });
    stubChrome(sendMessage);
    const { getSessionStorageArea, markContentScriptContext } = await import("./sessionStorageAdapter");
    markContentScriptContext();
    const storage = getSessionStorageArea();

    await expect(storage?.get("value")).resolves.toEqual({ value: 1 });
    await storage?.set({ value: 2 });
    await storage?.remove("value");

    expect(sendMessage.mock.calls.map(([message]) => message)).toEqual([
      { type: "sessionStorageGet", keys: "value" },
      { type: "sessionStorageSet", values: { value: 2 } },
      { type: "sessionStorageRemove", keys: "value" }
    ]);
  });

  it("delivers background session change broadcasts to content listeners", async () => {
    let runtimeListener: ((message: unknown) => boolean) | undefined;
    stubChrome(vi.fn(), (listener) => {
      runtimeListener = listener;
    });
    const { addSessionStorageChangeListener, markContentScriptContext } = await import("./sessionStorageAdapter");
    markContentScriptContext();
    const listener = vi.fn();
    addSessionStorageChangeListener(listener);

    runtimeListener?.({ type: "sessionStorageChanged", changes: { key: { oldValue: 1, newValue: 2 } } });

    expect(listener).toHaveBeenCalledWith({ key: { oldValue: 1, newValue: 2 } }, "session");
  });
});

function stubChrome(sendMessage: ReturnType<typeof vi.fn>, onRuntimeListener?: (listener: (message: unknown) => boolean) => void) {
  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage,
      onMessage: {
        addListener: vi.fn((listener) => onRuntimeListener?.(listener)),
        removeListener: vi.fn()
      }
    },
    storage: {
      session: {},
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() }
    }
  });
}
