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
        activity: { neo: { username: "neo", refreshedAt: "2026-06-28T00:00:00.000Z", items: [] } },
        currentAccount: { username: "lafish", verifiedAt: "2026-06-28T00:00:00.000Z", source: "latest_header" }
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
      laoFindsStartedAt: "2026-06-28T00:00:00.000Z",
      settings: defaultAppState.settings
    });
    expect(file).not.toHaveProperty("currentAccount");
    expect(file).not.toHaveProperty("followedUsers");
    expect(file).not.toHaveProperty("activity");
    expect(file).not.toHaveProperty("laoFindsItems");
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
          timedActivityRefreshIntervalMinutes: 240
        }
      })
    );

    expect(file.friends.neo).toMatchObject({ username: "neo", groups: ["ops"], pinned: true, activityKinds: ["reply", "reaction"] });
    expect(file.dredgeRules[0]).toMatchObject({ id: "rule-1", name: "AI", usernames: ["neo"], kinds: ["topic", "reply"], keywords: ["ai 工具"] });
    expect(file.laoFindsStartedAt).toBe("2026-06-28T00:00:00.000Z");
    expect(file.settings).toEqual({
      allowAutoRefresh: false,
      allowInactiveTabFallback: false,
      openActivityLinksInPage: true,
      refreshIntervalMinutes: 60,
      timedActivityRefreshEnabled: true,
      timedActivityRefreshScopeMode: "all",
      timedActivityRefreshIntervalMinutes: 240
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
    expect(file.settings.timedActivityRefreshEnabled).toBe(false);
    expect(file.settings.timedActivityRefreshScopeMode).toBe("rules");
    expect(file.settings.timedActivityRefreshIntervalMinutes).toBe(120);
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
        settings: { refreshIntervalMinutes: 90, openActivityLinksInPage: true }
      })
    );
    const { state } = applyConfigImport(file, "2026-06-28T00:01:00.000Z");

    expect(state.friends).toEqual(file.friends);
    expect(state.dredgeRules).toEqual(file.dredgeRules);
    expect(state.laoFindsStartedAt).toBe("2026-06-28T00:00:00.000Z");
    expect(state.laoFindsItems).toEqual({});
    expect(state.settings.refreshIntervalMinutes).toBe(90);
    expect(state.settings.openActivityLinksInPage).toBe(true);
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
    const changedStartedAt = {
      ...base,
      laoFindsStartedAt: "2026-06-28T00:01:00.000Z"
    };

    const fingerprint = await createConfigFingerprint(base);

    expect(fingerprint).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(fingerprint).toBe(await createConfigFingerprint(sameDifferentRuntimeState));
    expect(fingerprint).not.toBe(await createConfigFingerprint(changedScope));
    expect(fingerprint).not.toBe(await createConfigFingerprint(changedRule));
    expect(fingerprint).not.toBe(await createConfigFingerprint(changedSettings));
    expect(fingerprint).not.toBe(await createConfigFingerprint(changedStartedAt));
    expect(fingerprint).toBe(await createConfigFingerprint({ ...base }));
    expect(fingerprint).not.toContain("neo");
    expect(fingerprint).not.toContain("NAS");
    expect(fingerprint).not.toContain("LLM");
    expect(fingerprint).not.toContain("bot-secret-token");
    expect(fingerprint).not.toContain("chat-secret-id");
    expect(fingerprint).not.toContain("{");
  });
});
