import { createRefreshAdapter } from "../api/refreshAdapter";
import { sortActivityItems } from "../domain/activity";
import { maybeSendTelegramNotifications, sendTelegramMessage } from "../domain/telegramNotify";
import {
  applyScopedActivityRefresh,
  clearActivityNewFlags,
  deriveTimedActivityRefreshScopes,
  latestActivityRefreshAt,
  normalizeActivityRefreshScope,
  normalizeRefreshTargets,
  planActivityRefreshTargets,
  type ActivityRequestStep
} from "../domain/activityRefresh";
import { defaultAppState } from "../domain/defaultState";
import {
  CLOUD_SAVE_APP_ID,
  buildBrowserCodeAuthStartUrl,
  cloudAuthExchangeUrl,
  cloudAuthCompleteUrlPattern,
  cloudConfigSlotUrl,
  cloudConfigStatusFromError,
  parseCloudAuthExchangePayload,
  parseCloudConfigPayload,
  sanitizeCloudErrorMessage,
  summarizeCloudConfigPayload
} from "../domain/cloudConfig";
import { applyConfigImport, createConfigExport, createConfigFingerprint, parseConfigImportJson } from "../domain/configTransfer";
import { addFriendFromKnownUser, addFriendFromProfile, removeFriend, updateFriend, upsertFollowedUser, upsertFriendProfile } from "../domain/friends";
import {
  archiveLaoFindsItem,
  collectLaoFindsItems,
  markLaoFindsItemRead,
  removeDredgeRule,
  resetLaoFindsStartedAt,
  upsertDredgeRule
} from "../domain/laoFinds";
import { recordRequestAttempts } from "../domain/requestStats";
import {
  defaultUpdateCheckState,
  GITHUB_LATEST_RELEASE_API,
  GITHUB_LATEST_RELEASE_API_MIRROR,
  isUpdateCheckCacheFresh,
  updateCheckFailureState,
  updateCheckStateFromRelease
} from "../domain/versionCheck";
import { isBackgroundCommand } from "../messages/contracts";
import { base64urlFromBytes, sha256Base64url } from "../shared/crypto";
import { nowIso } from "../shared/time";
import type {
  ActivityItem,
  ActivityRefreshKind,
  ActivityKindFilter,
  ActivityRefreshScope,
  ActivityRefreshTaskProgress,
  AppState,
  BackgroundCommand,
  BackgroundResponse,
  CloudAuthState,
  CloudArchiveLocalStateResult,
  CloudConfigBackupResult,
  CloudConfigBindResult,
  CloudConfigClearBindingResult,
  CloudConfigOperationResult,
  CloudConfigRestoreResult,
  CloudConfigStatusResult,
  CloudConfigStatus,
  ContentScriptActivityResponse,
  ContentScriptAvatarResponse,
  ContentScriptCurrentAccountResponse,
  ContentScriptFollowingResponse,
  ContentScriptNavigationResponse,
  ContentScriptHeartbeatMessage,
  ContentScriptProfileResponse,
  PageRepairResult,
  PageScriptHeartbeat,
  PageScriptStatusSnapshot,
  ProfileRefreshTaskProgress,
  RefreshResult,
  RequestStatsFamily,
  SiteDataTaskTrigger,
  SiteDataTaskProgress,
  UpdateCheckState,
  Username
} from "../shared/types";
import {
  clearCloudAuth,
  configureCloudAuthStorageAccess,
  loadCloudAuth,
  saveCloudAuth,
  toPublicCloudBinding,
  updateCloudAuth
} from "../storage/cloudAuthStorage";
import { PAGE_SCRIPT_STATUS_STORAGE_KEY, savePageScriptStatusState } from "../storage/pageScriptStatusStorage";
import {
  isStaleRunningSiteDataProgress,
  SITE_DATA_PROGRESS_STORAGE_KEY,
  saveSiteDataProgressState
} from "../storage/siteDataProgressStorage";
import {
  invalidateTimedActivityNoTargetSessionState,
  loadTimedActivityRefreshSessionState,
  patchTimedActivityRefreshSessionState
} from "../storage/timedActivityRefreshSessionStorage";
import { loadState, saveState } from "../storage/storage";
import { UPDATE_CHECK_STORAGE_KEY, loadUpdateCheckState, saveUpdateCheckState } from "../storage/updateCheckStorage";
import { allUiSceneStorageKeys } from "../storage/uiSceneStorage";

interface ActiveSiteDataTask {
  taskId: string;
  generation: number;
  trigger?: SiteDataTaskTrigger;
  timedRunId?: string;
  promise: Promise<BackgroundResponse>;
  progress?: SiteDataTaskProgress;
}

type SiteDataTaskContext = Pick<ActiveSiteDataTask, "taskId" | "generation" | "trigger" | "timedRunId">;
type SiteDataTaskOwnership = Pick<ActiveSiteDataTask, "trigger" | "timedRunId">;
type RequestStatsCounter = ReturnType<typeof createRequestStatsCounter>;

let activeSiteDataTask: ActiveSiteDataTask | null = null;
let activeUpdateCheck: Promise<UpdateCheckState> | null = null;
let lastSiteDataProgress: SiteDataTaskProgress | null = null;
let stateWriteGeneration = 0;
const pageScriptHeartbeats = new Map<number, PageScriptHeartbeat>();
const heartbeatFreshMs = 45_000;
const heartbeatStaleMs = 120_000;
const CLOUD_AUTH_VERIFIER_STORAGE_KEY = "linuxdoFriendsCloudAuthVerifier";
const CLOUD_AUTH_WINDOW_STORAGE_KEY = "linuxdoFriendsCloudAuthWindowId";
const REQUEST_STATS_AUTO_SYNC_ALARM_NAME = "linuxdoFriends.requestStatsAutoSync";
const REQUEST_STATS_AUTO_SYNC_PERIOD_MINUTES = 24 * 60;

configureSessionStorageAccess();
configureLocalStorageAccess();
configureSidePanelAction();
registerRequestStatsAutoSyncAlarmListeners();
void reconcileRequestStatsAutoSyncAlarm().catch(() => {
  // Alarm reconciliation is best-effort and must not block the service worker.
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (isContentScriptHeartbeatMessage(message)) {
    const response = handlePageHeartbeat(message, sender);
    sendResponse(response);
    return false;
  }
  void handleMessage(message, sender).then(sendResponse);
  return true;
});

function configureSidePanelAction() {
  try {
    void chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true });
  } catch {
    // Some test and non-Chrome environments expose only a subset of extension APIs.
  }
}

