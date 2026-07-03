import { formatRelativeTime } from "../shared/time";
import type { CloudArchiveLocalState, CloudArchiveLocalStateResult, CloudConfigStatus, CloudConfigViewState } from "../shared/types";

export function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function configFileName(exportedAt: string) {
  return `linuxdo-friends-config-${exportedAt.replace(/[:.]/g, "-")}.json`;
}

export function cloudArchiveStatusTitle(state: CloudArchiveLocalStateResult | null): string {
  return cloudArchiveStatusCopy(state).title;
}

export function cloudArchiveStatusDescription(state: CloudArchiveLocalStateResult | null): string {
  return cloudArchiveStatusCopy(state).description;
}

export function cloudArchiveStatusHint(state: CloudArchiveLocalStateResult | null): string {
  return cloudArchiveStatusCopy(state).hint;
}

function cloudArchiveStatusCopy(state: CloudArchiveLocalStateResult | null): { title: string; description: string; hint: string } {
  const archiveState: CloudArchiveLocalState = state?.archiveState ?? "unbound";
  if (archiveState === "same") {
    return {
      title: "已备份",
      description: "本地配置已备份到云端。",
      hint: state?.syncedAt ? `同步于 ${new Date(state.syncedAt).toLocaleString()}` : "本地配置已备份到云端。"
    };
  }
  if (archiveState === "different") {
    return {
      title: "待备份",
      description: "本地配置有更新，尚未备份到云端。",
      hint: "建议备份到云端。"
    };
  }
  return {
    title: "未绑定",
    description: "绑定后可以把佬朋友、设置和请求统计备份到云端。",
    hint: "尚未绑定云存档。"
  };
}

export function cloudStatusText(status: CloudConfigStatus | undefined): string {
  if (!status || status.state === "unchecked") return "云端配置尚未检查。";
  if (status.state === "remote_config") {
    const exportedAt = status.exportedAt ? new Date(status.exportedAt).toLocaleString() : "未知时间";
    return `云端配置：${status.friendCount ?? 0} 位佬朋友，导出于 ${exportedAt}。`;
  }
  return status.message ?? "云端配置状态未知。";
}

export function cloudBindingMetaText(binding: Extract<CloudConfigViewState["binding"], { bound: true }>): string {
  const parts = [`账号 ${binding.linuxDoId}`, `绑定于 ${new Date(binding.boundAt).toLocaleString()}`];
  if (binding.lastBackupAt) parts.push(`上次备份 ${new Date(binding.lastBackupAt).toLocaleString()}`);
  if (binding.lastRestoreAt) parts.push(`上次恢复 ${new Date(binding.lastRestoreAt).toLocaleString()}`);
  return parts.join(" · ");
}

export function requestStatsSyncText(binding: Extract<CloudConfigViewState["binding"], { bound: true }> | null): string {
  if (!binding) return "请求统计每日同步需先绑定云存档。";
  if (binding.lastRequestStatsAutoSyncError && isRequestStatsAutoSyncErrorNewer(binding)) {
    return `请求统计上次自动同步失败：${binding.lastRequestStatsAutoSyncError.message ?? "请稍后重试。"}`;
  }
  if (binding.lastRequestStatsSyncedAt) {
    return `请求统计同步于 ${new Date(binding.lastRequestStatsSyncedAt).toLocaleString()} · 总计 ${binding.lastRequestStatsTotal ?? 0} 次`;
  }
  return "请求统计尚未自动同步。";
}

function isRequestStatsAutoSyncErrorNewer(binding: Extract<CloudConfigViewState["binding"], { bound: true }>): boolean {
  const errorAt = binding.lastRequestStatsAutoSyncError?.checkedAt;
  if (!errorAt) return false;
  if (!binding.lastRequestStatsSyncedAt) return true;
  return Date.parse(errorAt) > Date.parse(binding.lastRequestStatsSyncedAt);
}

export function formatLaoFindsStartedAt(value: string | undefined, now: number): string {
  if (!value || Number.isNaN(Date.parse(value))) return "未设置，首次打捞会从当前时间开始。";
  return `${new Date(value).toLocaleString()}（${formatRelativeTime(value, now)}）`;
}
