import type { PageScriptHeartbeat } from "./types";

export const PAGE_SCRIPT_HEARTBEAT_FRESH_MS = 45_000;
export const PAGE_SCRIPT_HEARTBEAT_STALE_MS = 120_000;

export function isFreshPageScriptHeartbeat(entry: Pick<PageScriptHeartbeat, "updatedAt">, nowMs = Date.now()): boolean {
  const updatedAtMs = Date.parse(entry.updatedAt);
  return Number.isFinite(updatedAtMs) && nowMs - updatedAtMs <= PAGE_SCRIPT_HEARTBEAT_FRESH_MS;
}

export function isFreshReadyPageScriptHeartbeat(entry: PageScriptHeartbeat, nowMs = Date.now()): boolean {
  return entry.status === "ready" && Number.isInteger(entry.tabId) && isFreshPageScriptHeartbeat(entry, nowMs);
}
