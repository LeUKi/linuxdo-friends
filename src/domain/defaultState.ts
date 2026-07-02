import type { AppState, RefreshSettings } from "../shared/types";
import { defaultRequestStats } from "./requestStats";

export const defaultSettings: RefreshSettings = {
  allowAutoRefresh: false,
  allowInactiveTabFallback: false,
  openActivityLinksInPage: true,
  refreshIntervalMinutes: 120,
  timedActivityRefreshEnabled: false,
  timedActivityRefreshScopeMode: "rules",
  timedActivityRefreshIntervalMinutes: 120,
  requestStatsAutoSyncEnabled: false
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
