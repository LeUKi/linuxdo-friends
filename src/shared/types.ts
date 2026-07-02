export type Username = string;

export interface FollowedUser {
  username: Username;
  name?: string;
  avatarUrl?: string;
  source: "manual" | "sync" | "seed";
  followedAt: string;
  updatedAt: string;
}

export type FollowedUserInput = Pick<FollowedUser, "username" | "name" | "avatarUrl">;

export interface FriendUser {
  username: Username;
  note: string;
  groups: string[];
  pinned: boolean;
  activityKinds: ActivityRefreshKind[];
  upgradedAt: string;
  updatedAt: string;
}

export interface FriendProfileSummary {
  username: Username;
  name?: string;
  avatarUrl?: string;
  lastPostedAt?: string;
  lastSeenAt?: string;
  refreshedAt: string;
}

export interface AvatarCacheEntry {
  username: Username;
  sourceUrl: string;
  dataUrl: string;
  contentType: string;
  byteLength: number;
  updatedAt: string;
}

export type ActivityKind = "topic" | "reply" | "boost" | "reaction" | "summary";
export type ActivityRefreshKind = Exclude<ActivityKind, "summary">;
export type ActivityKindFilter = "all" | ActivityRefreshKind;
export type ActivityRefreshRequestKind = ActivityRefreshKind | "user_actions";
export type ActivitySource = "user_actions" | "boosts" | "reactions";
export type TimedActivityRefreshScopeMode = "rules" | "all";
export type RequestStatsFamily = "account" | "following" | "profile" | "activity" | "avatar";

export type UiSceneTab = "friends" | "feed" | "finds";

export interface FilterPopoverScene {
  open: boolean;
  query: string;
}

export interface UiSceneState {
  version: 1;
  tab: UiSceneTab;
  feedKindFilter: ActivityKindFilter;
  feedUserFilter: "all" | Username;
  addFriendModalOpen: boolean;
  addFriendQuery: string;
  activityKindPopover: FilterPopoverScene;
  feedUserPopover: FilterPopoverScene;
}

export interface ActivityItem {
  id: string;
  username: Username;
  kind: ActivityKind;
  title: string;
  url?: string;
  occurredAt?: string;
  excerpt?: string;
  source?: ActivitySource;
  actorUsername?: Username;
  actorName?: string;
  actorAvatarUrl?: string;
  targetUsername?: Username;
  targetName?: string;
  targetAvatarUrl?: string;
  topicId?: number;
  topicTitle?: string;
  postId?: number;
  postNumber?: number;
  replyToPostNumber?: number;
  categoryId?: number;
  reactionValue?: string;
  boostText?: string;
  truncated?: boolean;
  deleted?: boolean;
  hidden?: boolean;
  closed?: boolean;
  archived?: boolean;
  isNew?: boolean;
}

export interface FriendActivitySummary {
  username: Username;
  refreshedAt: string;
  coarseStatus?: "recently_active" | "active_this_week" | "quiet" | "unknown";
  lastPostAt?: string;
  items: ActivityItem[];
}

export interface ActivityRefreshScope {
  kind: ActivityKindFilter;
  usernames?: Username[];
}

export interface ActivityRefreshLedgerEntry {
  scopeKey: string;
  username: Username;
  kind: ActivityRefreshKind;
  refreshedAt: string;
  source: RefreshSource;
  itemCount: number;
}

export interface ActivityWatermarkEntry {
  scopeKey: string;
  username: Username;
  kind: ActivityRefreshKind;
  latestOccurredAt: string;
  updatedAt: string;
  source: RefreshSource;
}

export interface RequestStatsDayEntry {
  date: string;
  total: number;
  hours: Record<string, number>;
  byFamily: Partial<Record<RequestStatsFamily, number>>;
}

export interface RequestStatsState {
  total: number;
  byFamily: Partial<Record<RequestStatsFamily, number>>;
  days: Record<string, RequestStatsDayEntry>;
}

export interface DredgeRule {
  id: string;
  name: string;
  enabled: boolean;
  usernames: "all" | Username[];
  kinds: ActivityRefreshKind[];
  keywords: string[];
  createdAt: string;
  updatedAt: string;
}

export interface LaoFindsItem {
  id: string;
  activityId: string;
  activity: ActivityItem;
  collectedAt: string;
  matchedRuleIds: string[];
  readAt?: string;
  archivedAt?: string;
}

