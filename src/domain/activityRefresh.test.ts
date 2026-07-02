import { describe, expect, it } from "vitest";
import { defaultAppState } from "./defaultState";
import { deriveTimedActivityRefreshScopes, normalizeActivityRefreshScope } from "./activityRefresh";
import type { AppState, FriendUser, DredgeRule } from "../shared/types";

function friend(username: string, activityKinds: FriendUser["activityKinds"]): FriendUser {
  return {
    username,
    note: "",
    groups: [],
    pinned: false,
    activityKinds,
    upgradedAt: "2026-06-30T00:00:00.000Z",
    updatedAt: "2026-06-30T00:00:00.000Z"
  };
}

function rule(patch: Partial<DredgeRule>): DredgeRule {
  return {
    id: patch.id ?? "rule-1",
    name: patch.name ?? "Rule",
    enabled: patch.enabled ?? true,
    usernames: patch.usernames ?? "all",
    kinds: patch.kinds ?? ["topic", "reply", "boost", "reaction"],
    keywords: patch.keywords ?? [],
    createdAt: "2026-06-30T00:00:00.000Z",
    updatedAt: "2026-06-30T00:00:00.000Z"
  };
}

function state(patch: Partial<AppState>): AppState {
  return { ...defaultAppState, ...patch };
}

describe("timed activity refresh scopes", () => {
  it("returns all scope for full mode without broadening the scope shape", () => {
    expect(deriveTimedActivityRefreshScopes(defaultAppState, "all")).toEqual([{ kind: "all" }]);
  });

  it("returns no rule-derived scopes when no enabled rules exist", () => {
    expect(deriveTimedActivityRefreshScopes(defaultAppState, "rules")).toEqual([]);
    expect(deriveTimedActivityRefreshScopes(state({ dredgeRules: [rule({ enabled: false })] }), "rules")).toEqual([]);
  });

  it("derives ordered existing scopes from enabled rules and friend activity kinds", () => {
    const scopes = deriveTimedActivityRefreshScopes(
      state({
        friends: {
          neo: friend("neo", ["topic", "reaction"]),
          trinity: friend("trinity", ["reply", "boost"]),
          quiet: friend("quiet", [])
        },
        dredgeRules: [
          rule({ id: "r1", usernames: "all", kinds: ["reaction", "topic", "reply"] }),
          rule({ id: "r2", usernames: ["trinity", "missing"], kinds: ["boost", "reply"] })
        ]
      }),
      "rules"
    );

    expect(scopes).toEqual([
      { kind: "topic", usernames: ["neo"] },
      { kind: "reply", usernames: ["trinity"] },
      { kind: "boost", usernames: ["trinity"] },
      { kind: "reaction", usernames: ["neo"] }
    ]);
    expect(scopes.every((scope) => !("kinds" in scope))).toBe(true);
  });

  it("preserves existing single-kind manual scope normalization", () => {
    expect(normalizeActivityRefreshScope({ kind: "boost", usernames: ["neo"] })).toEqual({ kind: "boost", usernames: ["neo"] });
  });
});
