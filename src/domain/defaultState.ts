import type { AppState, RefreshSettings } from "../shared/types";

export const defaultSettings: RefreshSettings = {
  allowAutoRefresh: false,
  allowInactiveTabFallback: false,
  openActivityLinksInPage: true,
  refreshIntervalMinutes: 120,
  timedActivityRefreshEnabled: false,
  timedActivityRefreshScopeMode: "rules",
  timedActivityRefreshIntervalMinutes: 120
};

export const defaultAppState: AppState = {
  followedUsers: {},
  friends: {},
  friendProfiles: {},
  activity: {},
  activityRefreshLedger: {},
  activityWatermarks: {},
  activityFeedWaterlineAt: undefined,
  dredgeRules: [],
  laoFindsStartedAt: undefined,
  laoFindsItems: {},
  avatarCache: {},
  settings: defaultSettings
};
