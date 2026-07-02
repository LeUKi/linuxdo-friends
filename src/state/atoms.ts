import { atom } from "jotai";
import type { Setter } from "jotai";
import type {
  ActivityRefreshScope,
  AppState,
  BackgroundCommand,
  BackgroundResponse,
  CloudArchiveLocalStateResult,
  CloudConfigStatusResult,
  ConfigExportFile,
  FollowedUserInput,
  FriendUser,
  FriendProfileSummary,
  DredgeRule,
  PageRepairResult,
  PageScriptStatusSnapshot,
  RefreshSettings,
  SiteDataTaskProgress,
  UpdateCheckState
} from "../shared/types";
import { defaultUpdateCheckState } from "../domain/versionCheck";
import { defaultAppState } from "../domain/defaultState";
import { normalizeRequestStats } from "../domain/requestStats";
import { sendCommand } from "../messages/client";
import {
  defaultPageScriptStatus,
  loadPageScriptStatusState,
  pageScriptStatusFromStorageChanges
} from "../storage/pageScriptStatusStorage";
import { loadSiteDataProgressState, siteDataProgressFromStorageChanges } from "../storage/siteDataProgressStorage";
import { APP_STATE_STORAGE_KEY } from "../storage/storage";
import { updateCheckStateFromStorageChanges } from "../storage/updateCheckStorage";

export const appStateAtom = atom<AppState>(defaultAppState);
export const loadingAtom = atom(false);
export const statusMessageAtom = atom<string | null>(null);
export const siteDataProgressAtom = atom<SiteDataTaskProgress | null>(null);
export const pageScriptStatusAtom = atom<PageScriptStatusSnapshot>(defaultPageScriptStatus());
export const updateCheckAtom = atom<UpdateCheckState>(defaultUpdateCheckState(installedVersion()));
export const cloudConfigViewAtom = atom<CloudConfigStatusResult | null>(null);
export const cloudArchiveLocalStateAtom = atom<CloudArchiveLocalStateResult | null>(null);
export const clearStatusMessageAtom = atom(null, (_get, set) => {
  set(statusMessageAtom, null);
});

let siteDataProgressListenerRegistered = false;
let pageScriptStatusListenerRegistered = false;
let appStateStorageListenerRegistered = false;
let siteDataProgressStorageListenerRegistered = false;
let pageScriptStatusStorageListenerRegistered = false;
let updateCheckStorageListenerRegistered = false;
const siteDataProgressSubscribers = new Set<Setter>();
const pageScriptStatusSubscribers = new Set<Setter>();
const appStateStorageSubscribers = new Set<Setter>();
const updateCheckSubscribers = new Set<Setter>();

export const loadStateAtom = atom(null, async (_get, set) => {
  set(loadingAtom, true);
  const response = await sendCommand<AppState>({ type: "getState" });
  if (response.ok) {
    set(appStateAtom, response.data);
    set(statusMessageAtom, null);
  } else {
    set(statusMessageAtom, response.error);
  }
  set(loadingAtom, false);
});

export const observeAppStateAtom = atom(null, (_get, set) => {
  if (typeof chrome === "undefined" || !chrome.storage?.onChanged) return undefined;
  appStateStorageSubscribers.add(set);
  if (!appStateStorageListenerRegistered) {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== "local") return;
      const changedState = changes[APP_STATE_STORAGE_KEY]?.newValue;
      if (!isPartialAppState(changedState)) return;
      const observedState = mergeObservedAppState(changedState);
      appStateStorageSubscribers.forEach((subscriber) => subscriber(appStateAtom, observedState));
    };
    chrome.storage.onChanged.addListener(listener);
    appStateStorageListenerRegistered = true;
  }
  return () => {
    appStateStorageSubscribers.delete(set);
  };
});

export function resetAppStateObserverForTest() {
  appStateStorageListenerRegistered = false;
  appStateStorageSubscribers.clear();
}

export function resetRuntimeObserversForTest() {
  siteDataProgressListenerRegistered = false;
  pageScriptStatusListenerRegistered = false;
  siteDataProgressStorageListenerRegistered = false;
  pageScriptStatusStorageListenerRegistered = false;
  updateCheckStorageListenerRegistered = false;
  siteDataProgressSubscribers.clear();
  pageScriptStatusSubscribers.clear();
  updateCheckSubscribers.clear();
}