function configureSessionStorageAccess() {
  try {
    void chrome.storage?.session?.setAccessLevel?.({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" });
  } catch {
    // Content-script access depends on Chrome support; tests and partial APIs may not expose it.
  }
}

function configureLocalStorageAccess() {
  void configureCloudAuthStorageAccess().catch(() => {
    // Older and test Chrome surfaces may not expose local storage access levels.
  });
}

async function handleMessage(message: unknown, sender: chrome.runtime.MessageSender): Promise<BackgroundResponse> {
  if (!isBackgroundCommand(message)) {
    return { ok: false, error: "未知命令。", reason: "unknown_command" };
  }
  try {
    return await dispatch(message, sender);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "操作失败。" };
  }
}

async function dispatch(command: BackgroundCommand, sender: chrome.runtime.MessageSender): Promise<BackgroundResponse> {
  switch (command.type) {
    case "getState":
      return ok(await loadState());
    case "identifyCurrentAccount":
      return ok(await identifyCurrentAccount());
    case "seedFollowedUser":
      return ok(await updateAppState((state) => upsertFollowedUser(state, { ...command.user, source: "manual" })));
    case "lookupFriendProfile":
      return lookupFriendProfileWithFallback(command.username);
    case "addFriendFromKnownUser":
      return ok(await updateTimedActivityTargetInputs((state) => addFriendFromKnownUser(state, command.user, command.profile)));
    case "addFriendByProfile": {
      const beforeSignature = timedActivityTargetSignature(await loadState());
      const response = await runSiteDataTask(() => refreshState((state) => addFriendByProfileWithFallback(state, command.username)));
      if (response.ok) {
        const responseState = response.data as AppState;
        if (timedActivityTargetSignature(responseState) !== beforeSignature) {
          await invalidateTimedActivityNoTargetSessionStateIfTargetable(responseState);
        }
      }
      return response;
    }
    case "removeFriend":
      return ok(await updateTimedActivityTargetInputs((state) => removeFriend(state, command.username)));
    case "updateFriend":
      return ok(
        command.patch.activityKinds === undefined
          ? await updateAppState((state) => updateFriend(state, command.username, command.patch))
          : await updateTimedActivityTargetInputs((state) => updateFriend(state, command.username, command.patch))
      );
    case "syncFollowedUsers":
      return runSiteDataTask(() => refreshState(syncFollowedUsersWithFallback));
    case "refreshFriendProfiles":
      return runSiteDataTask(() => refreshState((state) => refreshFriendProfilesWithFallback(state, command.usernames)));
    case "refreshFriendActivity": {
      const ownership = siteDataTaskOwnershipFromCommand(command);
      const activityResponse = await runSiteDataTask((taskContext) =>
        refreshState((state) => refreshFriendActivityWithFallback(state, command.scope ?? { kind: "all", usernames: command.usernames }, taskContext)),
        ownership
      );
      if (activityResponse.ok) {
        void maybeSendTelegramNotifications(activityResponse.data as AppState);
      }
      return activityResponse;
    }
    case "upsertDredgeRule":
      return ok(await updateTimedActivityTargetInputs((state) => upsertDredgeRule(state, command.rule)));
    case "removeDredgeRule":
      return ok(await updateTimedActivityTargetInputs((state) => removeDredgeRule(state, command.id)));
    case "resetLaoFindsStartedAt":
      return ok(await updateAppState((state) => resetLaoFindsStartedAt(state)));
    case "markLaoFindsItemRead":
      return ok(await updateAppState((state) => markLaoFindsItemRead(state, command.id, command.read)));
    case "archiveLaoFindsItem":
      return ok(await updateAppState((state) => archiveLaoFindsItem(state, command.id, command.archived)));
    case "cacheAvatars":
      return ok(await cacheAvatarsFromExistingTab(command.usernames));
    case "getSiteDataProgress":
      return ok(currentSiteDataProgress());
    case "getPageScriptStatus":
      return ok(pageScriptStatusSnapshot());
    case "getUpdateCheck":
      return ok(await loadUpdateCheckState(installedVersion()));
    case "checkForUpdates":
      return ok(await checkForUpdates(command.force === true));
    case "getCloudArchiveLocalState":
      return ok(await getCloudArchiveLocalState());
    case "getCloudConfigStatus":
      return ok(await runCloudCommand(getCloudConfigStatus));
    case "bindCloudSave":
      return ok(await runCloudCommand(bindCloudSave));
    case "cloudSaveExchangeCode":
      assertCloudSaveCompleteSender(sender);
      return ok(await runCloudCommand(() => exchangeCloudSaveCode(command.code)));
    case "backupCloudConfig":
      return ok(await runCloudCommand(backupCloudConfig));
    case "restoreCloudConfig":
      return ok(await runCloudCommand(restoreCloudConfig));
    case "clearCloudBinding":
      await clearCloudAuth();
      await clearCloudAuthHandshake();
      await reconcileRequestStatsAutoSyncAlarm();
      return ok({ binding: { bound: false }, message: "已断开云存档绑定。" } satisfies CloudConfigClearBindingResult);
    case "repairLinuxDoPageScript":
      return ok(await repairLinuxDoPageScript(command.tabId));
    case "openSidePanel":
      return ok(await openSidePanel(sender));
    case "openOptionsPage":
      return ok(await openOptionsPage(command.hash));
    case "openLinuxDoHome":
      return ok(await openLinuxDoHome());
    case "openActivityLink":
      return ok(await openActivityLink(command.url));
    case "updateSettings":
      return ok(await updateSettings(command.settings));
    case "exportConfig":
      return ok(createConfigExport(await loadState()));
    case "importConfig":
      return ok(await importConfig(command.json));
    case "clearCache":
      return ok(await clearCache());
    case "resetExtension":
      return ok(await resetExtension());
    case "testTelegramNotification": {
      const testState = await loadState();
      const { telegramBotToken, telegramChatId } = testState.settings;
      if (!telegramBotToken || !telegramChatId) {
        return { ok: false, error: "请先填写 Bot Token 和 Chat ID。" };
      }
      const telegramResult = await sendTelegramMessage(telegramBotToken, telegramChatId, "🔔 佬朋友测试消息：Telegram 配置成功！");
      return telegramResult.ok ? ok("已发送测试消息。") : { ok: false, error: telegramResult.error };
    }
  }
}

async function importConfig(json: string): Promise<AppState> {
  const file = parseConfigImportJson(json);
  const currentState = await loadState();
  invalidateStateWriters();
  clearActiveSiteDataTask();
  const { state: next } = applyConfigImport(file, nowIso(), currentState);
  await saveState(next);
  await removeLocalStorageKeys([UPDATE_CHECK_STORAGE_KEY]);
  await removeSessionStorageKeys([SITE_DATA_PROGRESS_STORAGE_KEY, PAGE_SCRIPT_STATUS_STORAGE_KEY, ...allUiSceneStorageKeys]);
  await invalidateTimedActivityNoTargetSessionStateIfTargetable(next);
  await reconcileRequestStatsAutoSyncAlarm();
  pageScriptHeartbeats.clear();
  lastSiteDataProgress = null;
  return next;
}

async function identifyCurrentAccount(): Promise<AppState> {
  const generation = stateWriteGeneration;
  const current = await loadState();
  const result = (await identifyCurrentAccountFromExistingTab(current)) ?? (await identifyCurrentAccountDirect(current));
  const next = {
    ...result.state,
    lastSync: result.result
  };
  if (generation !== stateWriteGeneration) {
    return staleStateWriteResponse("已导入配置，较早的账号识别结果已丢弃。");
  }
  await saveState(next);
  return next;
}

async function identifyCurrentAccountFromExistingTab(state: AppState): Promise<{ state: AppState; result: RefreshResult } | null> {
  const response = await sendToAvailableLinuxDoTab(sendExtractCurrentAccountMessage);
  if (!response) return null;
  if (!response.ok) {
    return {
      state: applyContentRequestStats(state, "account", response),
      result: {
        ok: false,
        source: "existing_tab",
        reason: response.reason === "unavailable" ? "unavailable" : response.reason,
        message: response.error,
        refreshedAt: nowIso()
      }
    };
  }
  return {
    state: applyContentRequestStats(
      {
        ...state,
        currentAccount: { username: response.username, verifiedAt: nowIso(), source: "latest_header" }
      },
      "account",
      response
    ),
    result: {
      ok: true,
      source: "existing_tab",
      message: `已识别 @${response.username}。`,
      refreshedAt: nowIso()
    }
  };
}

async function identifyCurrentAccountDirect(state: AppState): Promise<{ state: AppState; result: RefreshResult }> {
  const counter = createRequestStatsCounter();
  const adapter = createRefreshAdapter(fetch, counter.record);
  const result = await adapter.identifyCurrentAccount(state);
  return { ...result, state: counter.apply(result.state) };
}

async function clearCache(): Promise<AppState> {
  const next = await updateAppState((state) => ({
    ...state,
    followedUsers: {},
    friendProfiles: {},
    activity: {},
    activityRefreshLedger: {},
    activityWatermarks: {},
    activityFeedWaterlineAt: undefined,
    laoFindsItems: {},
    avatarCache: {},
    lastSync: {
      ok: true,
      source: "manual",
      message: "已清理缓存，佬朋友和设置已保留。",
      refreshedAt: nowIso()
    }
  }));
  await removeSessionStorageKeys([SITE_DATA_PROGRESS_STORAGE_KEY]);
  lastSiteDataProgress = null;
  return next;
}

async function resetExtension(): Promise<AppState> {
  invalidateStateWriters();
  clearActiveSiteDataTask();
  const next: AppState = {
    ...defaultAppState,
    lastSync: {
      ok: true,
      source: "manual",
      message: "已全量重置插件。",
      refreshedAt: nowIso()
    }
  };
  await saveState(next);
  await removeLocalStorageKeys([UPDATE_CHECK_STORAGE_KEY, CLOUD_AUTH_VERIFIER_STORAGE_KEY, CLOUD_AUTH_WINDOW_STORAGE_KEY]);
  await clearCloudAuth();
  await removeSessionStorageKeys([SITE_DATA_PROGRESS_STORAGE_KEY, PAGE_SCRIPT_STATUS_STORAGE_KEY, ...allUiSceneStorageKeys]);
  await invalidateTimedActivityNoTargetSessionStateIfTargetable(next);
  await reconcileRequestStatsAutoSyncAlarm();
  pageScriptHeartbeats.clear();
  lastSiteDataProgress = null;
  return next;
}

async function bindCloudSave(): Promise<CloudConfigBindResult> {
  const verifier = randomCloudVerifier();
  const challenge = await sha256Base64url(verifier);
  await saveCloudAuthVerifier(verifier);
  const popup = await chrome.windows.create({
    url: buildBrowserCodeAuthStartUrl(challenge),
    type: "popup",
    width: 520,
    height: 720
  });
  await saveCloudAuthWindowId(popup?.id);
  return {
    binding: toPublicCloudBinding(await loadCloudAuth()),
    status: { state: "unchecked" },
    message: "已打开 linuxdo-cloud-save 登录窗口。",
    authWindowId: popup?.id
  };
}

async function runCloudCommand(command: () => Promise<CloudConfigOperationResult>): Promise<CloudConfigOperationResult> {
  try {
    return await command();
  } catch (error) {
    throw new Error(sanitizeCloudErrorMessage(error instanceof Error ? error.message : "云存档操作失败。"));
  }
}

async function exchangeCloudSaveCode(code: string): Promise<CloudConfigBindResult> {
  const verifier = await loadCloudAuthVerifier();
  if (!verifier) throw new Error("缺少 cloud-save verifier。");
  try {
    const response = await fetch(cloudAuthExchangeUrl(), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        app: CLOUD_SAVE_APP_ID,
        code,
        verifier
      })
    });
    const payload = await safeJsonObject(response);
    if (!response.ok) {
      throw new Error(cloudExchangeFailureMessage(payload));
    }
    const result = parseCloudAuthExchangePayload(payload);
    const auth = await saveCloudAuth({
      app: result.app,
      linuxDoId: result.linuxDoId,
      tokenType: result.tokenType,
      tokenKind: result.tokenKind,
      token: result.token,
      boundAt: nowIso()
    });
    await closeCloudAuthWindow();
    await clearCloudAuthHandshake();
    await reconcileRequestStatsAutoSyncAlarm();
    return {
      binding: toPublicCloudBinding(auth),
      status: auth.lastStatus,
      message: "已绑定 linuxdo-cloud-save。"
    };
  } catch (error) {
    await clearCloudAuthHandshake();
    throw error;
  }
}

function assertCloudSaveCompleteSender(sender: chrome.runtime.MessageSender): void {
  const senderUrl = sender.url ?? sender.tab?.url ?? "";
  if (!isCloudSaveCompleteUrl(senderUrl)) {
    throw new Error("云存档登录完成消息来源不正确。");
  }
}

function isCloudSaveCompleteUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const pattern = new URL(cloudAuthCompleteUrlPattern().replace(/\*$/, ""));
    return url.protocol === pattern.protocol && url.hostname === pattern.hostname && url.pathname === pattern.pathname;
  } catch {
    return false;
  }
}

async function getCloudConfigStatus(): Promise<CloudConfigStatusResult> {
  const auth = await loadCloudAuth();
  if (!auth) {
    return {
      binding: { bound: false },
      status: { state: "unchecked" },
      message: "尚未绑定 linuxdo-cloud-save。"
    };
  }
  const status = await fetchCloudConfigStatus(auth);
  return {
    binding: toPublicCloudBinding(auth),
    status,
    message: cloudStatusMessage(status)
  };
}