export type SiteDataTaskTrigger = "manual" | "timed";
export type SiteDataTaskRetiredReason = "timed_disabled";

interface BaseSiteDataTaskProgress {
  taskId: string;
  status: "running" | "success" | "error";
  trigger?: SiteDataTaskTrigger;
  timedRunId?: string;
  retiredReason?: SiteDataTaskRetiredReason;
  completed: number;
  total: number;
  currentLabel?: string;
  source?: RefreshSource;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  error?: string;
}

export type ActivityRefreshTaskProgress = BaseSiteDataTaskProgress & {
  taskType: "activity";
  scope: ActivityRefreshScope;
};

export type ProfileRefreshTaskProgress = BaseSiteDataTaskProgress & {
  taskType: "profiles";
  usernames: Username[];
};

export type SiteDataTaskProgress = ActivityRefreshTaskProgress | ProfileRefreshTaskProgress;

export interface RefreshSettings {
  allowAutoRefresh: boolean;
  allowInactiveTabFallback: boolean;
  openActivityLinksInPage: boolean;
  refreshIntervalMinutes: number;
  timedActivityRefreshEnabled: boolean;
  timedActivityRefreshScopeMode: TimedActivityRefreshScopeMode;
  timedActivityRefreshIntervalMinutes: number;
  requestStatsAutoSyncEnabled: boolean;
  telegramBotToken?: string;
  telegramChatId?: string;
}

export interface ConfigExportSettings {
  openActivityLinksInPage: boolean;
  refreshIntervalMinutes: number;
  timedActivityRefreshScopeMode: TimedActivityRefreshScopeMode;
  timedActivityRefreshIntervalMinutes: number;
  telegramBotToken?: string;
  telegramChatId?: string;
}

export interface CurrentAccount {
  username: Username;
  verifiedAt: string;
  source: "latest_header";
}

export interface AppState {
  followedUsers: Record<Username, FollowedUser>;
  friends: Record<Username, FriendUser>;
  friendProfiles: Record<Username, FriendProfileSummary>;
  activity: Record<Username, FriendActivitySummary>;
  activityRefreshLedger: Record<string, ActivityRefreshLedgerEntry>;
  activityWatermarks: Record<string, ActivityWatermarkEntry>;
  activityFeedWaterlineAt?: string;
  requestStats: RequestStatsState;
  dredgeRules: DredgeRule[];
  laoFindsStartedAt?: string;
  laoFindsItems: Record<string, LaoFindsItem>;
  avatarCache: Record<Username, AvatarCacheEntry>;
  settings: RefreshSettings;
  currentAccount?: CurrentAccount;
  lastSync?: RefreshResult;
}

export interface ConfigExportFile {
  schemaVersion: 1;
  source: "linuxdo-friends";
  exportedAt: string;
  friends: Record<Username, FriendUser>;
  dredgeRules: DredgeRule[];
  requestStats: RequestStatsState;
  settings: ConfigExportSettings;
}

export type CloudConfigStatusState = "unchecked" | "remote_config" | "missing" | "unauthorized" | "invalid_config" | "network_error";

export interface CloudConfigStatus {
  state: CloudConfigStatusState;
  checkedAt?: string;
  exportedAt?: string;
  friendCount?: number;
  requestStatsTotal?: number;
  message?: string;
}

export interface CloudAuthExchangeResult {
  app: "linuxdo-friends";
  linuxDoId: string;
  tokenType: "Bearer";
  tokenKind: "jwt";
  token: string;
}

export interface CloudAuthState extends CloudAuthExchangeResult {
  boundAt: string;
  lastStatus?: CloudConfigStatus;
  lastBackupAt?: string;
  lastRestoreAt?: string;
  lastConfigDigest?: string;
  lastConfigSyncedAt?: string;
  lastRequestStatsSyncedAt?: string;
  lastRequestStatsTotal?: number;
  lastRequestStatsAutoSyncError?: CloudConfigStatus;
}

