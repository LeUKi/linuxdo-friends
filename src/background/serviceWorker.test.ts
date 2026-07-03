import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConfigFingerprint as createConfigFingerprintForTest } from "../domain/configTransfer";
import { defaultAppState } from "../domain/defaultState";
import { addFriendFromProfile, updateFriend, upsertFollowedUser } from "../domain/friends";
import { isBackgroundCommand } from "../messages/contracts";
import { PAGE_SCRIPT_STATUS_STORAGE_KEY } from "../storage/pageScriptStatusStorage";
import { SITE_DATA_PROGRESS_STORAGE_KEY } from "../storage/siteDataProgressStorage";
import { CLOUD_AUTH_STORAGE_KEY } from "../storage/cloudAuthStorage";
import { TIMED_ACTIVITY_SESSION_STORAGE_KEY } from "../storage/timedActivityRefreshSessionStorage";
import { createMockStorage } from "../test/mockStorage";
import type { AppState } from "../shared/types";

describe("message contracts", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    try {
      vi.clearAllTimers();
    } catch {
      // Some tests use real timers only; timer cleanup is best-effort.
    }
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("accepts known commands", () => {
    expect(isBackgroundCommand({ type: "lookupFriendProfile", username: "neil" })).toBe(true);
    expect(isBackgroundCommand({ type: "identifyCurrentAccount" })).toBe(true);
    expect(isBackgroundCommand({ type: "addFriendFromKnownUser", user: { username: "neil", name: "Neo" } })).toBe(true);
    expect(
      isBackgroundCommand({
        type: "addFriendFromKnownUser",
        user: { username: "neil" },
        profile: { username: "neil", name: "Neo", refreshedAt: "2026-06-28T00:00:00.000Z" }
      })
    ).toBe(true);
    expect(isBackgroundCommand({ type: "addFriendByProfile", username: "neil" })).toBe(true);
    expect(isBackgroundCommand({ type: "updateFriend", username: "neil", patch: { activityKinds: [] } })).toBe(true);
    expect(isBackgroundCommand({ type: "updateFriend", username: "neil", patch: { activityKinds: ["reply", "boost"] } })).toBe(true);
    expect(isBackgroundCommand({ type: "refreshFriendProfiles", usernames: ["neil"] })).toBe(true);
    expect(isBackgroundCommand({ type: "refreshFriendActivity", usernames: ["neil"] })).toBe(true);
    expect(isBackgroundCommand({ type: "refreshFriendActivity", scope: { kind: "boost", usernames: ["neil"] } })).toBe(true);
    expect(isBackgroundCommand({ type: "refreshFriendActivity", scope: { kind: "boost", usernames: ["neil"] }, trigger: "timed", timedRunId: "run-1" })).toBe(true);
    expect(
      isBackgroundCommand({
        type: "upsertDredgeRule",
        rule: { schemaVersion: 2, id: "rule-1", name: "AI", mode: "allow", usernames: ["neil"], kinds: ["topic"], patterns: ["AI"] }
      })
    ).toBe(true);
    expect(isBackgroundCommand({ type: "removeDredgeRule", id: "rule-1" })).toBe(true);
    expect(isBackgroundCommand({ type: "resetLaoFindsStartedAt" })).toBe(true);
    expect(isBackgroundCommand({ type: "markLaoFindsItemRead", id: "item-1", read: true })).toBe(true);
    expect(isBackgroundCommand({ type: "archiveLaoFindsItem", id: "item-1", archived: true })).toBe(true);
    expect(isBackgroundCommand({ type: "cacheAvatars", usernames: ["neil"] })).toBe(true);
    expect(isBackgroundCommand({ type: "getSiteDataProgress" })).toBe(true);
    expect(isBackgroundCommand({ type: "getPageScriptStatus" })).toBe(true);
    expect(isBackgroundCommand({ type: "getUpdateCheck" })).toBe(true);
    expect(isBackgroundCommand({ type: "checkForUpdates" })).toBe(true);
    expect(isBackgroundCommand({ type: "checkForUpdates", force: true })).toBe(true);
    expect(isBackgroundCommand({ type: "getCloudArchiveLocalState" })).toBe(true);
    expect(isBackgroundCommand({ type: "getCloudConfigStatus" })).toBe(true);
    expect(isBackgroundCommand({ type: "bindCloudSave" })).toBe(true);
    expect(isBackgroundCommand({ type: "cloudSaveExchangeCode", code: "code-1" })).toBe(true);
    expect(isBackgroundCommand({ type: "backupCloudConfig" })).toBe(true);
    expect(isBackgroundCommand({ type: "restoreCloudConfig" })).toBe(true);
    expect(isBackgroundCommand({ type: "clearCloudBinding" })).toBe(true);
    expect(isBackgroundCommand({ type: "repairLinuxDoPageScript", tabId: 123 })).toBe(true);
    expect(isBackgroundCommand({ type: "openSidePanel" })).toBe(true);
    expect(isBackgroundCommand({ type: "openOptionsPage" })).toBe(true);
    expect(isBackgroundCommand({ type: "openOptionsPage", hash: "#cloud-backup" })).toBe(true);
    expect(isBackgroundCommand({ type: "openLinuxDoHome" })).toBe(true);
    expect(isBackgroundCommand({ type: "openActivityLink", url: "https://linux.do/t/topic/1/2" })).toBe(true);
    expect(isBackgroundCommand({ type: "openActivityLink", url: "/t/topic/1/2" })).toBe(true);
    expect(isBackgroundCommand({ type: "updateSettings", settings: { requestStatsAutoSyncEnabled: true } })).toBe(true);
    expect(isBackgroundCommand({ type: "exportConfig" })).toBe(true);
    expect(isBackgroundCommand({ type: "importConfig", json: "{}" })).toBe(true);
    expect(isBackgroundCommand({ type: "clearCache" })).toBe(true);
    expect(isBackgroundCommand({ type: "resetExtension" })).toBe(true);
  });

  it("rejects unknown commands", () => {
    expect(isBackgroundCommand({ type: "solveCloudflareChallenge" })).toBe(false);
    expect(isBackgroundCommand({ type: "upgradeToFriend", username: "neil" })).toBe(false);
  });

  it("rejects malformed known commands before dispatch", () => {
    expect(isBackgroundCommand({ type: "lookupFriendProfile" })).toBe(false);
    expect(isBackgroundCommand({ type: "addFriendFromKnownUser", user: { name: "No username" } })).toBe(false);
    expect(isBackgroundCommand({ type: "addFriendByProfile" })).toBe(false);
    expect(isBackgroundCommand({ type: "openOptionsPage", hash: "cloud-backup" })).toBe(false);
    expect(isBackgroundCommand({ type: "refreshFriendProfiles", usernames: ["ok", ""] })).toBe(false);
    expect(isBackgroundCommand({ type: "cacheAvatars", usernames: ["ok", ""] })).toBe(false);
    expect(isBackgroundCommand({ type: "repairLinuxDoPageScript", tabId: 0 })).toBe(false);
    expect(isBackgroundCommand({ type: "checkForUpdates", force: "yes" })).toBe(false);
    expect(isBackgroundCommand({ type: "refreshFriendActivity", scope: { kind: "bad", usernames: ["ok"] } })).toBe(false);
    expect(isBackgroundCommand({ type: "refreshFriendActivity", scope: { kind: "boost" }, trigger: "timed" })).toBe(false);
    expect(isBackgroundCommand({ type: "refreshFriendActivity", scope: { kind: "boost" }, timedRunId: "run-1" })).toBe(false);
    expect(isBackgroundCommand({ type: "refreshFriendActivity", scope: { kind: "boost" }, trigger: "manual", timedRunId: "run-1" })).toBe(false);
    expect(isBackgroundCommand({ type: "refreshFriendActivity", scope: { kind: "boost" }, trigger: "bad", timedRunId: "run-1" })).toBe(false);
    expect(isBackgroundCommand({ type: "upsertDredgeRule", rule: { usernames: [""] } })).toBe(false);
    expect(isBackgroundCommand({ type: "upsertDredgeRule", rule: { kinds: ["bad"] } })).toBe(false);
    expect(isBackgroundCommand({ type: "upsertDredgeRule", rule: { keywords: ["AI"] } })).toBe(false);
    expect(isBackgroundCommand({ type: "upsertDredgeRule", rule: { mode: "deny" } })).toBe(false);
    expect(isBackgroundCommand({ type: "upsertDredgeRule", rule: { patterns: ["AI", 1] } })).toBe(false);
    expect(isBackgroundCommand({ type: "removeDredgeRule", id: "" })).toBe(false);
    expect(isBackgroundCommand({ type: "markLaoFindsItemRead", id: "item-1", read: "yes" })).toBe(false);
    expect(isBackgroundCommand({ type: "archiveLaoFindsItem", id: "item-1", archived: "yes" })).toBe(false);
    expect(isBackgroundCommand({ type: "updateFriend", username: "neil", patch: { activityKinds: ["bad"] } })).toBe(false);
    expect(isBackgroundCommand({ type: "seedFollowedUser", user: { name: "No username" } })).toBe(false);
    expect(isBackgroundCommand({ type: "updateSettings", settings: { refreshIntervalMinutes: 1 } })).toBe(false);
    expect(isBackgroundCommand({ type: "updateSettings", settings: { timedActivityRefreshScopeMode: "bad" } })).toBe(false);
    expect(isBackgroundCommand({ type: "updateSettings", settings: { timedActivityRefreshIntervalMinutes: 1 } })).toBe(false);
    expect(isBackgroundCommand({ type: "updateSettings", settings: { requestStatsAutoSyncEnabled: "yes" } })).toBe(false);
    expect(isBackgroundCommand({ type: "openActivityLink", url: "https://example.com/t/topic/1" })).toBe(false);
    expect(isBackgroundCommand({ type: "importConfig", json: "" })).toBe(false);
  });

  it("keeps MVP-only refresh toggles disabled at the service-worker boundary", async () => {
    const { send } = await setupWorker();
    const response = await send({
      type: "updateSettings",
      settings: { allowAutoRefresh: true, allowInactiveTabFallback: true, openActivityLinksInPage: true, refreshIntervalMinutes: 60 }
    });
    expect(response).toMatchObject({
      ok: true,
      data: {
        settings: {
          allowAutoRefresh: false,
          allowInactiveTabFallback: false,
          openActivityLinksInPage: true,
          refreshIntervalMinutes: 60
        }
      }
    });
  });

  it("records failed direct linux.do attempts for non-mutating profile lookup", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("blocked", { status: 403 })));
    const { send, localStorage } = await setupWorker();

    const response = await send({ type: "lookupFriendProfile", username: "neo" });

    expect(response).toMatchObject({ ok: false, reason: "blocked" });
    expect(localStorage.dump()).toMatchObject({
      linuxdoFriendsState: {
        requestStats: {
          total: 1,
          byFamily: { profile: 1 }
        }
      }
    });
  });

  it("buckets direct linux.do request stats at attempt time instead of completion time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 1, 23, 59));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        vi.setSystemTime(new Date(2026, 6, 2, 0, 1));
        return new Response("blocked", { status: 403 });
      })
    );
    try {
      const { send, localStorage } = await setupWorker();

      const response = await send({ type: "lookupFriendProfile", username: "neo" });

      expect(response).toMatchObject({ ok: false, reason: "blocked" });
      expect(localStorage.dump()).toMatchObject({
        linuxdoFriendsState: {
          requestStats: {
            total: 1,
            days: {
              "2026-07-01": {
                total: 1,
                hours: { "23": 1 },
                byFamily: { profile: 1 }
              }
            }
          }
        }
      });
      expect((localStorage.dump().linuxdoFriendsState as AppState).requestStats.days["2026-07-02"]).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears paused timed activity refresh session when timed refresh is re-enabled", async () => {
    const pausedState: AppState = {
      ...defaultAppState,
      settings: {
        ...defaultAppState.settings,
        timedActivityRefreshEnabled: false
      }
    };
    const { send, sessionStorage } = await setupWorker({
      initialState: pausedState,
      initialSession: {
        [TIMED_ACTIVITY_SESSION_STORAGE_KEY]: {
          pausedReason: "challenge",
          pausedMessage: "遇到浏览器验证页面，已停止请求。",
          lastFailureAt: "2026-06-30T00:00:00.000Z",
          pendingDue: true,
          nextDueAt: "2026-06-30T01:00:00.000Z",
          updatedAt: "2026-06-30T00:00:00.000Z"
        }
      }
    });

    const response = await send({
      type: "updateSettings",
      settings: { timedActivityRefreshEnabled: true }
    });

    expect(response).toMatchObject({
      ok: true,
      data: {
        settings: {
          timedActivityRefreshEnabled: true
        }
      }
    });
    expect(sessionStorage.dump()).toMatchObject({
      [TIMED_ACTIVITY_SESSION_STORAGE_KEY]: {
        pendingDue: false,
        nextDueAt: expect.any(String)
      }
    });
    const timedSession = sessionStorage.dump()[TIMED_ACTIVITY_SESSION_STORAGE_KEY] as Record<string, unknown>;
    expect(timedSession.nextDueAt).not.toBe("2026-06-30T00:00:00.000Z");
    expect(timedSession).not.toHaveProperty("pausedReason");
    expect(timedSession).not.toHaveProperty("pausedMessage");
    expect(timedSession).not.toHaveProperty("lastFailureAt");
  });

  it("clears active timed activity run state when timed refresh is disabled", async () => {
    const activeState: AppState = {
      ...defaultAppState,
      settings: {
        ...defaultAppState.settings,
        timedActivityRefreshEnabled: true
      }
    };
    const { send, sessionStorage } = await setupWorker({
      initialState: activeState,
      initialSession: {
        [TIMED_ACTIVITY_SESSION_STORAGE_KEY]: {
          activeRunId: "timed-activity:running",
          pendingDue: true,
          nextDueAt: "2026-06-30T00:00:00.000Z",
          updatedAt: "2026-06-30T00:00:00.000Z"
        }
      }
    });

    await send({ type: "updateSettings", settings: { timedActivityRefreshEnabled: false } });

    const timedSession = sessionStorage.dump()[TIMED_ACTIVITY_SESSION_STORAGE_KEY] as Record<string, unknown>;
    expect(timedSession.pendingDue).toBe(false);
    expect(timedSession).not.toHaveProperty("activeRunId");
  });

  it("invalidates stale no-rule timed session state when dredge rules become targetable", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const activeState: AppState = {
      ...addFriendFromProfile(defaultAppState, { username: "Neo", refreshedAt: "2026-06-28T00:00:00.000Z" }),
      settings: {
        ...defaultAppState.settings,
        timedActivityRefreshEnabled: false,
        timedActivityRefreshScopeMode: "rules"
      },
      dredgeRules: []
    };
    const { send, sessionStorage } = await setupWorker({
      initialState: activeState,
      initialSession: {
        [TIMED_ACTIVITY_SESSION_STORAGE_KEY]: {
          noTargetAt: "2026-06-30T00:00:00.000Z",
          noTargetMessage: "没有启用规则",
          nextDueAt: "2026-06-30T02:00:00.000Z",
          updatedAt: "2026-06-30T00:00:00.000Z"
        }
      }
    });

    await send({
      type: "upsertDredgeRule",
      rule: {
        schemaVersion: 2,
        name: "Neo",
        enabled: true,
        mode: "allow",
        usernames: ["neo"],
        kinds: ["topic"],
        patterns: []
      }
    });
    await send({ type: "updateSettings", settings: { timedActivityRefreshEnabled: true } });

    const timedSession = sessionStorage.dump()[TIMED_ACTIVITY_SESSION_STORAGE_KEY] as Record<string, unknown>;
    expect(timedSession).not.toHaveProperty("noTargetAt");
    expect(timedSession).not.toHaveProperty("noTargetMessage");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps stale no-rule timed session state when timed dredging is re-enabled without targets", async () => {
    const activeState: AppState = {
      ...defaultAppState,
      settings: {
        ...defaultAppState.settings,
        timedActivityRefreshEnabled: false,
        timedActivityRefreshScopeMode: "rules"
      },
      dredgeRules: []
    };
    const { send, sessionStorage } = await setupWorker({
      initialState: activeState,
      initialSession: {
        [TIMED_ACTIVITY_SESSION_STORAGE_KEY]: {
          noTargetAt: "2026-06-30T00:00:00.000Z",
          noTargetMessage: "没有启用规则",
          nextDueAt: "2026-06-30T02:00:00.000Z",
          updatedAt: "2026-06-30T00:00:00.000Z"
        }
      }
    });

    await send({ type: "updateSettings", settings: { timedActivityRefreshEnabled: true } });

    expect(sessionStorage.dump()[TIMED_ACTIVITY_SESSION_STORAGE_KEY]).toMatchObject({
      noTargetAt: "2026-06-30T00:00:00.000Z",
      noTargetMessage: "没有启用规则"
    });
  });

  it("invalidates stale no-rule timed session state when target inputs become targetable", async () => {
    const staleNoTargetSession = {
      noTargetAt: "2026-06-30T00:00:00.000Z",
      noTargetMessage: "没有启用规则",
      nextDueAt: "2026-06-30T02:00:00.000Z",
      updatedAt: "2026-06-30T00:00:00.000Z"
    };

    const modeWorker = await setupWorker({
      initialState: addFriendFromProfile(defaultAppState, { username: "Neo", refreshedAt: "2026-06-28T00:00:00.000Z" }),
      initialSession: { [TIMED_ACTIVITY_SESSION_STORAGE_KEY]: staleNoTargetSession }
    });
    await modeWorker.send({ type: "updateSettings", settings: { timedActivityRefreshScopeMode: "all" } });
    expect(modeWorker.sessionStorage.dump()[TIMED_ACTIVITY_SESSION_STORAGE_KEY]).not.toHaveProperty("noTargetMessage");

    vi.resetModules();
    vi.unstubAllGlobals();
    const friendState = updateFriend(
      {
        ...addFriendFromProfile(defaultAppState, { username: "Neo", refreshedAt: "2026-06-28T00:00:00.000Z" }),
        dredgeRules: [
          {
            schemaVersion: 2,
            id: "rule-neo",
            name: "Neo",
            enabled: true,
            mode: "allow",
            usernames: ["neo"],
            kinds: ["topic"],
            patterns: [],
            createdAt: "2026-06-28T00:00:00.000Z",
            updatedAt: "2026-06-28T00:00:00.000Z"
          }
        ]
      },
      "neo",
      { activityKinds: [] }
    );
    const friendWorker = await setupWorker({
      initialState: friendState,
      initialSession: { [TIMED_ACTIVITY_SESSION_STORAGE_KEY]: staleNoTargetSession }
    });
    await friendWorker.send({ type: "updateFriend", username: "neo", patch: { activityKinds: ["topic"] } });
    expect(friendWorker.sessionStorage.dump()[TIMED_ACTIVITY_SESSION_STORAGE_KEY]).not.toHaveProperty("noTargetMessage");

    vi.resetModules();
    vi.unstubAllGlobals();
    const combinedSettingsWorker = await setupWorker({
      initialState: {
        ...defaultAppState,
        settings: { ...defaultAppState.settings, timedActivityRefreshEnabled: true, timedActivityRefreshScopeMode: "rules" }
      },
      initialSession: { [TIMED_ACTIVITY_SESSION_STORAGE_KEY]: staleNoTargetSession }
    });
    await combinedSettingsWorker.send({ type: "updateSettings", settings: { timedActivityRefreshEnabled: false, timedActivityRefreshScopeMode: "all" } });
    expect(combinedSettingsWorker.sessionStorage.dump()[TIMED_ACTIVITY_SESSION_STORAGE_KEY]).not.toHaveProperty("noTargetAt");
    expect(combinedSettingsWorker.sessionStorage.dump()[TIMED_ACTIVITY_SESSION_STORAGE_KEY]).not.toHaveProperty("noTargetMessage");
  });

  it("keeps no-rule timed session state when rule edits do not change timed targets", async () => {
    const activeState: AppState = {
      ...addFriendFromProfile(defaultAppState, { username: "Neo", refreshedAt: "2026-06-28T00:00:00.000Z" }),
      settings: {
        ...defaultAppState.settings,
        timedActivityRefreshEnabled: false,
        timedActivityRefreshScopeMode: "rules"
      },
      dredgeRules: [
        {
          schemaVersion: 2,
          id: "rule-ghost",
          name: "Ghost",
          enabled: true,
          mode: "allow",
          usernames: ["ghost"],
          kinds: ["topic"],
          patterns: [],
          createdAt: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:00.000Z"
        }
      ]
    };
    const { send, sessionStorage } = await setupWorker({
      initialState: activeState,
      initialSession: {
        [TIMED_ACTIVITY_SESSION_STORAGE_KEY]: {
          noTargetAt: "2026-06-30T00:00:00.000Z",
          noTargetMessage: "没有启用规则",
          nextDueAt: "2026-06-30T02:00:00.000Z",
          updatedAt: "2026-06-30T00:00:00.000Z"
        }
      }
    });

    await send({ type: "upsertDredgeRule", rule: { id: "rule-ghost", name: "Ghost renamed" } });

    expect(sessionStorage.dump()[TIMED_ACTIVITY_SESSION_STORAGE_KEY]).toMatchObject({
      noTargetAt: "2026-06-30T00:00:00.000Z",
      noTargetMessage: "没有启用规则"
    });
  });

  it("keeps no-rule timed session state when broad state replacement still has no timed targets", async () => {
    const staleNoTargetSession = {
      noTargetAt: "2026-06-30T00:00:00.000Z",
      noTargetMessage: "没有启用规则",
      nextDueAt: "2026-06-30T02:00:00.000Z",
      updatedAt: "2026-06-30T00:00:00.000Z"
    };
    const importWorker = await setupWorker({
      initialState: defaultAppState,
      initialSession: { [TIMED_ACTIVITY_SESSION_STORAGE_KEY]: staleNoTargetSession }
    });
    await importWorker.send({
      type: "importConfig",
      json: JSON.stringify({
        schemaVersion: 1,
        source: "linuxdo-friends",
        exportedAt: "2026-06-30T00:00:00.000Z",
        friends: {},
        dredgeRules: []
      })
    });
    expect(importWorker.sessionStorage.dump()[TIMED_ACTIVITY_SESSION_STORAGE_KEY]).toMatchObject({
      noTargetAt: "2026-06-30T00:00:00.000Z",
      noTargetMessage: "没有启用规则"
    });

    vi.resetModules();
    vi.unstubAllGlobals();
    const resetWorker = await setupWorker({
      initialState: defaultAppState,
      initialSession: { [TIMED_ACTIVITY_SESSION_STORAGE_KEY]: staleNoTargetSession }
    });
    await resetWorker.send({ type: "resetExtension" });
    expect(resetWorker.sessionStorage.dump()[TIMED_ACTIVITY_SESSION_STORAGE_KEY]).toMatchObject({
      noTargetAt: "2026-06-30T00:00:00.000Z",
      noTargetMessage: "没有启用规则"
    });
  });

  it("retires a matching timed activity task when timed refresh is disabled", async () => {
    let releaseFetch: (response: Response) => void = () => undefined;
    const pendingFetch = new Promise<Response>((resolve) => {
      releaseFetch = resolve;
    });
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(pendingFetch));
    const activeState: AppState = {
      ...addFriendFromProfile(defaultAppState, { username: "neo", refreshedAt: "2026-06-28T00:00:00.000Z" }),
      settings: {
        ...defaultAppState.settings,
        timedActivityRefreshEnabled: true
      }
    };
    const { send, runtime, sessionStorage } = await setupWorker({
      initialState: activeState,
      initialSession: {
        [TIMED_ACTIVITY_SESSION_STORAGE_KEY]: {
          activeRunId: "timed-run-1",
          pendingDue: true,
          updatedAt: "2026-06-30T00:00:00.000Z"
        }
      }
    });

    const timedRefresh = send({ type: "refreshFriendActivity", scope: { kind: "boost", usernames: ["neo"] }, trigger: "timed", timedRunId: "timed-run-1" });
    await Promise.resolve();
    await send({ type: "updateSettings", settings: { timedActivityRefreshEnabled: false } });
    const progressAfterDisable = await send({ type: "getSiteDataProgress" });
    releaseFetch(new Response(JSON.stringify({ boosts: [] }), { status: 200 }));
    await timedRefresh;

    expect(progressAfterDisable).toMatchObject({
      ok: true,
      data: {
        taskType: "activity",
        status: "error",
        trigger: "timed",
        timedRunId: "timed-run-1",
        retiredReason: "timed_disabled",
        error: "自动捞料已关闭，本次打捞已停止。"
      }
    });
    expect(sessionStorage.dump()).toMatchObject({
      [SITE_DATA_PROGRESS_STORAGE_KEY]: expect.objectContaining({ status: "error", retiredReason: "timed_disabled", timedRunId: "timed-run-1" })
    });
    expect(runtime.sendMessage).toHaveBeenCalledWith({
      type: "linuxdoFriends.siteDataProgress",
      progress: expect.objectContaining({ status: "error", retiredReason: "timed_disabled", timedRunId: "timed-run-1" })
    });
  });

  it("does not let a retired timed activity callback finish newer manual profile progress", async () => {
    let releaseTimedFetch: (response: Response) => void = () => undefined;
    const timedFetch = new Promise<Response>((resolve) => {
      releaseTimedFetch = resolve;
    });
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(timedFetch).mockResolvedValueOnce(profileResponse("Neo", "Neo")));
    const activeState: AppState = {
      ...addFriendFromProfile(defaultAppState, { username: "neo", refreshedAt: "2026-06-28T00:00:00.000Z" }),
      settings: {
        ...defaultAppState.settings,
        timedActivityRefreshEnabled: true
      }
    };
    const { send, sessionStorage } = await setupWorker({
      initialState: activeState,
      initialSession: {
        [TIMED_ACTIVITY_SESSION_STORAGE_KEY]: {
          activeRunId: "timed-run-1",
          pendingDue: true,
          updatedAt: "2026-06-30T00:00:00.000Z"
        }
      }
    });

    const timedRefresh = send({ type: "refreshFriendActivity", scope: { kind: "boost", usernames: ["neo"] }, trigger: "timed", timedRunId: "timed-run-1" });
    await Promise.resolve();
    await send({ type: "updateSettings", settings: { timedActivityRefreshEnabled: false } });
    const manualRefresh = await send({ type: "refreshFriendProfiles" });
    releaseTimedFetch(new Response(JSON.stringify({ boosts: [] }), { status: 200 }));
    await timedRefresh;
    const progressAfterLateTimed = await send({ type: "getSiteDataProgress" });

    expect(manualRefresh).toMatchObject({
      ok: true,
      data: {
        friendProfiles: { neo: { name: "Neo" } },
        lastSync: { ok: true, source: "direct_fetch" }
      }
    });
    expect(progressAfterLateTimed).toMatchObject({
      ok: true,
      data: { taskType: "profiles", status: "success", currentLabel: "@neo" }
    });
    expect(sessionStorage.dump()).toMatchObject({
      [SITE_DATA_PROGRESS_STORAGE_KEY]: expect.objectContaining({ taskType: "profiles", status: "success", currentLabel: "@neo" })
    });
  });

  it("lets an unrelated manual refresh release its slot after timed refresh is disabled", async () => {
    let releaseManualFetch: (response: Response) => void = () => undefined;
    const manualFetch = new Promise<Response>((resolve) => {
      releaseManualFetch = resolve;
    });
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(manualFetch).mockResolvedValueOnce(profileResponse("Neo", "Neo")));
    const activeState: AppState = {
      ...addFriendFromProfile(defaultAppState, { username: "neo", refreshedAt: "2026-06-28T00:00:00.000Z" }),
      settings: {
        ...defaultAppState.settings,
        timedActivityRefreshEnabled: true
      }
    };
    const { send } = await setupWorker({
      initialState: activeState,
      initialSession: {
        [TIMED_ACTIVITY_SESSION_STORAGE_KEY]: {
          activeRunId: "timed-run-1",
          pendingDue: true,
          updatedAt: "2026-06-30T00:00:00.000Z"
        }
      }
    });

    const manualRefresh = send({ type: "refreshFriendProfiles" });
    await Promise.resolve();
    await send({ type: "updateSettings", settings: { timedActivityRefreshEnabled: false } });
    releaseManualFetch(profileResponse("Neo", "Stale"));
    const staleManualRefresh = await manualRefresh;
    const progressAfterManualFinish = await send({ type: "getSiteDataProgress" });
    const laterManualRefresh = await send({ type: "refreshFriendProfiles" });

    expect(staleManualRefresh).toMatchObject({
      ok: true,
      data: {
        lastSync: { ok: false, message: "已导入配置，较早的刷新结果已丢弃。" }
      }
    });
    expect(progressAfterManualFinish).toMatchObject({
      ok: true,
      data: {
        taskType: "profiles",
        status: "error",
        error: "刷新结果已被较新的本地状态变更丢弃。"
      }
    });
    expect(laterManualRefresh).toMatchObject({
      ok: true,
      data: {
        friendProfiles: { neo: { name: "Neo" } },
        lastSync: { ok: true, source: "direct_fetch" }
      }
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("checks GitHub latest release and persists an available update", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ tag_name: "v1.1.0", html_url: "https://github.com/LeUKi/linuxdo-friends/releases/tag/v1.1.0" }), { status: 200 }))
    );
    const { send, localStorage } = await setupWorker();

    const response = await send({ type: "checkForUpdates", force: true });

    expect(response).toMatchObject({
      ok: true,
      data: {
        installedVersion: "1.0.0",
        latestVersion: "1.1.0",
        status: "update-available"
      }
    });
    expect(fetch).toHaveBeenCalledWith("https://api.github.com/repos/LeUKi/linuxdo-friends/releases/latest", expect.any(Object));
    expect(localStorage.dump()).toMatchObject({
      linuxdoFriendsUpdateCheck: {
        installedVersion: "1.0.0",
        latestVersion: "1.1.0",
        status: "update-available"
      }
    });
  });

  it("reuses cached update checks within the 12-hour TTL", async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    const cached = {
      installedVersion: "1.0.0",
      latestReleaseUrl: "https://github.com/LeUKi/linuxdo-friends/releases/latest",
      status: "up-to-date",
      latestVersion: "1.0.0",
      checkedAt: new Date().toISOString(),
      source: "github_release"
    };
    const { send } = await setupWorker({ initialUpdateCheck: cached });

    const response = await send({ type: "checkForUpdates" });

    expect(response).toMatchObject({ ok: true, data: cached });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("deduplicates concurrent update checks before the cache is written", async () => {
    const { fetchImpl, release } = createPendingJsonFetch({
      tag_name: "v1.1.0",
      html_url: "https://github.com/LeUKi/linuxdo-friends/releases/tag/v1.1.0"
    });
    vi.stubGlobal("fetch", fetchImpl);
    const { send } = await setupWorker();

    const first = send({ type: "checkForUpdates", force: true });
    const second = send({ type: "checkForUpdates", force: true });
    await Promise.resolve();
    release();
    const [firstResponse, secondResponse] = await Promise.all([first, second]);

    expect(firstResponse).toMatchObject({ ok: true, data: { status: "update-available", latestVersion: "1.1.0" } });
    expect(secondResponse).toMatchObject({ ok: true, data: { status: "update-available", latestVersion: "1.1.0" } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("records a quiet no-release update-check state for GitHub 404", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
    const { send } = await setupWorker();

    const response = await send({ type: "checkForUpdates", force: true });

    expect(response).toMatchObject({
      ok: true,
      data: {
        installedVersion: "1.0.0",
        status: "no-release",
        error: "GitHub 仓库还没有 latest release。"
      }
    });
  });

  it("falls back to the bundled GitHub API mirror when the primary API is rate-limited", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("rate limit", { status: 403 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ tag_name: "v1.1.0", html_url: "https://github.com/LeUKi/linuxdo-friends/releases/tag/v1.1.0" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchImpl);
    const { send, localStorage } = await setupWorker();

    const response = await send({ type: "checkForUpdates", force: true });

    expect(response).toMatchObject({
      ok: true,
      data: {
        installedVersion: "1.0.0",
        latestVersion: "1.1.0",
        status: "update-available"
      }
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(1, "https://api.github.com/repos/LeUKi/linuxdo-friends/releases/latest", expect.any(Object));
    expect(fetchImpl).toHaveBeenNthCalledWith(2, "https://github-api.lafish.workers.dev/repos/LeUKi/linuxdo-friends/releases/latest", expect.any(Object));
    expect(localStorage.dump()).toMatchObject({
      linuxdoFriendsUpdateCheck: {
        latestVersion: "1.1.0",
        status: "update-available"
      }
    });
  });

  it("records update-check failures as diagnostics instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad gateway", { status: 502 })));
    const { send } = await setupWorker();

    const response = await send({ type: "checkForUpdates", force: true });

    expect(response).toMatchObject({
      ok: true,
      data: {
        installedVersion: "1.0.0",
        status: "error",
        error: "GitHub Release 检查失败：HTTP 502"
      }
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("configures the browser action to open the side panel instead of a popup", async () => {
    const { sidePanel } = await setupWorker();

    expect(sidePanel.setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: true });
  });

  it("opens the side panel for the sender tab", async () => {
    const { send, sidePanel } = await setupWorker();

    const response = await send({ type: "openSidePanel" }, { tab: { id: 123, windowId: 7 } as chrome.tabs.Tab });

    expect(response).toMatchObject({ ok: true, data: { message: "已打开插件侧栏。" } });
    expect(sidePanel.open).toHaveBeenCalledWith({ tabId: 123 });
  });

  it("opens the side panel for the active tab when sender tab is unavailable", async () => {
    const { send, sidePanel, tabs } = await setupWorker({
      tabs: {
        query: vi.fn(async () => [{ id: 456, windowId: 9 } as chrome.tabs.Tab]),
        sendMessage: vi.fn()
      }
    });

    const response = await send({ type: "openSidePanel" });

    expect(response).toMatchObject({ ok: true });
    expect(tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(sidePanel.open).toHaveBeenCalledWith({ tabId: 456 });
  });

  it("opens a new extension options page when no existing options tab is available", async () => {
    const { send, runtime, tabs } = await setupWorker();

    const response = await send({ type: "openOptionsPage" });

    expect(response).toMatchObject({ ok: true, data: { message: "已打开配置页。" } });
    expect(runtime.openOptionsPage).not.toHaveBeenCalled();
    expect(tabs.query).toHaveBeenCalledWith({ currentWindow: true });
    expect(tabs.query).toHaveBeenCalledWith({});
    expect(tabs.create).toHaveBeenCalledWith({
      url: "chrome-extension://linuxdo-friends/src/options/index.html",
      active: true
    });
  });

  it("opens a new extension options page at a specific section hash when no options tab exists", async () => {
    const { send, runtime, tabs } = await setupWorker();

    const response = await send({ type: "openOptionsPage", hash: "#cloud-backup" });

    expect(response).toMatchObject({ ok: true, data: { message: "已打开配置页。" } });
    expect(runtime.openOptionsPage).not.toHaveBeenCalled();
    expect(tabs.create).toHaveBeenCalledWith({
      url: "chrome-extension://linuxdo-friends/src/options/index.html#cloud-backup",
      active: true
    });
  });

  it("reuses the current-window options tab before checking other windows", async () => {
    const { send, tabs, windows } = await setupWorker({
      tabs: {
        query: vi.fn(async (queryInfo: chrome.tabs.QueryInfo) =>
          queryInfo.currentWindow
            ? [{ id: 123, windowId: 7, url: "chrome-extension://linuxdo-friends/src/options/index.html#basic" } as chrome.tabs.Tab]
            : [{ id: 456, windowId: 9, url: "chrome-extension://linuxdo-friends/src/options/index.html#data" } as chrome.tabs.Tab]
        ),
        sendMessage: vi.fn(),
        update: vi.fn(async () => ({ id: 123 } as chrome.tabs.Tab)),
        create: vi.fn()
      }
    });

    const response = await send({ type: "openOptionsPage", hash: "#lao-finds" });

    expect(response).toMatchObject({ ok: true, data: { message: "已打开配置页。" } });
    expect(tabs.query).toHaveBeenCalledTimes(1);
    expect(tabs.query).toHaveBeenCalledWith({ currentWindow: true });
    expect(tabs.update).toHaveBeenCalledWith(123, {
      url: "chrome-extension://linuxdo-friends/src/options/index.html#lao-finds",
      active: true
    });
    expect(windows.update).toHaveBeenCalledWith(7, { focused: true });
    expect(tabs.create).not.toHaveBeenCalled();
  });

  it("reuses an options tab from another window when the current window has none", async () => {
    const { send, tabs, windows } = await setupWorker({
      tabs: {
        query: vi.fn(async (queryInfo: chrome.tabs.QueryInfo) =>
          queryInfo.currentWindow
            ? [{ id: 111, windowId: 7, url: "https://linux.do/latest" } as chrome.tabs.Tab]
            : [
                { id: 222, windowId: 8, url: "https://linux.do/t/topic/1" } as chrome.tabs.Tab,
                { id: 333, windowId: 9, url: "chrome-extension://linuxdo-friends/src/options/index.html#data" } as chrome.tabs.Tab
              ]
        ),
        sendMessage: vi.fn(),
        update: vi.fn(async () => ({ id: 333 } as chrome.tabs.Tab)),
        create: vi.fn()
      }
    });

    const response = await send({ type: "openOptionsPage", hash: "#cloud-backup" });

    expect(response).toMatchObject({ ok: true, data: { message: "已打开配置页。" } });
    expect(tabs.query).toHaveBeenCalledWith({ currentWindow: true });
    expect(tabs.query).toHaveBeenCalledWith({});
    expect(tabs.update).toHaveBeenCalledWith(333, {
      url: "chrome-extension://linuxdo-friends/src/options/index.html#cloud-backup",
      active: true
    });
    expect(windows.update).toHaveBeenCalledWith(9, { focused: true });
    expect(tabs.create).not.toHaveBeenCalled();
  });

  it("routes activity links through the active linux.do page script", async () => {
    const { send, tabs } = await setupWorker({
      tabs: {
        query: vi.fn(async () => [{ id: 123, url: "https://linux.do/latest" } as chrome.tabs.Tab]),
        sendMessage: vi.fn(async () => ({ ok: true, url: "https://linux.do/t/topic/1/2" })),
        create: vi.fn(),
        update: vi.fn()
      }
    });

    const response = await send({ type: "openActivityLink", url: "https://linux.do/t/topic/1/2" });

    expect(response).toMatchObject({ ok: true, data: { tabId: 123, openedNewTab: false } });
    expect(tabs.sendMessage).toHaveBeenCalledWith(123, { type: "linuxdoFriends.navigateInPage", url: "https://linux.do/t/topic/1/2" });
    expect(tabs.update).not.toHaveBeenCalled();
    expect(tabs.create).not.toHaveBeenCalled();
  });

  it("updates the active linux.do tab when page-script navigation is unavailable", async () => {
    const { send, tabs } = await setupWorker({
      tabs: {
        query: vi.fn(async () => [{ id: 123, url: "https://linux.do/latest" } as chrome.tabs.Tab]),
        sendMessage: vi.fn(async () => ({ ok: false, reason: "unavailable", error: "missing" })),
        create: vi.fn(),
        update: vi.fn(async () => ({ id: 123, url: "https://linux.do/t/topic/1/2" }) as chrome.tabs.Tab)
      }
    });

    const response = await send({ type: "openActivityLink", url: "https://linux.do/t/topic/1/2" });

    expect(response).toMatchObject({ ok: true, data: { tabId: 123, openedNewTab: false } });
    expect(tabs.update).toHaveBeenCalledWith(123, { url: "https://linux.do/t/topic/1/2" });
    expect(tabs.create).not.toHaveBeenCalled();
  });

  it("opens activity links in a new tab when the active tab is outside linux.do", async () => {
    const { send, tabs } = await setupWorker({
      tabs: {
        query: vi.fn(async () => [{ id: 456, url: "https://example.com/" } as chrome.tabs.Tab]),
        sendMessage: vi.fn(),
        create: vi.fn(async () => ({ id: 789, url: "https://linux.do/t/topic/1/2" }) as chrome.tabs.Tab),
        update: vi.fn()
      }
    });

    const response = await send({ type: "openActivityLink", url: "https://linux.do/t/topic/1/2" });

    expect(response).toMatchObject({ ok: true, data: { tabId: 789, openedNewTab: true } });
    expect(tabs.sendMessage).not.toHaveBeenCalled();
    expect(tabs.update).not.toHaveBeenCalled();
    expect(tabs.create).toHaveBeenCalledWith({ url: "https://linux.do/t/topic/1/2", active: true });
  });

  it("allows session storage access from content scripts when Chrome exposes the API", async () => {
    const { sessionStorage } = await setupWorker();

    expect(sessionStorage.setAccessLevel).toHaveBeenCalledWith({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" });
  });

  it("restricts local storage to trusted contexts when Chrome exposes the API", async () => {
    const { localStorage } = await setupWorker();

    expect(localStorage.setAccessLevel).toHaveBeenCalledWith({ accessLevel: "TRUSTED_CONTEXTS" });
  });

  it("persists page script status snapshots to session storage on heartbeat", async () => {
    const { send, sessionStorage } = await setupWorker();

    await send(
      {
        type: "linuxdoFriends.pageHeartbeat",
        url: "https://linux.do/",
        title: "linux.do",
        status: "ready",
        hasLauncher: true
      },
      { tab: { id: 123, windowId: 7 } as chrome.tabs.Tab }
    );

    expect(sessionStorage.dump()).toMatchObject({
      [PAGE_SCRIPT_STATUS_STORAGE_KEY]: expect.objectContaining({
        status: "connected",
        connectedCount: 1,
        selectedTabId: 123
      })
    });
  });

  it("keeps starting when session storage access-level API is missing", async () => {
    const { sidePanel } = await setupWorker({ includeSessionAccessLevel: false });

    expect(sidePanel.setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: true });
  });

  it("starts cloud save browser-code login without returning a token", async () => {
    const { send, localStorage, windows } = await setupWorker();

    const response = await send({ type: "bindCloudSave" });

    const [popupOptions] = windows.create.mock.calls[0] as unknown as [{ url: string; type: string; width: number; height: number }];
    const url = new URL(popupOptions.url);
    expect(url.origin).toBe("https://linuxdo-cloud-save.lafish.workers.dev");
    expect(url.pathname).toBe("/auth/start");
    expect(url.searchParams.get("app")).toBe("linuxdo-friends");
    expect(url.searchParams.get("flow")).toBe("browser_code");
    expect(url.searchParams.get("challenge")).toBeTruthy();
    expect(popupOptions).toMatchObject({
      type: "popup",
      width: 520,
      height: 720
    });
    expect(response).toMatchObject({
      ok: true,
      data: {
        binding: { bound: false },
        message: "已打开 linuxdo-cloud-save 登录窗口。",
        authWindowId: 77
      }
    });
    expect(localStorage.dump()).toMatchObject({ linuxdoFriendsCloudAuthVerifier: expect.any(String) });
    expect(localStorage.dump()).toMatchObject({ linuxdoFriendsCloudAuthWindowId: 77 });
    expect(JSON.stringify(response)).not.toContain("secret-token");
  });

  it("exchanges browser-code completion code and persists cloud auth", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => cloudExchangeResponse()));
    const { send, localStorage, windows } = await setupWorker({
      initialCloudVerifier: "verifier-1"
    });

    const response = await sendCloudExchangeCode(send, "code-1");

    expect(fetch).toHaveBeenCalledWith("https://linuxdo-cloud-save.lafish.workers.dev/auth/exchange", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ app: "linuxdo-friends", code: "code-1", verifier: "verifier-1" })
    });
    expect(response).toMatchObject({
      ok: true,
      data: {
        binding: { bound: true, linuxDoId: "42", tokenKind: "jwt", tokenType: "Bearer" },
        message: "已绑定 linuxdo-cloud-save。"
      }
    });
    expect(JSON.stringify(response)).not.toContain("secret-token");
    expect(localStorage.dump()).toMatchObject({
      [CLOUD_AUTH_STORAGE_KEY]: { token: "secret-token", linuxDoId: "42" }
    });
    expect(localStorage.dump()).not.toHaveProperty("linuxdoFriendsCloudAuthVerifier");
    expect(localStorage.dump()).not.toHaveProperty("linuxdoFriendsCloudAuthWindowId");
    expect(windows.remove).toHaveBeenCalledWith(77);
  });

  it("rejects invalid exchange payloads without persisting token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        cloudExchangeResponse({
          app: "wrong",
          token: "secret-token",
          token_type: "Bearer",
          token_kind: "jwt",
          linux_do_id: "42"
        })
      )
    );
    const { send, localStorage } = await setupWorker({
      initialCloudVerifier: "verifier-1"
    });

    const response = await sendCloudExchangeCode(send, "code-1");

    expect(response).toMatchObject({ ok: false, error: "云存档登录来源不正确。" });
    expect(localStorage.dump()).not.toHaveProperty(CLOUD_AUTH_STORAGE_KEY);
    expect(localStorage.dump()).not.toHaveProperty("linuxdoFriendsCloudAuthVerifier");
    expect(JSON.stringify(response)).not.toContain("secret-token");
  });

  it("returns unbound cloud status without fetching", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { send } = await setupWorker();

    const response = await send({ type: "getCloudConfigStatus" });

    expect(response).toEqual({
      ok: true,
      data: {
        binding: { bound: false },
        status: { state: "unchecked" },
        message: "尚未绑定 linuxdo-cloud-save。"
      }
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns local-only cloud archive state without fetching", async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    const state = {
      ...addFriendFromProfile(defaultAppState, { username: "Neo", refreshedAt: "2026-06-28T00:00:00.000Z" }),
      requestStats: {
        total: 7,
        byFamily: { activity: 7 },
        days: {
          "2026-07-02": {
            date: "2026-07-02",
            total: 7,
            hours: { "09": 7 },
            byFamily: { activity: 7 }
          }
        }
      }
    };
    const { send } = await setupWorker({ initialState: state, initialCloudAuth: cloudAuthFixture() });

    const response = await send({ type: "getCloudArchiveLocalState" });

    expect(response).toMatchObject({
      ok: true,
      data: {
        binding: { bound: true, linuxDoId: "42" },
        archiveState: "different"
      }
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(JSON.stringify(response)).not.toContain("secret-token");
  });

  it("returns same local cloud archive state when the stored digest matches current migratable config", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const state = {
      ...addFriendFromProfile(defaultAppState, { username: "Neo", refreshedAt: "2026-06-28T00:00:00.000Z" }),
      requestStats: requestStatsFixture(7)
    };
    const digest = await createConfigFingerprintForTest(state);
    const { send } = await setupWorker({
      initialState: state,
      initialCloudAuth: { ...cloudAuthFixture(), lastConfigDigest: digest, lastConfigSyncedAt: "2026-06-29T00:02:00.000Z" }
    });

    const response = await send({ type: "getCloudArchiveLocalState" });

    expect(response).toMatchObject({
      ok: true,
      data: {
        binding: {
          bound: true,
          linuxDoId: "42",
          lastConfigDigest: digest,
          lastConfigSyncedAt: "2026-06-29T00:02:00.000Z"
        },
        archiveState: "same",
        syncedAt: "2026-06-29T00:02:00.000Z"
      }
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(response)).not.toContain("secret-token");
  });

  it("keeps the local archive tag stable for request stats and local runtime-only changes", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const base = addFriendFromProfile(defaultAppState, { username: "Neo", refreshedAt: "2026-06-28T00:00:00.000Z" });
    const digest = await createConfigFingerprintForTest(base);
    const state = {
      ...base,
      laoFindsStartedAt: "2026-06-29T00:00:00.000Z",
      requestStats: requestStatsFixture(99),
      settings: {
        ...base.settings,
        timedActivityRefreshEnabled: true,
        requestStatsAutoSyncEnabled: true
      }
    };
    const { send } = await setupWorker({
      initialState: state,
      initialCloudAuth: { ...cloudAuthFixture(), lastConfigDigest: digest, lastConfigSyncedAt: "2026-06-29T00:02:00.000Z" }
    });

    const response = await send({ type: "getCloudArchiveLocalState" });

    expect(response).toMatchObject({
      ok: true,
      data: { archiveState: "same", syncedAt: "2026-06-29T00:02:00.000Z" }
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reads cloud config status without mutating stored state", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => configSlotResponse({ friends: { neo: minimalFriend("neo") } })));
    const state = addFriendFromProfile(defaultAppState, { username: "local", refreshedAt: "2026-06-28T00:00:00.000Z" });
    const { send, localStorage } = await setupWorker({ initialState: state, initialCloudAuth: cloudAuthFixture() });

    const response = await send({ type: "getCloudConfigStatus" });

    expect(fetch).toHaveBeenCalledWith("https://linuxdo-cloud-save.lafish.workers.dev/api/apps/linuxdo-friends/slots/config", {
      method: "GET",
      headers: { Accept: "application/json", Authorization: "Bearer secret-token" }
    });
    expect(response).toMatchObject({
      ok: true,
      data: {
        binding: { bound: true, linuxDoId: "42" },
        status: { state: "remote_config", friendCount: 1 },
        message: "云端配置：1 位佬朋友。"
      }
    });
    expect(localStorage.dump()).toMatchObject({
      linuxdoFriendsState: { friends: { local: { username: "local" } } },
      [CLOUD_AUTH_STORAGE_KEY]: { token: "secret-token", linuxDoId: "42" }
    });
    expect(localStorage.dump()[CLOUD_AUTH_STORAGE_KEY]).not.toHaveProperty("lastStatus");
  });

  it("backs up migratable config to the cloud config slot", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchImpl);
    const state = {
      ...addFriendFromProfile(defaultAppState, { username: "Neo", refreshedAt: "2026-06-28T00:00:00.000Z" }),
      laoFindsStartedAt: "2026-06-29T00:00:00.000Z",
      requestStats: requestStatsFixture(7),
      settings: {
        ...defaultAppState.settings,
        timedActivityRefreshEnabled: true,
        timedActivityRefreshScopeMode: "all" as const,
        timedActivityRefreshIntervalMinutes: 240,
        requestStatsAutoSyncEnabled: true
      }
    };
    const { send } = await setupWorker({ initialState: state, initialCloudAuth: cloudAuthFixture() });

    const response = await send({ type: "backupCloudConfig" });

    expect(response).toMatchObject({
      ok: true,
      data: { status: { state: "remote_config", friendCount: 1 }, archiveState: "same", message: "已备份 1 位佬朋友到云端。" }
    });
    const [url, request] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://linuxdo-cloud-save.lafish.workers.dev/api/apps/linuxdo-friends/slots/config");
    expect(request.method).toBe("PUT");
    expect(request.headers).toEqual({ Accept: "application/json", Authorization: "Bearer secret-token", "Content-Type": "application/json" });
    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({ schemaVersion: 1, source: "linuxdo-friends", friends: { neo: { username: "neo" } }, requestStats: { total: 7 } });
    expect(body).not.toHaveProperty("currentAccount");
    expect(body).not.toHaveProperty("laoFindsStartedAt");
    expect(body.settings).toMatchObject({
      timedActivityRefreshScopeMode: "all",
      timedActivityRefreshIntervalMinutes: 240
    });
    expect(body.settings).not.toHaveProperty("timedActivityRefreshEnabled");
    expect(body.settings).not.toHaveProperty("requestStatsAutoSyncEnabled");
    expect(JSON.stringify(body)).not.toContain("secret-token");
    expect(JSON.stringify(response)).not.toContain("secret-token");
  });

  it("persists the current config digest after a successful cloud backup", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const state = {
      ...addFriendFromProfile(defaultAppState, { username: "Neo", refreshedAt: "2026-06-28T00:00:00.000Z" }),
      requestStats: requestStatsFixture(11)
    };
    const expectedDigest = await createConfigFingerprintForTest(state);
    const { send, localStorage } = await setupWorker({ initialState: state, initialCloudAuth: cloudAuthFixture() });

    const response = await send({ type: "backupCloudConfig" });

    expect(response).toMatchObject({
      ok: true,
      data: {
        archiveState: "same",
        binding: {
          bound: true,
          lastConfigDigest: expectedDigest,
          lastConfigSyncedAt: expect.any(String),
          lastRequestStatsSyncedAt: expect.any(String),
          lastRequestStatsTotal: 11
        }
      }
    });
    expect(localStorage.dump()[CLOUD_AUTH_STORAGE_KEY]).toMatchObject({
      token: "secret-token",
      lastConfigDigest: expectedDigest,
      lastConfigSyncedAt: expect.any(String),
      lastRequestStatsSyncedAt: expect.any(String),
      lastRequestStatsTotal: 11
    });
    expect(JSON.stringify(response)).not.toContain("secret-token");
    expect(JSON.stringify(response)).not.toContain("Neo");
    expect(JSON.stringify(response)).not.toContain("\"friends\":");
    expect(JSON.stringify(response)).not.toContain("\"neo\"");
  });

  it("redacts raw cloud request errors from backup responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("request failed Authorization: Bearer secret-token token=secret-token");
      })
    );
    const state = addFriendFromProfile(defaultAppState, { username: "Neo", refreshedAt: "2026-06-28T00:00:00.000Z" });
    const { send } = await setupWorker({ initialState: state, initialCloudAuth: cloudAuthFixture() });

    const response = await send({ type: "backupCloudConfig" });

    expect(response).toMatchObject({
      ok: false,
      error: "request failed Authorization: Bearer <redacted> token=<redacted>"
    });
    expect(JSON.stringify(response)).not.toContain("secret-token");
  });

  it("redacts raw exchange errors from cloud bind responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("failed https://example.com/auth/complete/browser_code?code=secret-code Authorization: Bearer secret-token verifier=verifier-1");
      })
    );
    const { send } = await setupWorker({ initialCloudVerifier: "verifier-1" });

    const response = await sendCloudExchangeCode(send, "secret-code");

    expect(response).toMatchObject({ ok: false, error: "failed [redacted-url] Authorization: Bearer <redacted> verifier=<redacted>" });
    expect(JSON.stringify(response)).not.toContain("secret-token");
    expect(JSON.stringify(response)).not.toContain("secret-code");
    expect(JSON.stringify(response)).not.toContain("verifier-1");
  });

  it("rejects cloud exchange messages outside the cloud-save complete page", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => cloudExchangeResponse()));
    const { send, localStorage } = await setupWorker({ initialCloudVerifier: "verifier-1" });

    const emptySenderResponse = await send({ type: "cloudSaveExchangeCode", code: "code-1" });
    const linuxDoSenderResponse = await send(
      { type: "cloudSaveExchangeCode", code: "code-1" },
      { url: "https://linux.do/latest" }
    );

    expect(emptySenderResponse).toMatchObject({ ok: false, error: "云存档登录完成消息来源不正确。" });
    expect(linuxDoSenderResponse).toMatchObject({ ok: false, error: "云存档登录完成消息来源不正确。" });
    expect(fetch).not.toHaveBeenCalled();
    expect(localStorage.dump()).not.toHaveProperty(CLOUD_AUTH_STORAGE_KEY);
    expect(localStorage.dump()).toMatchObject({ linuxdoFriendsCloudAuthVerifier: "verifier-1" });
  });

  it("restores cloud config through existing import semantics and preserves cloud binding", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        configSlotResponse({
          friends: { neo: minimalFriend("neo") },
          laoFindsStartedAt: "2026-06-30T00:00:00.000Z",
          settings: {
            refreshIntervalMinutes: 90,
            timedActivityRefreshEnabled: true,
            requestStatsAutoSyncEnabled: true
          },
          requestStats: requestStatsFixture(13)
        })
      )
    );
    const state = {
      ...addFriendFromProfile(defaultAppState, { username: "old", refreshedAt: "2026-06-28T00:00:00.000Z" }),
      laoFindsStartedAt: "2026-06-29T00:00:00.000Z",
      currentAccount: { username: "lafish", verifiedAt: "2026-06-28T00:00:00.000Z", source: "latest_header" as const }
    };
    const { send, localStorage, sessionStorage } = await setupWorker({
      initialState: state,
      initialCloudAuth: cloudAuthFixture(),
      initialSession: { [SITE_DATA_PROGRESS_STORAGE_KEY]: { taskId: "old" } }
    });

    const response = await send({ type: "restoreCloudConfig" });

    expect(response).toMatchObject({
      ok: true,
      data: {
        state: {
          friends: { neo: { username: "neo" } },
          laoFindsStartedAt: "2026-06-29T00:00:00.000Z",
          requestStats: { total: 13 },
          settings: { refreshIntervalMinutes: 90, timedActivityRefreshEnabled: false, requestStatsAutoSyncEnabled: false },
          lastSync: { message: "已导入 1 位佬朋友配置。" }
        },
        binding: { bound: true, linuxDoId: "42", lastRestoreAt: expect.any(String), lastRequestStatsSyncedAt: expect.any(String), lastRequestStatsTotal: 13 },
        archiveState: "same",
        status: { state: "remote_config", friendCount: 1 }
      }
    });
    expect(localStorage.dump()[CLOUD_AUTH_STORAGE_KEY]).toMatchObject({
      lastConfigDigest: await createConfigFingerprintForTest((response as { ok: true; data: { state: AppState } }).data.state),
      lastConfigSyncedAt: expect.any(String)
    });
    expect((localStorage.dump().linuxdoFriendsState as typeof defaultAppState).friends.old).toBeUndefined();
    expect((localStorage.dump().linuxdoFriendsState as typeof defaultAppState).currentAccount).toBeUndefined();
    expect(localStorage.dump()).toMatchObject({ [CLOUD_AUTH_STORAGE_KEY]: { token: "secret-token", linuxDoId: "42" } });
    expect(sessionStorage.dump()).not.toHaveProperty(SITE_DATA_PROGRESS_STORAGE_KEY);
    expect(JSON.stringify(response)).not.toContain("secret-token");
  });

  it("does not mutate AppState when remote cloud config is invalid", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ bad: true }), { status: 200 })));
    const state = addFriendFromProfile(defaultAppState, { username: "old", refreshedAt: "2026-06-28T00:00:00.000Z" });
    const { send, localStorage } = await setupWorker({ initialState: state, initialCloudAuth: cloudAuthFixture() });

    const response = await send({ type: "restoreCloudConfig" });

    expect(response).toMatchObject({ ok: false, error: "配置文件版本不支持。" });
    expect(localStorage.dump()).toMatchObject({ linuxdoFriendsState: { friends: { old: { username: "old" } } } });
  });

  it("reports a missing cloud config slot without treating the envelope as an unsupported version", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ found: false, app: "linuxdo-friends", slot: "config", data: null, version: 0, updatedAt: null }), { status: 200 }))
    );
    const state = addFriendFromProfile(defaultAppState, { username: "old", refreshedAt: "2026-06-28T00:00:00.000Z" });
    const { send, localStorage } = await setupWorker({ initialState: state, initialCloudAuth: cloudAuthFixture() });

    const response = await send({ type: "restoreCloudConfig" });

    expect(response).toMatchObject({ ok: false, error: "云端还没有配置备份。" });
    expect(localStorage.dump()).toMatchObject({ linuxdoFriendsState: { friends: { old: { username: "old" } } } });
  });

  it("reports unauthorized cloud status with a safe rebind message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unauthorized secret-token", { status: 401 })));
    const { send } = await setupWorker({ initialCloudAuth: cloudAuthFixture() });

    const response = await send({ type: "getCloudConfigStatus" });

    expect(response).toMatchObject({
      ok: true,
      data: { status: { state: "unauthorized", message: "云存档授权已失效，请重新绑定。" } }
    });
    expect(JSON.stringify(response)).not.toContain("secret-token");
  });

  it("reports malformed cloud status as invalid config", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not-json", { status: 200 })));
    const { send, localStorage } = await setupWorker({ initialCloudAuth: cloudAuthFixture() });

    const response = await send({ type: "getCloudConfigStatus" });

    expect(response).toMatchObject({
      ok: true,
      data: { status: { state: "invalid_config", message: "云端配置不是有效的 JSON 对象。" } }
    });
    expect(localStorage.dump()[CLOUD_AUTH_STORAGE_KEY]).not.toHaveProperty("lastStatus");
  });

  it("clears cloud binding separately from local config", async () => {
    const state = addFriendFromProfile(defaultAppState, { username: "old", refreshedAt: "2026-06-28T00:00:00.000Z" });
    const { send, localStorage, alarms } = await setupWorker({ initialState: state, initialCloudAuth: cloudAuthFixture() });
    await flushAsync();
    alarms.clear.mockClear();

    const response = await send({ type: "clearCloudBinding" });

    expect(response).toEqual({ ok: true, data: { binding: { bound: false }, message: "已断开云存档绑定。" } });
    expect(localStorage.dump()).not.toHaveProperty(CLOUD_AUTH_STORAGE_KEY);
    expect(localStorage.dump()).toMatchObject({ linuxdoFriendsState: { friends: { old: { username: "old" } } } });
    expect(alarms.clear).toHaveBeenCalledWith("linuxdoFriends.requestStatsAutoSync");
  });

  it("creates the request stats daily sync alarm when enabled and cloud-bound", async () => {
    const boundWorker = await setupWorker({ initialCloudAuth: cloudAuthFixture() });
    await flushAsync();
    boundWorker.alarms.create.mockClear();
    boundWorker.alarms.clear.mockClear();

    await boundWorker.send({ type: "updateSettings", settings: { requestStatsAutoSyncEnabled: true } });

    expect(boundWorker.alarms.create).toHaveBeenCalledWith("linuxdoFriends.requestStatsAutoSync", {
      delayInMinutes: 1,
      periodInMinutes: 24 * 60
    });
  });

  it("recreates the request stats daily sync alarm on service-worker startup", async () => {
    const state = {
      ...defaultAppState,
      settings: { ...defaultAppState.settings, requestStatsAutoSyncEnabled: true }
    };
    const worker = await setupWorker({ initialState: state, initialCloudAuth: cloudAuthFixture() });
    await flushAsync();
    worker.alarms.create.mockClear();

    await worker.triggerStartup();

    expect(worker.alarms.create).toHaveBeenCalledWith("linuxdoFriends.requestStatsAutoSync", {
      delayInMinutes: 1,
      periodInMinutes: 24 * 60
    });
  });

  it("clears the request stats daily sync alarm when enabled while unbound", async () => {
    const unboundWorker = await setupWorker();
    await flushAsync();
    unboundWorker.alarms.create.mockClear();
    unboundWorker.alarms.clear.mockClear();

    await unboundWorker.send({ type: "updateSettings", settings: { requestStatsAutoSyncEnabled: true } });

    expect(unboundWorker.alarms.create).not.toHaveBeenCalled();
    expect(unboundWorker.alarms.clear).toHaveBeenCalledWith("linuxdoFriends.requestStatsAutoSync");
  });

  it("clears the request stats daily sync alarm when disabled", async () => {
    const state = {
      ...defaultAppState,
      settings: { ...defaultAppState.settings, requestStatsAutoSyncEnabled: true }
    };
    const boundWorker = await setupWorker({ initialState: state, initialCloudAuth: cloudAuthFixture() });
    await flushAsync();

    boundWorker.alarms.create.mockClear();
    boundWorker.alarms.clear.mockClear();
    await boundWorker.send({ type: "updateSettings", settings: { requestStatsAutoSyncEnabled: false } });

    expect(boundWorker.alarms.clear).toHaveBeenCalledWith("linuxdoFriends.requestStatsAutoSync");
  });

  it("auto-syncs request stats to the cloud config slot at most once per local day without restoring", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchImpl);
    const state = {
      ...defaultAppState,
      requestStats: requestStatsFixture(17),
      settings: { ...defaultAppState.settings, requestStatsAutoSyncEnabled: true }
    };
    const { triggerAlarm, localStorage } = await setupWorker({ initialState: state, initialCloudAuth: cloudAuthFixture() });
    await flushAsync();
    fetchImpl.mockClear();

    await triggerAlarm("linuxdoFriends.requestStatsAutoSync");
    await waitForCloudAuth(localStorage, (auth) => typeof auth.lastRequestStatsSyncedAt === "string");
    await triggerAlarm("linuxdoFriends.requestStatsAutoSync");
    await flushAsync();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, request] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://linuxdo-cloud-save.lafish.workers.dev/api/apps/linuxdo-friends/slots/config");
    expect(request.method).toBe("PUT");
    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({ requestStats: { total: 17 } });
    expect(body.settings).not.toHaveProperty("requestStatsAutoSyncEnabled");
    expect(localStorage.dump()[CLOUD_AUTH_STORAGE_KEY]).toMatchObject({
      lastRequestStatsSyncedAt: expect.any(String),
      lastRequestStatsTotal: 17,
      lastConfigDigest: expect.any(String)
    });
    expect(String(request.body)).not.toContain("secret-token");
  });

  it("stores redacted request stats auto-sync failure metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("request failed Authorization: Bearer secret-token token=secret-token");
      })
    );
    const state = {
      ...defaultAppState,
      requestStats: requestStatsFixture(3),
      settings: { ...defaultAppState.settings, requestStatsAutoSyncEnabled: true }
    };
    const { triggerAlarm, localStorage } = await setupWorker({ initialState: state, initialCloudAuth: cloudAuthFixture() });
    await flushAsync();

    await triggerAlarm("linuxdoFriends.requestStatsAutoSync");
    const storedAuth = await waitForCloudAuth(localStorage, (auth) => Boolean(auth.lastRequestStatsAutoSyncError));

    expect(storedAuth).toMatchObject({
      lastRequestStatsAutoSyncError: {
        state: "network_error",
        message: "request failed Authorization: Bearer <redacted> token=<redacted>"
      }
    });
    expect(JSON.stringify(storedAuth.lastRequestStatsAutoSyncError)).not.toContain("secret-token");
  });

  it("adds a friend directly from a valid profile response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => profileResponse("Neil", "Neo")));
    const { send } = await setupWorker();

    const response = await send({ type: "addFriendByProfile", username: "Neil" });

    expect(response).toMatchObject({
      ok: true,
      data: {
        friends: { neil: { username: "neil" } },
        friendProfiles: { neil: { username: "neil", name: "Neo" } },
        lastSync: { ok: true, source: "direct_fetch" }
      }
    });
    expect(fetch).toHaveBeenCalledWith("https://linux.do/u/neil.json", expect.any(Object));
  });

  it("invalidates stale no-rule timed session state when profile add creates a timed target", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => profileResponse("Neil", "Neo")));
    const { send, sessionStorage } = await setupWorker({
      initialState: {
        ...defaultAppState,
        settings: {
          ...defaultAppState.settings,
          timedActivityRefreshEnabled: false,
          timedActivityRefreshScopeMode: "rules"
        },
        dredgeRules: [
          {
            schemaVersion: 2,
            id: "rule-neil",
            name: "Neil",
            enabled: true,
            mode: "allow",
            usernames: ["neil"],
            kinds: ["topic"],
            patterns: [],
            createdAt: "2026-06-28T00:00:00.000Z",
            updatedAt: "2026-06-28T00:00:00.000Z"
          }
        ]
      },
      initialSession: {
        [TIMED_ACTIVITY_SESSION_STORAGE_KEY]: {
          noTargetAt: "2026-06-30T00:00:00.000Z",
          noTargetMessage: "没有启用规则",
          nextDueAt: "2026-06-30T02:00:00.000Z",
          updatedAt: "2026-06-30T00:00:00.000Z"
        }
      }
    });

    const response = await send({ type: "addFriendByProfile", username: "Neil" });

    expect(response).toMatchObject({
      ok: true,
      data: { friends: { neil: { username: "neil" } }, lastSync: { ok: true, source: "direct_fetch" } }
    });
    const timedSession = sessionStorage.dump()[TIMED_ACTIVITY_SESSION_STORAGE_KEY] as Record<string, unknown>;
    expect(timedSession).not.toHaveProperty("noTargetAt");
    expect(timedSession).not.toHaveProperty("noTargetMessage");
  });

  it("adds a known user locally without fetching a profile", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { send } = await setupWorker();

    const response = await send({
      type: "addFriendFromKnownUser",
      user: { username: "Neil", name: "Neo", avatarUrl: "https://linux.do/avatar.png" }
    });

    expect(response).toMatchObject({
      ok: true,
      data: {
        friends: { neil: { username: "neil" } },
        friendProfiles: { neil: { username: "neil", name: "Neo", avatarUrl: "https://linux.do/avatar.png" } }
      }
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("looks up a profile without adding a friend", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => profileResponse("Neil", "Neo")));
    const { send } = await setupWorker();

    const response = await send({ type: "lookupFriendProfile", username: "Neil" });
    const state = await send({ type: "getState" });

    expect(response).toMatchObject({
      ok: true,
      data: { username: "neil", name: "Neo" }
    });
    expect(state).toMatchObject({
      ok: true,
      data: { friends: {}, friendProfiles: {} }
    });
    expect(fetch).toHaveBeenCalledWith("https://linux.do/u/neil.json", expect.any(Object));
  });

  it("reports a missing profile lookup without adding a friend", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("missing", { status: 404 })));
    const { send } = await setupWorker();

    const response = await send({ type: "lookupFriendProfile", username: "ghost" });
    const state = await send({ type: "getState" });

    expect(response).toMatchObject({
      ok: false,
      error: "用户不存在或公开资料不可用。",
      reason: "invalid_response"
    });
    expect(state).toMatchObject({
      ok: true,
      data: { friends: {}, friendProfiles: {} }
    });
  });

  it("does not add a friend when profile validation fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ user: { name: "No username" } }), { status: 200 })));
    const { send } = await setupWorker();

    const response = await send({ type: "addFriendByProfile", username: "ghost" });

    expect(response).toMatchObject({
      ok: true,
      data: { friends: {}, friendProfiles: {}, lastSync: { ok: false, reason: "invalid_response" } }
    });
  });

  it("falls back to an existing linux.do tab when direct profile add hits a challenge", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Enable JavaScript and cookies to continue", { status: 429 })));
    const { send, tabs } = await setupWorker({
      tabs: {
        query: vi.fn(async () => [{ id: 321, url: "https://linux.do/latest" } as chrome.tabs.Tab]),
        sendMessage: vi.fn(async () => ({
          ok: true,
          profile: {
            username: "neil",
            name: "Neo",
            refreshedAt: "2026-06-28T00:00:00.000Z"
          }
        }))
      }
    });

    const response = await send({ type: "addFriendByProfile", username: "Neil" });

    expect(response).toMatchObject({
      ok: true,
      data: {
        friends: { neil: { username: "neil" } },
        friendProfiles: { neil: { name: "Neo" } },
        lastSync: { ok: true, source: "existing_tab" }
      }
    });
    expect(tabs.sendMessage).toHaveBeenCalledWith(321, { type: "linuxdoFriends.extractProfile", username: "Neil" });
  });

  it("identifies the current account without syncing the following list", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Enable JavaScript and cookies to continue", { status: 429 })));
    const { send, tabs } = await setupWorker({
      tabs: {
        query: vi.fn(async () => [{ id: 123, url: "https://linux.do/t/topic/1" } as chrome.tabs.Tab]),
        sendMessage: vi.fn(async () => ({ ok: true, username: "lafish" }))
      }
    });

    const response = await send({ type: "identifyCurrentAccount" });

    expect(response).toMatchObject({
      ok: true,
      data: {
        currentAccount: { username: "lafish" },
        followedUsers: {},
        lastSync: { ok: true, source: "existing_tab", message: "已识别 @lafish。" }
      }
    });
    expect(tabs.sendMessage).toHaveBeenCalledWith(123, { type: "linuxdoFriends.extractCurrentAccount" });
    expect(tabs.sendMessage).not.toHaveBeenCalledWith(123, { type: "linuxdoFriends.extractFollowing" });
  });

  it("falls back to an existing linux.do tab when direct follow sync hits a challenge", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Enable JavaScript and cookies to continue", { status: 429 })));
    const { send, tabs } = await setupWorker({
      tabs: {
        query: vi.fn(async () => [{ id: 123, url: "https://linux.do/t/topic/1" } as chrome.tabs.Tab]),
        sendMessage: vi.fn(async () => ({
          ok: true,
          username: "lafish",
          users: [{ username: "Neil", name: "Neil", avatarUrl: "https://linux.do/avatar.png" }]
        }))
      }
    });

    const response = await send({ type: "syncFollowedUsers" });

    expect(response).toMatchObject({
      ok: true,
      data: {
        currentAccount: { username: "lafish" },
        followedUsers: { neil: { username: "neil", source: "sync" } },
        lastSync: { ok: true, source: "existing_tab" }
      }
    });
    expect(tabs.query).toHaveBeenCalledWith({ url: "https://linux.do/*" });
    expect(tabs.sendMessage).toHaveBeenCalledWith(123, { type: "linuxdoFriends.extractFollowing" });
  });

  it("caches known linux.do avatars through an existing tab", async () => {
    const state = addFriendFromProfile(defaultAppState, {
      username: "Neil",
      avatarUrl: "https://linux.do/user_avatar/linux.do/neil/48/1.png",
      refreshedAt: "2026-06-28T00:00:00.000Z"
    });
    const { send, tabs } = await setupWorker({
      initialState: state,
      tabs: {
        query: vi.fn(async () => [{ id: 123, url: "https://linux.do/t/topic/1" } as chrome.tabs.Tab]),
        sendMessage: vi.fn(async () => ({
          ok: true,
          username: "neil",
          sourceUrl: "https://linux.do/user_avatar/linux.do/neil/48/1.png",
          dataUrl: "data:image/png;base64,abc",
          contentType: "image/png",
          byteLength: 3
        }))
      }
    });

    const response = await send({ type: "cacheAvatars", usernames: ["Neil"] });

    expect(response).toMatchObject({
      ok: true,
      data: {
        avatarCache: {
          neil: {
            sourceUrl: "https://linux.do/user_avatar/linux.do/neil/48/1.png",
            dataUrl: "data:image/png;base64,abc"
          }
        }
      }
    });
    expect(tabs.sendMessage).toHaveBeenCalledWith(123, {
      type: "linuxdoFriends.extractAvatar",
      username: "neil",
      avatarUrl: "https://linux.do/user_avatar/linux.do/neil/48/1.png"
    });
  });

  it("records page script heartbeats and prefers the fresh ready tab for fallback requests", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Enable JavaScript and cookies to continue", { status: 429 })));
    const { send, tabs } = await setupWorker({
      tabs: {
        query: vi.fn(async () => [{ id: 321, url: "https://linux.do/latest" } as chrome.tabs.Tab]),
        sendMessage: vi.fn(async () => ({
          ok: true,
          profile: {
            username: "neil",
            name: "Neo",
            refreshedAt: "2026-06-28T00:00:00.000Z"
          }
        }))
      }
    });

    await send(
      { type: "linuxdoFriends.pageHeartbeat", url: "https://linux.do/latest", title: "latest", status: "ready", hasLauncher: true },
      { tab: { id: 777, windowId: 9, url: "https://linux.do/latest" } as chrome.tabs.Tab }
    );
    const status = await send({ type: "getPageScriptStatus" });
    const response = await send({ type: "addFriendByProfile", username: "Neil" });

    expect(status).toMatchObject({ ok: true, data: { status: "connected", connectedCount: 1, selectedTabId: 777 } });
    expect(response).toMatchObject({ ok: true, data: { lastSync: { ok: true, source: "existing_tab" } } });
    expect(tabs.sendMessage).toHaveBeenCalledWith(777, { type: "linuxdoFriends.extractProfile", username: "Neil" });
  });

  it("repairs an existing linux.do tab by activating and reloading it", async () => {
    const { send, tabs, windows } = await setupWorker({
      tabs: {
        query: vi.fn(async () => [{ id: 123, windowId: 7, url: "https://linux.do/latest" } as chrome.tabs.Tab]),
        sendMessage: vi.fn(),
        get: vi.fn(async () => ({ id: 123, windowId: 7, url: "https://linux.do/latest" }) as chrome.tabs.Tab),
        update: vi.fn(async () => ({ id: 123 } as chrome.tabs.Tab)),
        reload: vi.fn(async () => undefined),
        create: vi.fn()
      }
    });

    const response = await send({ type: "repairLinuxDoPageScript", tabId: 123 });

    expect(response).toMatchObject({ ok: true, data: { tabId: 123, openedNewTab: false } });
    expect(tabs.update).toHaveBeenCalledWith(123, { active: true });
    expect(tabs.reload).toHaveBeenCalledWith(123);
    expect(windows.update).toHaveBeenCalledWith(7, { focused: true });
  });

  it("opens linux.do home from an explicit repair action when no page exists", async () => {
    const { send, tabs } = await setupWorker({
      tabs: {
        query: vi.fn(async () => []),
        sendMessage: vi.fn(),
        get: vi.fn(),
        update: vi.fn(),
        reload: vi.fn(),
        create: vi.fn(async () => ({ id: 999, url: "https://linux.do/" }) as chrome.tabs.Tab)
      }
    });

    const response = await send({ type: "openLinuxDoHome" });

    expect(response).toMatchObject({ ok: true, data: { tabId: 999, openedNewTab: true } });
    expect(tabs.create).toHaveBeenCalledWith({ url: "https://linux.do/", active: true });
  });

  it("falls back to an existing linux.do tab when direct profile refresh hits a challenge", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Enable JavaScript and cookies to continue", { status: 429 })));
    const state = addFriendFromProfile(defaultAppState, { username: "neil", refreshedAt: "2026-06-27T00:00:00.000Z" });
    const { send, tabs } = await setupWorker({
      initialState: state,
      tabs: {
        query: vi.fn(async () => [{ id: 456, url: "https://linux.do/latest" } as chrome.tabs.Tab]),
        sendMessage: vi.fn(async () => ({
          ok: true,
          profile: {
            username: "neil",
            name: "Neo",
            lastSeenAt: "2026-06-28T00:00:00.000Z",
            refreshedAt: "2026-06-28T00:01:00.000Z"
          }
        }))
      }
    });

    const response = await send({ type: "refreshFriendProfiles" });

    expect(response).toMatchObject({
      ok: true,
      data: {
        friendProfiles: { neil: { name: "Neo", lastSeenAt: "2026-06-28T00:00:00.000Z" } },
        lastSync: { ok: true, source: "existing_tab" }
      }
    });
    expect(tabs.sendMessage).toHaveBeenCalledWith(456, { type: "linuxdoFriends.extractProfile", username: "neil" });
  });

  it("exposes profile refresh progress with a profiles task type", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => profileResponse("Neil", "Neo")));
    const state = addFriendFromProfile(defaultAppState, { username: "neil", refreshedAt: "2026-06-27T00:00:00.000Z" });
    const { send, runtime, sessionStorage } = await setupWorker({ initialState: state });

    const response = await send({ type: "refreshFriendProfiles" });
    const progressResponse = await send({ type: "getSiteDataProgress" });

    expect(response).toMatchObject({
      ok: true,
      data: {
        friendProfiles: { neil: { name: "Neo" } },
        lastSync: { ok: true, source: "direct_fetch" }
      }
    });
    expect(runtime.sendMessage).toHaveBeenCalledWith({
      type: "linuxdoFriends.siteDataProgress",
      progress: expect.objectContaining({ taskType: "profiles", status: "running", completed: 1, total: 1, currentLabel: "@neil" })
    });
    expect(sessionStorage.dump()).toMatchObject({
      [SITE_DATA_PROGRESS_STORAGE_KEY]: expect.objectContaining({ taskType: "profiles", status: "success", completed: 1, total: 1 })
    });
    expect(progressResponse).toMatchObject({
      ok: true,
      data: { taskType: "profiles", status: "success", completed: 1, total: 1, usernames: ["neil"] }
    });
  });

  it("falls back to an existing linux.do tab when direct activity refresh hits a challenge", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Enable JavaScript and cookies to continue", { status: 429 })));
    const state: AppState = {
      ...addFriendFromProfile(defaultAppState, { username: "misaka7369", refreshedAt: "2026-06-28T00:00:00.000Z" }),
      laoFindsStartedAt: "2026-06-26T00:00:00.000Z",
      dredgeRules: [
        {
          schemaVersion: 2,
          id: "rule-activity",
          name: "动态",
          enabled: true,
          mode: "allow",
          usernames: ["misaka7369"],
          kinds: ["reply"],
          patterns: ["动态"],
          createdAt: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:00.000Z"
        }
      ]
    };
    const { send, tabs } = await setupWorker({
      initialState: state,
      tabs: {
        query: vi.fn(async () => [{ id: 456, url: "https://linux.do/latest" } as chrome.tabs.Tab]),
        sendMessage: vi
          .fn()
          .mockResolvedValueOnce({
            ok: true,
            activity: {
              username: "misaka7369",
              refreshedAt: "2026-06-27T00:00:00.000Z",
              coarseStatus: "recently_active",
              lastPostAt: "2026-06-27T00:00:00.000Z",
              items: [
                {
                  id: "42",
                  username: "misaka7369",
                  kind: "reply",
                  source: "user_actions",
                  title: "动态",
                  occurredAt: "2026-06-27T00:00:00.000Z"
                }
              ]
            }
          })
          .mockResolvedValueOnce({
            ok: true,
            activity: {
              username: "misaka7369",
              refreshedAt: "2026-06-27T00:00:00.000Z",
              items: []
            }
          })
          .mockResolvedValueOnce({
            ok: true,
            activity: {
              username: "misaka7369",
              refreshedAt: "2026-06-27T00:00:00.000Z",
              items: []
            }
          })
          .mockResolvedValueOnce({
            ok: true,
            activity: {
              username: "misaka7369",
              refreshedAt: "2026-06-27T00:00:00.000Z",
              items: []
            }
          })
      }
    });

    const response = await send({ type: "refreshFriendActivity" });

    expect(response).toMatchObject({
      ok: true,
      data: {
        activity: { misaka7369: { items: [{ id: "42", title: "动态" }] } },
        laoFindsItems: { "42": { matchedRuleIds: ["rule-activity"] } },
        lastSync: { ok: true, source: "existing_tab" }
      }
    });
    expect(tabs.sendMessage).toHaveBeenCalledTimes(4);
    expect(tabs.sendMessage).toHaveBeenCalledWith(456, {
      type: "linuxdoFriends.extractActivity",
      username: "misaka7369",
      step: { kind: "topic", path: "/user_actions.json?offset=0&username=misaka7369&filter=4" }
    });
    expect(tabs.sendMessage).toHaveBeenCalledWith(456, {
      type: "linuxdoFriends.extractActivity",
      username: "misaka7369",
      step: { kind: "reply", path: "/user_actions.json?offset=0&username=misaka7369&filter=5" }
    });
    expect(tabs.sendMessage).toHaveBeenCalledWith(456, {
      type: "linuxdoFriends.extractActivity",
      username: "misaka7369",
      step: { kind: "boost", path: "/discourse-boosts/users/misaka7369/boosts-given.json" }
    });
    expect(tabs.sendMessage).toHaveBeenCalledWith(456, {
      type: "linuxdoFriends.extractActivity",
      username: "misaka7369",
      step: { kind: "reaction", path: "/discourse-reactions/posts/reactions.json?username=misaka7369" }
    });
  });

  it("does not commit earlier friends when existing-tab activity refresh later fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Enable JavaScript and cookies to continue", { status: 429 })));
    const withFirstFriend = addFriendFromProfile(defaultAppState, { username: "neil", refreshedAt: "2026-06-28T00:00:00.000Z" });
    const state = {
      ...addFriendFromProfile(withFirstFriend, { username: "ada", refreshedAt: "2026-06-28T00:00:00.000Z" }),
      activity: {
        neil: {
          username: "neil",
          refreshedAt: "2026-06-26T00:00:00.000Z",
          items: [{ id: "old", username: "neil", kind: "reply" as const, title: "old", isNew: true }]
        }
      },
      activityRefreshLedger: {
        "neil:reply": {
          scopeKey: "neil:reply",
          username: "neil",
          kind: "reply" as const,
          refreshedAt: "2026-06-26T00:00:00.000Z",
          source: "direct_fetch" as const,
          itemCount: 1
        }
      },
      activityWatermarks: {
        "neil:reply": {
          scopeKey: "neil:reply",
          username: "neil",
          kind: "reply" as const,
          latestOccurredAt: "2026-06-26T00:00:00.000Z",
          updatedAt: "2026-06-26T00:00:00.000Z",
          source: "direct_fetch" as const
        }
      }
    };
    const { send } = await setupWorker({
      initialState: state,
      tabs: {
        query: vi.fn(async () => [{ id: 456, url: "https://linux.do/latest" } as chrome.tabs.Tab]),
        sendMessage: vi
          .fn()
          .mockResolvedValueOnce({
            ok: true,
            activity: { username: "neil", refreshedAt: "2026-06-28T00:00:00.000Z", items: [] }
          })
          .mockResolvedValueOnce({
            ok: true,
            activity: { username: "neil", refreshedAt: "2026-06-28T00:00:00.000Z", items: [] }
          })
          .mockResolvedValueOnce({
            ok: true,
            activity: { username: "neil", refreshedAt: "2026-06-28T00:00:00.000Z", items: [] }
          })
          .mockResolvedValueOnce({ ok: false, reason: "challenge", error: "遇到浏览器验证页面，已停止请求。" })
      }
    });

    const response = await send({ type: "refreshFriendActivity" });

    expect(response).toMatchObject({
      ok: true,
      data: {
        activity: state.activity,
        activityRefreshLedger: state.activityRefreshLedger,
        activityWatermarks: state.activityWatermarks,
        lastSync: { ok: false, source: "existing_tab", reason: "challenge" }
      }
    });
  });

  it("passes activity scope to direct refresh and exposes endpoint progress", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ boosts: [] }), { status: 200 })));
    const state = addFriendFromProfile(defaultAppState, { username: "misaka7369", refreshedAt: "2026-06-28T00:00:00.000Z" });
    const { send, runtime, sessionStorage } = await setupWorker({ initialState: state });

    const response = await send({ type: "refreshFriendActivity", scope: { kind: "boost", usernames: ["Misaka7369"] } });
    const progressResponse = await send({ type: "getSiteDataProgress" });

    expect(response).toMatchObject({
      ok: true,
      data: {
        activityRefreshLedger: { "misaka7369:boost": { kind: "boost", source: "direct_fetch" } },
        requestStats: { total: 1, byFamily: { activity: 1 } },
        lastSync: { ok: true, source: "direct_fetch" }
      }
    });
    expect(fetch).toHaveBeenCalledWith("https://linux.do/discourse-boosts/users/misaka7369/boosts-given.json", expect.any(Object));
    expect(runtime.sendMessage).toHaveBeenCalledWith({
      type: "linuxdoFriends.siteDataProgress",
      progress: expect.objectContaining({ taskType: "activity", status: "running", completed: 1, total: 1 })
    });
    expect(sessionStorage.dump()).toMatchObject({
      [SITE_DATA_PROGRESS_STORAGE_KEY]: expect.objectContaining({ taskType: "activity", status: "success", completed: 1, total: 1 })
    });
    expect(progressResponse).toMatchObject({
      ok: true,
      data: { taskType: "activity", status: "success", completed: 1, total: 1, scope: { kind: "boost", usernames: ["misaka7369"] } }
    });
  });

  it("records existing-tab avatar requests reported by the content script", async () => {
    const attemptedAt = new Date(2026, 6, 1, 23, 59).toISOString();
    const state = addFriendFromProfile(defaultAppState, {
      username: "neo",
      avatarUrl: "https://linux.do/user_avatar/linux.do/neo/48/1.png",
      refreshedAt: "2026-06-28T00:00:00.000Z"
    });
    const { send } = await setupWorker({
      initialState: state,
      tabs: {
        query: vi.fn(async () => [{ id: 456, url: "https://linux.do/latest" } as chrome.tabs.Tab]),
        sendMessage: vi.fn(async () => ({
          ok: true,
          username: "neo",
          sourceUrl: "https://linux.do/user_avatar/linux.do/neo/48/1.png",
          dataUrl: "data:image/png;base64,abc",
          contentType: "image/png",
          byteLength: 3,
          requestCount: 1,
          requestAttemptedAts: [attemptedAt]
        }))
      }
    });

    const response = await send({ type: "cacheAvatars", usernames: ["neo"] });

    expect(response).toMatchObject({
      ok: true,
      data: {
        requestStats: {
          total: 1,
          byFamily: { avatar: 1 },
          days: {
            "2026-07-01": {
              total: 1,
              hours: { "23": 1 },
              byFamily: { avatar: 1 }
            }
          }
        },
        avatarCache: { neo: { byteLength: 3 } }
      }
    });
  });

  it("completes activity progress with zero total when every selected friend disallows dynamic activity", async () => {
    const state = updateFriend(
      addFriendFromProfile(defaultAppState, { username: "misaka7369", refreshedAt: "2026-06-28T00:00:00.000Z" }),
      "misaka7369",
      { activityKinds: [] }
    );
    vi.stubGlobal("fetch", vi.fn());
    const { send, sessionStorage } = await setupWorker({ initialState: state });

    const response = await send({ type: "refreshFriendActivity", scope: { kind: "all", usernames: ["Misaka7369"] } });
    const progressResponse = await send({ type: "getSiteDataProgress" });

    expect(response).toMatchObject({
      ok: true,
      data: {
        lastSync: { ok: true, source: "direct_fetch", message: "当前视奸范围没有可刷新的动态。" }
      }
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(sessionStorage.dump()).toMatchObject({
      [SITE_DATA_PROGRESS_STORAGE_KEY]: expect.objectContaining({ taskType: "activity", status: "success", completed: 0, total: 0 })
    });
    expect(progressResponse).toMatchObject({
      ok: true,
      data: { taskType: "activity", status: "success", completed: 0, total: 0 }
    });
  });

  it("does not start duplicate site-data requests while profile refresh is pending", async () => {
    const { fetchImpl, release } = createPendingChallengeFetch();
    vi.stubGlobal("fetch", fetchImpl);
    const state = addFriendFromProfile(defaultAppState, { username: "misaka7369", refreshedAt: "2026-06-28T00:00:00.000Z" });
    const { send } = await setupWorker({ initialState: state });

    const first = send({ type: "refreshFriendProfiles" });
    await Promise.resolve();
    const second = await send({ type: "refreshFriendActivity" });
    release();
    await first;

    expect(second).toMatchObject({
      ok: true,
      data: { lastSync: { ok: false, source: "manual", message: "已有刷新正在进行。" } }
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("releases a stale site-data request slot before starting a later refresh", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T00:00:00.000Z"));
    let releaseFirstFetch: (response: Response) => void = () => undefined;
    const firstFetch = new Promise<Response>((resolve) => {
      releaseFirstFetch = resolve;
    });
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(firstFetch).mockResolvedValue(profileResponse("Misaka7369", "Misaka")));
    const state = addFriendFromProfile(defaultAppState, { username: "misaka7369", refreshedAt: "2026-06-28T00:00:00.000Z" });
    const { send, sessionStorage } = await setupWorker({ initialState: state });

    const staleRefresh = send({ type: "refreshFriendProfiles" });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(10 * 60_000 + 1);
    const laterRefresh = await send({ type: "refreshFriendProfiles" });
    releaseFirstFetch(profileResponse("Misaka7369", "Old"));
    await staleRefresh;

    expect(laterRefresh).toMatchObject({
      ok: true,
      data: {
        friendProfiles: { misaka7369: { name: "Misaka" } },
        lastSync: { ok: true, source: "direct_fetch" }
      }
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sessionStorage.dump()).toMatchObject({
      [SITE_DATA_PROGRESS_STORAGE_KEY]: expect.objectContaining({ status: "success", currentLabel: "@misaka7369" })
    });
    vi.useRealTimers();
  });

  it("does not start manual add while another site-data request is pending", async () => {
    const { fetchImpl, release } = createPendingChallengeFetch();
    vi.stubGlobal("fetch", fetchImpl);
    const state = addFriendFromProfile(defaultAppState, { username: "misaka7369", refreshedAt: "2026-06-28T00:00:00.000Z" });
    const { send } = await setupWorker({ initialState: state });

    const first = send({ type: "refreshFriendActivity" });
    await Promise.resolve();
    const second = await send({ type: "addFriendByProfile", username: "neil" });
    release();
    await first;

    expect(second).toMatchObject({
      ok: true,
      data: {
        lastSync: { ok: false, source: "manual", message: "已有刷新正在进行。" }
      }
    });
    expect((second as { ok: true; data: typeof defaultAppState }).data.friends.neil).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not let an older refresh overwrite a later config import", async () => {
    let resolveFetch: (response: Response) => void = () => undefined;
    const pendingFetch = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.stubGlobal("fetch", vi.fn(() => pendingFetch));
    const oldState = addFriendFromProfile(defaultAppState, { username: "Old", refreshedAt: "2026-06-28T00:00:00.000Z" });
    const importJson = JSON.stringify({
      schemaVersion: 1,
      source: "linuxdo-friends",
      exportedAt: "2026-06-28T00:00:00.000Z",
      friends: {
        neo: {
          username: "neo",
          note: "",
          groups: [],
          pinned: false,
          upgradedAt: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:00.000Z"
        }
      },
      settings: { refreshIntervalMinutes: 90 }
    });
    const { send, localStorage, sessionStorage } = await setupWorker({ initialState: oldState });

    const refresh = send({ type: "refreshFriendProfiles" });
    await Promise.resolve();
    const imported = await send({ type: "importConfig", json: importJson });
    resolveFetch(profileResponse("Old", "Old"));
    const refreshResult = await refresh;

    expect(imported).toMatchObject({ ok: true, data: { friends: { neo: { username: "neo" } } } });
    expect(refreshResult).toMatchObject({
      ok: true,
      data: {
        friends: { neo: { username: "neo" } },
        lastSync: { ok: false, message: "已导入配置，较早的刷新结果已丢弃。" }
      }
    });
    expect(localStorage.dump()).toMatchObject({
      linuxdoFriendsState: {
        friends: { neo: { username: "neo" } },
        settings: { refreshIntervalMinutes: 90 }
      }
    });
    expect((localStorage.dump().linuxdoFriendsState as typeof defaultAppState).friends.old).toBeUndefined();
    expect(sessionStorage.dump()).not.toHaveProperty(SITE_DATA_PROGRESS_STORAGE_KEY);
  });

  it("does not let older profile lookup stats overwrite a later config import", async () => {
    let resolveFetch: (response: Response) => void = () => undefined;
    const pendingFetch = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.stubGlobal("fetch", vi.fn(() => pendingFetch));
    const oldState = addFriendFromProfile(defaultAppState, { username: "Old", refreshedAt: "2026-06-28T00:00:00.000Z" });
    const importJson = JSON.stringify({
      schemaVersion: 1,
      source: "linuxdo-friends",
      exportedAt: "2026-06-28T00:00:00.000Z",
      friends: {
        neo: {
          username: "neo",
          note: "",
          groups: [],
          pinned: false,
          upgradedAt: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:00.000Z"
        }
      },
      settings: { refreshIntervalMinutes: 90 }
    });
    const { send, localStorage } = await setupWorker({ initialState: oldState });

    const lookup = send({ type: "lookupFriendProfile", username: "old" });
    await Promise.resolve();
    const imported = await send({ type: "importConfig", json: importJson });
    resolveFetch(profileResponse("Old", "Old"));
    const lookupResult = await lookup;

    expect(imported).toMatchObject({ ok: true, data: { friends: { neo: { username: "neo" } } } });
    expect(lookupResult).toMatchObject({ ok: true, data: { username: "old", name: "Old" } });
    expect(localStorage.dump()).toMatchObject({
      linuxdoFriendsState: {
        friends: { neo: { username: "neo" } },
        settings: { refreshIntervalMinutes: 90 },
        requestStats: { total: 0 }
      }
    });
    expect((localStorage.dump().linuxdoFriendsState as typeof defaultAppState).friends.old).toBeUndefined();
  });

  it("clears live site-data progress and releases the refresh slot after config import", async () => {
    let resolveFirstFetch: (response: Response) => void = () => undefined;
    const firstFetch = new Promise<Response>((resolve) => {
      resolveFirstFetch = resolve;
    });
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(firstFetch).mockResolvedValue(profileResponse("Neo", "Neo")));
    const oldState = addFriendFromProfile(defaultAppState, { username: "Old", refreshedAt: "2026-06-28T00:00:00.000Z" });
    const importJson = JSON.stringify({
      schemaVersion: 1,
      source: "linuxdo-friends",
      exportedAt: "2026-06-28T00:00:00.000Z",
      friends: {
        neo: {
          username: "neo",
          note: "",
          groups: [],
          pinned: false,
          upgradedAt: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:00.000Z"
        }
      },
      settings: { refreshIntervalMinutes: 90 }
    });
    const { send } = await setupWorker({ initialState: oldState });

    const staleRefresh = send({ type: "refreshFriendProfiles" });
    await Promise.resolve();
    await send({ type: "importConfig", json: importJson });
    const progressAfterImport = await send({ type: "getSiteDataProgress" });
    const newRefresh = await send({ type: "refreshFriendProfiles" });
    resolveFirstFetch(profileResponse("Old", "Old"));
    const staleResult = await staleRefresh;

    expect(progressAfterImport).toEqual({ ok: true, data: null });
    expect(newRefresh).toMatchObject({
      ok: true,
      data: {
        friendProfiles: { neo: { username: "neo", name: "Neo" } },
        lastSync: { ok: true, source: "direct_fetch" }
      }
    });
    expect(staleResult).toMatchObject({
      ok: true,
      data: {
        friends: { neo: { username: "neo" } },
        lastSync: { ok: false, message: "已导入配置，较早的刷新结果已丢弃。" }
      }
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not let an older local settings update overwrite a later config import", async () => {
    const oldState = addFriendFromProfile(defaultAppState, { username: "Old", refreshedAt: "2026-06-28T00:00:00.000Z" });
    const importJson = JSON.stringify({
      schemaVersion: 1,
      source: "linuxdo-friends",
      exportedAt: "2026-06-28T00:00:00.000Z",
      friends: {
        neo: {
          username: "neo",
          note: "",
          groups: [],
          pinned: false,
          upgradedAt: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:00.000Z"
        }
      },
      settings: { refreshIntervalMinutes: 90 }
    });
    const { send, localStorage } = await setupWorker({ initialState: oldState });

    const settingsUpdate = send({ type: "updateSettings", settings: { refreshIntervalMinutes: 60 } });
    const imported = await send({ type: "importConfig", json: importJson });
    const staleUpdate = await settingsUpdate;

    expect(imported).toMatchObject({ ok: true, data: { friends: { neo: { username: "neo" } }, settings: { refreshIntervalMinutes: 90 } } });
    expect(staleUpdate).toMatchObject({
      ok: true,
      data: {
        friends: { neo: { username: "neo" } },
        settings: { refreshIntervalMinutes: 90 },
        lastSync: { ok: false, message: "已导入配置，较早的本地修改结果已丢弃。" }
      }
    });
    expect(localStorage.dump()).toMatchObject({
      linuxdoFriendsState: {
        friends: { neo: { username: "neo" } },
        settings: { refreshIntervalMinutes: 90 }
      }
    });
  });

  it("preserves already-refreshed profiles when existing-tab fallback later fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Enable JavaScript and cookies to continue", { status: 429 })));
    const state = addFriendFromProfile(
      addFriendFromProfile(defaultAppState, { username: "neil", refreshedAt: "2026-06-27T00:00:00.000Z" }),
      { username: "ada", refreshedAt: "2026-06-27T00:00:00.000Z" }
    );
    const { send } = await setupWorker({
      initialState: state,
      tabs: {
        query: vi.fn(async () => [{ id: 789, url: "https://linux.do/latest" } as chrome.tabs.Tab]),
        sendMessage: vi
          .fn()
          .mockResolvedValueOnce({
            ok: true,
            profile: { username: "neil", name: "Neo", refreshedAt: "2026-06-28T00:00:00.000Z" }
          })
          .mockResolvedValueOnce({ ok: false, reason: "challenge", error: "遇到浏览器验证页面，已停止请求。" })
      }
    });

    const response = await send({ type: "refreshFriendProfiles" });

    expect(response).toMatchObject({
      ok: true,
      data: {
        friendProfiles: { neil: { name: "Neo" } },
        lastSync: { ok: false, source: "existing_tab", reason: "challenge" }
      }
    });
  });

  it("clears cached data while preserving friends, settings, and current account", async () => {
    const state = {
      ...addFriendFromProfile(defaultAppState, { username: "Neil", name: "Neo", refreshedAt: "2026-06-28T00:00:00.000Z" }),
      followedUsers: {
        neil: {
          username: "neil",
          source: "sync",
          followedAt: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:00.000Z"
        }
      },
      activity: {
        neil: { username: "neil", refreshedAt: "2026-06-28T00:00:00.000Z", items: [] }
      },
      activityRefreshLedger: {
        "neil:topic": {
          scopeKey: "topic:neil",
          username: "neil",
          kind: "topic",
          refreshedAt: "2026-06-28T00:00:00.000Z",
          source: "direct_fetch",
          itemCount: 1
        }
      },
      activityWatermarks: {
        "neil:topic": {
          scopeKey: "topic:neil",
          username: "neil",
          kind: "topic",
          latestOccurredAt: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:00.000Z",
          source: "direct_fetch"
        }
      },
      activityFeedWaterlineAt: "2026-06-28T00:00:00.000Z",
      avatarCache: {
        neil: {
          username: "neil",
          sourceUrl: "https://linux.do/avatar.png",
          dataUrl: "data:image/png;base64,abc",
          contentType: "image/png",
          byteLength: 3,
          updatedAt: "2026-06-28T00:00:00.000Z"
        }
      },
      currentAccount: { username: "lafish", verifiedAt: "2026-06-28T00:00:00.000Z", source: "latest_header" as const },
      settings: { ...defaultAppState.settings, refreshIntervalMinutes: 60, openActivityLinksInPage: true }
    };
    const { send, sessionStorage } = await setupWorker({
      initialState: state,
      initialSession: { [SITE_DATA_PROGRESS_STORAGE_KEY]: { taskId: "old" } }
    });

    const response = await send({ type: "clearCache" });

    expect(response).toMatchObject({
      ok: true,
      data: {
        friends: { neil: { username: "neil" } },
        followedUsers: {},
        friendProfiles: {},
        activity: {},
        activityRefreshLedger: {},
        activityWatermarks: {},
        avatarCache: {},
        currentAccount: { username: "lafish" },
        settings: { refreshIntervalMinutes: 60 },
        lastSync: { ok: true, message: "已清理缓存，佬朋友和设置已保留。" }
      }
    });
    expect(sessionStorage.dump()).not.toHaveProperty(SITE_DATA_PROGRESS_STORAGE_KEY);
  });

  it("exports only friends and settings config", async () => {
    const state = {
      ...addFriendFromProfile(defaultAppState, { username: "Neil", name: "Neo", refreshedAt: "2026-06-28T00:00:00.000Z" }),
      followedUsers: {
        neil: {
          username: "neil",
          source: "sync",
          followedAt: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:00.000Z"
        }
      },
      activity: { neil: { username: "neil", refreshedAt: "2026-06-28T00:00:00.000Z", items: [] } },
      avatarCache: {
        neil: {
          username: "neil",
          sourceUrl: "https://linux.do/avatar.png",
          dataUrl: "data:image/png;base64,abc",
          contentType: "image/png",
          byteLength: 3,
          updatedAt: "2026-06-28T00:00:00.000Z"
        }
      },
      currentAccount: { username: "lafish", verifiedAt: "2026-06-28T00:00:00.000Z", source: "latest_header" as const },
      settings: { ...defaultAppState.settings, refreshIntervalMinutes: 60, openActivityLinksInPage: true }
    };
    const { send } = await setupWorker({ initialState: state });

    const response = await send({ type: "exportConfig" });

    expect(response).toMatchObject({
      ok: true,
      data: {
        schemaVersion: 1,
        source: "linuxdo-friends",
        friends: { neil: { username: "neil" } },
        settings: {
          refreshIntervalMinutes: 60,
          openActivityLinksInPage: true
        }
      }
    });
    const exported = (response as { ok: true; data: Record<string, unknown> }).data;
    expect(exported).not.toHaveProperty("currentAccount");
    expect(exported).not.toHaveProperty("followedUsers");
    expect(exported).not.toHaveProperty("avatarCache");
    expect(exported).not.toHaveProperty("activity");
    expect((exported.settings as Record<string, unknown>)).not.toHaveProperty("timedActivityRefreshEnabled");
    expect((exported.settings as Record<string, unknown>)).not.toHaveProperty("requestStatsAutoSyncEnabled");
  });

  it("imports config with overwrite semantics and clears non-migratable state", async () => {
    const state = {
      ...addFriendFromProfile(defaultAppState, { username: "Old", refreshedAt: "2026-06-28T00:00:00.000Z" }),
      followedUsers: {
        old: {
          username: "old",
          source: "sync",
          followedAt: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:00.000Z"
        }
      },
      activity: { old: { username: "old", refreshedAt: "2026-06-28T00:00:00.000Z", items: [] } },
      laoFindsStartedAt: "2026-06-27T00:00:00.000Z",
      currentAccount: { username: "lafish", verifiedAt: "2026-06-28T00:00:00.000Z", source: "latest_header" as const },
      settings: {
        ...defaultAppState.settings,
        timedActivityRefreshEnabled: true,
        requestStatsAutoSyncEnabled: true
      }
    };
    const json = JSON.stringify({
      schemaVersion: 1,
      source: "linuxdo-friends",
      exportedAt: "2026-06-28T00:00:00.000Z",
      friends: {
        neo: {
          username: "neo",
          note: "NAS",
          groups: ["ops"],
          pinned: true,
          upgradedAt: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:00.000Z"
        }
      },
      laoFindsStartedAt: "2026-06-28T00:00:00.000Z",
      settings: { refreshIntervalMinutes: 90, timedActivityRefreshEnabled: true, requestStatsAutoSyncEnabled: true }
    });
    const { send, localStorage, sessionStorage } = await setupWorker({
      initialState: state,
      initialUpdateCheck: {
        installedVersion: "1.0.0",
        latestReleaseUrl: "https://github.com/LeUKi/linuxdo-friends/releases/latest",
        status: "up-to-date",
        latestVersion: "1.0.0",
        checkedAt: "2026-06-28T00:00:00.000Z",
        source: "github_release"
      },
      initialSession: {
        [SITE_DATA_PROGRESS_STORAGE_KEY]: { taskId: "old" },
        [PAGE_SCRIPT_STATUS_STORAGE_KEY]: { status: "connected" },
        "linuxdoFriendsUiScene.tab": "feed"
      }
    });

    const response = await send({ type: "importConfig", json });

    expect(response).toMatchObject({
      ok: true,
      data: {
        friends: { neo: { username: "neo", note: "NAS", groups: ["ops"], pinned: true } },
        settings: {
          refreshIntervalMinutes: 90,
          allowAutoRefresh: false,
          allowInactiveTabFallback: false,
          timedActivityRefreshEnabled: false,
          requestStatsAutoSyncEnabled: false
        },
        laoFindsStartedAt: "2026-06-27T00:00:00.000Z",
        followedUsers: {},
        friendProfiles: {},
        activity: {},
        avatarCache: {},
        lastSync: { ok: true, message: "已导入 1 位佬朋友配置。" }
      }
    });
    expect((response as { ok: true; data: typeof defaultAppState }).data.currentAccount).toBeUndefined();
    expect((localStorage.dump().linuxdoFriendsState as typeof defaultAppState).friends.old).toBeUndefined();
    expect(localStorage.dump()).not.toHaveProperty("linuxdoFriendsUpdateCheck");
    expect(sessionStorage.dump()).not.toHaveProperty(SITE_DATA_PROGRESS_STORAGE_KEY);
    expect(sessionStorage.dump()).not.toHaveProperty(PAGE_SCRIPT_STATUS_STORAGE_KEY);
    expect(sessionStorage.dump()).not.toHaveProperty("linuxdoFriendsUiScene.tab");
  });

  it("does not change state when config import validation fails", async () => {
    const state = addFriendFromProfile(defaultAppState, { username: "Old", refreshedAt: "2026-06-28T00:00:00.000Z" });
    const { send, localStorage } = await setupWorker({ initialState: state });

    const response = await send({ type: "importConfig", json: "{" });

    expect(response).toMatchObject({ ok: false, error: "配置文件不是有效的 JSON。" });
    expect(localStorage.dump()).toMatchObject({
      linuxdoFriendsState: {
        friends: { old: { username: "old" } }
      }
    });
  });

  it("does not change state when config import has invalid settings schema", async () => {
    const state = addFriendFromProfile(defaultAppState, { username: "Old", refreshedAt: "2026-06-28T00:00:00.000Z" });
    const { send, localStorage } = await setupWorker({ initialState: state });

    const response = await send({
      type: "importConfig",
      json: JSON.stringify({
        schemaVersion: 1,
        source: "linuxdo-friends",
        exportedAt: "2026-06-28T00:00:00.000Z",
        friends: {},
        settings: { refreshIntervalMinutes: "bad" }
      })
    });

    expect(response).toMatchObject({ ok: false, error: "配置文件的刷新间隔不正确。" });
    expect(localStorage.dump()).toMatchObject({
      linuxdoFriendsState: {
        friends: { old: { username: "old" } }
      }
    });
  });

  it("fully resets local extension data and session state", async () => {
    const state = {
      ...addFriendFromProfile(defaultAppState, { username: "Neil", refreshedAt: "2026-06-28T00:00:00.000Z" }),
      currentAccount: { username: "lafish", verifiedAt: "2026-06-28T00:00:00.000Z", source: "latest_header" as const }
    };
    const { send, localStorage, sessionStorage } = await setupWorker({
      initialState: state,
      initialUpdateCheck: {
        installedVersion: "1.0.0",
        latestReleaseUrl: "https://github.com/LeUKi/linuxdo-friends/releases/latest",
        status: "up-to-date",
        latestVersion: "1.0.0",
        checkedAt: "2026-06-28T00:00:00.000Z",
        source: "github_release"
      },
      initialSession: {
        [SITE_DATA_PROGRESS_STORAGE_KEY]: { taskId: "old" },
        [PAGE_SCRIPT_STATUS_STORAGE_KEY]: { status: "connected" },
        "linuxdoFriendsUiScene.tab": "feed"
      },
      initialCloudAuth: cloudAuthFixture()
    });

    const response = await send({ type: "resetExtension" });

    expect(response).toMatchObject({
      ok: true,
      data: {
        friends: {},
        settings: defaultAppState.settings,
        lastSync: { ok: true, message: "已全量重置插件。" }
      }
    });
    expect((response as { ok: true; data: typeof defaultAppState }).data.currentAccount).toBeUndefined();
    expect(localStorage.dump()).toMatchObject({
      linuxdoFriendsState: {
        friends: {}
      }
    });
    expect((localStorage.dump().linuxdoFriendsState as typeof defaultAppState).currentAccount).toBeUndefined();
    expect(localStorage.dump()).not.toHaveProperty(CLOUD_AUTH_STORAGE_KEY);
    expect(localStorage.dump()).not.toHaveProperty("linuxdoFriendsUpdateCheck");
    expect(sessionStorage.dump()).not.toHaveProperty(SITE_DATA_PROGRESS_STORAGE_KEY);
    expect(sessionStorage.dump()).not.toHaveProperty(PAGE_SCRIPT_STATUS_STORAGE_KEY);
    expect(sessionStorage.dump()).not.toHaveProperty("linuxdoFriendsUiScene.tab");
  });
});