async function getCloudArchiveLocalState(): Promise<CloudArchiveLocalStateResult> {
  const auth = await loadCloudAuth();
  if (!auth) {
    return {
      binding: { bound: false },
      archiveState: "unbound"
    };
  }
  const currentDigest = await createConfigFingerprint(await loadState());
  const archiveState = auth.lastConfigDigest && auth.lastConfigDigest === currentDigest ? "same" : "different";
  return {
    binding: toPublicCloudBinding(auth),
    archiveState,
    syncedAt: archiveState === "same" ? auth.lastConfigSyncedAt : undefined
  };
}

async function backupCloudConfig(): Promise<CloudConfigBackupResult> {
  const auth = await requireCloudAuth();
  const state = await loadState();
  const payload = createConfigExport(state);
  const configDigest = await createConfigFingerprint(state);
  const response = await fetchCloudConfig("PUT", auth, payload);
  if (!response.ok) {
    const status = cloudStatusFromResponse(response);
    await updateCloudAuth((current) => ({ ...current, lastStatus: status }));
    throw new Error(status.message ?? "云端备份失败。");
  }
  const backedUpAt = nowIso();
  const status = summarizeCloudConfigPayload(payload, backedUpAt);
  const updated = await updateCloudAuth((current) => ({
    ...current,
    lastStatus: status,
    lastBackupAt: backedUpAt,
    lastConfigDigest: configDigest,
    lastConfigSyncedAt: backedUpAt,
    lastRequestStatsSyncedAt: backedUpAt,
    lastRequestStatsTotal: state.requestStats.total,
    lastRequestStatsAutoSyncError: undefined
  }));
  return {
    binding: toPublicCloudBinding(updated ?? auth),
    status,
    archiveState: "same",
    message: `已备份 ${status.friendCount ?? 0} 位佬朋友到云端。`
  };
}

async function restoreCloudConfig(): Promise<CloudConfigRestoreResult> {
  const auth = await requireCloudAuth();
  const response = await fetchCloudConfig("GET", auth);
  if (!response.ok) {
    const status = cloudStatusFromResponse(response);
    await updateCloudAuth((current) => ({ ...current, lastStatus: status }));
    throw new Error(status.message ?? "读取云端配置失败。");
  }
  const payload = await safeJsonObject(response);
  const file = parseCloudConfigPayload(payload);
  const nextState = await importConfig(JSON.stringify(file));
  const restoredAt = nowIso();
  const status = summarizeCloudConfigPayload(file, restoredAt);
  const configDigest = await createConfigFingerprint(nextState);
  const updated = await updateCloudAuth((current) => ({
    ...current,
    lastStatus: status,
    lastRestoreAt: restoredAt,
    lastConfigDigest: configDigest,
    lastConfigSyncedAt: restoredAt,
    lastRequestStatsSyncedAt: restoredAt,
    lastRequestStatsTotal: nextState.requestStats.total,
    lastRequestStatsAutoSyncError: undefined
  }));
  await reconcileRequestStatsAutoSyncAlarm();
  return {
    binding: toPublicCloudBinding(updated ?? auth),
    status,
    archiveState: "same",
    state: nextState,
    message: nextState.lastSync?.message ?? "已从云端恢复配置。"
  };
}

function registerRequestStatsAutoSyncAlarmListeners(): void {
  try {
    chrome.alarms?.onAlarm?.addListener?.((alarm) => {
      void handleRequestStatsAutoSyncAlarm(alarm).catch(() => {
        // Background alarms are best-effort; failures are recorded in cloud auth when possible.
      });
    });
    chrome.runtime?.onStartup?.addListener?.(() => {
      void reconcileRequestStatsAutoSyncAlarm().catch(() => {
        // Startup reconciliation should never block normal extension startup.
      });
    });
  } catch {
    // Test and older browser surfaces may omit alarms/startup APIs.
  }
}

async function reconcileRequestStatsAutoSyncAlarm(): Promise<void> {
  if (!chrome.alarms) return;
  const [state, auth] = await Promise.all([loadState(), loadCloudAuth()]);
  if (state.settings.requestStatsAutoSyncEnabled && auth) {
    await chrome.alarms.create(REQUEST_STATS_AUTO_SYNC_ALARM_NAME, {
      delayInMinutes: 1,
      periodInMinutes: REQUEST_STATS_AUTO_SYNC_PERIOD_MINUTES
    });
    return;
  }
  await chrome.alarms.clear(REQUEST_STATS_AUTO_SYNC_ALARM_NAME);
}

async function handleRequestStatsAutoSyncAlarm(alarm: chrome.alarms.Alarm): Promise<void> {
  if (alarm.name !== REQUEST_STATS_AUTO_SYNC_ALARM_NAME) return;
  const state = await loadState();
  if (!state.settings.requestStatsAutoSyncEnabled) {
    await reconcileRequestStatsAutoSyncAlarm();
    return;
  }
  const auth = await loadCloudAuth();
  if (!auth) {
    await reconcileRequestStatsAutoSyncAlarm();
    return;
  }
  if (!shouldRunRequestStatsAutoSyncToday(auth, new Date())) return;
  await uploadRequestStatsCloudSnapshot(state, auth);
}

function shouldRunRequestStatsAutoSyncToday(auth: CloudAuthState, now: Date): boolean {
  const today = localDateKey(now);
  const latestAttemptAt = latestRequestStatsAutoSyncAttemptAt(auth);
  return !latestAttemptAt || localDateKey(new Date(latestAttemptAt)) !== today;
}

function latestRequestStatsAutoSyncAttemptAt(auth: CloudAuthState): string | undefined {
  const candidates = [auth.lastRequestStatsSyncedAt, auth.lastRequestStatsAutoSyncError?.checkedAt].filter(
    (value): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value))
  );
  return candidates.sort((left, right) => Date.parse(right) - Date.parse(left))[0];
}

async function uploadRequestStatsCloudSnapshot(state: AppState, auth: CloudAuthState): Promise<void> {
  const payload = createConfigExport(state);
  const configDigest = await createConfigFingerprint(state);
  try {
    const response = await fetchCloudConfig("PUT", auth, payload);
    if (!response.ok) {
      const status = cloudStatusFromResponse(response);
      await updateCloudAuth((current) => ({ ...current, lastRequestStatsAutoSyncError: status }));
      return;
    }
    const syncedAt = nowIso();
    const status = summarizeCloudConfigPayload(payload, syncedAt);
    await updateCloudAuth((current) => ({
      ...current,
      lastStatus: status,
      lastConfigDigest: configDigest,
      lastConfigSyncedAt: syncedAt,
      lastRequestStatsSyncedAt: syncedAt,
      lastRequestStatsTotal: state.requestStats.total,
      lastRequestStatsAutoSyncError: undefined
    }));
  } catch (error) {
    const status = cloudConfigStatusFromError("network_error", error instanceof Error ? error.message : "请求统计自动同步失败。");
    await updateCloudAuth((current) => ({ ...current, lastRequestStatsAutoSyncError: status }));
  }
}

async function requireCloudAuth(): Promise<CloudAuthState> {
  const auth = await loadCloudAuth();
  if (!auth) throw new Error("尚未绑定 linuxdo-cloud-save。");
  return auth;
}

async function fetchCloudConfig(method: "GET" | "PUT", auth: CloudAuthState, body?: unknown): Promise<Response> {
  try {
    return await fetch(cloudConfigSlotUrl(), {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `${auth.tokenType} ${auth.token}`,
        ...(method === "PUT" ? { "Content-Type": "application/json" } : {})
      },
      ...(method === "PUT" ? { body: JSON.stringify(body ?? {}) } : {})
    });
  } catch (error) {
    throw new Error(sanitizeCloudErrorMessage(error instanceof Error ? error.message : "云存档网络请求失败。"));
  }
}

async function saveCloudAuthVerifier(verifier: string): Promise<void> {
  await chrome.storage?.local?.set?.({ [CLOUD_AUTH_VERIFIER_STORAGE_KEY]: verifier });
}

async function loadCloudAuthVerifier(): Promise<string | null> {
  const result = await chrome.storage?.local?.get?.(CLOUD_AUTH_VERIFIER_STORAGE_KEY);
  const verifier = result?.[CLOUD_AUTH_VERIFIER_STORAGE_KEY];
  return typeof verifier === "string" && verifier.trim() ? verifier : null;
}

async function saveCloudAuthWindowId(windowId: number | undefined): Promise<void> {
  if (typeof windowId !== "number") return;
  await chrome.storage?.local?.set?.({ [CLOUD_AUTH_WINDOW_STORAGE_KEY]: windowId });
}

async function loadCloudAuthWindowId(): Promise<number | null> {
  const result = await chrome.storage?.local?.get?.(CLOUD_AUTH_WINDOW_STORAGE_KEY);
  const windowId = result?.[CLOUD_AUTH_WINDOW_STORAGE_KEY];
  return typeof windowId === "number" && Number.isInteger(windowId) && windowId > 0 ? windowId : null;
}

async function clearCloudAuthHandshake(): Promise<void> {
  await removeLocalStorageKeys([CLOUD_AUTH_VERIFIER_STORAGE_KEY, CLOUD_AUTH_WINDOW_STORAGE_KEY]);
}

async function closeCloudAuthWindow(): Promise<void> {
  const windowId = await loadCloudAuthWindowId();
  if (windowId == null || typeof chrome.windows?.remove !== "function") return;
  try {
    await chrome.windows.remove(windowId);
  } catch {
    // The user may have closed the popup before the completion page reports back.
  }
}

function randomCloudVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64urlFromBytes(bytes.buffer);
}

function cloudExchangeFailureMessage(payload: Record<string, unknown>): string {
  const error = payload.error;
  if (typeof error === "object" && error != null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "cloud-save exchange failed";
}

async function fetchCloudConfigStatus(auth: CloudAuthState): Promise<CloudConfigStatus> {
  try {
    const response = await fetchCloudConfig("GET", auth);
    if (!response.ok) return cloudStatusFromResponse(response);
    return summarizeCloudConfigPayload(await safeJsonObject(response));
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === "CloudConfigError") return cloudConfigStatusFromError("invalid_config", error.message);
      return cloudConfigStatusFromError("network_error", error.message);
    }
    return cloudConfigStatusFromError("network_error", "云存档状态检查失败。");
  }
}

