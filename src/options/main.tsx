import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useAtom, useSetAtom } from "jotai";
import {
  addFriendFromKnownUserAtom,
  appStateAtom,
  checkForUpdatesAtom,
  clearCacheAtom,
  exportConfigAtom,
  identifyCurrentAccountAtom,
  importConfigAtom,
  loadStateAtom,
  loadUpdateCheckAtom,
  lookupFriendProfileAtom,
  loadSiteDataProgressAtom,
  observeAppStateAtom,
  observeUpdateCheckAtom,
  observeSiteDataProgressAtom,
  removeFriendAtom,
  removeDredgeRuleAtom,
  resetLaoFindsStartedAtAtom,
  resetExtensionAtom,
  siteDataProgressAtom,
  syncFollowsAtom,
  updateFriendAtom,
  updateCheckAtom,
  upsertDredgeRuleAtom
} from "../state/atoms";
import { sendCommand } from "../messages/client";
import { VersionBadge } from "../app/VersionStatus";
import type {
  ActivityRefreshKind,
  CloudArchiveLocalStateResult,
  CloudConfigBackupResult,
  CloudConfigBindResult,
  CloudConfigClearBindingResult,
  CloudConfigRestoreResult,
  CloudConfigStatusResult,
  CloudConfigViewState,
  Username
} from "../shared/types";
import { deriveFollowedCandidates, deriveFriendList } from "../popup/selectors";
import { CLOUD_AUTH_STORAGE_KEY } from "../storage/cloudAuthStorage";
import { deriveRequestStatsView } from "../domain/requestStats";
import { classNames } from "./classNames";
import { OPTIONS_SECTIONS, canonicalizeOptionsHash, sectionFromHash, type OptionsSectionId } from "./navigation";
import { RequestStatsSettingsPanel } from "./RequestStatsSettingsPanel";
import {
  BasicSettingsSection,
  DataSettingsSection,
  LaoFindsSettingsSection,
  NotificationsSettingsSection,
  ScopeSettingsSection,
  SponsorSettingsSection
} from "./OptionsSections";
import { configFileName, downloadJson } from "./optionsHelpers";
import "../styles/app.css";

function useCloudAuthStorageRefresh(
  refreshCloudStatus: (options?: { silent?: boolean }) => Promise<void>,
  refreshCloudArchiveState: () => Promise<void>
) {
  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.storage?.onChanged) return undefined;
    const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== "local" || !changes[CLOUD_AUTH_STORAGE_KEY]) return;
      void refreshCloudStatus({ silent: true });
      void refreshCloudArchiveState();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => {
      chrome.storage.onChanged.removeListener?.(listener);
    };
  }, [refreshCloudArchiveState, refreshCloudStatus]);
}