export const loadSiteDataProgressAtom = atom(null, async (_get, set) => {
  const storedProgress = await loadSiteDataProgressState();
  if (storedProgress) {
    set(siteDataProgressAtom, storedProgress);
    return;
  }
  const response = await sendCommand<SiteDataTaskProgress | null>({ type: "getSiteDataProgress" });
  if (response.ok) {
    set(siteDataProgressAtom, response.data);
  }
});

export const loadPageScriptStatusAtom = atom(null, async (_get, set) => {
  const storedStatus = await loadPageScriptStatusState();
  if (storedStatus) {
    set(pageScriptStatusAtom, storedStatus);
    return;
  }
  const response = await sendCommand<PageScriptStatusSnapshot>({ type: "getPageScriptStatus" });
  if (response.ok && isPageScriptStatusSnapshot(response.data)) {
    set(pageScriptStatusAtom, response.data);
  }
});

export const loadUpdateCheckAtom = atom(null, async (_get, set) => {
  const response = await sendCommand<UpdateCheckState>({ type: "getUpdateCheck" });
  if (response.ok) {
    set(updateCheckAtom, response.data);
  }
});

export const checkForUpdatesAtom = atom(null, async (get, set, force?: boolean) => {
  const current = get(updateCheckAtom);
  set(updateCheckAtom, { ...current, status: "checking" });
  const response = await sendCommand<UpdateCheckState>({ type: "checkForUpdates", force });
  if (response.ok) {
    set(updateCheckAtom, response.data);
  } else {
    set(updateCheckAtom, {
      ...current,
      status: "error",
      checkedAt: new Date().toISOString(),
      error: response.error || "检查更新失败。"
    });
  }
});

export const loadCloudConfigViewAtom = atom(null, async (_get, set) => {
  const response = await sendCommand<CloudConfigStatusResult>({ type: "getCloudConfigStatus" });
  if (response.ok) {
    set(cloudConfigViewAtom, response.data);
  }
});

export const loadCloudArchiveLocalStateAtom = atom(null, async (_get, set) => {
  const response = await sendCommand<CloudArchiveLocalStateResult>({ type: "getCloudArchiveLocalState" });
  if (response.ok) {
    set(cloudArchiveLocalStateAtom, response.data);
  }
});

export const observeSiteDataProgressAtom = atom(null, (_get, set) => {
  siteDataProgressSubscribers.add(set);
  if (typeof chrome !== "undefined" && chrome.storage?.onChanged && !siteDataProgressStorageListenerRegistered) {
    const storageListener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== "session") return;
      const progress = siteDataProgressFromStorageChanges(changes);
      if (progress === undefined) return;
      siteDataProgressSubscribers.forEach((subscriber) => subscriber(siteDataProgressAtom, progress));
    };
    chrome.storage.onChanged.addListener(storageListener);
    siteDataProgressStorageListenerRegistered = true;
  }
  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage && !siteDataProgressListenerRegistered) {
    const listener = (message: unknown) => {
      if (!isSiteDataProgressMessage(message)) return;
      siteDataProgressSubscribers.forEach((subscriber) => subscriber(siteDataProgressAtom, message.progress));
    };
    chrome.runtime.onMessage.addListener(listener);
    siteDataProgressListenerRegistered = true;
  }
  return () => {
    siteDataProgressSubscribers.delete(set);
  };
});

export const observePageScriptStatusAtom = atom(null, (_get, set) => {
  pageScriptStatusSubscribers.add(set);
  if (typeof chrome !== "undefined" && chrome.storage?.onChanged && !pageScriptStatusStorageListenerRegistered) {
    const storageListener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== "session") return;
      const status = pageScriptStatusFromStorageChanges(changes);
      if (status === undefined) return;
      pageScriptStatusSubscribers.forEach((subscriber) => subscriber(pageScriptStatusAtom, status ?? defaultPageScriptStatus()));
    };
    chrome.storage.onChanged.addListener(storageListener);
    pageScriptStatusStorageListenerRegistered = true;
  }
  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage && !pageScriptStatusListenerRegistered) {
    const listener = (message: unknown) => {
      if (!isPageScriptStatusMessage(message)) return;
      pageScriptStatusSubscribers.forEach((subscriber) => subscriber(pageScriptStatusAtom, message.status));
    };
    chrome.runtime.onMessage.addListener(listener);
    pageScriptStatusListenerRegistered = true;
  }
  return () => {
    pageScriptStatusSubscribers.delete(set);
  };
});