async function safeJsonObject(response: Response): Promise<Record<string, unknown>> {
  try {
    const payload = (await response.json()) as unknown;
    if (typeof payload === "object" && payload != null && !Array.isArray(payload)) return payload as Record<string, unknown>;
  } catch {
    // Fall through to the curated error below.
  }
  throw cloudConfigStatusError("云端配置不是有效的 JSON 对象。");
}

function cloudConfigStatusError(message: string): Error {
  const error = new Error(message);
  error.name = "CloudConfigError";
  return error;
}

function cloudStatusFromResponse(response: Response): CloudConfigStatus {
  if (response.status === 401 || response.status === 403) {
    return cloudConfigStatusFromError("unauthorized", "云存档授权已失效，请重新绑定。");
  }
  if (response.status === 404) {
    return cloudConfigStatusFromError("missing", "云端还没有配置备份。");
  }
  return cloudConfigStatusFromError("network_error", `云存档请求失败：HTTP ${response.status}`);
}

function cloudStatusMessage(status: CloudConfigStatus): string {
  switch (status.state) {
    case "remote_config":
      return `云端配置：${status.friendCount ?? 0} 位佬朋友。`;
    case "missing":
    case "unauthorized":
    case "invalid_config":
    case "network_error":
      return status.message ?? "云存档状态检查失败。";
    case "unchecked":
      return "尚未检查云端配置。";
  }
}

async function removeLocalStorageKeys(keys: string[]) {
  try {
    await chrome.storage?.local?.remove?.(keys);
  } catch {
    // Storage cleanup is best effort; the canonical app state is saved separately.
  }
}

async function removeSessionStorageKeys(keys: string[]) {
  try {
    await chrome.storage?.session?.remove?.(keys);
  } catch {
    // Session storage may be unavailable in tests or older Chrome surfaces.
  }
}

async function checkForUpdates(force: boolean): Promise<UpdateCheckState> {
  const installed = installedVersion();
  const cached = await loadUpdateCheckState(installed);
  if (!force && cached.checkedAt && isUpdateCheckCacheFresh(cached)) return cached;
  if (activeUpdateCheck) return activeUpdateCheck;

  const request = fetchLatestReleaseUpdateState(installed, stateWriteGeneration).finally(() => {
    if (activeUpdateCheck === request) activeUpdateCheck = null;
  });
  activeUpdateCheck = request;
  return request;
}

async function fetchLatestReleaseUpdateState(installed: string, generation: number): Promise<UpdateCheckState> {
  const next = await fetchLatestReleaseFromApis(installed);
  if (generation === stateWriteGeneration) {
    await saveUpdateCheckState(next);
  }
  return next;
}

async function fetchLatestReleaseFromApis(installed: string): Promise<UpdateCheckState> {
  const primary = await fetchLatestReleaseFromApi(GITHUB_LATEST_RELEASE_API);
  if (primary.ok) return updateCheckStateFromRelease(installed, primary.payload);
  if (primary.status === 404) return updateCheckFailureState(installed, "no-release", "GitHub 仓库还没有 latest release。");
  if (!shouldTryGitHubApiMirror(primary)) {
    return updateCheckFailureState(installed, "error", updateCheckFailureMessage(primary, "GitHub Release 检查失败。"));
  }

  const mirror = await fetchLatestReleaseFromApi(GITHUB_LATEST_RELEASE_API_MIRROR);
  if (mirror.ok) return updateCheckStateFromRelease(installed, mirror.payload);
  if (mirror.status === 404) return updateCheckFailureState(installed, "no-release", "GitHub 仓库还没有 latest release。");
  return updateCheckFailureState(installed, "error", updateCheckFailureMessage(mirror, updateCheckFailureMessage(primary, "GitHub Release 检查失败。")));
}

type LatestReleaseFetchResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; status?: number; error?: string };

async function fetchLatestReleaseFromApi(url: string): Promise<LatestReleaseFetchResult> {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json"
      }
    });
    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true, payload: (await response.json()) as Record<string, unknown> };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "GitHub Release 检查失败。" };
  }
}

function shouldTryGitHubApiMirror(result: LatestReleaseFetchResult): boolean {
  if (result.ok) return false;
  if (result.error) return true;
  return result.status === 403 || result.status === 429 || (typeof result.status === "number" && result.status >= 500);
}

function updateCheckFailureMessage(result: LatestReleaseFetchResult, fallback: string): string {
  if (result.ok) return fallback;
  if (result.status) return `GitHub Release 检查失败：HTTP ${result.status}`;
  return result.error ?? fallback;
}

function installedVersion(): string {
  return chrome.runtime.getManifest?.().version ?? defaultUpdateCheckState("0.0.0").installedVersion;
}

async function openSidePanel(sender: chrome.runtime.MessageSender): Promise<{ message: string }> {
  if (!chrome.sidePanel?.open) {
    throw new Error("当前浏览器不支持插件侧栏。");
  }
  const senderTabId = sender.tab?.id;
  const senderWindowId = sender.tab?.windowId;
  if (typeof senderTabId === "number") {
    await chrome.sidePanel.open({ tabId: senderTabId });
    return { message: "已打开插件侧栏。" };
  }
  if (typeof senderWindowId === "number") {
    await chrome.sidePanel.open({ windowId: senderWindowId });
    return { message: "已打开插件侧栏。" };
  }
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (typeof activeTab?.id === "number") {
    await chrome.sidePanel.open({ tabId: activeTab.id });
    return { message: "已打开插件侧栏。" };
  }
  if (typeof activeTab?.windowId === "number") {
    await chrome.sidePanel.open({ windowId: activeTab.windowId });
    return { message: "已打开插件侧栏。" };
  }
  throw new Error("没有找到可以打开侧栏的浏览器窗口。");
}

async function openOptionsPage(hash?: string): Promise<{ message: string }> {
  const url = optionsPageUrl(hash);
  const existing = await findExistingOptionsTab();
  if (existing?.id != null) {
    await chrome.tabs.update(existing.id, { url, active: true });
    if (typeof existing.windowId === "number") {
      try {
        await chrome.windows?.update?.(existing.windowId, { focused: true });
      } catch {
        // Focusing another window is best effort; updating the tab is enough.
      }
    }
    return { message: "已打开配置页。" };
  }
  await chrome.tabs.create({ url, active: true });
  return { message: "已打开配置页。" };
}

function optionsPageUrl(hash?: string): string {
  return chrome.runtime.getURL(`src/options/index.html${hash ?? ""}`);
}

async function findExistingOptionsTab(): Promise<chrome.tabs.Tab | null> {
  const optionsPageBase = chrome.runtime.getURL("src/options/index.html");
  const currentWindowTabs = await chrome.tabs.query({ currentWindow: true });
  const currentWindowTab = currentWindowTabs.find((tab) => isOptionsPageTab(tab, optionsPageBase));
  if (currentWindowTab?.id != null) return currentWindowTab;
  const allTabs = await chrome.tabs.query({});
  return allTabs.find((tab) => isOptionsPageTab(tab, optionsPageBase)) ?? null;
}

function isOptionsPageTab(tab: chrome.tabs.Tab, optionsPageBase: string): boolean {
  return typeof tab.url === "string" && (tab.url === optionsPageBase || tab.url.startsWith(`${optionsPageBase}#`));
}

async function addFriendByProfileWithFallback(
  state: AppState,
  username: Username
): Promise<{ state: AppState; result: RefreshResult }> {
  const counter = createRequestStatsCounter();
  const directAdapter = createRefreshAdapter(fetch, counter.record);
  const directRaw = await directAdapter.addFriendByProfile(state, username);
  const direct = { ...directRaw, state: counter.apply(directRaw.state) };
  if (direct.result?.ok) return direct;
  if (!shouldTryExistingTab(direct.result)) return direct;

  const existingTab = await addFriendByProfileFromExistingTab(direct.state, username);
  if (existingTab) return existingTab;
  return {
    state: direct.state,
    result: {
      ok: false,
      source: "existing_tab",
      reason: direct.result.reason,
      message: `${direct.result.message} 请打开一个 linux.do 页面后再添加。`,
      refreshedAt: nowIso()
    }
  };
}

async function lookupFriendProfileWithFallback(username: Username): Promise<BackgroundResponse> {
  const generation = stateWriteGeneration;
  const counter = createRequestStatsCounter();
  const directAdapter = createRefreshAdapter(fetch, counter.record);
  const direct = await directAdapter.lookupFriendProfile(username);
  await persistRequestStats(counter, generation);
  if (direct.ok) return ok(direct.profile);
  if (!shouldTryExistingTab(direct.result)) return { ok: false, error: direct.result.message, reason: direct.result.reason };

  const response = await sendToAvailableLinuxDoTab((tabId) => sendExtractProfileMessage(tabId, username));
  await persistContentRequestStats("profile", response, generation);
  if (!response) {
    return {
      ok: false,
      error: `${direct.result.message} 请打开一个 linux.do 页面后再查找。`,
      reason: direct.result.reason
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      error: response.error,
      reason: response.reason === "unavailable" ? "unavailable" : response.reason
    };
  }
  return ok(response.profile);
}

