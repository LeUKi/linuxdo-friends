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
});
