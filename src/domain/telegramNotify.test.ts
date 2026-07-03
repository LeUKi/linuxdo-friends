import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { buildLaoFindsTelegramMessageBatches, sendLaoFindsTelegramNotifications } from "./telegramNotify";
import type { LaoFindsItem } from "../shared/types";

function item(patch: Partial<LaoFindsItem> = {}): LaoFindsItem {
  return {
    id: "topic:neo:1",
    activityId: "topic:neo:1",
    collectedAt: "2026-07-03T00:00:00.000Z",
    matchedRuleIds: ["rule-ai"],
    activity: {
      id: "topic:neo:1",
      username: "neo",
      kind: "topic",
      title: "AI 工具 (测试)",
      url: "/t/topic/1",
      excerpt: "值得看看 _ Markdown"
    },
    ...patch
  };
}

describe("Lao Finds Telegram notifications", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds one MarkdownV2-safe timed dredge digest with count and item details", () => {
    const [message] = buildLaoFindsTelegramMessageBatches([item()], "timed");

    expect(message).toContain("佬有料 自动捞料新增 1 条");
    expect(message).toContain("@neo");
    expect(message).toContain("话题：AI 工具 \\(测试\\)");
    expect(message).toContain("命中规则：rule\\-ai");
    expect(message).toContain("值得看看 \\_ Markdown");
    expect(message).toContain("[查看动态](https://linux.do/t/topic/1)");
  });

  it("labels manual dredge separately", () => {
    const [message] = buildLaoFindsTelegramMessageBatches([item()], "manual");

    expect(message).toContain("佬有料 手动打捞新增 1 条");
  });

  it("splits long digests without dropping items", () => {
    const items = Array.from({ length: 30 }, (_, index) =>
      item({
        id: `topic:neo:${index}`,
        activityId: `topic:neo:${index}`,
        activity: { ...item().activity, id: `topic:neo:${index}`, title: `AI ${index} ${"x".repeat(170)}` }
      })
    );

    const batches = buildLaoFindsTelegramMessageBatches(items, "timed");

    expect(batches.length).toBeGreaterThan(1);
    expect(batches.every((batch) => batch.length <= 4096)).toBe(true);
    expect(batches.join("\n")).toContain("30\\. @neo");
  });

  it("keeps a single oversized item within Telegram limits", () => {
    const [message] = buildLaoFindsTelegramMessageBatches(
      [
        item({
          matchedRuleIds: Array.from({ length: 180 }, (_, index) => `rule-${index}-${"_".repeat(40)}`),
          activity: {
            ...item().activity,
            title: `${"(".repeat(500)} oversized title`,
            excerpt: "_".repeat(2000),
            url: `/t/topic/${")\\".repeat(1000)}`
          }
        })
      ],
      "timed"
    );

    expect(message.length).toBeLessThanOrEqual(4096);
    expect(message).toContain("佬有料 自动捞料新增 1 条");
    expect(message).toContain("1\\. @neo");
  });

  it("sends each digest batch through Telegram sendMessage when configured", async () => {
    await sendLaoFindsTelegramNotifications({ botToken: "token", chatId: "chat", source: "timed", items: [item()] });

    expect(fetch).toHaveBeenCalledWith(
      "https://api.telegram.org/bottoken/sendMessage",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"chat_id":"chat"')
      })
    );
  });

  it("does nothing without credentials or items", async () => {
    await sendLaoFindsTelegramNotifications({ botToken: undefined, chatId: "chat", source: "timed", items: [item()] });
    await sendLaoFindsTelegramNotifications({ botToken: "token", chatId: "chat", source: "timed", items: [] });

    expect(fetch).not.toHaveBeenCalled();
  });
});