async function runSiteDataTask(
  run: (taskContext: SiteDataTaskContext) => Promise<BackgroundResponse>,
  ownership: SiteDataTaskOwnership = {}
): Promise<BackgroundResponse> {
  releaseStaleActiveSiteDataTask();
  if (activeSiteDataTask) {
    const current = await loadState();
    return ok({
      ...current,
      lastSync: {
        ok: false,
        source: "manual",
        reason: "unavailable",
        message: "已有刷新正在进行。",
        refreshedAt: nowIso()
      }
    });
  }
  const taskId = `site-data:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const taskRecord: ActiveSiteDataTask = {
    taskId,
    generation: stateWriteGeneration,
    trigger: ownership.trigger,
    timedRunId: ownership.timedRunId,
    promise: Promise.resolve({ ok: false, error: "任务尚未开始。" } satisfies BackgroundResponse)
  };
  activeSiteDataTask = taskRecord;
  const taskContext = taskContextFromRecord(taskRecord);
  const task = run(taskContext);
  taskRecord.promise = task;
  try {
    return await task;
  } finally {
    if (taskMatchesActiveIdentity(taskContext)) {
      if (activeSiteDataTask.progress?.status === "running") {
        if (taskCanWriteProgress(taskContext)) {
          finishSiteDataProgress(taskContext, "error", "刷新任务异常中断。");
        } else {
          finishInvalidatedSiteDataProgress(taskContext);
        }
      }
      activeSiteDataTask = null;
    }
  }
}

function releaseStaleActiveSiteDataTask() {
  if (!activeSiteDataTask || !isStaleRunningSiteDataProgress(activeSiteDataTask.progress)) return;
  finishSiteDataProgress(taskContextFromRecord(activeSiteDataTask), "error", "刷新任务超时，已释放刷新锁。");
  activeSiteDataTask = null;
  invalidateStateWriters();
}

async function refreshFriendProfilesWithFallback(
  state: AppState,
  usernames?: Username[]
): Promise<{ state: AppState; result: RefreshResult }> {
  const taskContext = activeSiteDataTask ? taskContextFromRecord(activeSiteDataTask) : undefined;
  startProfileProgress(state, usernames, "direct_fetch", taskContext);
  const counter = createRequestStatsCounter();
  const directAdapter = createRefreshAdapter(fetch, counter.record);
  const directRaw = await directAdapter.refreshFriendProfiles(state, usernames, (username) => incrementProfileProgress(username, "direct_fetch", taskContext));
  const direct = { ...directRaw, state: counter.apply(directRaw.state) };
  if (direct.result?.ok) {
    finishSiteDataProgress(taskContext, "success");
    return direct;
  }
  if (!shouldTryExistingTab(direct.result)) {
    finishSiteDataProgress(taskContext, "error", direct.result.message);
    return direct;
  }

  finishSiteDataProgress(taskContext, "error", direct.result.message);
  startProfileProgress(direct.state, usernames, "existing_tab", taskContext);
  const existingTab = await refreshFriendProfilesFromExistingTab(direct.state, usernames, taskContext);
  if (existingTab) {
    finishSiteDataProgress(taskContext, existingTab.result.ok ? "success" : "error", existingTab.result.ok ? undefined : existingTab.result.message);
    return existingTab;
  }
  const missingTabResult: { state: AppState; result: RefreshResult } = {
    state: direct.state,
    result: {
      ok: false,
      source: "existing_tab",
      reason: direct.result.reason,
      message: `${direct.result.message} 请打开一个 linux.do 页面后再刷新状态。`,
      refreshedAt: nowIso()
    }
  };
  finishSiteDataProgress(taskContext, "error", missingTabResult.result.message);
  return missingTabResult;
}

async function syncFollowedUsersWithFallback(state: AppState): Promise<{ state: AppState; result: RefreshResult }> {
  const counter = createRequestStatsCounter();
  const directAdapter = createRefreshAdapter(fetch, counter.record);
  const directRaw = await directAdapter.syncFollowedUsers(state);
  const direct = { ...directRaw, state: counter.apply(directRaw.state) };
  if (direct.result?.ok) return direct;
  if (!shouldTryExistingTab(direct.result)) return direct;

  const existingTab = await syncFollowedUsersFromExistingTab(direct.state);
  if (existingTab) return existingTab;
  return {
    state: direct.state,
    result: {
      ok: false,
      source: "existing_tab",
      reason: direct.result.reason,
      message: `${direct.result.message} 请打开一个 linux.do 页面后再同步。`,
      refreshedAt: nowIso()
    }
  };
}

async function addFriendByProfileFromExistingTab(
  state: AppState,
  username: Username
): Promise<{ state: AppState; result: RefreshResult } | null> {
  const response = await sendToAvailableLinuxDoTab((tabId) => sendExtractProfileMessage(tabId, username));
  if (!response) return null;
  if (!response.ok) {
    return {
      state: applyContentRequestStats(state, "profile", response),
      result: {
        ok: false,
        source: "existing_tab",
        reason: response.reason === "unavailable" ? "unavailable" : response.reason,
        message: response.error,
        refreshedAt: nowIso()
      }
    };
  }
  return {
    state: applyContentRequestStats(addFriendFromProfile(state, response.profile), "profile", response),
    result: {
      ok: true,
      source: "existing_tab",
      message: `已通过已打开的 linux.do 页面添加 @${response.profile.username} 为佬朋友。`,
      refreshedAt: nowIso()
    }
  };
}

async function refreshFriendProfilesFromExistingTab(
  state: AppState,
  usernames?: Username[],
  taskContext?: SiteDataTaskContext
): Promise<{ state: AppState; result: RefreshResult } | null> {
  const targets = normalizeRefreshTargets(state, usernames);
  let nextState = state;
  let refreshedCount = 0;
  for (const username of targets) {
    const response = await sendToAvailableLinuxDoTab((tabId) => sendExtractProfileMessage(tabId, username));
    if (!response) return null;
    if (!response.ok) {
      return {
        state: applyContentRequestStats(nextState, "profile", response),
        result: {
          ok: false,
          source: "existing_tab",
          reason: response.reason === "unavailable" ? "unavailable" : response.reason,
          message: response.error,
          refreshedAt: nowIso()
        }
      };
    }
    nextState = applyContentRequestStats(upsertFriendProfile(nextState, response.profile), "profile", response);
    refreshedCount += 1;
    incrementProfileProgress(username, "existing_tab", taskContext);
  }
  return {
    state: nextState,
    result: {
      ok: true,
      source: "existing_tab",
      message: `已通过已打开的 linux.do 页面刷新 ${refreshedCount} 位佬朋友状态。`,
      refreshedAt: nowIso()
    }
  };
}

async function refreshFriendActivityWithFallback(
  state: AppState,
  scopeInput?: ActivityRefreshScope,
  taskContext?: SiteDataTaskContext
): Promise<{ state: AppState; result: RefreshResult }> {
  const scope = normalizeActivityRefreshScope(scopeInput);
  startActivityProgress(state, scope, "direct_fetch", taskContext);
  const counter = createRequestStatsCounter();
  const directAdapter = createRefreshAdapter(fetch, counter.record);
  const directRaw = await directAdapter.refreshFriendActivity(state, scope, (step) => incrementActivityProgress(step, "direct_fetch", taskContext));
  const direct = { ...directRaw, state: counter.apply(directRaw.state) };
  if (direct.result?.ok) {
    finishActivityProgress(taskContext, "success");
    return direct;
  }
  const directFailure = direct.result as Exclude<RefreshResult, { ok: true }>;
  if (!shouldTryExistingTab(directFailure)) {
    finishActivityProgress(taskContext, "error", directFailure.message);
    return direct;
  }

  startActivityProgress(direct.state, scope, "existing_tab", taskContext);
  const existingTab = await refreshFriendActivityFromExistingTab(direct.state, scope, taskContext);
  if (existingTab) {
    finishActivityProgress(taskContext, existingTab.result.ok ? "success" : "error", existingTab.result.ok ? undefined : existingTab.result.message);
    return existingTab;
  }
  const missingTabResult: { state: AppState; result: RefreshResult } = {
    state: direct.state,
    result: {
      ok: false,
      source: "existing_tab",
      reason: directFailure.reason,
      message: `${directFailure.message} 请打开一个 linux.do 页面后再刷新动态。`,
      refreshedAt: nowIso()
    }
  };
  finishActivityProgress(taskContext, "error", missingTabResult.result.message);
  return missingTabResult;
}

function shouldTryExistingTab(result: RefreshResult): boolean {
  return !result.ok && ["challenge", "blocked", "rate_limited", "unavailable", "network_error"].includes(result.reason);
}

function startActivityProgress(state: AppState, scope: ActivityRefreshScope, source: RefreshResult["source"], taskContext?: SiteDataTaskContext) {
  if (!taskContext || !taskCanWriteProgress(taskContext)) return;
  const targets = planActivityRefreshTargets(state, scope);
  const now = nowIso();
  const progress: ActivityRefreshTaskProgress = {
    taskId: taskContext.taskId,
    taskType: "activity",
    status: "running",
    trigger: taskContext.trigger,
    timedRunId: taskContext.timedRunId,
    scope,
    completed: 0,
    total: targets.reduce((sum, target) => sum + target.steps.length, 0),
    source,
    startedAt: now,
    updatedAt: now
  };
  setActivityProgress(taskContext, progress);
}

function startProfileProgress(state: AppState, usernames: Username[] | undefined, source: RefreshResult["source"], taskContext?: SiteDataTaskContext) {
  if (!taskContext || !taskCanWriteProgress(taskContext)) return;
  const targets = normalizeRefreshTargets(state, usernames);
  const now = nowIso();
  const progress: ProfileRefreshTaskProgress = {
    taskId: taskContext.taskId,
    taskType: "profiles",
    status: "running",
    trigger: taskContext.trigger,
    timedRunId: taskContext.timedRunId,
    usernames: targets,
    completed: 0,
    total: targets.length,
    source,
    startedAt: now,
    updatedAt: now
  };
  setSiteDataProgress(taskContext, progress);
}

function incrementActivityProgress(step: ActivityRequestStep, source: RefreshResult["source"], taskContext?: SiteDataTaskContext) {
  if (!taskContext || !taskCanWriteProgress(taskContext) || !activeSiteDataTask?.progress || activeSiteDataTask.progress.taskType !== "activity") return;
  setActivityProgress(taskContext, {
    ...activeSiteDataTask.progress,
    status: "running",
    completed: Math.min(activeSiteDataTask.progress.completed + 1, activeSiteDataTask.progress.total),
    currentLabel: step.label,
    source,
    updatedAt: nowIso()
  });
}

function incrementProfileProgress(username: Username, source: RefreshResult["source"], taskContext?: SiteDataTaskContext) {
  if (!taskContext || !taskCanWriteProgress(taskContext) || !activeSiteDataTask?.progress || activeSiteDataTask.progress.taskType !== "profiles") return;
  setSiteDataProgress(taskContext, {
    ...activeSiteDataTask.progress,
    status: "running",
    completed: Math.min(activeSiteDataTask.progress.completed + 1, activeSiteDataTask.progress.total),
    currentLabel: `@${username}`,
    source,
    updatedAt: nowIso()
  });
}

function finishActivityProgress(taskContext: SiteDataTaskContext | undefined, status: "success" | "error", error?: string) {
  finishSiteDataProgress(taskContext, status, error);
}

function finishSiteDataProgress(taskContext: SiteDataTaskContext | undefined, status: "success" | "error", error?: string) {
  if (!taskContext || !taskCanWriteProgress(taskContext) || !activeSiteDataTask?.progress) return;
  const now = nowIso();
  setSiteDataProgress(taskContext, {
    ...activeSiteDataTask.progress,
    status,
    updatedAt: now,
    finishedAt: now,
    error
  });
}

function setActivityProgress(taskContext: SiteDataTaskContext, progress: ActivityRefreshTaskProgress) {
  setSiteDataProgress(taskContext, progress);
}

function setSiteDataProgress(taskContext: SiteDataTaskContext, progress: SiteDataTaskProgress) {
  if (!taskCanWriteProgress(taskContext)) return;
  const task = activeSiteDataTask;
  if (!task) return;
  task.progress = progress;
  lastSiteDataProgress = progress;
  void saveSiteDataProgressState(progress);
  broadcastSiteDataProgress(progress);
}

function retireTimedActivityTask(timedRunId: string) {
  const task = activeSiteDataTask;
  if (!task || task.trigger !== "timed" || task.timedRunId !== timedRunId || task.progress?.taskType !== "activity") return;
  const now = nowIso();
  const progress: ActivityRefreshTaskProgress = {
    ...task.progress,
    status: "error",
    trigger: "timed",
    timedRunId,
    retiredReason: "timed_disabled",
    updatedAt: now,
    finishedAt: now,
    error: "自动捞料已关闭，本次打捞已停止。"
  };
  activeSiteDataTask = null;
  writeRetiredSiteDataProgress(progress);
}

function writeRetiredSiteDataProgress(progress: SiteDataTaskProgress) {
  if (progress.status === "running" || progress.retiredReason !== "timed_disabled" || progress.trigger !== "timed" || !progress.timedRunId) return;
  lastSiteDataProgress = progress;
  void saveSiteDataProgressState(progress);
  broadcastSiteDataProgress(progress);
}

function finishInvalidatedSiteDataProgress(taskContext: SiteDataTaskContext) {
  if (!taskMatchesActiveIdentity(taskContext) || lastSiteDataProgress?.taskId !== taskContext.taskId) return;
  const task = activeSiteDataTask;
  if (!task?.progress) return;
  const now = nowIso();
  const progress: SiteDataTaskProgress = {
    ...task.progress,
    status: "error",
    updatedAt: now,
    finishedAt: now,
    error: "刷新结果已被较新的本地状态变更丢弃。"
  };
  lastSiteDataProgress = progress;
  void saveSiteDataProgressState(progress);
  broadcastSiteDataProgress(progress);
}

function taskContextFromRecord(task: ActiveSiteDataTask): SiteDataTaskContext {
  return {
    taskId: task.taskId,
    generation: task.generation,
    trigger: task.trigger,
    timedRunId: task.timedRunId
  };
}

function taskMatchesActiveIdentity(taskContext: SiteDataTaskContext | undefined): taskContext is SiteDataTaskContext {
  return (
    !!taskContext &&
    !!activeSiteDataTask &&
    activeSiteDataTask.taskId === taskContext.taskId &&
    activeSiteDataTask.generation === taskContext.generation
  );
}

function taskCanWriteProgress(taskContext: SiteDataTaskContext | undefined): taskContext is SiteDataTaskContext {
  const task = activeSiteDataTask;
  return !!taskContext && !!task && task.taskId === taskContext.taskId && task.generation === taskContext.generation && task.generation === stateWriteGeneration;
}

function siteDataTaskOwnershipFromCommand(command: Extract<BackgroundCommand, { type: "refreshFriendActivity" }>): SiteDataTaskOwnership {
  if (command.trigger !== "timed") return {};
  return { trigger: "timed", timedRunId: command.timedRunId };
}

function currentSiteDataProgress(): SiteDataTaskProgress | null {
  const progress = activeSiteDataTask?.generation === stateWriteGeneration ? (activeSiteDataTask.progress ?? lastSiteDataProgress) : lastSiteDataProgress;
  if (isStaleRunningSiteDataProgress(progress)) return null;
  return progress ?? null;
}

function clearActiveSiteDataTask() {
  activeSiteDataTask = null;
}

function broadcastSiteDataProgress(progress: SiteDataTaskProgress) {
  try {
    void chrome.runtime.sendMessage({ type: "linuxdoFriends.siteDataProgress", progress });
  } catch {
    // Popup or side-panel may be closed while the task continues.
  }
}

async function syncFollowedUsersFromExistingTab(state: AppState): Promise<{ state: AppState; result: RefreshResult } | null> {
  const response = await sendToAvailableLinuxDoTab(sendExtractFollowingMessage);
  if (!response) return null;
  if (!response.ok) {
    return {
      state: applyContentRequestStats(state, "following", response),
      result: {
        ok: false,
        source: "existing_tab",
        reason: response.reason === "unavailable" ? "unavailable" : response.reason,
        message: response.error,
        refreshedAt: nowIso()
      }
    };
  }

  let nextState: AppState = applyContentRequestStats(
    {
      ...state,
      currentAccount: { username: response.username, verifiedAt: nowIso(), source: "latest_header" }
    },
    "following",
    response
  );
  for (const user of response.users) {
    nextState = upsertFollowedUser(nextState, { ...user, source: "sync" });
  }
  return {
    state: nextState,
    result: {
      ok: true,
      source: "existing_tab",
      message: `已通过已打开的 linux.do 页面识别 @${response.username}，同步 ${response.users.length} 位关注用户。`,
      refreshedAt: nowIso()
    }
  };
}

async function refreshFriendActivityFromExistingTab(
  state: AppState,
  scopeInput?: ActivityRefreshScope,
  taskContext?: SiteDataTaskContext
): Promise<{ state: AppState; result: RefreshResult } | null> {
  const scope = normalizeActivityRefreshScope(scopeInput);
  const targets = planActivityRefreshTargets(state, scope);
  const collectedTargets: Array<{ username: Username; items: ActivityItem[]; refreshedKinds: ActivityRefreshKind[] }> = [];
  const feedWaterlineAt = latestActivityRefreshAt(state);
  let statsState = state;
  let refreshedCount = 0;
  for (const target of targets) {
    const items: ActivityItem[] = [];
    for (const step of target.steps) {
      const response = await sendToAvailableLinuxDoTab((tabId) => sendExtractActivityMessage(tabId, target.username, step));
      if (!response) return null;
      if (!response.ok) {
        return {
          state: applyContentRequestStats(statsState, "activity", response),
          result: {
            ok: false,
            source: "existing_tab",
            reason: response.reason === "unavailable" ? "unavailable" : response.reason,
            message: response.error,
            refreshedAt: nowIso()
          }
        };
      }
      statsState = applyContentRequestStats(statsState, "activity", response);
      items.push(...response.activity.items);
      incrementActivityProgress(step, "existing_tab", taskContext);
    }
    collectedTargets.push({ username: target.username, items: sortActivityItems(items), refreshedKinds: target.refreshedKinds });
    refreshedCount += 1;
  }
  let nextState = collectedTargets.length ? clearActivityNewFlags(statsState) : statsState;
  for (const target of collectedTargets) {
    nextState = applyScopedActivityRefresh(
      nextState,
      target.username,
      target.items,
      target.refreshedKinds,
      "existing_tab",
      undefined,
      { clearExistingNew: false, feedWaterlineAt }
    );
  }
  const refreshedAt = nowIso();
  const collected = collectLaoFindsItems(nextState, collectedTargets.flatMap((target) => target.items), refreshedAt);
  return {
    state: collected.state,
    result: {
      ok: true,
      source: "existing_tab",
      message: `已通过已打开的 linux.do 页面刷新 ${refreshedCount} 位好友动态。`,
      refreshedAt
    }
  };
}

async function findUsableLinuxDoTabId(): Promise<number | null> {
  const ids = await linuxDoTabCandidateIds();
  return ids[0] ?? null;
}

async function linuxDoTabCandidateIds(): Promise<number[]> {
  const seen = new Set<number>();
  const ids: number[] = [];
  function add(id: unknown) {
    if (typeof id !== "number" || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  }
  freshReadyHeartbeats().forEach((heartbeat) => add(heartbeat.tabId));
  try {
    const tabs = await chrome.tabs.query({ url: "https://linux.do/*" });
    tabs.forEach((tab) => add(tab.id));
  } catch {
    // Heartbeat candidates are still useful if tab query is unavailable.
  }
  return ids;
}

async function cacheAvatarsFromExistingTab(usernames?: Username[]): Promise<AppState> {
  const generation = stateWriteGeneration;
  const state = await loadState();
  const targets = avatarCacheTargets(state, usernames);
  if (targets.length === 0) return state;
  let nextState = state;
  for (const target of targets) {
    const response = await sendToAvailableLinuxDoTab((tabId) => sendExtractAvatarMessage(tabId, target.username, target.avatarUrl));
    if (!response) continue;
    nextState = applyContentRequestStats(nextState, "avatar", response);
    if (!response.ok) continue;
    nextState = {
      ...nextState,
      avatarCache: {
        ...nextState.avatarCache,
        [target.username]: {
          username: target.username,
          sourceUrl: response.sourceUrl,
          dataUrl: response.dataUrl,
          contentType: response.contentType,
          byteLength: response.byteLength,
          updatedAt: nowIso()
        }
      }
    };
  }
  if (nextState !== state) {
    if (generation !== stateWriteGeneration) {
      return staleStateWriteResponse("已导入配置，较早的头像缓存结果已丢弃。");
    }
    await saveState(nextState);
  }
  return nextState;
}

type LinuxDoContentResponse =
  | ContentScriptCurrentAccountResponse
  | ContentScriptFollowingResponse
  | ContentScriptProfileResponse
  | ContentScriptActivityResponse
  | ContentScriptAvatarResponse;

async function sendToAvailableLinuxDoTab<T extends LinuxDoContentResponse>(send: (tabId: number) => Promise<T>): Promise<T | null> {
  const ids = await linuxDoTabCandidateIds();
  let lastUnavailable: T | null = null;
  for (const tabId of ids) {
    const response = await send(tabId);
    if (response.ok) return response;
    if (response.reason !== "unavailable") return response;
    pageScriptHeartbeats.delete(tabId);
    lastUnavailable = response;
  }
  return lastUnavailable;
}

function isContentScriptHeartbeatMessage(value: unknown): value is ContentScriptHeartbeatMessage {
  if (typeof value !== "object" || value == null) return false;
  const message = value as Partial<ContentScriptHeartbeatMessage>;
  return (
    message.type === "linuxdoFriends.pageHeartbeat" &&
    typeof message.url === "string" &&
    (message.title === undefined || typeof message.title === "string") &&
    (message.status === "ready" || message.status === "challenge" || message.status === "unavailable") &&
    typeof message.hasLauncher === "boolean"
  );
}

function handlePageHeartbeat(message: ContentScriptHeartbeatMessage, sender: chrome.runtime.MessageSender): PageScriptStatusSnapshot {
  const tabId = sender.tab?.id;
  if (typeof tabId !== "number") {
    return pageScriptStatusSnapshot();
  }
  const heartbeat: PageScriptHeartbeat = {
    tabId,
    windowId: sender.tab?.windowId,
    url: message.url,
    title: message.title,
    status: message.status,
    hasLauncher: message.hasLauncher,
    updatedAt: nowIso()
  };
  pageScriptHeartbeats.set(tabId, heartbeat);
  prunePageHeartbeats();
  broadcastPageScriptStatus();
  return pageScriptStatusSnapshot();
}

function pageScriptStatusSnapshot(): PageScriptStatusSnapshot {
  prunePageHeartbeats();
  const now = nowIso();
  const entries = [...pageScriptHeartbeats.values()].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  const fresh = entries.filter((entry) => Date.now() - Date.parse(entry.updatedAt) <= heartbeatFreshMs);
  const ready = fresh.filter((entry) => entry.status === "ready");
  const challenge = fresh.filter((entry) => entry.status === "challenge");
  const staleCount = entries.length - fresh.length;
  return {
    status: ready.length > 0 ? "connected" : challenge.length > 0 ? "challenge" : entries.length > 0 ? "stale" : "missing",
    connectedCount: ready.length,
    staleCount,
    heartbeats: entries,
    selectedTabId: ready[0]?.tabId,
    updatedAt: now
  };
}

function freshReadyHeartbeats(): PageScriptHeartbeat[] {
  prunePageHeartbeats();
  const nowMs = Date.now();
  return [...pageScriptHeartbeats.values()]
    .filter((entry) => entry.status === "ready" && nowMs - Date.parse(entry.updatedAt) <= heartbeatFreshMs)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

function prunePageHeartbeats() {
  const nowMs = Date.now();
  for (const [tabId, heartbeat] of pageScriptHeartbeats) {
    if (nowMs - Date.parse(heartbeat.updatedAt) > heartbeatStaleMs) {
      pageScriptHeartbeats.delete(tabId);
    }
  }
}

function broadcastPageScriptStatus() {
  const status = pageScriptStatusSnapshot();
  void savePageScriptStatusState(status);
  try {
    void chrome.runtime.sendMessage({ type: "linuxdoFriends.pageScriptStatus", status });
  } catch {
    // Side panel may be closed. The next getPageScriptStatus call will read the in-memory snapshot.
  }
}

async function repairLinuxDoPageScript(tabId?: number): Promise<PageRepairResult> {
  const targetTab = await findRepairTargetTab(tabId);
  if (targetTab?.id == null) {
    return openLinuxDoHome();
  }
  await activateTab(targetTab);
  try {
    await chrome.tabs.reload(targetTab.id);
  } catch {
    // Activating the page is still useful if reload is unavailable in a constrained browser surface.
  }
  return { message: "已切换并刷新 linux.do 页面。", tabId: targetTab.id, openedNewTab: false };
}

async function openLinuxDoHome(): Promise<PageRepairResult> {
  const existing = await findRepairTargetTab();
  if (existing?.id != null) {
    await activateTab(existing);
    return { message: "已切换到 linux.do 页面，请完成浏览器验证后重试。", tabId: existing.id, openedNewTab: false };
  }
  const tab = await chrome.tabs.create({ url: "https://linux.do/", active: true });
  return { message: "已打开 linux.do 首页，请完成浏览器验证后重试。", tabId: tab.id, openedNewTab: true };
}

async function openActivityLink(inputUrl: string): Promise<PageRepairResult> {
  const url = normalizeLinuxDoUrl(inputUrl);
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (typeof activeTab?.id === "number" && isLinuxDoTab(activeTab)) {
    const navigation = await sendNavigateInPageMessage(activeTab.id, url);
    if (navigation.ok) {
      return { message: "已在当前 linux.do 页面打开动态。", tabId: activeTab.id, openedNewTab: false };
    }
    await chrome.tabs.update(activeTab.id, { url });
    return { message: "页面脚本不可用，已在当前 linux.do 标签页打开动态。", tabId: activeTab.id, openedNewTab: false };
  }
  const tab = await chrome.tabs.create({ url, active: true });
  return { message: "已打开动态。", tabId: tab.id, openedNewTab: true };
}

function normalizeLinuxDoUrl(value: string): string {
  const url = new URL(value, "https://linux.do");
  if (url.protocol !== "https:" || url.hostname !== "linux.do") {
    throw new Error("只能打开 linux.do 站内动态。");
  }
  return url.href;
}

function isLinuxDoTab(tab: chrome.tabs.Tab): boolean {
  return typeof tab.url === "string" && tab.url.startsWith("https://linux.do/");
}

async function findRepairTargetTab(tabId?: number): Promise<chrome.tabs.Tab | null> {
  try {
    if (typeof tabId === "number") {
      const tab = await chrome.tabs.get(tabId);
      if (tab?.url?.startsWith("https://linux.do/")) return tab;
    }
  } catch {
    pageScriptHeartbeats.delete(tabId ?? -1);
  }
  const heartbeatTabId = pageScriptStatusSnapshot().selectedTabId ?? pageScriptStatusSnapshot().heartbeats[0]?.tabId;
  if (typeof heartbeatTabId === "number") {
    try {
      const tab = await chrome.tabs.get(heartbeatTabId);
      if (tab?.url?.startsWith("https://linux.do/")) return tab;
    } catch {
      pageScriptHeartbeats.delete(heartbeatTabId);
    }
  }
  try {
    const tabs = await chrome.tabs.query({ url: "https://linux.do/*" });
    return tabs.find((candidate) => typeof candidate.id === "number") ?? null;
  } catch {
    return null;
  }
}

async function activateTab(tab: chrome.tabs.Tab) {
  if (tab.id == null) return;
  await chrome.tabs.update(tab.id, { active: true });
  if (typeof tab.windowId === "number") {
    try {
      await chrome.windows?.update?.(tab.windowId, { focused: true });
    } catch {
      // Focusing the window is best effort; activating the tab is the core repair.
    }
  }
}

function avatarCacheTargets(state: AppState, usernames?: Username[]): Array<{ username: Username; avatarUrl: string }> {
  const requested = usernames?.length ? usernames : Object.keys(state.friends);
  const seen = new Set<Username>();
  const targets: Array<{ username: Username; avatarUrl: string }> = [];
  for (const usernameInput of requested) {
    const username = usernameInput.trim().replace(/^@/, "").toLowerCase();
    if (!username || seen.has(username)) continue;
    seen.add(username);
    const avatarUrl = state.friendProfiles[username]?.avatarUrl || state.followedUsers[username]?.avatarUrl;
    if (!avatarUrl || state.avatarCache[username]?.sourceUrl === avatarUrl) continue;
    if (!isLinuxDoAvatarUrl(avatarUrl)) continue;
    targets.push({ username, avatarUrl });
  }
  return targets.slice(0, 20);
}

function isLinuxDoAvatarUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "linux.do" && (url.pathname.startsWith("/user_avatar/") || url.pathname.startsWith("/letter_avatar/"));
  } catch {
    return false;
  }
}

async function sendExtractFollowingMessage(tabId: number): Promise<ContentScriptFollowingResponse> {
  try {
    const response = (await chrome.tabs.sendMessage(tabId, { type: "linuxdoFriends.extractFollowing" })) as
      | ContentScriptFollowingResponse
      | undefined;
    return response ?? { ok: false, reason: "unavailable", error: "已打开的 linux.do 页面没有响应同步请求，请刷新页面后重试。" };
  } catch {
    return { ok: false, reason: "unavailable", error: "已打开的 linux.do 页面未加载佬朋友脚本，请刷新 linux.do 页面后重试。" };
  }
}

async function sendExtractCurrentAccountMessage(tabId: number): Promise<ContentScriptCurrentAccountResponse> {
  try {
    const response = (await chrome.tabs.sendMessage(tabId, { type: "linuxdoFriends.extractCurrentAccount" })) as
      | ContentScriptCurrentAccountResponse
      | undefined;
    return response ?? { ok: false, reason: "unavailable", error: "已打开的 linux.do 页面没有响应账号识别请求，请刷新页面后重试。" };
  } catch {
    return { ok: false, reason: "unavailable", error: "已打开的 linux.do 页面未加载佬朋友脚本，请刷新 linux.do 页面后重试。" };
  }
}

async function sendExtractAvatarMessage(tabId: number, username: Username, avatarUrl: string): Promise<ContentScriptAvatarResponse> {
  try {
    const response = (await chrome.tabs.sendMessage(tabId, {
      type: "linuxdoFriends.extractAvatar",
      username,
      avatarUrl
    })) as ContentScriptAvatarResponse | undefined;
    return response ?? { ok: false, reason: "unavailable", error: "已打开的 linux.do 页面没有响应头像缓存请求。" };
  } catch {
    return { ok: false, reason: "unavailable", error: "已打开的 linux.do 页面未加载佬朋友脚本，请刷新 linux.do 页面后重试。" };
  }
}

async function sendExtractProfileMessage(tabId: number, username: Username): Promise<ContentScriptProfileResponse> {
  try {
    const response = (await chrome.tabs.sendMessage(tabId, {
      type: "linuxdoFriends.extractProfile",
      username
    })) as ContentScriptProfileResponse | undefined;
    return response ?? { ok: false, reason: "unavailable", error: "已打开的 linux.do 页面没有响应状态刷新请求，请刷新页面后重试。" };
  } catch {
    return { ok: false, reason: "unavailable", error: "已打开的 linux.do 页面未加载佬朋友脚本，请刷新 linux.do 页面后重试。" };
  }
}

async function sendExtractActivityMessage(
  tabId: number,
  username: Username,
  step: ActivityRequestStep
): Promise<ContentScriptActivityResponse> {
  try {
    const response = (await chrome.tabs.sendMessage(tabId, {
      type: "linuxdoFriends.extractActivity",
      username,
      step: { kind: step.kind, path: step.path }
    })) as ContentScriptActivityResponse | undefined;
    return response ?? { ok: false, reason: "unavailable", error: "已打开的 linux.do 页面没有响应动态刷新请求，请刷新页面后重试。" };
  } catch {
    return { ok: false, reason: "unavailable", error: "已打开的 linux.do 页面未加载佬朋友脚本，请刷新 linux.do 页面后重试。" };
  }
}

async function sendNavigateInPageMessage(tabId: number, url: string): Promise<ContentScriptNavigationResponse> {
  try {
    const response = (await chrome.tabs.sendMessage(tabId, {
      type: "linuxdoFriends.navigateInPage",
      url
    })) as ContentScriptNavigationResponse | undefined;
    return response ?? { ok: false, reason: "unavailable", error: "已打开的 linux.do 页面没有响应跳转请求。" };
  } catch {
    return { ok: false, reason: "unavailable", error: "已打开的 linux.do 页面未加载佬朋友脚本。" };
  }
}

function applyMvpSettingsGuard(settings: Partial<AppState["settings"]>): Partial<AppState["settings"]> {
  return {
    ...settings,
    allowAutoRefresh: false,
    allowInactiveTabFallback: false
  };
}

async function updateSettings(settings: Partial<AppState["settings"]>) {
  let timedActivityRefreshToggle: boolean | undefined;
  let timedRunIdToRetire: string | undefined;
  let beforeTimedTargetSignature = "";
  let afterTimedTargetSignature = "";
  if (settings.timedActivityRefreshEnabled === false) {
    timedRunIdToRetire = (await loadTimedActivityRefreshSessionState()).activeRunId;
  }
  const nextState = await updateAppState((state) => {
    timedActivityRefreshToggle = settings.timedActivityRefreshEnabled;
    beforeTimedTargetSignature = timedActivityTargetSignature(state);
    const next = {
      ...state,
      settings: {
        ...state.settings,
        ...applyMvpSettingsGuard(settings)
      }
    };
    afterTimedTargetSignature = timedActivityTargetSignature(next);
    return next;
  });
  if (timedActivityRefreshToggle === true) {
    const now = new Date();
    const intervalMs = nextState.settings.timedActivityRefreshIntervalMinutes * 60_000;
    const sessionPatch = {
      activeRunId: undefined,
      enabledAt: now.toISOString(),
      pausedReason: undefined,
      pausedMessage: undefined,
      lastFailureAt: undefined,
      pendingDue: false,
      nextDueAt: new Date(now.getTime() + intervalMs).toISOString()
    };
    await patchTimedActivityRefreshSessionState(
      hasTimedActivityTargets(nextState)
        ? { ...sessionPatch, noTargetAt: undefined, noTargetMessage: undefined }
        : sessionPatch
    );
  } else if (timedActivityRefreshToggle === false) {
    await patchTimedActivityRefreshSessionState({
      activeRunId: undefined,
      controllerSurfaceId: undefined,
      controllerClaimedAt: undefined,
      controllerHeartbeatAt: undefined,
      pendingDue: false
    });
    if (timedRunIdToRetire) {
      retireTimedActivityTask(timedRunIdToRetire);
    }
    if (beforeTimedTargetSignature !== afterTimedTargetSignature) {
      await invalidateTimedActivityNoTargetSessionStateIfTargetable(nextState);
    }
  } else if (beforeTimedTargetSignature !== afterTimedTargetSignature) {
    await invalidateTimedActivityNoTargetSessionStateIfTargetable(nextState);
  }
  await reconcileRequestStatsAutoSyncAlarm();
  return nextState;
}

function createRequestStatsCounter() {
  const attempts: Array<{ family: RequestStatsFamily; at: Date }> = [];
  const record = (family: RequestStatsFamily, url: string) => {
    if (!isLinuxDoRequestUrl(url)) return;
    attempts.push({ family, at: new Date() });
  };
  return {
    record,
    hasAttempts() {
      return attempts.length > 0;
    },
    apply(state: AppState): AppState {
      let next = state;
      for (const attempt of attempts) {
        next = recordRequestAttempts(next, { family: attempt.family, count: 1, at: attempt.at });
      }
      return next;
    }
  };
}

function applyContentRequestStats<T extends { requestCount?: number; requestAttemptedAts?: string[] }>(
  state: AppState,
  family: RequestStatsFamily,
  response: T
): AppState {
  const requestCount = response.requestCount ?? 0;
  const attemptedAts = Array.isArray(response.requestAttemptedAts) ? response.requestAttemptedAts : [];
  if (attemptedAts.length === 0) return recordRequestAttempts(state, { family, count: requestCount });

  let next = state;
  for (const timestamp of attemptedAts) {
    next = recordRequestAttempts(next, { family, count: 1, at: parseRequestStatsAttemptAt(timestamp) });
  }
  const missingTimestamps = Math.max(0, requestCount - attemptedAts.length);
  return missingTimestamps > 0 ? recordRequestAttempts(next, { family, count: missingTimestamps }) : next;
}

async function persistRequestStats(counter: RequestStatsCounter, generation: number) {
  if (!counter.hasAttempts()) return;
  await persistRequestStatsUpdate(generation, (state) => counter.apply(state));
}

async function persistContentRequestStats(
  family: RequestStatsFamily,
  response: { requestCount?: number; requestAttemptedAts?: string[] } | null,
  generation: number
) {
  if (!response?.requestCount) return;
  await persistRequestStatsUpdate(generation, (state) => applyContentRequestStats(state, family, response));
}

async function persistRequestStatsUpdate(generation: number, updater: (state: AppState) => AppState) {
  const current = await loadState();
  const next = updater(current);
  if (generation !== stateWriteGeneration) return;
  await saveState(next);
}

function parseRequestStatsAttemptAt(value: string): Date | undefined {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp);
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function isLinuxDoRequestUrl(value: string): boolean {
  try {
    const url = new URL(value, "https://linux.do");
    return url.protocol === "https:" && url.hostname === "linux.do";
  } catch {
    return false;
  }
}

async function updateTimedActivityTargetInputs(updater: (state: AppState) => AppState | Promise<AppState>): Promise<AppState> {
  let beforeSignature = "";
  let afterSignature = "";
  const nextState = await updateAppState(async (state) => {
    beforeSignature = timedActivityTargetSignature(state);
    const next = await updater(state);
    afterSignature = timedActivityTargetSignature(next);
    return next;
  });
  if (beforeSignature !== afterSignature) {
    await invalidateTimedActivityNoTargetSessionStateIfTargetable(nextState);
  }
  return nextState;
}

function timedActivityTargetSignature(state: AppState): string {
  return JSON.stringify(deriveTimedActivityRefreshScopes(state, state.settings.timedActivityRefreshScopeMode));
}

function hasTimedActivityTargets(state: AppState): boolean {
  return deriveTimedActivityRefreshScopes(state, state.settings.timedActivityRefreshScopeMode).length > 0;
}

async function invalidateTimedActivityNoTargetSessionStateIfTargetable(state: AppState) {
  if (hasTimedActivityTargets(state)) {
    await invalidateTimedActivityNoTargetSessionState();
  }
}

async function refreshState(
  run: (state: AppState) => Promise<{ state: AppState; result: AppState["lastSync"] }>
): Promise<BackgroundResponse> {
  const generation = stateWriteGeneration;
  const current = await loadState();
  const { state, result } = await run(current);
  const next = { ...state, lastSync: result };
  if (generation !== stateWriteGeneration) {
    return ok(await staleStateWriteResponse("已导入配置，较早的刷新结果已丢弃。"));
  }
  await saveState(next);
  return ok(next);
}

async function updateAppState(updater: (state: AppState) => AppState | Promise<AppState>): Promise<AppState> {
  const generation = invalidateStateWriters();
  const current = await loadState();
  const next = await updater(current);
  if (generation !== stateWriteGeneration) {
    return staleStateWriteResponse("已导入配置，较早的本地修改结果已丢弃。");
  }
  await saveState(next);
  return next;
}

function invalidateStateWriters(): number {
  stateWriteGeneration += 1;
  return stateWriteGeneration;
}

async function staleStateWriteResponse(message: string): Promise<AppState> {
  const current = await loadState();
  return {
    ...current,
    lastSync: {
      ok: false,
      source: "manual",
      reason: "unavailable",
      message,
      refreshedAt: nowIso()
    }
  };
}

function ok<T>(data: T): BackgroundResponse<T> {
  return { ok: true, data };
}
