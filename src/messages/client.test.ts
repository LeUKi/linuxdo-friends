import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendCommand } from "./client";

describe("sendCommand", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a failed response when the extension runtime rejects", async () => {
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => {
          throw new Error("Receiving end does not exist.");
        })
      }
    });

    await expect(sendCommand({ type: "getState" })).resolves.toEqual({
      ok: false,
      error: "Receiving end does not exist."
    });
  });
});
