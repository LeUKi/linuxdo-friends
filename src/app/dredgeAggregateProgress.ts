import { planActivityRefreshTargets, scopeLabel } from "../domain/activityRefresh";
import type { ActivityRefreshScope, ActivityRefreshTaskProgress, AppState, SiteDataTaskProgress } from "../shared/types";

export interface TimedActivityAggregateRun {
  runId: string;
  scopeOffsets: number[];
  scopeTotals: number[];
  scopes: ActivityRefreshScope[];
  startedAt: string;
  total: number;
}

export interface TimedActivityAggregateProgressState {
  run: TimedActivityAggregateRun;
  scopeIndex: number;
  completedWithinScope: number;
  currentLabel?: string;
  source?: ActivityRefreshTaskProgress["source"];
  updatedAt: string;
}

export type TimedActivityAggregateProgressUpdater = (state: TimedActivityAggregateProgressState | null) => void;

export interface AggregateActivityProgressSnapshot {
  origin: "ui_aggregate";
  progress: ActivityRefreshTaskProgress;
}

export function createTimedActivityAggregateRun(state: AppState, scopes: ActivityRefreshScope[], runId: string, startedAt: string): TimedActivityAggregateRun {
  const scopeTotals = scopes.map((scope) => planActivityRefreshTargets(state, scope).reduce((sum, target) => sum + target.steps.length, 0));
  const scopeOffsets: number[] = [];
  let offset = 0;
  for (const total of scopeTotals) {
    scopeOffsets.push(offset);
    offset += total;
  }
  return {
    runId,
    scopeOffsets,
    scopeTotals,
    scopes,
    startedAt,
    total: offset
  };
}

export function aggregateProgressStateForScope(
  run: TimedActivityAggregateRun,
  scopeIndex: number,
  completedWithinScope: number,
  updatedAt: string
): TimedActivityAggregateProgressState {
  return {
    run,
    scopeIndex,
    completedWithinScope,
    currentLabel: scopeLabel(run.scopes[scopeIndex] ?? { kind: "all" }),
    updatedAt
  };
}

export function isProgressForAggregateRun(
  progress: SiteDataTaskProgress | null,
  runId: string
): progress is ActivityRefreshTaskProgress {
  return progress?.taskType === "activity" && progress.status === "running" && progress.timedRunId === runId;
}

export function aggregateProgressSnapshotFromState(
  aggregate: TimedActivityAggregateProgressState,
  progress?: ActivityRefreshTaskProgress
): AggregateActivityProgressSnapshot {
  const scope = aggregate.run.scopes[aggregate.scopeIndex] ?? { kind: "all" };
  const scopeTotal = aggregate.run.scopeTotals[aggregate.scopeIndex] ?? progress?.total ?? 0;
  const completedWithinScope = progress ? progress.completed : aggregate.completedWithinScope;
  const safeScopeCompleted = Math.max(0, Math.min(completedWithinScope, scopeTotal));
  const completed = Math.max(0, Math.min((aggregate.run.scopeOffsets[aggregate.scopeIndex] ?? 0) + safeScopeCompleted, aggregate.run.total));
  return {
    origin: "ui_aggregate",
    progress: {
      taskId: `aggregate:${aggregate.run.runId}`,
      taskType: "activity",
      scope,
      status: "running",
      trigger: "timed",
      timedRunId: aggregate.run.runId,
      completed,
      total: aggregate.run.total,
      currentLabel: progress?.currentLabel ?? aggregate.currentLabel,
      source: progress?.source ?? aggregate.source,
      startedAt: aggregate.run.startedAt,
      updatedAt: progress?.updatedAt ?? aggregate.updatedAt
    }
  };
}
