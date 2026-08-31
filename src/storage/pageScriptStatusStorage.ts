import type { PageScriptHeartbeatStatus, PageScriptStatusSnapshot } from "../shared/types";
import { getSessionStorageArea } from "./sessionStorageAdapter";

export const PAGE_SCRIPT_STATUS_STORAGE_KEY = "linuxdoFriendsPageScriptStatus";

type SessionStorageLike = {
  get(key: string): Promise<Record<string, unknown>>;
  set(value: Record<string, unknown>): Promise<void>;
};

type StorageChanges = Record<string, chrome.storage.StorageChange>;

const emptyStatus: PageScriptStatusSnapshot = {
  status: "missing",
  connectedCount: 0,
  staleCount: 0,
  heartbeats: [],
  updatedAt: new Date(0).toISOString()
};
const fallbackStore: { status: PageScriptStatusSnapshot | null } = { status: null };

export async function loadPageScriptStatusState(
  storage: SessionStorageLike | null = getChromeSessionStorage()
): Promise<PageScriptStatusSnapshot | null> {
  if (!storage) return fallbackStore.status;
  const result = await storage.get(PAGE_SCRIPT_STATUS_STORAGE_KEY);
  return normalizePageScriptStatus(result[PAGE_SCRIPT_STATUS_STORAGE_KEY]);
}

export async function savePageScriptStatusState(
  status: PageScriptStatusSnapshot,
  storage: SessionStorageLike | null = getChromeSessionStorage()
): Promise<void> {
  if (!storage) {
    fallbackStore.status = status;
    return;
  }
  await storage.set({ [PAGE_SCRIPT_STATUS_STORAGE_KEY]: status });
}

export function pageScriptStatusFromStorageChanges(changes: StorageChanges): PageScriptStatusSnapshot | null | undefined {
  if (!(PAGE_SCRIPT_STATUS_STORAGE_KEY in changes)) return undefined;
  return normalizePageScriptStatus(changes[PAGE_SCRIPT_STATUS_STORAGE_KEY].newValue);
}

export function defaultPageScriptStatus(): PageScriptStatusSnapshot {
  return { ...emptyStatus, heartbeats: [] };
}

export function resetPageScriptStatusFallbackStorage() {
  fallbackStore.status = null;
}

export function normalizePageScriptStatus(value: unknown): PageScriptStatusSnapshot | null {
  if (!isRecord(value)) return null;
  if (
    !isStatus(value.status) ||
    typeof value.connectedCount !== "number" ||
    typeof value.staleCount !== "number" ||
    !Array.isArray(value.heartbeats) ||
    typeof value.updatedAt !== "string"
  ) {
    return null;
  }
  const snapshotUpdatedAt = value.updatedAt;
  const heartbeats = value.heartbeats.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.tabId !== "number" || typeof entry.url !== "string" || !isHeartbeatStatus(entry.status)) {
      return [];
    }
    return [{
      tabId: entry.tabId,
      windowId: typeof entry.windowId === "number" ? entry.windowId : undefined,
      url: entry.url,
      title: typeof entry.title === "string" ? entry.title : undefined,
      status: entry.status,
      hasLauncher: entry.hasLauncher === true,
      updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : snapshotUpdatedAt
    }];
  });
  return {
    status: value.status,
    connectedCount: value.connectedCount,
    staleCount: value.staleCount,
    heartbeats,
    selectedTabId: typeof value.selectedTabId === "number" ? value.selectedTabId : undefined,
    updatedAt: value.updatedAt
  };
}

function getChromeSessionStorage(): SessionStorageLike | null {
  if (typeof chrome === "undefined") return null;
  return getSessionStorageArea();
}

function isStatus(value: unknown): value is PageScriptStatusSnapshot["status"] {
  return value === "connected" || value === "challenge" || value === "stale" || value === "missing";
}

function isHeartbeatStatus(value: unknown): value is PageScriptHeartbeatStatus {
  return value === "ready" || value === "challenge" || value === "unavailable";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}