export type CloudBindingPublicState =
  | { bound: false; lastStatus?: CloudConfigStatus }
  | {
      bound: true;
      app: "linuxdo-friends";
      linuxDoId: string;
      tokenType: "Bearer";
      tokenKind: "jwt";
      boundAt: string;
      lastStatus?: CloudConfigStatus;
      lastBackupAt?: string;
      lastRestoreAt?: string;
      lastConfigDigest?: string;
      lastConfigSyncedAt?: string;
      lastRequestStatsSyncedAt?: string;
      lastRequestStatsTotal?: number;
      lastRequestStatsAutoSyncError?: CloudConfigStatus;
    };

export type CloudArchiveLocalState = "unbound" | "different" | "same";

export interface CloudArchiveLocalStateResult {
  binding: CloudBindingPublicState;
  archiveState: CloudArchiveLocalState;
  syncedAt?: string;
}

export interface CloudConfigStatusResult {
  binding: CloudBindingPublicState;
  status: CloudConfigStatus;
  message: string;
}

export interface CloudConfigBindResult {
  binding: CloudBindingPublicState;
  status?: CloudConfigStatus;
  message: string;
  authWindowId?: number;
}

export interface CloudConfigBackupResult {
  binding: CloudBindingPublicState;
  status: CloudConfigStatus;
  archiveState: CloudArchiveLocalState;
  message: string;
}

export interface CloudConfigRestoreResult {
  binding: CloudBindingPublicState;
  status: CloudConfigStatus;
  archiveState: CloudArchiveLocalState;
  message: string;
  state: AppState;
}

export interface CloudConfigClearBindingResult {
  binding: CloudBindingPublicState;
  message: string;
}

export type CloudConfigOperationResult =
  | CloudConfigStatusResult
  | CloudArchiveLocalStateResult
  | CloudConfigBindResult
  | CloudConfigBackupResult
  | CloudConfigRestoreResult
  | CloudConfigClearBindingResult;

export interface CloudConfigViewState {
  binding: CloudBindingPublicState;
  status?: CloudConfigStatus;
  message: string;
  authWindowId?: number;
}

export type PageScriptHeartbeatStatus = "ready" | "challenge" | "unavailable";

export interface PageScriptHeartbeat {
  tabId: number;
  windowId?: number;
  url: string;
  title?: string;
  status: PageScriptHeartbeatStatus;
  hasLauncher: boolean;
  updatedAt: string;
}

export interface PageScriptStatusSnapshot {
  status: "connected" | "challenge" | "stale" | "missing";
  connectedCount: number;
  staleCount: number;
  heartbeats: PageScriptHeartbeat[];
  selectedTabId?: number;
  updatedAt: string;
}

export type ContentScriptHeartbeatMessage = {
  type: "linuxdoFriends.pageHeartbeat";
  url: string;
  title?: string;
  status: PageScriptHeartbeatStatus;
  hasLauncher: boolean;
};

export interface PageRepairResult {
  message: string;
  tabId?: number;
  openedNewTab?: boolean;
}

export type UpdateCheckStatus = "idle" | "checking" | "up-to-date" | "update-available" | "no-release" | "error";

export interface UpdateCheckState {
  installedVersion: string;
  latestReleaseUrl: string;
  status: UpdateCheckStatus;
  latestVersion?: string;
  checkedAt?: string;
  error?: string;
  source?: "github_release";
}

export type RefreshFailureReason =
  | "unavailable"
  | "blocked"
  | "rate_limited"
  | "challenge"
  | "network_error"
  | "invalid_response";

export type RefreshResult =
  | { ok: true; source: RefreshSource; message: string; refreshedAt: string }
  | RefreshFailureResult;

export interface RefreshFailureResult {
  ok: false;
  source: RefreshSource;
  reason: RefreshFailureReason;
  message: string;
  refreshedAt: string;
}

export type RefreshSource = "direct_fetch" | "existing_tab" | "manual";

