import { defaultAppState } from "../domain/defaultState";
import { normalizeFriendUser, normalizeUsername } from "../domain/friends";
import { normalizeLaoFindsItems, normalizeDredgeRules } from "../domain/laoFinds";
import type { AppState, RefreshSettings } from "../shared/types";

export const APP_STATE_STORAGE_KEY = "linuxdoFriendsState";

type ChromeLikeStorage = {
  get(key: string): Promise<Record<string, unknown>>;
  set(value: Record<string, unknown>): Promise<void>;
};

function hasChromeStorage(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

export async function loadState(storage: ChromeLikeStorage | null = hasChromeStorage() ? chrome.storage.local : null): Promise<AppState> {
  if (!storage) return defaultAppState;
  const result = await storage.get(APP_STATE_STORAGE_KEY);
  const stored = result[APP_STATE_STORAGE_KEY] as Partial<AppState> | undefined;
  return mergeState(stored);
}

export async function saveState(state: AppState, storage: ChromeLikeStorage | null = hasChromeStorage() ? chrome.storage.local : null): Promise<void> {
  if (!storage) return;
  await storage.set({ [APP_STATE_STORAGE_KEY]: state });
}

export async function updateState(
  updater: (state: AppState) => AppState | Promise<AppState>,
  storage: ChromeLikeStorage | null = hasChromeStorage() ? chrome.storage.local : null
): Promise<AppState> {
  const current = await loadState(storage);
  const next = await updater(current);
  await saveState(next, storage);
  return next;
}

function mergeState(stored?: Partial<AppState>): AppState {
  return {
    followedUsers: stored?.followedUsers ?? {},
    friends: mergeFriends(stored?.friends),
    friendProfiles: stored?.friendProfiles ?? {},
    activity: stored?.activity ?? {},
    activityRefreshLedger: stored?.activityRefreshLedger ?? {},
    activityWatermarks: stored?.activityWatermarks ?? {},
    activityFeedWaterlineAt: stored?.activityFeedWaterlineAt,
    dredgeRules: normalizeDredgeRules(stored?.dredgeRules),
    laoFindsStartedAt: normalizeOptionalTimestamp(stored?.laoFindsStartedAt),
    laoFindsItems: normalizeLaoFindsItems(stored?.laoFindsItems),
    avatarCache: stored?.avatarCache ?? {},
    settings: mergeSettings(stored?.settings),
    currentAccount: stored?.currentAccount,
    lastSync: stored?.lastSync
  };
}

function mergeFriends(stored?: Partial<AppState["friends"]>): AppState["friends"] {
  const friends: AppState["friends"] = {};
  for (const [key, value] of Object.entries(stored ?? {})) {
    if (!value || typeof value !== "object") continue;
    const username = normalizeUsername(typeof value.username === "string" ? value.username : key);
    if (!username) continue;
    friends[username] = normalizeFriendUser({ ...value, username });
  }
  return friends;
}

function mergeSettings(stored?: Partial<RefreshSettings>): RefreshSettings {
  const refreshIntervalMinutes =
    typeof stored?.refreshIntervalMinutes === "number" && stored.refreshIntervalMinutes >= 30 && stored.refreshIntervalMinutes <= 720
      ? stored.refreshIntervalMinutes
      : defaultAppState.settings.refreshIntervalMinutes;
  const timedActivityRefreshIntervalMinutes =
    typeof stored?.timedActivityRefreshIntervalMinutes === "number" &&
    stored.timedActivityRefreshIntervalMinutes >= 30 &&
    stored.timedActivityRefreshIntervalMinutes <= 720
      ? stored.timedActivityRefreshIntervalMinutes
      : defaultAppState.settings.timedActivityRefreshIntervalMinutes;
  return {
    ...defaultAppState.settings,
    refreshIntervalMinutes,
    timedActivityRefreshEnabled:
      typeof stored?.timedActivityRefreshEnabled === "boolean"
        ? stored.timedActivityRefreshEnabled
        : defaultAppState.settings.timedActivityRefreshEnabled,
    timedActivityRefreshScopeMode:
      stored?.timedActivityRefreshScopeMode === "all" || stored?.timedActivityRefreshScopeMode === "rules"
        ? stored.timedActivityRefreshScopeMode
        : defaultAppState.settings.timedActivityRefreshScopeMode,
    timedActivityRefreshIntervalMinutes,
    openActivityLinksInPage:
      typeof stored?.openActivityLinksInPage === "boolean" ? stored.openActivityLinksInPage : defaultAppState.settings.openActivityLinksInPage,
    allowAutoRefresh: false,
    allowInactiveTabFallback: false,
    telegramBotToken: typeof stored?.telegramBotToken === "string" && stored.telegramBotToken ? stored.telegramBotToken : undefined,
    telegramChatId: typeof stored?.telegramChatId === "string" && stored.telegramChatId ? stored.telegramChatId : undefined
  };
}

function normalizeOptionalTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return Number.isNaN(Date.parse(value)) ? undefined : value;
}
