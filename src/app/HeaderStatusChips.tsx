import { useEffect, useRef, useState } from "react";
import { ChartColumn, Check, Cloud, LoaderCircle, PanelRightOpen, RefreshCw, Settings } from "lucide-react";
import { isFreshReadyPageScriptHeartbeat } from "../shared/pageScriptStatus";
import type { CloudArchiveLocalStateResult, PageScriptHeartbeat, PageScriptStatusSnapshot, Username } from "../shared/types";
import { eventHappenedInside } from "./activityLinks";

export function PageScriptStatusBadge({
  status,
  onActivateTab,
  onOpenLinuxDoHome,
  onRepairPageScript
}: {
  status: PageScriptStatusSnapshot;
  onActivateTab: (tabId: number) => void;
  onOpenLinuxDoHome: () => void;
  onRepairPageScript: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const label = pageScriptStatusLabel(status);
  const connected = status.status === "connected";
  const readyHeartbeats = connected && open ? readyPageScriptHeartbeats(status) : [];

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current && !eventHappenedInside(event, rootRef.current)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!connected) {
      setOpen(false);
    }
  }, [connected]);

  function handleStatusClick() {
    if (connected) {
      setOpen((current) => !current);
      return;
    }
    if (status.status === "stale") {
      onRepairPageScript();
      return;
    }
    onOpenLinuxDoHome();
  }

  function handleActivate(entry: PageScriptHeartbeat) {
    setOpen(false);
    onActivateTab(entry.tabId);
  }

  return (
    <div className="page-script-status-control" ref={rootRef}>
      <button
        className={`page-script-badge page-script-${status.status}`}
        type="button"
        onClick={handleStatusClick}
        title={pageScriptStatusTitle(status)}
        aria-label={pageScriptStatusAriaLabel(status)}
        aria-haspopup={connected ? "menu" : undefined}
        aria-expanded={connected ? open : undefined}
      >
        <span className="page-script-badge-dot" aria-hidden="true" />
        <span className="page-script-badge-label">{label}</span>
      </button>
      {connected && open ? (
        <div className="page-script-popover" role="menu" aria-label="已连接的 linux.do 页面">
          {readyHeartbeats.length > 0 ? (
            readyHeartbeats.map((entry) => {
              const selected = entry.tabId === status.selectedTabId;
              return (
                <button
                  className={`page-script-tab-option${selected ? " is-selected" : ""}`}
                  type="button"
                  role="menuitem"
                  key={`${entry.tabId}-${entry.updatedAt}`}
                  onClick={() => handleActivate(entry)}
                  title={entry.title ? `${entry.title} ${entry.url}` : entry.url}
                >
                  <span className="page-script-tab-text">
                    <span className="page-script-tab-title">{entry.title || "linux.do 页面"}</span>
                    <span className="page-script-tab-url">{compactLinuxDoUrl(entry.url)}</span>
                  </span>
                  {selected ? <Check className="page-script-tab-check" size={14} aria-label="当前页面" /> : <span className="page-script-tab-check-placeholder" aria-hidden="true" />}
                </button>
              );
            })
          ) : (
            <span className="page-script-tab-empty">暂无可切换页面</span>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function SidePanelLauncherButton({ status, onOpen }: { status: PageScriptStatusSnapshot; onOpen: () => void }) {
  return (
    <button className={`header-icon-chip side-panel-chip page-script-${status.status}`} type="button" onClick={onOpen} title="打开浏览器侧栏" aria-label="打开浏览器侧栏">
      <PanelRightOpen size={14} aria-hidden="true" />
    </button>
  );
}

export function AccountDetectTag({
  detecting,
  onDetect,
  username
}: {
  detecting: boolean;
  onDetect: () => void;
  username?: Username;
}) {
  const label = username ? `重新探测本地账号：@${username}` : "探测本地账号";
  return (
    <button
      className={`badge badge-button account-badge${detecting ? " is-loading" : ""}`}
      type="button"
      onClick={onDetect}
      disabled={detecting}
      title={label}
      aria-label={label}
    >
      {detecting ? <LoaderCircle className="spin-icon" size={13} aria-hidden="true" /> : username ? null : <RefreshCw size={13} aria-hidden="true" />}
      <span>{detecting ? "识别中" : username ? `@${username}` : "识别账号"}</span>
    </button>
  );
}

export function RequestStatsSummaryChip({ today, total, onOpen }: { today: number; total: number; onOpen: () => void }) {
  return (
    <button
      className="request-stats-chip"
      type="button"
      onClick={onOpen}
      title={`今日请求 ${today}，总请求 ${total}。打开请求统计。`}
      aria-label={`今日请求 ${today}，总请求 ${total}。打开请求统计。`}
    >
      <ChartColumn size={13} aria-hidden="true" />
      <span className="request-stats-today">{formatCompactRequestCount(today)}</span>
      <span className="request-stats-total">/ {formatCompactRequestCount(total)}</span>
    </button>
  );
}

export function formatCompactRequestCount(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const safeValue = Math.max(0, Math.trunc(value));
  if (safeValue >= 1_000_000) return `${(safeValue / 1_000_000).toFixed(2)}M`;
  if (safeValue >= 1_000) return `${(safeValue / 1_000).toFixed(2)}K`;
  return String(safeValue);
}

export function CloudArchiveTag({ state, onOpen }: { state: CloudArchiveLocalStateResult | null; onOpen: () => void }) {
  const archiveState = state?.archiveState ?? "unbound";
  const same = archiveState === "same";
  const text = archiveState === "different" ? "待备份" : archiveState === "unbound" ? "未绑定" : "";
  const label = same ? "云存档已备份" : archiveState === "different" ? "云存档待备份" : "云存档未绑定";
  return (
    <button className={`cloud-archive-chip cloud-archive-${archiveState}`} type="button" onClick={onOpen} title={`${label}，打开云端备份设置`} aria-label={`${label}，打开云端备份设置`}>
      <span className="cloud-archive-icon" aria-hidden="true">
        <Cloud size={13} />
        {archiveState === "unbound" ? <span className="cloud-archive-cross" /> : null}
      </span>
      {text ? <span className="cloud-archive-text">{text}</span> : null}
    </button>
  );
}

export function OptionsPageButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button className="header-icon-chip settings-chip" type="button" onClick={onOpen} title="打开配置页" aria-label="打开配置页">
      <Settings size={14} aria-hidden="true" />
    </button>
  );
}

function readyPageScriptHeartbeats(status: PageScriptStatusSnapshot) {
  return status.heartbeats.filter((entry) => isFreshReadyPageScriptHeartbeat(entry));
}

function pageScriptStatusLabel(status: PageScriptStatusSnapshot) {
  if (status.status === "connected") return `关联会话 ${status.connectedCount}`;
  if (status.status === "challenge") return "页面验证";
  if (status.status === "stale") return "页面断开";
  return "页面未连";
}

function pageScriptStatusTitle(status: PageScriptStatusSnapshot) {
  const latest = status.heartbeats[0];
  if (status.status === "connected") return "查看并切换已连接的 linux.do 页面。";
  if (status.status === "stale") return "页面脚本没有响应，点击切换并刷新 linux.do 页面。";
  if (status.status === "challenge") return "页面需要浏览器验证，点击切换或打开 linux.do。";
  if (!latest) return "还没有 linux.do 页面脚本心跳，点击打开 linux.do。";
  return `最近页面：${latest.title || latest.url}`;
}

function pageScriptStatusAriaLabel(status: PageScriptStatusSnapshot) {
  const label = pageScriptStatusLabel(status);
  if (status.status === "connected") return `页面连接状态：${label}。点击查看已连接页面。`;
  if (status.status === "stale") return `页面连接状态：${label}。点击刷新 linux.do 页面。`;
  return `页面连接状态：${label}。点击打开 linux.do。`;
}

function compactLinuxDoUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.hostname !== "linux.do") return value;
    const path = `${url.pathname}${url.search}${url.hash}`;
    return path === "/" ? "linux.do/" : `linux.do${path}`;
  } catch {
    return value;
  }
}

export function repairActionForStatus(status: string, onRepairPageScript: () => void, onOpenLinuxDoHome: () => void) {
  if (status.includes("未加载佬朋友脚本") || status.includes("没有响应")) {
    return { label: "一键刷新页面", onClick: onRepairPageScript };
  }
  if (status.includes("浏览器验证") || status.includes("请打开一个 linux.do 页面")) {
    return { label: "打开 linux.do", onClick: onOpenLinuxDoHome };
  }
  return null;
}
