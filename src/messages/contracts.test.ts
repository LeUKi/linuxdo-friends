import { describe, expect, it } from "vitest";
import { isBackgroundCommand } from "./contracts";

describe("message contracts", () => {
  it("accepts rule-derived manual activity refresh ownership", () => {
    expect(
      isBackgroundCommand({
        type: "refreshFriendActivity",
        scope: { kind: "topic", usernames: ["neo"] },
        trigger: "manual",
        timedRunId: "timed-activity:1:manual"
      })
    ).toBe(true);
  });

  it("accepts clearing all Lao Finds items as a no-payload command", () => {
    expect(isBackgroundCommand({ type: "clearLaoFindsItems" })).toBe(true);
  });

  it("accepts telegram digest notification enablement in settings patches", () => {
    expect(
      isBackgroundCommand({
        type: "updateSettings",
        settings: { laoFindsTelegramNotificationsEnabled: true }
      })
    ).toBe(true);
  });

  it("rejects invalid telegram digest notification enablement in settings patches", () => {
    expect(
      isBackgroundCommand({
        type: "updateSettings",
        settings: { laoFindsTelegramNotificationsEnabled: "yes" }
      })
    ).toBe(false);
  });

  it("accepts normalized friend notes up to 80 characters and rejects longer updates", () => {
    expect(isBackgroundCommand({ type: "updateFriend", username: "neo", patch: { note: "中".repeat(80) } })).toBe(true);
    expect(isBackgroundCommand({ type: "updateFriend", username: "neo", patch: { note: "NAS\nlab" } })).toBe(true);
    expect(isBackgroundCommand({ type: "updateFriend", username: "neo", patch: { note: "中".repeat(81) } })).toBe(false);
  });
  it("accepts saved Telegram credentials marker for channel-level test notifications", () => {
    expect(
      isBackgroundCommand({
        type: "testTelegramNotification",
        credentials: { kind: "saved" }
      })
    ).toBe(true);
  });

  it("rejects missing Telegram test credentials", () => {
    expect(
      isBackgroundCommand({
        type: "testTelegramNotification"
      })
    ).toBe(false);
  });

  it("accepts draft Telegram credentials for one-off test notifications", () => {
    expect(
      isBackgroundCommand({
        type: "testTelegramNotification",
        credentials: { kind: "draft", botToken: "draft-token", chatId: "12345" }
      })
    ).toBe(true);
  });

  it("rejects invalid draft Telegram test credentials", () => {
    expect(
      isBackgroundCommand({
        type: "testTelegramNotification",
        credentials: { kind: "draft", botToken: 123, chatId: "12345" }
      })
    ).toBe(false);
  });

});
