import { afterEach, describe, expect, it, vi } from "vitest";
import { DATA_CONSENT_PERMISSIONS, hasDataConsent, requestDataConsent } from "./dataConsent";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Firefox data consent", () => {
  it("keeps Chrome behavior unchanged", async () => {
    const request = vi.fn();
    stubExtensionApis({}, request);

    await expect(hasDataConsent("telegram")).resolves.toBe(true);
    await expect(requestDataConsent("cloudSave")).resolves.toBe(true);
    expect(request).not.toHaveBeenCalled();
  });

  it("requests the exact optional permissions for each feature", async () => {
    const request = vi.fn(async () => true);
    stubExtensionApis({ browser_specific_settings: { gecko: { id: "linuxdo-friends@lafish" } } }, request);

    await expect(requestDataConsent("telegram")).resolves.toBe(true);
    await expect(requestDataConsent("cloudSave")).resolves.toBe(true);
    await expect(requestDataConsent("updateCheck")).resolves.toBe(true);

    expect(request.mock.calls).toEqual([
      [{ data_collection: DATA_CONSENT_PERMISSIONS.telegram }],
      [{ data_collection: DATA_CONSENT_PERMISSIONS.cloudSave }],
      [{ data_collection: DATA_CONSENT_PERMISSIONS.updateCheck }]
    ]);
  });

  it("detects revoked Firefox permissions", async () => {
    const getAll = vi.fn(async () => ({ data_collection: ["technicalAndInteraction"] }));
    stubExtensionApis(
      { browser_specific_settings: { gecko: { id: "linuxdo-friends@lafish" } } },
      vi.fn(async () => false),
      getAll
    );

    await expect(hasDataConsent("updateCheck")).resolves.toBe(true);
    await expect(hasDataConsent("telegram")).resolves.toBe(false);
  });
});

function stubExtensionApis(
  manifest: Record<string, unknown>,
  request: ReturnType<typeof vi.fn>,
  getAll = vi.fn(async () => ({ data_collection: [] as string[] }))
) {
  vi.stubGlobal("chrome", {
    runtime: { getManifest: vi.fn(() => manifest) },
    permissions: { request, getAll }
  });
  vi.stubGlobal("browser", { permissions: { request, getAll } });
}
