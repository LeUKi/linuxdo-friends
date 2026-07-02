import { describe, expect, it } from "vitest";
import { defaultAppState } from "./defaultState";
import {
  archiveLaoFindsItem,
  collectLaoFindsItems,
  markLaoFindsItemRead,
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

  it("matches enabled rules by user, kind, and normalized keyword", () => {
    const state = withRules([rule({ id: "rule-ai", usernames: ["Neo"], kinds: ["topic"], keywords: ["AI 工具"] })], "2026-06-29T00:00:00.000Z");

    const result = collectLaoFindsItems(
      state,
      [
        activity({ id: "hit", username: "neo", kind: "topic", title: "一个 AI 工具" }),
        activity({ id: "wrong-user", username: "ada", kind: "topic", title: "一个 AI 工具" }),
        activity({ id: "wrong-kind", username: "neo", kind: "reply", title: "一个 AI 工具" }),
        activity({ id: "wrong-keyword", username: "neo", kind: "topic", title: "闲聊" })
      ],
      "2026-06-30T00:00:00.000Z"
    );

    expect(Object.keys(result.state.laoFindsItems)).toEqual(["hit"]);
    expect(result.state.laoFindsItems.hit).toMatchObject({ matchedRuleIds: ["rule-ai"], collectedAt: "2026-06-30T00:00:00.000Z" });
  });

  it("treats empty keywords as collect-all inside selected user and kind scope", () => {
    const state = withRules([rule({ id: "rule-all-neo", usernames: ["neo"], kinds: ["boost"], keywords: [] })], "2026-06-29T00:00:00.000Z");

    const result = collectLaoFindsItems(state, [activity({ id: "boost-1", username: "neo", kind: "boost", title: "Boost" })]);

    expect(result.collectedCount).toBe(1);
    expect(result.state.laoFindsItems["boost-1"].matchedRuleIds).toEqual(["rule-all-neo"]);
  });

  it("ignores disabled rules", () => {
    const state = withRules([rule({ id: "disabled", enabled: false, keywords: ["AI"] })], "2026-06-29T00:00:00.000Z");

    const result = collectLaoFindsItems(state, [activity({ id: "a1", title: "AI" })]);

    expect(result.state.laoFindsItems).toEqual({});
  });

  it("deduplicates repeated refreshes and preserves read/archive flags", () => {
    const state = withRules([rule({ id: "rule-ai", keywords: ["AI"] })], "2026-06-29T00:00:00.000Z");
    const first = collectLaoFindsItems(state, [activity({ id: "a1", title: "AI", excerpt: "old" })], "2026-06-30T00:00:00.000Z").state;
    const marked = archiveLaoFindsItem(markLaoFindsItemRead(first, "a1", true), "a1", true);

    const second = collectLaoFindsItems(marked, [activity({ id: "a1", title: "AI", excerpt: "new" })], "2026-06-30T01:00:00.000Z");

    expect(second.collectedCount).toBe(0);
    expect(second.state.laoFindsItems.a1.collectedAt).toBe("2026-06-30T00:00:00.000Z");
    expect(second.state.laoFindsItems.a1.activity.excerpt).toBe("new");
    expect(second.state.laoFindsItems.a1.readAt).toBeTruthy();
    expect(second.state.laoFindsItems.a1.archivedAt).toBeTruthy();
  });

  it("merges rule matches and removes deleted rule ids from existing items", () => {
    const state = withRules([rule({ id: "rule-ai", keywords: ["AI"] }), rule({ id: "rule-llm", keywords: ["LLM"] })], "2026-06-29T00:00:00.000Z");
    const collected = collectLaoFindsItems(state, [activity({ id: "a1", title: "AI LLM" })]).state;

    expect(collected.laoFindsItems.a1.matchedRuleIds).toEqual(["rule-ai", "rule-llm"]);

    const removed = removeDredgeRule(collected, "rule-ai");
    expect(removed.laoFindsItems.a1.matchedRuleIds).toEqual(["rule-llm"]);
    expect(removed.laoFindsStartedAt).toBeTruthy();
  });

  it("upserts rules with normalized usernames, kinds, and keywords", () => {
    const state = upsertDredgeRule(defaultAppState, {
      id: "rule-1",
      name: "  AI  ",
      usernames: ["@Neo", "neo"],
      kinds: ["reply", "topic"],
      keywords: [" AI  工具 ", "ai 工具"]
    });

    expect(state.dredgeRules[0]).toMatchObject({
      id: "rule-1",
      name: "AI",
      usernames: ["neo"],
      kinds: ["topic", "reply"],
      keywords: ["ai 工具"]
    });
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

    const next = upsertDredgeRule(cachedActivityState, { id: "rule-ai", keywords: ["AI"] });

    expect(next.dredgeRules).toHaveLength(1);
    expect(next.laoFindsItems).toEqual({});
    expect(next.laoFindsStartedAt).toBeTruthy();
  });

  it("resets the rule-set start point on semantic rule changes but not name-only edits", () => {
    const base: AppState = {
      ...defaultAppState,
      laoFindsStartedAt: "2026-06-29T00:00:00.000Z",
      dredgeRules: [rule({ id: "rule-ai", name: "AI", keywords: ["ai"] })]
    };

    const renamed = upsertDredgeRule(base, { id: "rule-ai", name: "AI 规则" });
    const retargeted = upsertDredgeRule(base, { id: "rule-ai", keywords: ["llm"] });
    const toggled = upsertDredgeRule(base, { id: "rule-ai", enabled: false });

    expect(renamed.laoFindsStartedAt).toBe("2026-06-29T00:00:00.000Z");
    expect(retargeted.laoFindsStartedAt).not.toBe("2026-06-29T00:00:00.000Z");
    expect(toggled.laoFindsStartedAt).not.toBe("2026-06-29T00:00:00.000Z");
  });

  it("filters collection by the rule-set start point", () => {
    const state = withRules([rule({ id: "rule-ai", keywords: ["AI"] })], "2026-06-30T00:00:00.000Z");

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
    const missing = withRules([rule({ id: "rule-ai", keywords: ["AI"] })]);
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
      withRules([rule({ id: "rule-ai", keywords: ["AI"] })]),
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
    id: "rule",
    name: "规则",
    enabled: true,
    usernames: "all",
    kinds: ["topic", "reply", "boost", "reaction"],
    keywords: [],
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
