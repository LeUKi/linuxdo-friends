import { describe, expect, it, vi } from "vitest";
import { createMockStorage } from "../test/mockStorage";
import {
  clearCloudAuth,
  CLOUD_AUTH_STORAGE_KEY,
  configureCloudAuthStorageAccess,
  loadCloudAuth,
  saveCloudAuthFromExchange,
  toPublicCloudBinding,
  updateCloudAuth
} from "./cloudAuthStorage";
import { APP_STATE_STORAGE_KEY } from "./storage";

describe("cloud auth storage", () => {
  it("configures local storage as trusted-context only when Chrome exposes the API", async () => {
    const storage = { ...createMockStorage(), setAccessLevel: vi.fn() };

    await configureCloudAuthStorageAccess(storage);

    expect(storage.setAccessLevel).toHaveBeenCalledWith({ accessLevel: "TRUSTED_CONTEXTS" });
  });

  it("tolerates storage without setAccessLevel", async () => {
    await expect(configureCloudAuthStorageAccess(createMockStorage())).resolves.toBeUndefined();
  });

  it("persists token separately from app state and exposes only public binding", async () => {
    const storage = createMockStorage({ [APP_STATE_STORAGE_KEY]: { friends: {} } });

    const saved = await saveCloudAuthFromExchange(
      {
        app: "linuxdo-friends",
        linuxDoId: "42",
        token: "secret-token",
        tokenKind: "jwt",
        tokenType: "Bearer"
      },
      storage,
      "2026-06-29T00:00:00.000Z"
    );

    expect(saved.token).toBe("secret-token");
    expect(storage.dump()[APP_STATE_STORAGE_KEY]).toEqual({ friends: {} });
    expect(storage.dump()[CLOUD_AUTH_STORAGE_KEY]).toMatchObject({ token: "secret-token", linuxDoId: "42" });
    expect(await loadCloudAuth(storage)).toMatchObject({ token: "secret-token", linuxDoId: "42" });
    expect(toPublicCloudBinding(saved)).toEqual({
      bound: true,
      app: "linuxdo-friends",
      linuxDoId: "42",
      tokenType: "Bearer",
      tokenKind: "jwt",
      boundAt: "2026-06-29T00:00:00.000Z"
    });
    expect(JSON.stringify(toPublicCloudBinding(saved))).not.toContain("secret-token");
  });

  it("updates status metadata without losing the token", async () => {
    const storage = createMockStorage();
    await saveCloudAuthFromExchange(
      { app: "linuxdo-friends", linuxDoId: "42", token: "secret-token", tokenKind: "jwt", tokenType: "Bearer" },
      storage,
      "2026-06-29T00:00:00.000Z"
    );

    const updated = await updateCloudAuth(
      (auth) => ({
        ...auth,
        lastStatus: { state: "remote_config", checkedAt: "2026-06-29T00:01:00.000Z", exportedAt: "2026-06-29T00:00:00.000Z", friendCount: 3 },
        lastBackupAt: "2026-06-29T00:02:00.000Z",
        lastConfigDigest: "digest-1",
        lastConfigSyncedAt: "2026-06-29T00:02:00.000Z",
        lastRequestStatsSyncedAt: "2026-07-02T09:00:00.000Z",
        lastRequestStatsTotal: 12,
        lastRequestStatsAutoSyncError: { state: "network_error", checkedAt: "2026-07-02T08:00:00.000Z", message: "timeout token=<redacted>" }
      }),
      storage
    );

    expect(updated).toMatchObject({
      token: "secret-token",
      lastBackupAt: "2026-06-29T00:02:00.000Z",
      lastConfigDigest: "digest-1",
      lastConfigSyncedAt: "2026-06-29T00:02:00.000Z",
      lastRequestStatsSyncedAt: "2026-07-02T09:00:00.000Z",
      lastRequestStatsTotal: 12,
      lastRequestStatsAutoSyncError: { state: "network_error", message: "timeout token=<redacted>" },
      lastStatus: { state: "remote_config", friendCount: 3 }
    });
    expect(toPublicCloudBinding(updated)).toMatchObject({
      bound: true,
      lastStatus: { state: "remote_config", friendCount: 3 },
      lastBackupAt: "2026-06-29T00:02:00.000Z",
      lastConfigDigest: "digest-1",
      lastConfigSyncedAt: "2026-06-29T00:02:00.000Z",
      lastRequestStatsSyncedAt: "2026-07-02T09:00:00.000Z",
      lastRequestStatsTotal: 12,
      lastRequestStatsAutoSyncError: { state: "network_error", message: "timeout token=<redacted>" }
    });
    expect(JSON.stringify(toPublicCloudBinding(updated))).not.toContain("secret-token");
  });

  it("clears cloud auth without touching app state", async () => {
    const storage = createMockStorage({
      [APP_STATE_STORAGE_KEY]: { friends: { neo: { username: "neo" } } },
      [CLOUD_AUTH_STORAGE_KEY]: {
        app: "linuxdo-friends",
        linuxDoId: "42",
        tokenType: "Bearer",
        tokenKind: "jwt",
        token: "secret-token",
        boundAt: "2026-06-29T00:00:00.000Z"
      }
    });

    await clearCloudAuth(storage);

    expect(storage.dump()).not.toHaveProperty(CLOUD_AUTH_STORAGE_KEY);
    expect(storage.dump()[APP_STATE_STORAGE_KEY]).toEqual({ friends: { neo: { username: "neo" } } });
    await expect(loadCloudAuth(storage)).resolves.toBeNull();
  });
});
