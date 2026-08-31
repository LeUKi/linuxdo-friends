import React from "react";
import { ExternalLink, LoaderCircle, RefreshCw } from "lucide-react";
import { GITHUB_LATEST_RELEASE_URL } from "../domain/versionCheck";
import { formatRelativeTime } from "../shared/time";
import type { UpdateCheckState } from "../shared/types";

export const GITHUB_PROJECT_URL = "https://github.com/LeUKi/linuxdo-friends";

export function VersionBadge({ state }: { state: UpdateCheckState }) {
  const latestVersion = state.status === "update-available" && state.latestVersion ? state.latestVersion : null;
  return (
    <div className="version-badge" aria-label="插件版本">
      <a className="version-github-link" href={GITHUB_PROJECT_URL} target="_blank" rel="noreferrer" title="打开 GitHub 项目" aria-label="打开 GitHub 项目">
        <GitHubMark size={13} />
      </a>
      <span className="version-current">v{state.installedVersion}</span>
      {latestVersion ? (
        <a className="version-update-link" href={GITHUB_LATEST_RELEASE_URL} target="_blank" rel="noreferrer">
          新 v{latestVersion}
          <ExternalLink size={11} aria-hidden="true" />
        </a>
      ) : null}
    </div>
  );
}

export function VersionDiagnostics({
  now,
  onCheck,
  state
}: {
  now: number;
  onCheck: () => void;
  state: UpdateCheckState;
}) {
  const latestVersion = state.latestVersion ? `v${state.latestVersion}` : "暂无";
  const checkedAt = state.checkedAt ? `${formatRelativeTime(state.checkedAt, now)}检查` : "尚未检查";
  const message = diagnosticMessage(state);
  return (
    <section className="panel version-panel">
      <div className="section-title">
        <h2>版本更新</h2>
        <button className="small-action" type="button" onClick={onCheck} disabled={state.status === "checking"}>
          {state.status === "checking" ? (
            <LoaderCircle className="spin-icon" size={13} aria-hidden="true" />
          ) : (
            <RefreshCw size={13} aria-hidden="true" />
          )}
          检查更新
        </button>
      </div>
      <div className="version-diagnostic-grid">
        <span>当前版本</span>
        <strong>v{state.installedVersion}</strong>
        <span>最新版本</span>
        {state.status === "update-available" ? (
          <a className="version-diagnostic-link" href={GITHUB_LATEST_RELEASE_URL} target="_blank" rel="noreferrer">
            {latestVersion}
            <ExternalLink size={12} aria-hidden="true" />
          </a>
        ) : (
          <strong>{latestVersion}</strong>
        )}
        <span>检查状态</span>
        <strong>{message}</strong>
        <span>检查时间</span>
        <strong>{checkedAt}</strong>
      </div>
      {state.status === "error" || state.status === "no-release" || state.status === "permission-required" ? (
        <p className="version-diagnostic-error">{state.error}</p>
      ) : null}
    </section>
  );
}

function GitHubMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M8 .2a8 8 0 0 0-2.5 15.6c.4.1.5-.2.5-.4v-1.5c-2.2.5-2.7-1-2.7-1-.3-.8-.7-1-.7-1-.6-.4 0-.4 0-.4.7 0 1.1.7 1.1.7.6 1.1 1.7.8 2.1.6.1-.5.2-.8.4-1-1.8-.2-3.6-.9-3.6-3.9 0-.9.3-1.6.8-2.2-.1-.2-.3-1 .1-2.1 0 0 .7-.2 2.2.8A7.5 7.5 0 0 1 8 4.6c.8 0 1.5.1 2.2.3 1.5-1 2.2-.8 2.2-.8.4 1.1.2 1.9.1 2.1.5.6.8 1.3.8 2.2 0 3-1.8 3.7-3.6 3.9.3.3.5.7.5 1.4v1.7c0 .2.1.5.5.4A8 8 0 0 0 8 .2Z"
      />
    </svg>
  );
}

function diagnosticMessage(state: UpdateCheckState): string {
  switch (state.status) {
    case "checking":
      return "正在检查";
    case "update-available":
      return "发现新版本";
    case "up-to-date":
      return "已是最新";
    case "no-release":
      return "暂无 Release";
    case "permission-required":
      return "需要数据权限";
    case "error":
      return "检查失败";
    case "idle":
      return "待检查";
  }
}