type MockTabs = {
  query: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
  get?: ReturnType<typeof vi.fn>;
  update?: ReturnType<typeof vi.fn>;
  reload?: ReturnType<typeof vi.fn>;
  create?: ReturnType<typeof vi.fn>;
};

async function setupWorker(
  overrides: {
    tabs?: MockTabs;
    initialState?: unknown;
    initialUpdateCheck?: unknown;
    initialSession?: Record<string, unknown>;
    initialCloudAuth?: Record<string, unknown>;
    initialCloudVerifier?: string;
    includeSessionAccessLevel?: boolean;
  } = {}
) {
  let listener: ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean) | null = null;
  const startupListeners: Array<() => void> = [];
  const alarmListeners: Array<(alarm: chrome.alarms.Alarm) => void> = [];
  const runtime = {
    sendMessage: vi.fn(),
    openOptionsPage: vi.fn(),
    getURL: vi.fn((path: string) => `chrome-extension://linuxdo-friends/${path}`),
    onMessage: {
      addListener: vi.fn((callback) => {
        listener = callback;
      })
    },
    onStartup: {
      addListener: vi.fn((callback) => {
        startupListeners.push(callback);
      })
    }
  };
  const tabs = {
    query: vi.fn(async () => []),
    sendMessage: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    reload: vi.fn(),
    create: vi.fn(),
    ...overrides.tabs
  };
  const windows = {
    create: vi.fn(async () => ({ id: 77 })),
    remove: vi.fn(async () => undefined),
    update: vi.fn()
  };
  const sidePanel = {
    open: vi.fn(),
    setPanelBehavior: vi.fn()
  };
  const alarms = {
    create: vi.fn(async () => undefined),
    clear: vi.fn(async () => true),
    onAlarm: {
      addListener: vi.fn((callback) => {
        alarmListeners.push(callback);
      })
    }
  };
  const sessionStorage = {
    ...createMockStorage(overrides.initialSession ?? {}),
    ...(overrides.includeSessionAccessLevel === false ? {} : { setAccessLevel: vi.fn() })
  };
  const localStorage = {
    ...createMockStorage({
      ...(overrides.initialState ? { linuxdoFriendsState: overrides.initialState } : {}),
      ...(overrides.initialUpdateCheck ? { linuxdoFriendsUpdateCheck: overrides.initialUpdateCheck } : {}),
      ...(overrides.initialCloudAuth ? { [CLOUD_AUTH_STORAGE_KEY]: overrides.initialCloudAuth } : {}),
      ...(overrides.initialCloudVerifier ? { linuxdoFriendsCloudAuthVerifier: overrides.initialCloudVerifier, linuxdoFriendsCloudAuthWindowId: 77 } : {})
    }),
    setAccessLevel: vi.fn()
  };
  vi.stubGlobal("chrome", {
    runtime: {
      ...runtime,
      getManifest: vi.fn(() => ({ version: "1.0.0" }))
    },
    storage: {
      local: localStorage,
      session: sessionStorage
    },
    tabs,
    windows,
    sidePanel,
    alarms
  });

  await import("./serviceWorker");
  expect(listener).toBeTruthy();
  return {
    runtime,
    localStorage,
    sidePanel,
    sessionStorage,
    tabs,
    windows,
    alarms,
    async triggerAlarm(name: string) {
      for (const alarmListener of alarmListeners) {
        alarmListener({ name, scheduledTime: Date.now() });
      }
      await Promise.resolve();
      await Promise.resolve();
    },
    async triggerStartup() {
      for (const startupListener of startupListeners) startupListener();
      await Promise.resolve();
      await Promise.resolve();
    },
    send(message: unknown, sender: chrome.runtime.MessageSender = {}) {
      return new Promise((resolve) => {
        listener?.(message, sender, resolve);
      });
    }
  };
}