export const observeUpdateCheckAtom = atom(null, (_get, set) => {
  if (typeof chrome === "undefined" || !chrome.storage?.onChanged) return undefined;
  updateCheckSubscribers.add(set);
  if (!updateCheckStorageListenerRegistered) {
    const storageListener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== "local") return;
      const state = updateCheckStateFromStorageChanges(changes, installedVersion());
      if (state === undefined) return;
      updateCheckSubscribers.forEach((subscriber) => subscriber(updateCheckAtom, state));
    };
    chrome.storage.onChanged.addListener(storageListener);
    updateCheckStorageListenerRegistered = true;
  }
  return () => {
    updateCheckSubscribers.delete(set);
  };
});

export const seedFollowedAtom = atom(null, async (_get, set, username: string) => {
  const response = await sendLoadingStateCommand(set, { type: "seedFollowedUser", user: { username } });
  applyStateResponse(set, response, "已添加到关注。");
});

export const addFriendByProfileAtom = atom(null, async (_get, set, username: string) => {
  const response = await sendLoadingStateCommand(set, { type: "addFriendByProfile", username });
  applyStateResponse(set, response);
});

export const addFriendFromKnownUserAtom = atom(null, async (_get, set, user: FollowedUserInput, profile?: FriendProfileSummary) => {
  const response = await sendLoadingStateCommand(set, { type: "addFriendFromKnownUser", user, profile });
  const username = user.username.trim().replace(/^@/, "").toLowerCase();
  applyStateResponse(set, response, response.ok ? `已添加 @${username} 为佬朋友。` : undefined);
});

export const lookupFriendProfileAtom = atom(null, async (_get, _set, username: string) => {
  const response = await sendCommand<FriendProfileSummary>({ type: "lookupFriendProfile", username });
  return response;
});

export const removeFriendAtom = atom(null, async (_get, set, username: string) => {
  const response = await sendLoadingStateCommand(set, { type: "removeFriend", username });
  applyStateResponse(set, response, response.ok ? "已移除佬朋友。" : undefined);
});

export const updateFriendAtom = atom(null, async (_get, set, username: string, patch: Partial<Pick<FriendUser, "note" | "groups" | "pinned" | "activityKinds">>) => {
  const response = await sendLoadingStateCommand(set, { type: "updateFriend", username, patch });
  applyStateResponse(set, response, response.ok ? null : undefined);
});

export const upsertDredgeRuleAtom = atom(null, async (_get, set, rule: Partial<DredgeRule> & { id?: string }) => {
  const response = await sendCommand<AppState>({ type: "upsertDredgeRule", rule });
  applyStateResponse(set, response, response.ok ? null : undefined);
});

export const removeDredgeRuleAtom = atom(null, async (_get, set, id: string) => {
  const response = await sendCommand<AppState>({ type: "removeDredgeRule", id });
  applyStateResponse(set, response, response.ok ? null : undefined);
});

export const resetLaoFindsStartedAtAtom = atom(null, async (_get, set) => {
  const response = await sendCommand<AppState>({ type: "resetLaoFindsStartedAt" });
  applyStateResponse(set, response, response.ok ? null : undefined);
});

export const markLaoFindsItemReadAtom = atom(null, async (_get, set, id: string, read: boolean) => {
  const response = await sendCommand<AppState>({ type: "markLaoFindsItemRead", id, read });
  applyStateResponse(set, response, response.ok ? null : undefined);
});

export const archiveLaoFindsItemAtom = atom(null, async (_get, set, id: string, archived: boolean) => {
  const response = await sendCommand<AppState>({ type: "archiveLaoFindsItem", id, archived });
  applyStateResponse(set, response, response.ok ? null : undefined);
});

export const updateSettingsAtom = atom(null, async (_get, set, settings: Partial<RefreshSettings>) => {
  const response = await sendLoadingStateCommand(set, { type: "updateSettings", settings });
  applyStateResponse(set, response, response.ok ? null : undefined);
  return response;
});

