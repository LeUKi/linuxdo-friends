import { describe, expect, it } from "vitest";
import { defaultAppState } from "./defaultState";
import {
  archiveLaoFindsItem,
  clearLaoFindsItems,
  collectLaoFindsItems,
  deleteLaoFindsItem,
  markLaoFindsItemRead,
  normalizeDredgeRules,
  removeDredgeRule,
  upsertDredgeRule
} from "./laoFinds";
import type { ActivityItem, AppState, DredgeRule } from "../shared/types";

describe("lao finds collection", () => {
  it("collects nothing when there are no rules", () => {
    const result = collectLaoFindsItems(defaultAppState, [activity({ id: "a1", title: "AI 工具" })], "2026-06-30T00:00:00.000Z");

    expect(result.collectedCount).toBe(0);
    expect(result.state.laoFindsItems).toEqual({});
  });

  it("collects nothing when there is no enabled allow rule", () => {
    const state = withRules([rule({ id: "block-ai", mode: "block", patterns: ["AI"] })], "2026-06-29T00:00:00.000Z");

    const result = collectLaoFindsItems(state, [activity({ id: "a1", title: "AI 工具" })], "2026-06-30T00:00:00.000Z");

    expect(result.collectedCount).toBe(0);
    expect(result.state.laoFindsItems).toEqual({});
  });

  it("matches enabled allow rules by user, kind, and regex pattern", () => {
    const state = withRules([rule({ id: "rule-ai", usernames: ["Neo"], kinds: ["topic"], patterns: ["AI|LLM"] })], "2026-06-29T00:00:00.000Z");

    const result = collectLaoFindsItems(
      state,
      [
        activity({ id: "hit", username: "neo", kind: "topic", title: "一个 ai 工具" }),
        activity({ id: "wrong-user", username: "ada", kind: "topic", title: "一个 AI 工具" }),
        activity({ id: "wrong-kind", username: "neo", kind: "reply", title: "一个 AI 工具" }),
        activity({ id: "wrong-pattern", username: "neo", kind: "topic", title: "闲聊" })
      ],
      "2026-06-30T00:00:00.000Z"
    );

    expect(Object.keys(result.state.laoFindsItems)).toEqual(["hit"]);
    expect(result.state.laoFindsItems.hit).toMatchObject({ matchedRuleIds: ["rule-ai"], collectedAt: "2026-06-30T00:00:00.000Z" });
  });

  it("lets a block rule globally veto an allow match", () => {
    const state = withRules(
      [
        rule({ id: "allow-ai", mode: "allow", patterns: ["AI"] }),
        rule({ id: "block-spam", mode: "block", patterns: ["spam"] })
      ],
      "2026-06-29T00:00:00.000Z"
    );

    const result = collectLaoFindsItems(state, [activity({ id: "blocked", title: "AI spam" })]);

    expect(result.collectedCount).toBe(0);
    expect(result.state.laoFindsItems).toEqual({});
  });

  it("does not let unrelated block rules prevent allow matches", () => {
    const state = withRules(
      [
        rule({ id: "allow-ai", mode: "allow", patterns: ["AI"] }),
        rule({ id: "block-spam", mode: "block", patterns: ["spam"] })
      ],
      "2026-06-29T00:00:00.000Z"
    );

    const result = collectLaoFindsItems(state, [activity({ id: "hit", title: "AI 工具" })]);

    expect(result.collectedCount).toBe(1);
    expect(result.state.laoFindsItems.hit.matchedRuleIds).toEqual(["allow-ai"]);
  });

  it("treats empty patterns as match-all inside selected user and kind scope", () => {
    const allowState = withRules([rule({ id: "allow-all-neo", mode: "allow", usernames: ["neo"], kinds: ["boost"], patterns: [] })], "2026-06-29T00:00:00.000Z");
    const allowed = collectLaoFindsItems(allowState, [activity({ id: "boost-1", username: "neo", kind: "boost", title: "Boost" })]);

    const blockState = withRules(
      [
        rule({ id: "allow-all", mode: "allow", patterns: [] }),
        rule({ id: "block-all-neo", mode: "block", usernames: ["neo"], kinds: ["boost"], patterns: [] })
      ],
      "2026-06-29T00:00:00.000Z"
    );
    const blocked = collectLaoFindsItems(blockState, [activity({ id: "boost-2", username: "neo", kind: "boost", title: "Boost" })]);

    expect(allowed.collectedCount).toBe(1);
    expect(allowed.state.laoFindsItems["boost-1"].matchedRuleIds).toEqual(["allow-all-neo"]);
    expect(blocked.collectedCount).toBe(0);
    expect(blocked.state.laoFindsItems).toEqual({});
  });

  it("ignores disabled rules", () => {
    const state = withRules([rule({ id: "disabled", enabled: false, patterns: ["AI"] })], "2026-06-29T00:00:00.000Z");

    const result = collectLaoFindsItems(state, [activity({ id: "a1", title: "AI" })]);

    expect(result.state.laoFindsItems).toEqual({});
  });

  it("deduplicates repeated refreshes and preserves read/archive flags", () => {
    const state = withRules([rule({ id: "rule-ai", patterns: ["AI"] })], "2026-06-29T00:00:00.000Z");
    const first = collectLaoFindsItems(state, [activity({ id: "a1", title: "AI", excerpt: "old" })], "2026-06-30T00:00:00.000Z").state;
    const marked = archiveLaoFindsItem(markLaoFindsItemRead(first, "a1", true), "a1", true);

    const second = collectLaoFindsItems(marked, [activity({ id: "a1", title: "AI", excerpt: "new" })], "2026-06-30T01:00:00.000Z");

    expect(second.collectedCount).toBe(0);
    expect(second.state.laoFindsItems.a1.collectedAt).toBe("2026-06-30T00:00:00.000Z");
    expect(second.state.laoFindsItems.a1.activity.excerpt).toBe("new");
    expect(second.state.laoFindsItems.a1.readAt).toBeTruthy();
    expect(second.state.laoFindsItems.a1.archivedAt).toBeTruthy();
  });

  it("deletes a lao finds item locally without creating tombstones", () => {
    const state = withRules([rule({ id: "rule-ai", patterns: ["AI"] })], "2026-06-29T00:00:00.000Z");
    const collected = collectLaoFindsItems(state, [activity({ id: "a1", title: "AI" }), activity({ id: "a2", title: "AI 2" })]).state;

    const deleted = deleteLaoFindsItem(collected, "a1");
    const unchanged = deleteLaoFindsItem(deleted, "missing");

    expect(Object.keys(deleted.laoFindsItems)).toEqual(["a2"]);
    expect(deleted.laoFindsItems.a1).toBeUndefined();
    expect(unchanged).toBe(deleted);
    expect(deleted.laoFindsStartedAt).toBe(collected.laoFindsStartedAt);
  });

  it("clears all lao finds items without changing the dredge start point", () => {
    const state = withRules([rule({ id: "rule-ai", patterns: ["AI"] })], "2026-06-29T00:00:00.000Z");
    const collected = collectLaoFindsItems(state, [activity({ id: "a1", title: "AI" }), activity({ id: "a2", title: "AI 2" })]).state;

    const cleared = clearLaoFindsItems(collected);
    const unchanged = clearLaoFindsItems(cleared);

    expect(cleared.laoFindsItems).toEqual({});
    expect(cleared.laoFindsStartedAt).toBe(collected.laoFindsStartedAt);
    expect(unchanged).toBe(cleared);
  });

  it("merges allow rule matches and removes deleted rule ids from existing items", () => {
    const state = withRules([rule({ id: "rule-ai", patterns: ["AI"] }), rule({ id: "rule-llm", patterns: ["LLM"] })], "2026-06-29T00:00:00.000Z");
    const collected = collectLaoFindsItems(state, [activity({ id: "a1", title: "AI LLM" })]).state;

    expect(collected.laoFindsItems.a1.matchedRuleIds).toEqual(["rule-ai", "rule-llm"]);

    const removed = removeDredgeRule(collected, "rule-ai");
    expect(removed.laoFindsItems.a1.matchedRuleIds).toEqual(["rule-llm"]);
    expect(removed.laoFindsStartedAt).toBeTruthy();
  });

  it("upserts current rules with normalized usernames, kinds, and patterns", () => {
    const state = upsertDredgeRule(defaultAppState, {
      schemaVersion: 2,
      id: "rule-1",
      name: "  AI  ",
      mode: "allow",
      usernames: ["@Neo", "neo"],
      kinds: ["reply", "topic"],
      patterns: [" AI  工具 ", "AI  工具"]
    });

    expect(state.dredgeRules[0]).toMatchObject({
      schemaVersion: 2,
      id: "rule-1",
      name: "AI",
      mode: "allow",
      usernames: ["neo"],
      kinds: ["topic", "reply"],
      patterns: ["AI  工具"]
    });
  });

  it("preserves current all-except-like rule scopes", () => {
    const state = upsertDredgeRule(defaultAppState, {
      schemaVersion: 2,
      id: "rule-no-like",
      mode: "allow",
      kinds: ["topic", "reply", "boost", "reaction"],
      patterns: []
    });

    expect(state.dredgeRules[0].kinds).toEqual(["topic", "reply", "boost", "reaction"]);
  });

  it("drops legacy keyword-only rules and invalid current regex rules during normalization", () => {
    const normalized = normalizeDredgeRules([
      { id: "legacy", name: "Legacy", enabled: true, usernames: "all", kinds: ["topic"], keywords: ["AI"] },
      { schemaVersion: 2, id: "invalid", name: "Invalid", enabled: true, mode: "allow", usernames: "all", kinds: ["topic"], patterns: ["["] },
      rule({ id: "valid", patterns: ["AI"] })
    ]);

    expect(normalized.map((item) => item.id)).toEqual(["valid"]);
  });

  it("does not retroactively collect cached activity when a rule is edited", () => {
    const cachedActivityState: AppState = {
      ...defaultAppState,
      activity: {
        neo: {
          username: "neo",
          refreshedAt: "2026-06-30T00:00:00.000Z",
          items: [activity({ id: "cached-ai", username: "neo", title: "AI 工具" })]
        }
      }
    };

    const next = upsertDredgeRule(cachedActivityState, { schemaVersion: 2, id: "rule-ai", mode: "allow", patterns: ["AI"] });

    expect(next.dredgeRules).toHaveLength(1);
    expect(next.laoFindsItems).toEqual({});
    expect(next.laoFindsStartedAt).toBeTruthy();
  });

  it("resets the rule-set start point on semantic rule changes but not name-only edits", () => {
    const base: AppState = {
      ...defaultAppState,
      laoFindsStartedAt: "2026-06-29T00:00:00.000Z",
      dredgeRules: [rule({ id: "rule-ai", name: "AI", patterns: ["ai"] })]
    };

    const renamed = upsertDredgeRule(base, { id: "rule-ai", name: "AI 规则" });
    const retargeted = upsertDredgeRule(base, { id: "rule-ai", patterns: ["llm"] });
    const remoded = upsertDredgeRule(base, { id: "rule-ai", mode: "block" });
    const toggled = upsertDredgeRule(base, { id: "rule-ai", enabled: false });

    expect(renamed.laoFindsStartedAt).toBe("2026-06-29T00:00:00.000Z");
    expect(retargeted.laoFindsStartedAt).not.toBe("2026-06-29T00:00:00.000Z");
    expect(remoded.laoFindsStartedAt).not.toBe("2026-06-29T00:00:00.000Z");
    expect(toggled.laoFindsStartedAt).not.toBe("2026-06-29T00:00:00.000Z");
  });

  it("filters collection by the rule-set start point", () => {
    const state = withRules([rule({ id: "rule-ai", patterns: ["AI"] })], "2026-06-30T00:00:00.000Z");

    const result = collectLaoFindsItems(
      state,
      [
        activity({ id: "old", title: "AI old", occurredAt: "2026-06-29T23:59:59.000Z" }),
        activity({ id: "equal", title: "AI equal", occurredAt: "2026-06-30T00:00:00.000Z" }),
        activity({ id: "new", title: "AI new", occurredAt: "2026-06-30T00:00:01.000Z" }),
        activity({ id: "invalid", title: "AI invalid", occurredAt: "bad" })
      ],
      "2026-06-30T00:02:00.000Z"
    );

    expect(result.collectedCount).toBe(1);
    expect(Object.keys(result.state.laoFindsItems)).toEqual(["new"]);
  });

  it("establishes a missing or invalid start point without backfilling the current batch", () => {
    const missing = withRules([rule({ id: "rule-ai", patterns: ["AI"] })]);
    const invalid = { ...missing, laoFindsStartedAt: "bad" };

    const missingResult = collectLaoFindsItems(missing, [activity({ id: "a1", title: "AI" })], "2026-06-30T00:02:00.000Z");
    const invalidResult = collectLaoFindsItems(invalid, [activity({ id: "a2", title: "AI" })], "2026-06-30T00:03:00.000Z");

    expect(missingResult.collectedCount).toBe(0);
    expect(missingResult.state.laoFindsItems).toEqual({});
    expect(missingResult.state.laoFindsStartedAt).toBe("2026-06-30T00:02:00.000Z");
    expect(invalidResult.state.laoFindsItems).toEqual({});
    expect(invalidResult.state.laoFindsStartedAt).toBe("2026-06-30T00:03:00.000Z");
  });

  it("establishes a missing start point even when the current batch is empty", () => {
    const bootstrapped = collectLaoFindsItems(
      withRules([rule({ id: "rule-ai", patterns: ["AI"] })]),
      [],
      "2026-06-30T00:02:00.000Z"
    );
    const next = collectLaoFindsItems(
      bootstrapped.state,
      [activity({ id: "later-ai", title: "AI later", occurredAt: "2026-06-30T00:03:00.000Z" })],
      "2026-06-30T00:04:00.000Z"
    );

    expect(bootstrapped).toMatchObject({
      collectedCount: 0,
      state: { laoFindsStartedAt: "2026-06-30T00:02:00.000Z", laoFindsItems: {} }
    });
    expect(next.collectedCount).toBe(1);
    expect(Object.keys(next.state.laoFindsItems)).toEqual(["later-ai"]);
  });
});

function withRules(rules: DredgeRule[], laoFindsStartedAt?: string): AppState {
  return { ...defaultAppState, dredgeRules: rules, laoFindsStartedAt };
}

function rule(patch: Partial<DredgeRule>): DredgeRule {
  return {
    schemaVersion: 2,
    id: "rule",
    name: "规则",
    enabled: true,
    mode: "allow",
    usernames: "all",
    kinds: ["topic", "reply", "boost", "reaction", "like"],
    patterns: [],
    createdAt: "2026-06-30T00:00:00.000Z",
    updatedAt: "2026-06-30T00:00:00.000Z",
    ...patch
  };
}

function activity(patch: Partial<ActivityItem>): ActivityItem {
  return {
    id: "activity",
    username: "neo",
    kind: "topic",
    title: "标题",
    occurredAt: "2026-06-30T00:00:00.000Z",
    ...patch
  };
}
