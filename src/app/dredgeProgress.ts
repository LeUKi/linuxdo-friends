import type { ActivityRefreshTaskProgress, SiteDataTaskProgress } from "../shared/types";

export type DredgeProgressIcon = "spinner" | "telescope";

export interface DredgeProgressDisplay {
  completed: number;
  globalCopy?: string;
  icon: DredgeProgressIcon;
  localDetail?: string;
  localLabel?: string;
  percent: number;
  running: boolean;
  total: number;
}

export function deriveDredgeProgressDisplay(progress: SiteDataTaskProgress | null | undefined): DredgeProgressDisplay {
  if (!isRunningActivityProgress(progress)) {
    return {
      completed: 0,
      icon: "telescope",
      percent: 0,
      running: false,
      total: 0
    };
  }
  const completed = Math.max(0, progress.completed);
  const total = Math.max(0, progress.total);
  const percent = calculateProgressPercent(completed, total);
  const baseLabel = progress.trigger === "timed" ? "自动捞料中" : "打捞中";
  const localLabel = progress.currentLabel ?? baseLabel;
  const localDetail = total > 0 ? `${localLabel} · ${Math.min(completed, total)}/${total}` : localLabel;
  return {
    completed,
    globalCopy: `打捞中 ${percent}%`,
    icon: "spinner",
    localDetail,
    localLabel,
    percent,
    running: true,
    total
  };
}

function isRunningActivityProgress(progress: SiteDataTaskProgress | null | undefined): progress is ActivityRefreshTaskProgress {
  return Boolean(progress && progress.taskType === "activity" && progress.status === "running");
}

function calculateProgressPercent(completed: number, total: number): number {
  if (total <= 0) return 0;
  const raw = Math.round((completed / total) * 100);
  return Math.max(0, Math.min(100, raw));
}