export const refreshFriendProfilesAtom = atom(null, async (_get, set) => {
  const response = await sendLoadingStateCommand(set, { type: "refreshFriendProfiles" });
  applyStateResponse(set, response);
});

export const refreshFriendActivityAtom = atom(null, async (_get, set, scope?: ActivityRefreshScope) => {
  const response = await sendLoadingStateCommand(set, { type: "refreshFriendActivity", scope });
  applyStateResponse(set, response);
  return response;
});

export const refreshFriendActivityForTimedRunAtom = atom(null, async (_get, set, scope: ActivityRefreshScope, timedRunId: string) => {
  const response = await sendCommand<AppState>({ type: "refreshFriendActivity", scope, trigger: "timed", timedRunId });
  if (response.ok) {
    set(appStateAtom, response.data);
  }
  return response;
});

export const syncFollowsAtom = atom(null, async (_get, set) => {
  const response = await sendLoadingStateCommand(set, { type: "syncFollowedUsers" });
  applyStateResponse(set, response);
});

export const identifyCurrentAccountAtom = atom(null, async (_get, set, quiet?: boolean) => {
  const response = quiet
    ? await sendCommand<AppState>({ type: "identifyCurrentAccount" })
    : await sendLoadingStateCommand(set, { type: "identifyCurrentAccount" });
  applyStateResponse(set, response, response.ok && quiet ? null : undefined);
});

export const clearCacheAtom = atom(null, async (_get, set) => {
  const response = await sendLoadingStateCommand(set, { type: "clearCache" });
  applyStateResponse(set, response);
});

export const resetExtensionAtom = atom(null, async (_get, set) => {
  const response = await sendLoadingStateCommand(set, { type: "resetExtension" });
  applyStateResponse(set, response);
});

export const exportConfigAtom = atom(null, async (_get, set) => {
  const response = await sendCommand<ConfigExportFile>({ type: "exportConfig" });
  if (!response.ok) set(statusMessageAtom, response.error);
  return response;
});

export const importConfigAtom = atom(null, async (_get, set, json: string) => {
  const response = await sendLoadingStateCommand(set, { type: "importConfig", json });
  applyStateResponse(set, response);
  return response;
});

export const cacheAvatarsAtom = atom(null, async (_get, set, usernames?: string[]) => {
  const response = await sendCommand<AppState>({ type: "cacheAvatars", usernames });
  if (response.ok) {
    set(appStateAtom, response.data);
  }
});

export const repairLinuxDoPageScriptAtom = atom(null, async (get, set) => {
  const tabId = get(pageScriptStatusAtom).selectedTabId ?? get(pageScriptStatusAtom).heartbeats[0]?.tabId;
  const response = await sendCommand<PageRepairResult>({ type: "repairLinuxDoPageScript", tabId });
  if (response.ok) {
    set(statusMessageAtom, response.data.message);
    await refreshPageScriptStatus(set);
  } else {
    set(statusMessageAtom, response.error);
  }
});

export const openLinuxDoHomeAtom = atom(null, async (get, set) => {
  const response = await sendCommand<PageRepairResult>({ type: "openLinuxDoHome" });
  if (response.ok) {
    set(statusMessageAtom, response.data.message);
    await refreshPageScriptStatus(set);
  } else {
    set(statusMessageAtom, response.error);
  }
});

export const openActivityLinkAtom = atom(null, async (_get, set, url: string) => {
  const response = await sendCommand<PageRepairResult>({ type: "openActivityLink", url });
  if (response.ok) {
    set(statusMessageAtom, null);
  } else {
    set(statusMessageAtom, response.error);
  }
});

export const openSidePanelAtom = atom(null, async (_get, set) => {
  const response = await sendCommand<{ message: string }>({ type: "openSidePanel" });
  if (response.ok) {
    set(statusMessageAtom, null);
  } else {
    set(statusMessageAtom, response.error);
  }
});

export const openOptionsPageAtom = atom(null, async (_get, set, hash?: string) => {
  const response = await sendCommand<{ message: string }>({ type: "openOptionsPage", hash });
  if (response.ok) {
    set(statusMessageAtom, null);
  } else {
    set(statusMessageAtom, response.error);
  }
});

