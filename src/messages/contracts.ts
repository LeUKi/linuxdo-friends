import { isValidRefreshIntervalMinutes, isValidTimedActivityRefreshIntervalMinutes } from "../shared/settingsLimits";
import type { BackgroundCommand } from "../shared/types";

export function isBackgroundCommand(value: unknown): value is BackgroundCommand {
  if (typeof value !== "object" || value == null) return false;
  const command = value as Record<string, unknown>;
  switch (command.type) {
    case "getState":
    case "identifyCurrentAccount":
    case "syncFollowedUsers":
    case "getSiteDataProgress":
    case "getPageScriptStatus":
    case "getUpdateCheck":
    case "getCloudArchiveLocalState":
    case "getCloudConfigStatus":
    case "bindCloudSave":
      return true;
    case "cloudSaveExchangeCode":
      return typeof command.code === "string" && command.code.trim().length > 0;
    case "backupCloudConfig":
    case "restoreCloudConfig":
    case "clearCloudBinding":
    case "openSidePanel":
    case "openLinuxDoHome":
    case "exportConfig":
    case "clearCache":
    case "resetExtension":
      return true;
    case "testTelegramNotification":
      return isTelegramTestCredentials(command.credentials);
    case "openOptionsPage":
      return command.hash === undefined || isOptionsHash(command.hash);
    case "openActivityLink":
      return typeof command.url === "string" && isLinuxDoActivityUrl(command.url);
    case "importConfig":
      return isNonEmptyString(command.json);
    case "checkForUpdates":
      return command.force === undefined || typeof command.force === "boolean";
    case "repairLinuxDoPageScript":
      return command.tabId === undefined || isPositiveInteger(command.tabId);
    case "activateLinuxDoPageTab":
      return isPositiveInteger(command.tabId);
    case "seedFollowedUser":
      return isSeedFollowedCommand(command);
    case "addFriendFromKnownUser":
      return isKnownUserAddCommand(command);
    case "lookupFriendProfile":
    case "addFriendByProfile":
    case "removeFriend":
      return isNonEmptyString(command.username);
    case "updateFriend":
      return isNonEmptyString(command.username) && isFriendPatch(command.patch);
    case "refreshFriendProfiles":
    case "cacheAvatars":
      return command.usernames === undefined || isUsernameList(command.usernames);
    case "refreshFriendActivity":
      return isActivityRefreshCommand(command);
    case "upsertDredgeRule":
      return isDredgeRulePatch(command.rule);
    case "removeDredgeRule":
      return isNonEmptyString(command.id);
    case "resetLaoFindsStartedAt":
      return true;
    case "completeRuleDerivedLaoFindsDredge":
      return isValidTimestampString(command.startedAt) && isActivityRefreshScopeList(command.scopes) && isSiteDataTaskTrigger(command.trigger);
    case "markLaoFindsItemRead":
      return isNonEmptyString(command.id) && typeof command.read === "boolean";
    case "archiveLaoFindsItem":
      return isNonEmptyString(command.id) && typeof command.archived === "boolean";
    case "deleteLaoFindsItem":
      return isNonEmptyString(command.id);
    case "clearLaoFindsItems":
      return true;
    case "updateSettings":
      return isSettingsPatch(command.settings);
    default:
      return false;
  }
}


function isTelegramTestCredentials(value: unknown): value is { kind: "saved" } | { kind: "draft"; botToken: string; chatId: string } {
  if (!isRecord(value)) return false;
  if (value.kind === "saved") return true;
  return value.kind === "draft" && typeof value.botToken === "string" && typeof value.chatId === "string";
}

function isDredgeRulePatch(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isOptionalString(value.id) &&
    (value.schemaVersion === undefined || value.schemaVersion === 2) &&
    isOptionalString(value.name) &&
    (value.enabled === undefined || typeof value.enabled === "boolean") &&
    (value.mode === undefined || value.mode === "allow" || value.mode === "block") &&
    (value.usernames === undefined || value.usernames === "all" || isUsernameList(value.usernames)) &&
    (value.kinds === undefined || isActivityRefreshKindList(value.kinds)) &&
    value.keywords === undefined &&
    (value.patterns === undefined || isStringList(value.patterns)) &&
    isOptionalString(value.createdAt) &&
    isOptionalString(value.updatedAt)
  );
}