export function OptionsApp() {
  const [state, setState] = useAtom(appStateAtom);
  const [siteDataProgress] = useAtom(siteDataProgressAtom);
  const [updateCheck] = useAtom(updateCheckAtom);
  const addFriendFromKnownUser = useSetAtom(addFriendFromKnownUserAtom);
  const loadState = useSetAtom(loadStateAtom);
  const loadUpdateCheck = useSetAtom(loadUpdateCheckAtom);
  const checkForUpdates = useSetAtom(checkForUpdatesAtom);
  const clearCache = useSetAtom(clearCacheAtom);
  const exportConfig = useSetAtom(exportConfigAtom);
  const identifyCurrentAccount = useSetAtom(identifyCurrentAccountAtom);
  const importConfig = useSetAtom(importConfigAtom);
  const lookupFriendProfile = useSetAtom(lookupFriendProfileAtom);
  const loadSiteDataProgress = useSetAtom(loadSiteDataProgressAtom);
  const observeAppState = useSetAtom(observeAppStateAtom);
  const observeUpdateCheck = useSetAtom(observeUpdateCheckAtom);
  const observeSiteDataProgress = useSetAtom(observeSiteDataProgressAtom);
  const removeFriend = useSetAtom(removeFriendAtom);
  const removeDredgeRule = useSetAtom(removeDredgeRuleAtom);
  const resetLaoFindsStartedAt = useSetAtom(resetLaoFindsStartedAtAtom);
  const resetExtension = useSetAtom(resetExtensionAtom);
  const syncFollows = useSetAtom(syncFollowsAtom);
  const updateFriend = useSetAtom(updateFriendAtom);
  const upsertDredgeRule = useSetAtom(upsertDredgeRuleAtom);
  const [relativeNow, setRelativeNow] = useState(() => Date.now());
  const [activeHash, setActiveHash] = useState(() => canonicalizeOptionsHash(window.location.hash));
  const [configMessage, setConfigMessage] = useState<string | null>(null);
  const [cloudState, setCloudState] = useState<CloudConfigViewState | null>(null);
  const [cloudArchiveState, setCloudArchiveState] = useState<CloudArchiveLocalStateResult | null>(null);
  const [cloudBusy, setCloudBusy] = useState<"bind" | "status" | "backup" | "restore" | "clear" | null>(null);
  const [accountBusy, setAccountBusy] = useState(false);
  const [friendsQuery, setFriendsQuery] = useState("");
  const [syncBusy, setSyncBusy] = useState(false);
  const [cloudMessage, setCloudMessage] = useState<string | null>(null);
  const [telegramMessage, setTelegramMessage] = useState<string | null>(null);
  const [telegramBusy, setTelegramBusy] = useState<"save" | "test" | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const cloudBackupRef = useRef<HTMLElement | null>(null);
  const activeSection = sectionFromHash(activeHash);
  const friends = deriveFriendList(state);
  const followedCandidates = deriveFollowedCandidates(state);
  const requestStatsView = deriveRequestStatsView(state.requestStats, new Date(relativeNow));
  const cloudBinding = cloudArchiveState?.binding.bound ? cloudArchiveState.binding : cloudState?.binding.bound ? cloudState.binding : null;
  const cloudBound = cloudBinding != null;
  const dredgeRulesLocked = state.settings.timedActivityRefreshEnabled || (siteDataProgress?.taskType === "activity" && siteDataProgress.status === "running");
  const dredgeRulesLockReason =
    siteDataProgress?.taskType === "activity" && siteDataProgress.status === "running"
      ? "刷新动态运行中，完成后可修改规则。"
      : state.settings.timedActivityRefreshEnabled
        ? "关闭自动捞料后可修改规则。"
        : undefined;

  useEffect(() => {
    void loadState();
    void loadSiteDataProgress();
    void loadUpdateCheck();
    void checkForUpdates();
    const cleanupAppState = observeAppState();
    const cleanupSiteDataProgress = observeSiteDataProgress();
    const cleanupUpdateCheck = observeUpdateCheck();
    const interval = window.setInterval(() => setRelativeNow(Date.now()), 30_000);
    return () => {
      cleanupAppState?.();
      cleanupSiteDataProgress?.();
      cleanupUpdateCheck?.();
      window.clearInterval(interval);
    };
  }, [checkForUpdates, loadSiteDataProgress, loadState, loadUpdateCheck, observeAppState, observeSiteDataProgress, observeUpdateCheck]);

  useEffect(() => {
    function applyCurrentHash() {
      const nextHash = canonicalizeOptionsHash(window.location.hash);
      if (window.location.hash !== nextHash) {
        window.history.replaceState(null, "", nextHash);
      }
      setActiveHash(nextHash);
    }
    applyCurrentHash();
    function handleHashChange() {
      applyCurrentHash();
    }
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const refreshCloudStatus = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!options.silent) setCloudBusy("status");
    const response = await sendCommand<CloudConfigStatusResult>({ type: "getCloudConfigStatus" });
    if (response.ok) {
      setCloudState(response.data);
      if (!options.silent) setCloudMessage(response.data.message);
    } else if (!options.silent) {
      setCloudMessage(response.error);
    }
    if (!options.silent) setCloudBusy(null);
  }, []);

  const refreshCloudArchiveState = useCallback(async () => {
    const response = await sendCommand<CloudArchiveLocalStateResult>({ type: "getCloudArchiveLocalState" });
    if (response.ok) setCloudArchiveState(response.data);
  }, []);

  useEffect(() => {
    void refreshCloudStatus({ silent: true });
    void refreshCloudArchiveState();
  }, [refreshCloudArchiveState, refreshCloudStatus]);

  useEffect(() => {
    void refreshCloudArchiveState();
  }, [
    refreshCloudArchiveState,
    state.friends,
    state.dredgeRules,
    state.settings.openActivityLinksInPage,
    state.settings.refreshIntervalMinutes,
    state.settings.timedActivityRefreshScopeMode,
    state.settings.timedActivityRefreshIntervalMinutes,
    state.settings.laoFindsBrowserNotificationsEnabled,
    state.settings.laoFindsManualNotificationsEnabled,
    state.settings.laoFindsTelegramNotificationsEnabled,
    state.settings.telegramBotToken,
    state.settings.telegramChatId
  ]);

  useEffect(() => {
    if (window.location.hash !== "#cloud-backup" || activeSection !== "data") return;
    const scrollToCloudBackup = () => cloudBackupRef.current?.scrollIntoView?.({ block: "start" });
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(scrollToCloudBackup);
      return;
    }
    window.setTimeout(scrollToCloudBackup, 0);
  }, [activeHash, activeSection]);

  useCloudAuthStorageRefresh(refreshCloudStatus, refreshCloudArchiveState);

  async function updateSettings(patch: Partial<typeof state.settings>) {
    const response = await sendCommand<typeof state>({ type: "updateSettings", settings: patch });
    if (response.ok) setState(response.data);
  }

  async function handleResetLaoFindsStartedAt() {
    const confirmed = window.confirm("重设后只会打捞此刻之后命中规则的公开动态，旧动态不会补录。");
    if (!confirmed) return;
    await resetLaoFindsStartedAt();
  }

  function switchSection(section: OptionsSectionId) {
    const target = OPTIONS_SECTIONS.find((item) => item.id === section);
    const hash = target?.hash ?? "#basic";
    if (window.location.hash === hash) {
      setActiveHash(hash);
      return;
    }
    window.location.hash = hash;
    setActiveHash(hash);
  }

  async function handleSaveTelegram(token: string, chatId: string, enableTelegram = false): Promise<boolean> {
    setTelegramBusy("save");
    setTelegramMessage(null);
    try {
      const nextToken = token.trim();
      const nextChatId = chatId.trim();
      if (enableTelegram && (!nextToken || !nextChatId)) {
        setTelegramMessage("请先填写 Bot Token 和 Chat ID。");
        return false;
      }
      const response = await sendCommand<typeof state>({
        type: "updateSettings",
        settings: {
          telegramBotToken: nextToken,
          telegramChatId: nextChatId,
          ...(enableTelegram ? { laoFindsTelegramNotificationsEnabled: true } : {})
        }
      });
      if (response.ok) {
        setState(response.data);
        setTelegramMessage(enableTelegram ? "Telegram 配置已保存并启用。" : nextToken ? "Telegram 配置已保存。" : "已清除 Telegram 配置。");
        return true;
      } else {
        setTelegramMessage(response.error);
        return false;
      }
    } finally {
      setTelegramBusy(null);
    }
  }

  async function handleTestTelegram(credentials?: { botToken: string; chatId: string }): Promise<boolean> {
    setTelegramBusy("test");
    setTelegramMessage(null);
    try {
      const response = await sendCommand<unknown>(
        credentials
          ? { type: "testTelegramNotification", credentials: { kind: "draft", botToken: credentials.botToken, chatId: credentials.chatId } }
          : { type: "testTelegramNotification", credentials: { kind: "saved" } }
      );
      setTelegramMessage(response.ok ? "测试消息已发送，请检查 Telegram。" : response.error);
      return response.ok;
    } finally {
      setTelegramBusy(null);
    }
  }

  async function handleIdentifyAccount() {
    setAccountBusy(true);
    try {
      await identifyCurrentAccount(false);
    } finally {
      setAccountBusy(false);
    }
  }

  async function handleSyncFollows() {
    setSyncBusy(true);
    try {
      await syncFollows();
    } finally {
      setSyncBusy(false);
    }
  }

  function handleUpdateFriendScope(username: Username, activityKinds: ActivityRefreshKind[]) {
    void updateFriend(username, { activityKinds });
  }

  async function handleClearCache() {
    await clearCache();
  }

  async function handleResetExtension() {
    if (!window.confirm("确认全量重置佬朋友？这会清空佬朋友、设置、账号和所有缓存。")) return;
    await resetExtension();
  }

  async function handleExportConfig() {
    const response = await exportConfig();
    if (!response.ok) {
      setConfigMessage(response.error);
      return;
    }
    downloadJson(response.data, configFileName(response.data.exportedAt));
    setConfigMessage(`已导出 ${Object.keys(response.data.friends).length} 位佬朋友配置。`);
  }

  async function handleImportConfig(file: File | undefined) {
    if (!file) return;
    try {
      const json = await file.text();
      if (!window.confirm("确认导入配置？这会替换当前佬朋友和刷新设置，并清空本地缓存。")) return;
      const response = await importConfig(json);
      if (response.ok) {
        setState(response.data);
        setConfigMessage(response.data.lastSync?.message ?? "已导入配置。");
        void refreshCloudArchiveState();
      } else {
        setConfigMessage(response.error);
      }
    } catch {
      setConfigMessage("读取配置文件失败。");
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  async function handleBindCloudSave() {
    setCloudBusy("bind");
    const response = await sendCommand<CloudConfigBindResult>({ type: "bindCloudSave" });
    if (response.ok) {
      setCloudState(response.data);
      setCloudMessage(response.data.message);
      void refreshCloudArchiveState();
    } else {
      setCloudMessage(response.error);
    }
    setCloudBusy(null);
  }

  async function handleBackupCloudConfig() {
    setCloudBusy("backup");
    const response = await sendCommand<CloudConfigBackupResult>({ type: "backupCloudConfig" });
    if (response.ok) {
      setCloudState(response.data);
      setCloudArchiveState({ binding: response.data.binding, archiveState: response.data.archiveState, syncedAt: response.data.binding.bound ? response.data.binding.lastConfigSyncedAt : undefined });
      setCloudMessage(response.data.message);
    } else {
      setCloudMessage(response.error);
    }
    setCloudBusy(null);
  }

  async function handleRestoreCloudConfig() {
    if (!window.confirm("确认从云端恢复配置？这会替换当前佬朋友和刷新设置，并清空本地缓存。")) return;
    setCloudBusy("restore");
    const response = await sendCommand<CloudConfigRestoreResult>({ type: "restoreCloudConfig" });
    if (response.ok) {
      setCloudState(response.data);
      setCloudArchiveState({ binding: response.data.binding, archiveState: response.data.archiveState, syncedAt: response.data.binding.bound ? response.data.binding.lastConfigSyncedAt : undefined });
      if (response.data.state) setState(response.data.state);
      setCloudMessage(response.data.message);
    } else {
      setCloudMessage(response.error);
    }
    setCloudBusy(null);
  }

  async function handleClearCloudBinding() {
    setCloudBusy("clear");
    const response = await sendCommand<CloudConfigClearBindingResult>({ type: "clearCloudBinding" });
    if (response.ok) {
      setCloudState(response.data);
      setCloudArchiveState({ binding: response.data.binding, archiveState: "unbound" });
      setCloudMessage(response.data.message);
    } else {
      setCloudMessage(response.error);
    }
    setCloudBusy(null);
  }

  return (
    <main className={classNames("options-shell options-shell-wide")}>
      <header className={classNames("header")}>
        <div>
          <p className={classNames("eyebrow")}>LinuxDo Friends</p>
          <h1>佬朋友设置</h1>
        </div>
        <div className={classNames("header-status")}>
          <VersionBadge state={updateCheck} />
        </div>
      </header>

      <div className={classNames("options-layout")}>
        <nav className={classNames("options-nav")} aria-label="设置导航">
          {OPTIONS_SECTIONS.map((section) => (
            <button
              className={classNames(activeSection === section.id && "active")}
              key={section.id}
              type="button"
              onClick={() => switchSection(section.id)}
            >
              {section.label}
            </button>
          ))}
        </nav>

        <div className={classNames("options-content")}>
          {activeSection === "basic" ? (
            <BasicSettingsSection
              accountBusy={accountBusy}
              now={relativeNow}
              onCheckForUpdates={() => void checkForUpdates(true)}
              onIdentifyAccount={() => void handleIdentifyAccount()}
              state={state}
              updateCheck={updateCheck}
              updateSettings={updateSettings}
            />
          ) : null}

          {activeSection === "scope" ? (
            <ScopeSettingsSection
              followedCandidates={followedCandidates}
              friends={friends}
              friendsQuery={friendsQuery}
              onAddFriend={(target, profile) => void addFriendFromKnownUser(target, profile)}
              onLookupFriend={(target) => lookupFriendProfile(target)}
              onRemoveFriend={(target) => void removeFriend(target)}
              onSyncFollows={() => void handleSyncFollows()}
              onUpdateScope={handleUpdateFriendScope}
              setFriendsQuery={setFriendsQuery}
              syncBusy={syncBusy}
            />
          ) : null}

          {activeSection === "notifications" ? (
            <NotificationsSettingsSection
              onSaveTelegram={handleSaveTelegram}
              onTestTelegram={handleTestTelegram}
              state={state}
              telegramBusy={telegramBusy}
              telegramMessage={telegramMessage}
              updateSettings={updateSettings}
            />
          ) : null}

          {activeSection === "lao-finds" ? (
            <LaoFindsSettingsSection
              dredgeRulesLocked={dredgeRulesLocked}
              dredgeRulesLockReason={dredgeRulesLockReason}
              now={relativeNow}
              onRemoveDredgeRule={(id) => void removeDredgeRule(id)}
              onResetLaoFindsStartedAt={() => void handleResetLaoFindsStartedAt()}
              onUpsertDredgeRule={(rule) => void upsertDredgeRule(rule)}
              state={state}
              updateSettings={updateSettings}
            />
          ) : null}

          {activeSection === "data" ? (
            <DataSettingsSection
              cloudArchiveState={cloudArchiveState}
              cloudBackupRef={cloudBackupRef}
              cloudBinding={cloudBinding}
              cloudBound={cloudBound}
              cloudBusy={cloudBusy}
              cloudMessage={cloudMessage}
              cloudState={cloudState}
              configMessage={configMessage}
              importInputRef={importInputRef}
              onBackupCloudConfig={() => void handleBackupCloudConfig()}
              onBindCloudSave={() => void handleBindCloudSave()}
              onClearCache={() => void handleClearCache()}
              onClearCloudBinding={() => void handleClearCloudBinding()}
              onExportConfig={() => void handleExportConfig()}
              onImportConfig={(file) => void handleImportConfig(file)}
              onRefreshCloudStatus={() => void refreshCloudStatus()}
              onResetExtension={() => void handleResetExtension()}
              onRestoreCloudConfig={() => void handleRestoreCloudConfig()}
              state={state}
              updateSettings={updateSettings}
            />
          ) : null}

          {activeSection === "request-stats" ? <RequestStatsSettingsPanel view={requestStatsView} /> : null}

          {activeSection === "sponsor" ? <SponsorSettingsSection /> : null}
        </div>
      </div>
    </main>
  );
}

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(<OptionsApp />);
}