async function refreshPageScriptStatus(set: Setter) {
  const response = await sendCommand<PageScriptStatusSnapshot>({ type: "getPageScriptStatus" });
  if (response.ok && isPageScriptStatusSnapshot(response.data)) {
    set(pageScriptStatusAtom, response.data);
  }
}

async function sendLoadingStateCommand(set: Setter, command: BackgroundCommand): Promise<BackgroundResponse<AppState>> {
  set(loadingAtom, true);
  try {
    return await sendCommand<AppState>(command);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "扩展后台没有响应。" };
  } finally {
    set(loadingAtom, false);
  }
}

function applyStateResponse(
  set: Setter,
  response: { ok: true; data: AppState } | { ok: false; error: string },
  successMessage?: string | null
) {
  if (response.ok) {
    set(appStateAtom, response.data);
    set(statusMessageAtom, successMessage === null ? null : (successMessage ?? response.data.lastSync?.message ?? null));
  } else {
    set(statusMessageAtom, response.error);
  }
  set(loadingAtom, false);
}

function isSiteDataProgressMessage(value: unknown): value is { type: "linuxdoFriends.siteDataProgress"; progress: SiteDataTaskProgress } {
  if (typeof value !== "object" || value == null) return false;
  const record = value as { type?: unknown; progress?: Partial<SiteDataTaskProgress> };
  return (
    record.type === "linuxdoFriends.siteDataProgress" &&
    typeof record.progress?.taskId === "string" &&
    (record.progress.taskType === "activity" || record.progress.taskType === "profiles") &&
    typeof record.progress.completed === "number" &&
    typeof record.progress.total === "number"
  );
}

function isPageScriptStatusMessage(value: unknown): value is { type: "linuxdoFriends.pageScriptStatus"; status: PageScriptStatusSnapshot } {
  if (typeof value !== "object" || value == null) return false;
  const record = value as { type?: unknown; status?: Partial<PageScriptStatusSnapshot> };
  return record.type === "linuxdoFriends.pageScriptStatus" && isPageScriptStatusSnapshot(record.status);
}

function isPageScriptStatusSnapshot(value: unknown): value is PageScriptStatusSnapshot {
  if (typeof value !== "object" || value == null) return false;
  const record = value as Partial<PageScriptStatusSnapshot>;
  return (
    (record.status === "connected" || record.status === "challenge" || record.status === "stale" || record.status === "missing") &&
    typeof record.connectedCount === "number" &&
    typeof record.staleCount === "number" &&
    Array.isArray(record.heartbeats) &&
    typeof record.updatedAt === "string"
  );
}

function isPartialAppState(value: unknown): value is Partial<AppState> {
  return typeof value === "object" && value != null;
}

function mergeObservedAppState(stored: Partial<AppState>): AppState {
  return {
    followedUsers: stored.followedUsers ?? {},
    friends: stored.friends ?? {},
    friendProfiles: stored.friendProfiles ?? {},
    activity: stored.activity ?? {},
    activityRefreshLedger: stored.activityRefreshLedger ?? {},
    activityWatermarks: stored.activityWatermarks ?? {},
    activityFeedWaterlineAt: stored.activityFeedWaterlineAt,
    requestStats: normalizeRequestStats(stored.requestStats),
    dredgeRules: stored.dredgeRules ?? [],
    laoFindsStartedAt: normalizeOptionalTimestamp(stored.laoFindsStartedAt),
    laoFindsItems: stored.laoFindsItems ?? {},
    avatarCache: stored.avatarCache ?? {},
    settings: mergeObservedSettings(stored.settings),
    currentAccount: stored.currentAccount,
    lastSync: stored.lastSync
  };
}

function normalizeOptionalTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return Number.isNaN(Date.parse(value)) ? undefined : value;
}

function mergeObservedSettings(settings: Partial<AppState["settings"]> | undefined): AppState["settings"] {
  return {
    ...defaultAppState.settings,
    ...(settings ?? {})
  };
}

function installedVersion(): string {
  return typeof chrome === "undefined" ? "0.0.0" : (chrome.runtime?.getManifest?.().version ?? "0.0.0");
}
