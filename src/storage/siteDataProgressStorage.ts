import type { ActivityKindFilter, SiteDataTaskProgress } from "../shared/types";

export const SITE_DATA_PROGRESS_STORAGE_KEY = "linuxdoFriendsSiteDataProgress";
export const SITE_DATA_PROGRESS_RUNNING_TTL_MS = 10 * 60_000;

type SessionStorageLike = {
  get(key: string): Promise<Record<string, unknown>>;
  set(value: Record<string, unknown>): Promise<void>;
};

type StorageChanges = Record<string, chrome.storage.StorageChange>;

const fallbackStore: { progress: SiteDataTaskProgress | null } = { progress: null };

export async function loadSiteDataProgressState(
  storage: SessionStorageLike | null = getChromeSessionStorage(),
  now = Date.now()
): Promise<SiteDataTaskProgress | null> {
  if (!storage) return fallbackStore.progress;
  const result = await storage.get(SITE_DATA_PROGRESS_STORAGE_KEY);
  const progress = normalizeSiteDataProgress(result[SITE_DATA_PROGRESS_STORAGE_KEY]);
  if (isStaleRunningSiteDataProgress(progress, now)) return null;
  return progress;
}

export async function saveSiteDataProgressState(
  progress: SiteDataTaskProgress,
  storage: SessionStorageLike | null = getChromeSessionStorage()
): Promise<void> {
  if (!storage) {
    fallbackStore.progress = progress;
    return;
  }
  await storage.set({ [SITE_DATA_PROGRESS_STORAGE_KEY]: progress });
}

export function siteDataProgressFromStorageChanges(changes: StorageChanges): SiteDataTaskProgress | null | undefined {
  if (!(SITE_DATA_PROGRESS_STORAGE_KEY in changes)) return undefined;
  return normalizeSiteDataProgress(changes[SITE_DATA_PROGRESS_STORAGE_KEY].newValue);
}

export function resetSiteDataProgressFallbackStorage() {
  fallbackStore.progress = null;
}

export function normalizeSiteDataProgress(value: unknown): SiteDataTaskProgress | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.taskId !== "string" ||
    (value.taskType !== "activity" && value.taskType !== "profiles") ||
    (value.status !== "running" && value.status !== "success" && value.status !== "error") ||
    typeof value.completed !== "number" ||
    typeof value.total !== "number" ||
    typeof value.startedAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    return null;
  }
  const trigger = normalizeSiteDataTaskTrigger(value.trigger);
  const timedRunId = optionalString(value.timedRunId);
  const retiredReason = normalizeRetiredReason(value.retiredReason);
  if (!isValidProgressOwnership(trigger, timedRunId)) return null;
  if (value.retiredReason !== undefined && (retiredReason === undefined || value.status === "running")) return null;
  const normalizedTrigger = trigger ?? undefined;
  if (value.taskType === "activity") {
    if (!isRecord(value.scope) || !isActivityKindFilter(value.scope.kind)) return null;
    const scope = {
      kind: value.scope.kind,
      usernames: isUsernameList(value.scope.usernames) ? value.scope.usernames : undefined
    };
    return {
      taskId: value.taskId,
      taskType: "activity",
      scope,
      status: value.status,
      trigger: normalizedTrigger,
      timedRunId,
      retiredReason,
      completed: value.completed,
      total: value.total,
      currentLabel: optionalString(value.currentLabel),
      source: normalizeRefreshSource(value.source),
      startedAt: value.startedAt,
      updatedAt: value.updatedAt,
      finishedAt: optionalString(value.finishedAt),
      error: optionalString(value.error)
    };
  }
  if (!isUsernameList(value.usernames)) return null;
  return {
    taskId: value.taskId,
    taskType: "profiles",
    usernames: value.usernames,
    status: value.status,
    trigger: normalizedTrigger,
    timedRunId,
    retiredReason,
    completed: value.completed,
    total: value.total,
    currentLabel: optionalString(value.currentLabel),
    source: normalizeRefreshSource(value.source),
    startedAt: value.startedAt,
    updatedAt: value.updatedAt,
    finishedAt: optionalString(value.finishedAt),
    error: optionalString(value.error)
  };
}

export function isStaleRunningSiteDataProgress(progress: SiteDataTaskProgress | null | undefined, now = Date.now()): boolean {
  if (progress?.status !== "running") return false;
  const timestamp = Date.parse(progress.updatedAt);
  if (!Number.isFinite(timestamp)) return true;
  return now - timestamp > SITE_DATA_PROGRESS_RUNNING_TTL_MS;
}

function getChromeSessionStorage(): SessionStorageLike | null {
  if (typeof chrome === "undefined") return null;
  return chrome.storage?.session ?? null;
}

function normalizeRefreshSource(value: unknown) {
  return value === "direct_fetch" || value === "existing_tab" || value === "manual" ? value : undefined;
}

function normalizeSiteDataTaskTrigger(value: unknown) {
  if (value === undefined) return undefined;
  return value === "manual" || value === "timed" ? value : null;
}

function normalizeRetiredReason(value: unknown) {
  if (value === undefined) return undefined;
  return value === "timed_disabled" ? value : undefined;
}

function isValidProgressOwnership(trigger: "manual" | "timed" | null | undefined, timedRunId: string | undefined) {
  if (trigger === null) return false;
  if (trigger === "timed") return typeof timedRunId === "string" && timedRunId.trim().length > 0;
  return timedRunId === undefined;
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function isUsernameList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim().length > 0);
}

function isActivityKindFilter(value: unknown): value is ActivityKindFilter {
  return value === "all" || value === "topic" || value === "reply" || value === "boost" || value === "reaction" || value === "like";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}
