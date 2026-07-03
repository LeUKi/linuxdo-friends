import { describe, expect, it } from "vitest";
import type { SiteDataTaskProgress } from "../shared/types";
import { deriveDredgeProgressDisplay } from "./dredgeProgress";

function activityProgress(patch: Partial<Extract<SiteDataTaskProgress, { taskType: "activity" }>> = {}): Extract<SiteDataTaskProgress, { taskType: "activity" }> {
  return {
    taskId: "activity-1",
    taskType: "activity",
    scope: { kind: "all" },
    status: "running",
    completed: 1,
    total: 4,
    currentLabel: "话题 @neo",
    startedAt: "2026-06-28T00:00:00.000Z",
    updatedAt: "2026-06-28T00:00:01.000Z",
    ...patch
  };
}

function profileProgress(): Extract<SiteDataTaskProgress, { taskType: "profiles" }> {
  return {
    taskId: "profiles-1",
    taskType: "profiles",
    usernames: ["neo"],
    status: "running",
    completed: 1,
    total: 2,
    currentLabel: "@neo",
    startedAt: "2026-06-28T00:00:00.000Z",
    updatedAt: "2026-06-28T00:00:01.000Z"
  };
}

describe("deriveDredgeProgressDisplay", () => {
  it("returns an idle telescope display when there is no running activity progress", () => {
    expect(deriveDredgeProgressDisplay(null)).toEqual({
      completed: 0,
      icon: "telescope",
      percent: 0,
      running: false,
      total: 0
    });
    expect(deriveDredgeProgressDisplay(profileProgress())).toEqual({
      completed: 0,
      icon: "telescope",
      percent: 0,
      running: false,
      total: 0
    });
    expect(deriveDredgeProgressDisplay(activityProgress({ status: "success" }))).toEqual({
      completed: 0,
      icon: "telescope",
      percent: 0,
      running: false,
      total: 0
    });
  });

  it("derives shared global and local running copy for manual activity progress", () => {
    expect(deriveDredgeProgressDisplay(activityProgress({ trigger: "manual", completed: 1, total: 4 }))).toEqual({
      completed: 1,
      globalCopy: "打捞中 25%",
      icon: "spinner",
      localDetail: "话题 @neo · 1/4",
      localLabel: "话题 @neo",
      percent: 25,
      running: true,
      total: 4
    });
  });

  it("uses automatic dredge local fallback wording while keeping the header copy global", () => {
    expect(deriveDredgeProgressDisplay(activityProgress({ trigger: "timed", currentLabel: undefined, completed: 2, total: 4 }))).toEqual({
      completed: 2,
      globalCopy: "打捞中 50%",
      icon: "spinner",
      localDetail: "自动捞料中 · 2/4",
      localLabel: "自动捞料中",
      percent: 50,
      running: true,
      total: 4
    });
  });

  it("handles zero and out-of-range totals safely", () => {
    expect(deriveDredgeProgressDisplay(activityProgress({ completed: 0, total: 0 }))).toMatchObject({
      globalCopy: "打捞中 0%",
      localDetail: "话题 @neo",
      percent: 0,
      running: true
    });
    expect(deriveDredgeProgressDisplay(activityProgress({ completed: 5, total: 4 }))).toMatchObject({
      globalCopy: "打捞中 100%",
      localDetail: "话题 @neo · 4/4",
      percent: 100,
      running: true
    });
  });
});
