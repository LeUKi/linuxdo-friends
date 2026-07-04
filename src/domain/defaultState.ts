import type { AppState, RefreshSettings } from "../shared/types";
import { defaultRequestStats } from "./requestStats";
import { DEFAULT_TIMED_ACTIVITY_REFRESH_INTERVAL_MINUTES } from "../shared/settingsLimits";

export const defaultSettings: RefreshSettings = {
  allowAutoRefresh: false,
  allowInactiveTabFallback: false,
  openActivityLinksInPage: true,
  refreshIntervalMinutes: 120,
  timedActivityRefreshEnabled: false,
  timedActivityRefreshScopeMode: "rules",
  timedActivityRefreshIntervalMinutes: DEFAULT_TIMED_ACTIVITY_REFRESH_INTERVAL_MINUTES,
  requestStatsAutoSyncEnabled: false,
  laoFindsBrowserNotificationsEnabled: true,
  laoFindsManualNotificationsEnabled: false,
  laoFindsTelegramNotificationsEnabled: false
};

export const defaultAppState: AppState = {
  followedUsers: {},
  friends: {},
  friendProfiles: {},
  activity: {},
  activityRefreshLedger: {},
  activityWatermarks: {},
  activityFeedWaterlineAt: undefined,
  requestStats: defaultRequestStats,
  dredgeRules: [],
  laoFindsStartedAt: undefined,
  laoFindsItems: {},
  avatarCache: {},
  settings: defaultSettings
};