function isActivityRefreshCommand(command: Record<string, unknown>): boolean {
  const legacyUsernamesValid = command.usernames === undefined || isUsernameList(command.usernames);
  if (!legacyUsernamesValid) return false;
  if (!isSiteDataTaskOwnership(command)) return false;
  if (command.scope === undefined) return true;
  return isActivityRefreshScope(command.scope);
}

function isActivityRefreshScope(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isActivityKindFilter(value.kind) && (value.usernames === undefined || isUsernameList(value.usernames));
}

function isActivityRefreshScopeList(value: unknown): boolean {
  return Array.isArray(value) && value.every(isActivityRefreshScope);
}

function isSiteDataTaskOwnership(command: Record<string, unknown>): boolean {
  if (command.trigger === undefined && command.timedRunId === undefined) return true;
  if (command.trigger === "manual") return command.timedRunId === undefined || isNonEmptyString(command.timedRunId);
  return command.trigger === "timed" && isNonEmptyString(command.timedRunId);
}

function isSeedFollowedCommand(command: Record<string, unknown>): boolean {
  if (!isRecord(command.user)) return false;
  return (
    isNonEmptyString(command.user.username) &&
    isOptionalString(command.user.name) &&
    isOptionalString(command.user.avatarUrl)
  );
}

function isKnownUserAddCommand(command: Record<string, unknown>): boolean {
  if (!isSeedFollowedCommand(command)) return false;
  if (command.profile === undefined) return true;
  if (!isRecord(command.profile)) return false;
  return isNonEmptyString(command.profile.username) && isOptionalString(command.profile.name) && isOptionalString(command.profile.avatarUrl);
}

function isFriendPatch(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isOptionalString(value.note) &&
    (value.groups === undefined || isStringList(value.groups)) &&
    (value.pinned === undefined || typeof value.pinned === "boolean") &&
    (value.activityKinds === undefined || isActivityRefreshKindList(value.activityKinds))
  );
}

function isSettingsPatch(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    (value.allowAutoRefresh === undefined || typeof value.allowAutoRefresh === "boolean") &&
    (value.allowInactiveTabFallback === undefined || typeof value.allowInactiveTabFallback === "boolean") &&
    (value.openActivityLinksInPage === undefined || typeof value.openActivityLinksInPage === "boolean") &&
    (value.refreshIntervalMinutes === undefined || isValidRefreshIntervalMinutes(value.refreshIntervalMinutes)) &&
    (value.timedActivityRefreshEnabled === undefined || typeof value.timedActivityRefreshEnabled === "boolean") &&
    (value.timedActivityRefreshScopeMode === undefined ||
      value.timedActivityRefreshScopeMode === "rules" ||
      value.timedActivityRefreshScopeMode === "all") &&
    (value.timedActivityRefreshIntervalMinutes === undefined ||
      isValidTimedActivityRefreshIntervalMinutes(value.timedActivityRefreshIntervalMinutes)) &&
    (value.requestStatsAutoSyncEnabled === undefined || typeof value.requestStatsAutoSyncEnabled === "boolean") &&
    (value.laoFindsBrowserNotificationsEnabled === undefined || typeof value.laoFindsBrowserNotificationsEnabled === "boolean") &&
    (value.laoFindsManualNotificationsEnabled === undefined || typeof value.laoFindsManualNotificationsEnabled === "boolean") &&
    (value.laoFindsTelegramNotificationsEnabled === undefined || typeof value.laoFindsTelegramNotificationsEnabled === "boolean") &&
    (value.telegramBotToken === undefined || typeof value.telegramBotToken === "string") &&
    (value.telegramChatId === undefined || typeof value.telegramChatId === "string")
  );
}

function isLinuxDoActivityUrl(value: string): boolean {
  try {
    const url = new URL(value, "https://linux.do");
    return url.protocol === "https:" && url.hostname === "linux.do" && (value.startsWith("/") || url.origin === "https://linux.do");
  } catch {
    return false;
  }
}

function isOptionsHash(value: unknown): boolean {
  return typeof value === "string" && /^#[a-z0-9-]+$/i.test(value);
}


function isSiteDataTaskTrigger(value: unknown): boolean {
  return value === "manual" || value === "timed";
}

function isPositiveInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isUsernameList(value: unknown): boolean {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function isActivityKindFilter(value: unknown): boolean {
  return value === "all" || value === "topic" || value === "reply" || value === "boost" || value === "reaction" || value === "like";
}

function isActivityRefreshKindList(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => item === "topic" || item === "reply" || item === "boost" || item === "reaction" || item === "like");
}

function isStringList(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isValidTimestampString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && !Number.isNaN(Date.parse(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}