export type BackgroundCommand =
  | { type: "getState" }
  | { type: "identifyCurrentAccount" }
  | { type: "seedFollowedUser"; user: FollowedUserInput }
  | { type: "lookupFriendProfile"; username: Username }
  | { type: "addFriendFromKnownUser"; user: FollowedUserInput; profile?: FriendProfileSummary }
  | { type: "addFriendByProfile"; username: Username }
  | { type: "removeFriend"; username: Username }
  | { type: "updateFriend"; username: Username; patch: Partial<Pick<FriendUser, "note" | "groups" | "pinned" | "activityKinds">> }
  | { type: "syncFollowedUsers" }
  | { type: "refreshFriendProfiles"; usernames?: Username[] }
  | { type: "refreshFriendActivity"; usernames?: Username[]; scope?: ActivityRefreshScope; trigger?: SiteDataTaskTrigger; timedRunId?: string }
  | { type: "upsertDredgeRule"; rule: Partial<DredgeRule> & { id?: string } }
  | { type: "removeDredgeRule"; id: string }
  | { type: "resetLaoFindsStartedAt" }
  | { type: "markLaoFindsItemRead"; id: string; read: boolean }
  | { type: "archiveLaoFindsItem"; id: string; archived: boolean }
  | { type: "cacheAvatars"; usernames?: Username[] }
  | { type: "getSiteDataProgress" }
  | { type: "getPageScriptStatus" }
  | { type: "getUpdateCheck" }
  | { type: "checkForUpdates"; force?: boolean }
  | { type: "getCloudArchiveLocalState" }
  | { type: "getCloudConfigStatus" }
  | { type: "bindCloudSave" }
  | { type: "cloudSaveExchangeCode"; code: string }
  | { type: "backupCloudConfig" }
  | { type: "restoreCloudConfig" }
  | { type: "clearCloudBinding" }
  | { type: "repairLinuxDoPageScript"; tabId?: number }
  | { type: "openSidePanel" }
  | { type: "openOptionsPage"; hash?: string }
  | { type: "openLinuxDoHome" }
  | { type: "openActivityLink"; url: string }
  | { type: "updateSettings"; settings: Partial<RefreshSettings> }
  | { type: "exportConfig" }
  | { type: "importConfig"; json: string }
  | { type: "clearCache" }
  | { type: "resetExtension" }
  | { type: "testTelegramNotification" };

export type BackgroundResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; reason?: RefreshFailureReason | "unknown_command" };

export interface VisibleFriend {
  username: Username;
  note: string;
  groups: string[];
  pinned: boolean;
  activityKinds: ActivityRefreshKind[];
  profile?: FriendProfileSummary;
  activity?: FriendActivitySummary;
}

export type ContentScriptCommand =
  | { type: "linuxdoFriends.extractCurrentAccount" }
  | { type: "linuxdoFriends.extractFollowing" }
  | { type: "linuxdoFriends.extractProfile"; username: Username }
  | {
      type: "linuxdoFriends.extractActivity";
      username: Username;
      kind?: ActivityKindFilter | "user_actions";
      step?: { kind: ActivityRefreshRequestKind; path: string };
    }
  | { type: "linuxdoFriends.extractAvatar"; username: Username; avatarUrl: string }
  | { type: "linuxdoFriends.navigateInPage"; url: string };

export interface ContentScriptRequestStats {
  requestCount?: number;
  requestAttemptedAts?: string[];
}

export type ContentScriptFailureResponse = { ok: false; reason: RefreshFailureReason | "unavailable"; error: string } & ContentScriptRequestStats;

export type ContentScriptCurrentAccountResponse =
  | ({ ok: true; username: Username } & ContentScriptRequestStats)
  | ContentScriptFailureResponse;

export type ContentScriptFollowingResponse =
  | ({ ok: true; username: Username; users: FollowedUserInput[] } & ContentScriptRequestStats)
  | ContentScriptFailureResponse;

export type ContentScriptActivityResponse =
  | ({ ok: true; activity: FriendActivitySummary } & ContentScriptRequestStats)
  | ContentScriptFailureResponse;

export type ContentScriptProfileResponse =
  | ({ ok: true; profile: FriendProfileSummary } & ContentScriptRequestStats)
  | ContentScriptFailureResponse;

export type ContentScriptAvatarResponse =
  | ({ ok: true; username: Username; sourceUrl: string; dataUrl: string; contentType: string; byteLength: number } & ContentScriptRequestStats)
  | ContentScriptFailureResponse;

export type ContentScriptNavigationResponse =
  | { ok: true; url: string }
  | ContentScriptFailureResponse;

export type ContentScriptResponse =
  | ContentScriptCurrentAccountResponse
  | ContentScriptFollowingResponse
  | ContentScriptActivityResponse
  | ContentScriptProfileResponse
  | ContentScriptAvatarResponse
  | ContentScriptNavigationResponse;