function createPendingChallengeFetch() {
  let resolveFetch: (response: Response) => void = () => undefined;
  const pendingFetch = new Promise<Response>((resolve) => {
    resolveFetch = resolve;
  });
  return {
    fetchImpl: vi.fn(() => pendingFetch),
    release() {
      resolveFetch(new Response("Enable JavaScript and cookies to continue", { status: 429 }));
    }
  };
}

function sendCloudExchangeCode(
  send: (message: unknown, sender?: chrome.runtime.MessageSender) => Promise<unknown>,
  code: string
) {
  return send(
    { type: "cloudSaveExchangeCode", code },
    { url: "https://linuxdo-cloud-save.lafish.workers.dev/auth/complete/browser_code?code=redacted" }
  );
}

async function waitForCloudAuth(
  localStorage: ReturnType<typeof createMockStorage>,
  predicate: (auth: Record<string, unknown>) => boolean
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await flushAsync();
    const auth = localStorage.dump()[CLOUD_AUTH_STORAGE_KEY];
    if (auth && typeof auth === "object" && !Array.isArray(auth) && predicate(auth as Record<string, unknown>)) {
      return auth as Record<string, unknown>;
    }
  }
  throw new Error("Timed out waiting for stored cloud auth metadata.");
}

async function flushAsync() {
  for (let index = 0; index < 4; index += 1) {
    await Promise.resolve();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (let index = 0; index < 4; index += 1) {
    await Promise.resolve();
  }
}

function createPendingJsonFetch(payload: unknown) {
  let resolveFetch: (response: Response) => void = () => undefined;
  const pendingFetch = new Promise<Response>((resolve) => {
    resolveFetch = resolve;
  });
  return {
    fetchImpl: vi.fn(() => pendingFetch),
    release() {
      resolveFetch(new Response(JSON.stringify(payload), { status: 200 }));
    }
  };
}

function profileResponse(username: string, name: string): Response {
  return new Response(
    JSON.stringify({
      user: {
        username,
        name,
        avatar_template: `/user_avatar/linux.do/${username.toLowerCase()}/{size}/1.png`
      }
    }),
    { status: 200 }
  );
}

function cloudAuthFixture() {
  return {
    app: "linuxdo-friends",
    linuxDoId: "42",
    tokenType: "Bearer",
    tokenKind: "jwt",
    token: "secret-token",
    boundAt: "2026-06-29T00:00:00.000Z"
  };
}

function cloudExchangeResponse(
  overrides: Partial<Record<"app" | "linux_do_id" | "token" | "token_kind" | "token_type", string>> = {}
): Response {
  return new Response(
    JSON.stringify({
      app: "linuxdo-friends",
      linux_do_id: "42",
      token: "secret-token",
      token_kind: "jwt",
      token_type: "Bearer",
      ...overrides
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function minimalFriend(username: string) {
  return {
    username,
    groups: [],
    upgradedAt: "2026-06-29T00:00:00.000Z",
    updatedAt: "2026-06-29T00:00:00.000Z"
  };
}

function requestStatsFixture(total = 7) {
  return {
    total,
    byFamily: { activity: total },
    days: {
      "2026-07-02": {
        date: "2026-07-02",
        total,
        hours: { "09": total },
        byFamily: { activity: total }
      }
    }
  };
}

function configResponse(overrides: Partial<Record<string, unknown>> = {}): Response {
  return new Response(
    JSON.stringify({
      schemaVersion: 1,
      source: "linuxdo-friends",
      exportedAt: "2026-06-29T00:00:00.000Z",
      friends: {},
      settings: { refreshIntervalMinutes: 60 },
      ...overrides
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function configSlotResponse(overrides: Partial<Record<string, unknown>> = {}): Response {
  return new Response(
    JSON.stringify({
      found: true,
      app: "linuxdo-friends",
      slot: "config",
      data: {
        schemaVersion: 1,
        source: "linuxdo-friends",
        exportedAt: "2026-06-29T00:00:00.000Z",
        friends: {},
        settings: { refreshIntervalMinutes: 60 },
        ...overrides
      },
      version: 1,
      updatedAt: "2026-06-29T00:01:00.000Z"
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
