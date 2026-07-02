import { describe, expect, it } from "vitest";
import { createMockStorage } from "../test/mockStorage";
import {
  TIMED_ACTIVITY_CONTROLLER_STORAGE_KEY,
  TIMED_ACTIVITY_SESSION_STORAGE_KEY,
  claimTimedActivityRefreshController,
  invalidateTimedActivityNoTargetSessionState,
  loadTimedActivityRefreshSessionState,
  normalizeTimedActivityRefreshSession,
  patchTimedActivityRefreshSessionState,
  registerTimedActivityRefreshSurface,
  unregisterTimedActivityRefreshSurface
} from "./timedActivityRefreshSessionStorage";

describe("timed activity refresh session storage", () => {
  it("starts as scheduler-only empty session", async () => {
    await expect(loadTimedActivityRefreshSessionState(null, Date.parse("2026-06-30T00:00:00.000Z"))).resolves.toMatchObject({
      visibleSurfaces: {},
      updatedAt: "2026-06-30T00:00:00.000Z"
    });
  });

  it("normalizes only side-panel visible surfaces", () => {
    const session = normalizeTimedActivityRefreshSession(
      {
        visibleSurfaces: {
          side: { surface: "side-panel", heartbeatAt: "2026-06-30T00:00:00.000Z" },
          page: { surface: "in-page", heartbeatAt: "2026-06-30T00:00:00.000Z" }
        }
      },
      Date.parse("2026-06-30T00:00:10.000Z")
    );

    expect(session.visibleSurfaces).toEqual({
      side: { surface: "side-panel", heartbeatAt: "2026-06-30T00:00:00.000Z" }
    });
  });

  it("registers, claims, and unregisters the elected side-panel controller", async () => {
    const storage = createMockStorage();
    const now = Date.parse("2026-06-30T00:00:00.000Z");
    await registerTimedActivityRefreshSurface("b", "side-panel", storage, now);
    await registerTimedActivityRefreshSurface("a", "side-panel", storage, now + 1000);

    const rejected = await claimTimedActivityRefreshController("b", storage, now + 2000);
    expect(rejected.controllerSurfaceId).toBeUndefined();

    const claimed = await claimTimedActivityRefreshController("a", storage, now + 3000);
    expect(claimed.controllerSurfaceId).toBe("a");
    expect(storage.dump()).toHaveProperty(TIMED_ACTIVITY_CONTROLLER_STORAGE_KEY);

    const afterRemove = await unregisterTimedActivityRefreshSurface("a", storage, now + 4000);
    expect(afterRemove.controllerSurfaceId).toBeUndefined();
  });

  it("does not claim while paused", async () => {
    const storage = createMockStorage();
    const now = Date.parse("2026-06-30T00:00:00.000Z");
    await registerTimedActivityRefreshSurface("side", "side-panel", storage, now);
    await patchTimedActivityRefreshSessionState({ pausedReason: "challenge", pausedMessage: "验证中" }, storage, now + 1000);

    const session = await claimTimedActivityRefreshController("side", storage, now + 2000);
    expect(session.controllerSurfaceId).toBeUndefined();
  });

  it("invalidates only stale no-target state", async () => {
    const storage = createMockStorage({
      [TIMED_ACTIVITY_SESSION_STORAGE_KEY]: {
        enabledAt: "2026-06-30T00:00:00.000Z",
        nextDueAt: "2026-06-30T02:00:00.000Z",
        noTargetAt: "2026-06-30T00:00:00.000Z",
        noTargetMessage: "没有启用规则",
        pausedReason: "challenge",
        pausedMessage: "验证中",
        pendingDue: true,
        updatedAt: "2026-06-30T00:00:00.000Z"
      }
    });

    await invalidateTimedActivityNoTargetSessionState(storage, Date.parse("2026-06-30T00:01:00.000Z"));

    const session = storage.dump()[TIMED_ACTIVITY_SESSION_STORAGE_KEY] as Record<string, unknown>;
    expect(session).toMatchObject({
      enabledAt: "2026-06-30T00:00:00.000Z",
      nextDueAt: "2026-06-30T02:00:00.000Z",
      pausedReason: "challenge",
      pausedMessage: "验证中",
      pendingDue: true,
      updatedAt: "2026-06-30T00:01:00.000Z"
    });
    expect(session).not.toHaveProperty("noTargetAt");
    expect(session).not.toHaveProperty("noTargetMessage");
  });

  it("drops stale controller leases", async () => {
    const storage = createMockStorage({
      [TIMED_ACTIVITY_SESSION_STORAGE_KEY]: { updatedAt: "2026-06-30T00:00:00.000Z" },
      [`linuxdoFriendsTimedActivityRefreshSession.surface.side`]: {
        surface: "side-panel",
        heartbeatAt: "2026-06-30T00:00:00.000Z"
      },
      [TIMED_ACTIVITY_CONTROLLER_STORAGE_KEY]: {
        surfaceId: "side",
        claimedAt: "2026-06-30T00:00:00.000Z",
        heartbeatAt: "2026-06-30T00:00:00.000Z"
      }
    });

    const session = await loadTimedActivityRefreshSessionState(storage, Date.parse("2026-06-30T00:01:00.000Z"));
    expect(session.visibleSurfaces).toEqual({});
    expect(session.controllerSurfaceId).toBeUndefined();
  });
});
