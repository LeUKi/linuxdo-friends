import { describe, expect, it } from "vitest";
import { createMockStorage } from "../test/mockStorage";
import {
  isStaleRunningSiteDataProgress,
  loadSiteDataProgressState,
  resetSiteDataProgressFallbackStorage,
  saveSiteDataProgressState,
  SITE_DATA_PROGRESS_STORAGE_KEY,
  siteDataProgressFromStorageChanges
} from "./siteDataProgressStorage";

describe("site data progress session storage", () => {
  it("saves and loads refresh progress from session storage", async () => {
    const storage = createMockStorage({});
    const progress = {
      taskId: "profiles-1",
      taskType: "profiles" as const,
      usernames: ["neo"],
      status: "running" as const,
      completed: 0,
      total: 1,
      currentLabel: "@neo",
      startedAt: "2026-06-28T00:00:00.000Z",
      updatedAt: "2026-06-28T00:00:00.000Z"
    };

    await saveSiteDataProgressState(progress, storage);

    await expect(loadSiteDataProgressState(storage, Date.parse("2026-06-28T00:00:02.000Z"))).resolves.toMatchObject({
      taskType: "profiles",
      currentLabel: "@neo"
    });
  });

  it("ignores stale running progress when loading from session storage", async () => {
    const storage = createMockStorage({
      [SITE_DATA_PROGRESS_STORAGE_KEY]: {
        taskId: "activity-stale",
        taskType: "activity",
        scope: { kind: "all" },
        status: "running",
        completed: 1,
        total: 4,
        startedAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z"
      }
    });

    await expect(loadSiteDataProgressState(storage, Date.parse("2026-06-28T00:11:00.000Z"))).resolves.toBeNull();
  });

  it("classifies stale running progress with the shared TTL helper", () => {
    expect(
      isStaleRunningSiteDataProgress(
        {
          taskId: "activity-stale",
          taskType: "activity",
          scope: { kind: "all" },
          status: "running",
          completed: 1,
          total: 4,
          startedAt: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:00.000Z"
        },
        Date.parse("2026-06-28T00:11:00.000Z")
      )
    ).toBe(true);
    expect(
      isStaleRunningSiteDataProgress(
        {
          taskId: "activity-fresh",
          taskType: "activity",
          scope: { kind: "all" },
          status: "running",
          completed: 1,
          total: 4,
          startedAt: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:00.000Z"
        },
        Date.parse("2026-06-28T00:09:59.000Z")
      )
    ).toBe(false);
  });

  it("extracts progress from storage changes", () => {
    const progress = siteDataProgressFromStorageChanges({
      [SITE_DATA_PROGRESS_STORAGE_KEY]: {
        oldValue: null,
        newValue: {
          taskId: "activity-1",
          taskType: "activity",
          scope: { kind: "boost", usernames: ["neo"] },
          status: "running",
          completed: 1,
          total: 2,
          currentLabel: "Boost @neo",
          startedAt: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:01.000Z"
        }
      }
    });

    expect(progress).toMatchObject({
      taskType: "activity",
      scope: { kind: "boost", usernames: ["neo"] },
      currentLabel: "Boost @neo"
    });
  });

  it("normalizes timed ownership and retired progress", () => {
    const progress = siteDataProgressFromStorageChanges({
      [SITE_DATA_PROGRESS_STORAGE_KEY]: {
        oldValue: null,
        newValue: {
          taskId: "activity-1",
          taskType: "activity",
          scope: { kind: "boost", usernames: ["neo"] },
          status: "error",
          trigger: "timed",
          timedRunId: "run-1",
          retiredReason: "timed_disabled",
          completed: 1,
          total: 2,
          startedAt: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:01.000Z",
          finishedAt: "2026-06-28T00:00:01.000Z"
        }
      }
    });

    expect(progress).toMatchObject({
      taskType: "activity",
      trigger: "timed",
      timedRunId: "run-1",
      retiredReason: "timed_disabled"
    });
  });

  it("rejects invalid timed ownership combinations", () => {
    const base = {
      taskId: "activity-1",
      taskType: "activity",
      scope: { kind: "all" },
      status: "running",
      completed: 0,
      total: 1,
      startedAt: "2026-06-28T00:00:00.000Z",
      updatedAt: "2026-06-28T00:00:00.000Z"
    };

    expect(siteDataProgressFromStorageChanges({ [SITE_DATA_PROGRESS_STORAGE_KEY]: { oldValue: null, newValue: { ...base, trigger: "bad" } } })).toBeNull();
    expect(siteDataProgressFromStorageChanges({ [SITE_DATA_PROGRESS_STORAGE_KEY]: { oldValue: null, newValue: { ...base, trigger: "timed" } } })).toBeNull();
    expect(siteDataProgressFromStorageChanges({ [SITE_DATA_PROGRESS_STORAGE_KEY]: { oldValue: null, newValue: { ...base, timedRunId: "run-1" } } })).toBeNull();
    expect(
      siteDataProgressFromStorageChanges({
        [SITE_DATA_PROGRESS_STORAGE_KEY]: { oldValue: null, newValue: { ...base, trigger: "timed", timedRunId: "run-1", retiredReason: "timed_disabled" } }
      })
    ).toBeNull();
  });

  it("uses a deterministic in-memory fallback without chrome storage", async () => {
    resetSiteDataProgressFallbackStorage();

    await saveSiteDataProgressState(
      {
        taskId: "profiles-2",
        taskType: "profiles",
        usernames: ["ada"],
        status: "success",
        completed: 1,
        total: 1,
        startedAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:02.000Z",
        finishedAt: "2026-06-28T00:00:02.000Z"
      },
      null
    );

    await expect(loadSiteDataProgressState(null)).resolves.toMatchObject({ taskType: "profiles", usernames: ["ada"] });
  });
});
