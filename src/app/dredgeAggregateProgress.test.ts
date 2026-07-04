import { describe, expect, it } from "vitest";
import { defaultAppState } from "../domain/defaultState";
import type { ActivityRefreshTaskProgress, AppState } from "../shared/types";
import { aggregateProgressSnapshotFromState, createTimedActivityAggregateRun } from "./dredgeAggregateProgress";

function stateWithDredgeTarget(): AppState {
  return {
    ...defaultAppState,
    friends: {
      neo: {
        username: "neo",
        note: "",
        groups: [],
        pinned: false,
        activityKinds: ["topic", "reaction"],
        upgradedAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z"
      }
    }
  };
}

describe("dredge aggregate progress", () => {
  it("keeps UI aggregate progress explicitly wrapped instead of returning canonical storage progress", () => {
    const run = createTimedActivityAggregateRun(
      stateWithDredgeTarget(),
      [
        { kind: "topic", usernames: ["neo"] },
        { kind: "reaction", usernames: ["neo"] }
      ],
      "timed-run-1",
      "2026-06-28T00:00:00.000Z"
    );
    const scopeProgress: ActivityRefreshTaskProgress = {
      taskId: "scope-reaction",
      taskType: "activity",
      scope: { kind: "reaction", usernames: ["neo"] },
      status: "running",
      trigger: "timed",
      timedRunId: "timed-run-1",
      completed: 1,
      total: 1,
      currentLabel: "回应 @neo",
      source: "existing_tab",
      startedAt: "2026-06-28T00:00:02.000Z",
      updatedAt: "2026-06-28T00:00:03.000Z"
    };

    const snapshot = aggregateProgressSnapshotFromState(
      {
        run,
        scopeIndex: 1,
        completedWithinScope: 0,
        currentLabel: "@neo 回应",
        updatedAt: "2026-06-28T00:00:02.000Z"
      },
      scopeProgress
    );

    expect(snapshot.origin).toBe("ui_aggregate");
    expect(snapshot.progress).toMatchObject({
      taskId: "aggregate:timed-run-1",
      completed: 2,
      total: 2,
      trigger: "timed",
      currentLabel: "回应 @neo",
      timedRunId: "timed-run-1"
    });
  });

  it("preserves manual trigger semantics in aggregate progress snapshots", () => {
    const run = createTimedActivityAggregateRun(
      stateWithDredgeTarget(),
      [{ kind: "topic", usernames: ["neo"] }],
      "manual-run-1",
      "2026-06-28T00:00:00.000Z",
      "manual"
    );

    const snapshot = aggregateProgressSnapshotFromState({
      run,
      scopeIndex: 0,
      completedWithinScope: 0,
      currentLabel: "@neo 话题",
      updatedAt: "2026-06-28T00:00:00.000Z"
    });

    expect(snapshot.progress).toMatchObject({
      trigger: "manual",
      timedRunId: "manual-run-1",
      currentLabel: "@neo 话题"
    });
  });
});
