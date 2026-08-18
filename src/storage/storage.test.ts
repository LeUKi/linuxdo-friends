import { describe, expect, it } from "vitest";
import { defaultAppState } from "../domain/defaultState";
import { createMockStorage } from "../test/mockStorage";
import { loadState } from "./storage";

describe("storage migration", () => {
  it("default state includes friendProfiles, activityRefreshLedger, and activityWatermarks", () => {
    expect(defaultAppState.friendProfiles).toEqual({});
    expect(defaultAppState.activityRefreshLedger).toEqual({});
    expect(defaultAppState.activityWatermarks).toEqual({});
    expect(defaultAppState.activityFeedWaterlineAt).toBeUndefined();
    expect(defaultAppState.requestStats).toEqual({ total: 0, byFamily: {}, days: {} });
    expect(defaultAppState.dredgeRules).toEqual([]);
    expect(defaultAppState.laoFindsStartedAt).toBeUndefined();
    expect(defaultAppState.laoFindsItems).toEqual({});
    expect(defaultAppState.avatarCache).toEqual({});
    expect(defaultAppState.settings.laoFindsTelegramNotificationsEnabled).toBe(false);
  });

  it("backfills old persisted state without friendProfiles", async () => {
    const storage = createMockStorage({
      linuxdoFriendsState: {
        followedUsers: {},
        friends: {},
        activity: {},
        settings: { refreshIntervalMinutes: 90 }
      }
    });

    await expect(loadState(storage)).resolves.toMatchObject({
      friendProfiles: {},
      activityRefreshLedger: {},
      activityWatermarks: {},
      activityFeedWaterlineAt: undefined,
      requestStats: { total: 0, byFamily: {}, days: {} },
      dredgeRules: [],
      laoFindsStartedAt: undefined,
      laoFindsItems: {},
      avatarCache: {},
      settings: { openActivityLinksInPage: true }
    });
  });

  it("preserves persisted lao finds rules and items", async () => {
    const storage = createMockStorage({
      linuxdoFriendsState: {
        dredgeRules: [
          {
            schemaVersion: 2,
            id: "rule-1",
            name: "AI",
            enabled: true,
            mode: "allow",
            usernames: ["Neo"],
            kinds: ["reply", "bad"],
            patterns: [" AI "],
            createdAt: "2026-06-30T00:00:00.000Z",
            updatedAt: "2026-06-30T00:00:00.000Z"
          }
        ],
        laoFindsStartedAt: "2026-06-30T00:00:00.000Z",
        laoFindsItems: {
          item1: {
            id: "item1",
            activityId: "activity1",
            activity: { id: "activity1", username: "neo", kind: "reply", title: "AI" },
            collectedAt: "2026-06-30T00:01:00.000Z",
            matchedRuleIds: ["rule-1"]
          }
        }
      }
    });

    await expect(loadState(storage)).resolves.toMatchObject({
      dredgeRules: [{ id: "rule-1", schemaVersion: 2, mode: "allow", usernames: ["neo"], kinds: ["reply"], patterns: ["AI"] }],
      laoFindsStartedAt: "2026-06-30T00:00:00.000Z",
      laoFindsItems: { item1: { activityId: "activity1", matchedRuleIds: ["rule-1"] } }
    });
  });

  it("drops invalid persisted lao finds start point", async () => {
    const storage = createMockStorage({
      linuxdoFriendsState: {
        laoFindsStartedAt: "bad"
      }
    });

    await expect(loadState(storage)).resolves.toMatchObject({
      laoFindsStartedAt: undefined
    });
  });

  it("preserves the activity navigation setting", async () => {
    const storage = createMockStorage({
      linuxdoFriendsState: {
        settings: { refreshIntervalMinutes: 90, openActivityLinksInPage: false }
      }
    });

    await expect(loadState(storage)).resolves.toMatchObject({
      settings: { refreshIntervalMinutes: 90, openActivityLinksInPage: false }
    });
  });

  it("preserves persisted activity feed waterline", async () => {
    const storage = createMockStorage({
      linuxdoFriendsState: {
        activityFeedWaterlineAt: "2026-06-28T00:00:00.000Z"
      }
    });

    await expect(loadState(storage)).resolves.toMatchObject({
      activityFeedWaterlineAt: "2026-06-28T00:00:00.000Z"
    });
  });

  it("preserves persisted friendProfiles", async () => {
    const storage = createMockStorage({
      linuxdoFriendsState: {
        friendProfiles: { neil: { username: "neil", name: "Neo", refreshedAt: "2026-06-28T00:00:00.000Z" } }
      }
    });

    await expect(loadState(storage)).resolves.toMatchObject({
      friendProfiles: { neil: { username: "neil", name: "Neo" } }
    });
  });

  it("normalizes legacy persisted friends to all activity kinds", async () => {
    const storage = createMockStorage({
      linuxdoFriendsState: {
        friends: {
          Neo: {
            username: "@Neo",
            note: "NAS",
            groups: ["ops"],
            pinned: true,
            upgradedAt: "2026-06-28T00:00:00.000Z",
            updatedAt: "2026-06-28T00:01:00.000Z"
          }
        }
      }
    });

    await expect(loadState(storage)).resolves.toMatchObject({
      friends: {
        neo: {
          username: "neo",
          activityKinds: ["topic", "reply", "boost", "reaction", "like"]
        }
      }
    });
  });

  it("preserves an existing over-limit note until the user edits it", async () => {
    const note = "中".repeat(81);
    const storage = createMockStorage({
      linuxdoFriendsState: {
        friends: {
          neo: { username: "neo", note }
        }
      }
    });

    await expect(loadState(storage)).resolves.toMatchObject({ friends: { neo: { note } } });
  });

  it("preserves explicit empty friend activity scope", async () => {
    const storage = createMockStorage({
      linuxdoFriendsState: {
        friends: {
          neo: {
            username: "neo",
            activityKinds: [],
            upgradedAt: "2026-06-28T00:00:00.000Z",
            updatedAt: "2026-06-28T00:01:00.000Z"
          }
        }
      }
    });

    await expect(loadState(storage)).resolves.toMatchObject({
      friends: { neo: { username: "neo", activityKinds: [] } }
    });
  });

  it("preserves persisted activity refresh ledger", async () => {
    const storage = createMockStorage({
      linuxdoFriendsState: {
        activityRefreshLedger: {
          "neil:boost": {
            scopeKey: "neil:boost",
            username: "neil",
            kind: "boost",
            refreshedAt: "2026-06-28T00:00:00.000Z",
            source: "direct_fetch",
            itemCount: 2
          }
        }
      }
    });

    await expect(loadState(storage)).resolves.toMatchObject({
      activityRefreshLedger: { "neil:boost": { username: "neil", kind: "boost", itemCount: 2 } }
    });
  });

  it("preserves persisted activity watermarks", async () => {
    const storage = createMockStorage({
      linuxdoFriendsState: {
        activityWatermarks: {
          "neil:boost": {
            scopeKey: "neil:boost",
            username: "neil",
            kind: "boost",
            latestOccurredAt: "2026-06-28T00:00:00.000Z",
            updatedAt: "2026-06-28T00:01:00.000Z",
            source: "direct_fetch"
          }
        }
      }
    });

    await expect(loadState(storage)).resolves.toMatchObject({
      activityWatermarks: { "neil:boost": { username: "neil", kind: "boost", latestOccurredAt: "2026-06-28T00:00:00.000Z" } }
    });
  });

  it("normalizes persisted request stats", async () => {
    const storage = createMockStorage({
      linuxdoFriendsState: {
        requestStats: {
          total: 9,
          byFamily: { activity: 5, profile: 4, bad: 99 },
          days: {
            "2026-07-02": {
              date: "2026-07-02",
              total: 5,
              hours: { "00": 2, "09": 3, "25": 1 },
              byFamily: { activity: 5 }
            }
          }
        }
      }
    });

    await expect(loadState(storage)).resolves.toMatchObject({
      requestStats: {
        total: 9,
        byFamily: { activity: 5, profile: 4 },
        days: {
          "2026-07-02": {
            total: 5,
            hours: { "00": 2, "09": 3 },
            byFamily: { activity: 5 }
          }
        }
      }
    });
  });

  it("preserves telegram bot token and chat id", async () => {
    const storage = createMockStorage({
      linuxdoFriendsState: {
        settings: { telegramBotToken: "123456:ABC-DEF", telegramChatId: "987654321" }
      }
    });

    await expect(loadState(storage)).resolves.toMatchObject({
      settings: {
        laoFindsTelegramNotificationsEnabled: false,
        telegramBotToken: "123456:ABC-DEF",
        telegramChatId: "987654321"
      }
    });
  });

  it("preserves explicit telegram digest notification enablement", async () => {
    const storage = createMockStorage({
      linuxdoFriendsState: {
        settings: { laoFindsTelegramNotificationsEnabled: true, telegramBotToken: "123456:ABC-DEF", telegramChatId: "987654321" }
      }
    });

    await expect(loadState(storage)).resolves.toMatchObject({
      settings: {
        laoFindsTelegramNotificationsEnabled: true,
        telegramBotToken: "123456:ABC-DEF",
        telegramChatId: "987654321"
      }
    });
  });

  it("normalizes timed activity refresh settings", async () => {
    const storage = createMockStorage({
      linuxdoFriendsState: {
        settings: {
          timedActivityRefreshEnabled: true,
          timedActivityRefreshScopeMode: "all",
          timedActivityRefreshIntervalMinutes: 5,
          requestStatsAutoSyncEnabled: true,
          laoFindsBrowserNotificationsEnabled: false,
          laoFindsManualNotificationsEnabled: true,
          laoFindsTelegramNotificationsEnabled: true
        }
      }
    });

    await expect(loadState(storage)).resolves.toMatchObject({
      settings: {
        timedActivityRefreshEnabled: true,
        timedActivityRefreshScopeMode: "all",
        timedActivityRefreshIntervalMinutes: 5,
        requestStatsAutoSyncEnabled: true,
        laoFindsBrowserNotificationsEnabled: false,
        laoFindsManualNotificationsEnabled: true,
        laoFindsTelegramNotificationsEnabled: true
      }
    });
  });

  it("backfills missing or invalid timed activity refresh settings", async () => {
    const storage = createMockStorage({
      linuxdoFriendsState: {
        settings: {
          timedActivityRefreshEnabled: "yes",
          timedActivityRefreshScopeMode: "bad",
          timedActivityRefreshIntervalMinutes: 1,
          requestStatsAutoSyncEnabled: "yes",
          laoFindsBrowserNotificationsEnabled: "yes",
          laoFindsManualNotificationsEnabled: "yes",
          laoFindsTelegramNotificationsEnabled: "yes"
        }
      }
    });

    await expect(loadState(storage)).resolves.toMatchObject({
      settings: {
        timedActivityRefreshEnabled: false,
        timedActivityRefreshScopeMode: "rules",
        timedActivityRefreshIntervalMinutes: 20,
        requestStatsAutoSyncEnabled: false,
        laoFindsBrowserNotificationsEnabled: true,
        laoFindsManualNotificationsEnabled: false,
        laoFindsTelegramNotificationsEnabled: false
      }
    });
  });

  it("omits telegram settings when not stored", async () => {
    const storage = createMockStorage({
      linuxdoFriendsState: {
        settings: { refreshIntervalMinutes: 90 }
      }
    });

    const state = await loadState(storage);
    expect(state.settings.telegramBotToken).toBeUndefined();
    expect(state.settings.telegramChatId).toBeUndefined();
  });

  it("preserves persisted avatar cache", async () => {
    const storage = createMockStorage({
      linuxdoFriendsState: {
        avatarCache: {
          neil: {
            username: "neil",
            sourceUrl: "https://linux.do/user_avatar/linux.do/neil/48/1.png",
            dataUrl: "data:image/png;base64,abc",
            contentType: "image/png",
            byteLength: 3,
            updatedAt: "2026-06-28T00:01:00.000Z"
          }
        }
      }
    });

    await expect(loadState(storage)).resolves.toMatchObject({
      avatarCache: { neil: { username: "neil", dataUrl: "data:image/png;base64,abc" } }
    });
  });
});
