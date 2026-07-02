import { describe, expect, it } from "vitest";
import type { AppState } from "../shared/types";
import { defaultAppState } from "./defaultState";
import { createConfigExport, createConfigFingerprint, parseConfigImportJson, applyConfigImport } from "./configTransfer";

describe("config transfer", () => {
  it("exports only migratable config", () => {
    const file = createConfigExport(
      {
        ...defaultAppState,
        followedUsers: {
          neo: { username: "neo", source: "sync", followedAt: "2026-06-28T00:00:00.000Z", updatedAt: "2026-06-28T00:00:00.000Z" }
        },
        friends: {
          neo: {
            username: "neo",
            note: "NAS",
            groups: ["ops"],
            pinned: true,
            activityKinds: ["topic", "reaction"],
            upgradedAt: "2026-06-28T00:00:00.000Z",
            updatedAt: "2026-06-28T00:00:00.000Z"
          }
        },
        dredgeRules: [
          {
            id: "rule-ai",
            name: "AI",
            enabled: true,
            usernames: "all",
            kinds: ["topic"],
            keywords: ["AI"],
            createdAt: "2026-06-28T00:00:00.000Z",
            updatedAt: "2026-06-28T00:00:00.000Z"
          }
        ],
        laoFindsStartedAt: "2026-06-28T00:00:00.000Z",
        laoFindsItems: {
          item1: {
            id: "item1",
            activityId: "activity1",
            activity: { id: "activity1", username: "neo", kind: "topic", title: "AI" },
            collectedAt: "2026-06-28T00:00:00.000Z",
            matchedRuleIds: ["rule-ai"]
          }
        },
        requestStats: {
          total: 6,
          byFamily: { activity: 4, profile: 2 },
          days: {
            "2026-07-02": {
              date: "2026-07-02",
              total: 6,
              hours: { "09": 4, "10": 2 },
              byFamily: { activity: 4, profile: 2 }
            }
          }
        },
        activity: { neo: { username: "neo", refreshedAt: "2026-06-28T00:00:00.000Z", items: [] } },
        currentAccount: { username: "lafish", verifiedAt: "2026-06-28T00:00:00.000Z", source: "latest_header" },
        settings: {
          ...defaultAppState.settings,
          openActivityLinksInPage: false,
          timedActivityRefreshEnabled: true,
          timedActivityRefreshScopeMode: "all",
          timedActivityRefreshIntervalMinutes: 240,
          requestStatsAutoSyncEnabled: true
        }
      },
      "2026-06-28T00:00:00.000Z"
    );

    expect(file).toEqual({
      schemaVersion: 1,
      source: "linuxdo-friends",
      exportedAt: "2026-06-28T00:00:00.000Z",
      friends: {
        neo: {
          username: "neo",
          note: "NAS",
          groups: ["ops"],
          pinned: true,
          activityKinds: ["topic", "reaction"],
          upgradedAt: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:00.000Z"
        }
      },
      dredgeRules: [
        {
          id: "rule-ai",
          name: "AI",
          enabled: true,
          usernames: "all",
          kinds: ["topic"],
          keywords: ["ai"],
          createdAt: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:00.000Z"
        }
      ],
      requestStats: {
        total: 6,
        byFamily: { activity: 4, profile: 2 },
        days: {
          "2026-07-02": {
            date: "2026-07-02",
            total: 6,
            hours: { "09": 4, "10": 2 },
            byFamily: { activity: 4, profile: 2 }
          }
        }
      },
      settings: {
        openActivityLinksInPage: false,
        refreshIntervalMinutes: 120,
        timedActivityRefreshScopeMode: "all",
        timedActivityRefreshIntervalMinutes: 240
      }
    });
    expect(file).not.toHaveProperty("currentAccount");
    expect(file).not.toHaveProperty("followedUsers");
    expect(file).not.toHaveProperty("activity");
    expect(file).not.toHaveProperty("laoFindsStartedAt");
    expect(file).not.toHaveProperty("laoFindsItems");
    expect(file.settings).not.toHaveProperty("timedActivityRefreshEnabled");
    expect(file.settings).not.toHaveProperty("requestStatsAutoSyncEnabled");
    expect(JSON.stringify(file)).not.toContain("token");
    expect(JSON.stringify(file)).not.toContain("linux_do_id");
    expect(JSON.stringify(file)).not.toContain("linuxdoFriendsCloudAuth");
  });

  it("normalizes valid import files", () => {
    const file = parseConfigImportJson(
      JSON.stringify({
        schemaVersion: 1,
        source: "linuxdo-friends",
        exportedAt: "2026-06-28T00:00:00.000Z",
        friends: {
          Neo: {
            username: "@Neo",
            note: "NAS",
            groups: ["ops", "ops", ""],
            pinned: true,
            activityKinds: ["reaction", "bad", "reply", "reply"],
            upgradedAt: "2026-06-28T00:00:00.000Z",
            updatedAt: "2026-06-28T00:00:00.000Z"
          }
        },
        dredgeRules: [
          {
            id: "rule-1",
            name: " AI ",
            enabled: true,
            usernames: ["@Neo", "neo"],
            kinds: ["reply", "bad", "topic"],
            keywords: [" AI  工具 "],
            createdAt: "2026-06-28T00:00:00.000Z",
            updatedAt: "2026-06-28T00:00:00.000Z"
          }
        ],
        laoFindsStartedAt: "2026-06-28T00:00:00.000Z",
        settings: {
          refreshIntervalMinutes: 60,
          allowAutoRefresh: true,
          allowInactiveTabFallback: true,
          openActivityLinksInPage: true,
          timedActivityRefreshEnabled: true,
          timedActivityRefreshScopeMode: "all",
          timedActivityRefreshIntervalMinutes: 240,
          requestStatsAutoSyncEnabled: true
        },
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
      })
    );

    expect(file.friends.neo).toMatchObject({ username: "neo", groups: ["ops"], pinned: true, activityKinds: ["reply", "reaction"] });
    expect(file.dredgeRules[0]).toMatchObject({ id: "rule-1", name: "AI", usernames: ["neo"], kinds: ["topic", "reply"], keywords: ["ai 工具"] });
    expect(file).not.toHaveProperty("laoFindsStartedAt");
    expect(file.settings).toEqual({
      openActivityLinksInPage: true,
      refreshIntervalMinutes: 60,
      timedActivityRefreshScopeMode: "all",
      timedActivityRefreshIntervalMinutes: 240
    });
    expect(file.settings).not.toHaveProperty("timedActivityRefreshEnabled");
    expect(file.settings).not.toHaveProperty("requestStatsAutoSyncEnabled");
    expect(file.requestStats).toEqual({
      total: 9,
      byFamily: { activity: 5, profile: 4 },
      days: {
        "2026-07-02": {
          date: "2026-07-02",
          total: 5,
          hours: { "00": 2, "09": 3 },
          byFamily: { activity: 5 }
        }
      }
    });
  });

  it("defaults legacy imported friends to all activity kinds and preserves explicit empty scope", () => {
    const file = parseConfigImportJson(
      JSON.stringify({
        schemaVersion: 1,
        source: "linuxdo-friends",
        exportedAt: "2026-06-28T00:00:00.000Z",
        friends: {
          legacy: {
            username: "legacy",
            groups: [],
            upgradedAt: "2026-06-28T00:00:00.000Z",
            updatedAt: "2026-06-28T00:00:00.000Z"
          },
          quiet: {
            username: "quiet",
            groups: [],
            activityKinds: [],
            upgradedAt: "2026-06-28T00:00:00.000Z",
            updatedAt: "2026-06-28T00:00:00.000Z"
          }
        },
        dredgeRules: [],
        settings: { refreshIntervalMinutes: 60 }
      })
    );

    expect(file.friends.legacy.activityKinds).toEqual(["topic", "reply", "boost", "reaction"]);
    expect(file.friends.quiet.activityKinds).toEqual([]);
    expect(file.settings.openActivityLinksInPage).toBe(true);
    expect(file.settings.timedActivityRefreshScopeMode).toBe("rules");
    expect(file.settings.timedActivityRefreshIntervalMinutes).toBe(120);
    expect(file.settings).not.toHaveProperty("timedActivityRefreshEnabled");
    expect(file.settings).not.toHaveProperty("requestStatsAutoSyncEnabled");
    expect(file.requestStats).toEqual({ total: 0, byFamily: {}, days: {} });
  });

  it("rejects invalid import files", () => {
    expect(() => parseConfigImportJson("{")).toThrow("配置文件不是有效的 JSON。");
    expect(() => parseConfigImportJson(JSON.stringify({ schemaVersion: 2, source: "linuxdo-friends" }))).toThrow("配置文件版本不支持。");
    expect(() =>
      parseConfigImportJson(
        JSON.stringify({
          schemaVersion: 1,
          source: "linuxdo-friends",
          exportedAt: "2026-06-28T00:00:00.000Z",
          friends: {},
          settings: { refreshIntervalMinutes: "bad" }
        })
      )
    ).toThrow("配置文件的刷新间隔不正确。");
    expect(() =>
      parseConfigImportJson(
        JSON.stringify({
          schemaVersion: 1,
          source: "linuxdo-friends",
          exportedAt: "2026-06-28T00:00:00.000Z",
          friends: {},
          settings: { refreshIntervalMinutes: 60, timedActivityRefreshScopeMode: "bad" }
        })
      )
    ).toThrow("配置文件的定时刷新范围不正确。");
    expect(() =>
      parseConfigImportJson(
        JSON.stringify({
          schemaVersion: 1,
          source: "linuxdo-friends",
          exportedAt: "2026-06-28T00:00:00.000Z",
          friends: {},
          settings: { refreshIntervalMinutes: 60, timedActivityRefreshIntervalMinutes: 1 }
        })
      )
    ).toThrow("配置文件的定时刷新间隔不正确。");
    expect(() =>
      parseConfigImportJson(
        JSON.stringify({
          schemaVersion: 1,
          source: "linuxdo-friends",
          exportedAt: "2026-06-28T00:00:00.000Z",
          friends: {},
          settings: { refreshIntervalMinutes: 60, requestStatsAutoSyncEnabled: "yes" }
        })
      )
    ).toThrow("配置文件的请求统计自动同步设置不正确。");
    expect(() =>
      parseConfigImportJson(
        JSON.stringify({
          schemaVersion: 1,
          source: "linuxdo-friends",
          exportedAt: "2026-06-28T00:00:00.000Z",
          friends: { neo: { username: "neo", groups: [1] } },
          settings: {}
        })
      )
    ).toThrow("佬朋友分组格式不正确。");
  });

  it("applies import as overwrite and clears derived state", () => {
    const file = parseConfigImportJson(
      JSON.stringify({
        schemaVersion: 1,
        source: "linuxdo-friends",
        exportedAt: "2026-06-28T00:00:00.000Z",
        friends: {
          neo: {
            username: "neo",
            note: "",
            groups: [],
            pinned: false,
            activityKinds: ["boost"],
            upgradedAt: "2026-06-28T00:00:00.000Z",
            updatedAt: "2026-06-28T00:00:00.000Z"
          }
        },
        dredgeRules: [
          {
            id: "rule-1",
            name: "AI",
            enabled: true,
            usernames: "all",
            kinds: ["topic"],
            keywords: ["AI"],
            createdAt: "2026-06-28T00:00:00.000Z",
            updatedAt: "2026-06-28T00:00:00.000Z"
          }
        ],
        laoFindsStartedAt: "2026-06-28T00:00:00.000Z",
        requestStats: {
          total: 4,
          byFamily: { activity: 4 },
          days: {
            "2026-07-02": {
              date: "2026-07-02",
              total: 4,
              hours: { "12": 4 },
              byFamily: { activity: 4 }
            }
          }
        },
        settings: {
          refreshIntervalMinutes: 90,
          openActivityLinksInPage: true,
          timedActivityRefreshEnabled: true,
          requestStatsAutoSyncEnabled: true
        }
      })
    );
    const { state } = applyConfigImport(
      file,
      "2026-06-28T00:01:00.000Z",
      { ...defaultAppState, laoFindsStartedAt: "2026-06-27T00:00:00.000Z" }
    );

    expect(state.friends).toEqual(file.friends);
    expect(state.dredgeRules).toEqual(file.dredgeRules);
    expect(state.laoFindsStartedAt).toBe("2026-06-27T00:00:00.000Z");
    expect(state.requestStats).toEqual(file.requestStats);
    expect(state.laoFindsItems).toEqual({});
    expect(state.settings.refreshIntervalMinutes).toBe(90);
    expect(state.settings.openActivityLinksInPage).toBe(true);
    expect(state.settings.timedActivityRefreshEnabled).toBe(false);
    expect(state.settings.requestStatsAutoSyncEnabled).toBe(false);
    expect(state.activity).toEqual({});
    expect(state.currentAccount).toBeUndefined();
    expect(state.lastSync?.message).toBe("已导入 1 位佬朋友配置。");
  });

  it("creates an opaque stable fingerprint for migratable config only", async () => {
    const base: AppState = {
      ...defaultAppState,
      friends: {
        neo: {
          username: "neo",
          note: "NAS",
          groups: ["ops"],
          pinned: true,
          activityKinds: ["topic"],
          upgradedAt: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:00.000Z"
        }
      },
      dredgeRules: [
        {
          id: "rule-ai",
          name: "AI",
          enabled: true,
          usernames: ["neo"],
          kinds: ["topic"],
          keywords: ["AI"],
          createdAt: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:00.000Z"
        }
      ],
      laoFindsStartedAt: "2026-06-28T00:00:00.000Z",
      settings: {
        ...defaultAppState.settings,
        refreshIntervalMinutes: 90,
        telegramBotToken: "bot-secret-token",
        telegramChatId: "chat-secret-id"
      }
    };
    const sameDifferentRuntimeState = {
      ...base,
      currentAccount: { username: "lafish", verifiedAt: "2026-06-28T00:00:00.000Z", source: "latest_header" as const },
      activity: {
        neo: {
          username: "neo",
          refreshedAt: "2026-06-28T00:01:00.000Z",
          items: [{ id: "topic:neo:1", username: "neo", kind: "topic" as const, title: "Runtime only" }]
        }
      },
      avatarCache: {
        neo: {
          username: "neo",
          sourceUrl: "https://linux.do/avatar.png",
          dataUrl: "data:image/png;base64,abc",
          contentType: "image/png",
          byteLength: 3,
          updatedAt: "2026-06-28T00:00:00.000Z"
        }
      },
      lastSync: { ok: true as const, source: "manual" as const, message: "runtime", refreshedAt: "2026-06-28T00:02:00.000Z" }
    };
    const changedScope = {
      ...base,
      friends: {
        ...base.friends,
        neo: { ...base.friends.neo, activityKinds: ["reply" as const] }
      }
    };
    const changedRule = {
      ...base,
      dredgeRules: [{ ...base.dredgeRules[0], keywords: ["LLM"] }]
    };
    const changedSettings = {
      ...base,
      settings: { ...base.settings, openActivityLinksInPage: false }
    };
    const changedTimedRefreshEnabled = {
      ...base,
      settings: { ...base.settings, timedActivityRefreshEnabled: true }
    };
    const changedRequestStatsAutoSync = {
      ...base,
      settings: { ...base.settings, requestStatsAutoSyncEnabled: true }
    };
    const changedTimedRefreshScopeMode = {
      ...base,
      settings: { ...base.settings, timedActivityRefreshScopeMode: "all" as const }
    };
    const changedTimedRefreshInterval = {
      ...base,
      settings: { ...base.settings, timedActivityRefreshIntervalMinutes: 240 }
    };
    const changedStartedAt = {
      ...base,
      laoFindsStartedAt: "2026-06-28T00:01:00.000Z"
    };
    const changedStats = {
      ...base,
      requestStats: {
        total: 99,
        byFamily: { activity: 99 as const },
        days: {
          "2026-07-02": {
            date: "2026-07-02",
            total: 99,
            hours: { "09": 99 },
            byFamily: { activity: 99 as const }
          }
        }
      }
    };

    const fingerprint = await createConfigFingerprint(base);

    expect(fingerprint).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(fingerprint).toBe(await createConfigFingerprint(sameDifferentRuntimeState));
    expect(fingerprint).not.toBe(await createConfigFingerprint(changedScope));
    expect(fingerprint).not.toBe(await createConfigFingerprint(changedRule));
    expect(fingerprint).not.toBe(await createConfigFingerprint(changedSettings));
    expect(fingerprint).not.toBe(await createConfigFingerprint(changedTimedRefreshScopeMode));
    expect(fingerprint).not.toBe(await createConfigFingerprint(changedTimedRefreshInterval));
    expect(fingerprint).toBe(await createConfigFingerprint(changedTimedRefreshEnabled));
    expect(fingerprint).toBe(await createConfigFingerprint(changedRequestStatsAutoSync));
    expect(fingerprint).toBe(await createConfigFingerprint(changedStartedAt));
    expect(fingerprint).toBe(await createConfigFingerprint(changedStats));
    expect(fingerprint).toBe(await createConfigFingerprint({ ...base }));
    expect(fingerprint).not.toContain("neo");
    expect(fingerprint).not.toContain("NAS");
    expect(fingerprint).not.toContain("LLM");
    expect(fingerprint).not.toContain("bot-secret-token");
    expect(fingerprint).not.toContain("chat-secret-id");
    expect(fingerprint).not.toContain("{");
  });
});
