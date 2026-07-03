import React, { useCallback, useEffect, useRef, useState } from "react";
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
import { ActivityScopeSelect, FriendCandidateList } from "../app/FriendManagement";
import { DredgeRuleEditor } from "../app/DredgeRuleEditor";
import { UserIdentityRow } from "../app/UserIdentityRow";
import { VersionBadge, VersionDiagnostics } from "../app/VersionStatus";
import type {
  ActivityRefreshKind,
  CloudArchiveLocalState,
  CloudArchiveLocalStateResult,
  CloudConfigBackupResult,
  CloudConfigBindResult,
  CloudConfigClearBindingResult,
  CloudConfigRestoreResult,
  CloudConfigStatus,
  CloudConfigStatusResult,
  CloudConfigViewState,
  Username
} from "../shared/types";
import { deriveFollowedCandidates, deriveFriendList } from "../popup/selectors";
import { CLOUD_AUTH_STORAGE_KEY } from "../storage/cloudAuthStorage";
import { formatRelativeTime } from "../shared/time";
import {
  deriveRequestStatsView,
  type RequestStatsDayView,
  type RequestStatsHourView,
  type RequestStatsView
} from "../domain/requestStats";
import "../styles/app.css";

function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

const LDC_SPONSOR_20_URL = "https://credit.linux.do/paying/online?token=3b78efe60d34a77c55d52e84d60e33270b5cc69f7aa8979bbab4d1b41b6f95b7";
const LDC_SPONSOR_200_URL = "https://credit.linux.do/paying/online?token=276b84998e7864428f277f6d7260f7e65e8c531cda5413cb061ff4a91cc3caa4";

type OptionsSectionId = "basic" | "scope" | "lao-finds" | "request-stats" | "notifications" | "data" | "sponsor";

const OPTIONS_SECTIONS: Array<{ id: OptionsSectionId; hash: string; label: string }> = [
  { id: "basic", hash: "#basic", label: "基础" },
  { id: "scope", hash: "#scope", label: "视奸范围" },
  { id: "lao-finds", hash: "#lao-finds", label: "佬有料" },
  { id: "request-stats", hash: "#request-stats", label: "请求统计" },
  { id: "notifications", hash: "#notifications", label: "通知渠道" },
  { id: "data", hash: "#data", label: "数据管理" },
  { id: "sponsor", hash: "#sponsor", label: "赞助" }
];

const SECTION_BY_HASH = new Map(OPTIONS_SECTIONS.map((section) => [section.hash, section.id]));
const HASH_ALIASES = new Map<string, { hash: string; preserve?: boolean }>([
  ["#friends", { hash: "#scope" }],
  ["#sync", { hash: "#data" }],
  ["#maintenance", { hash: "#data" }],
  ["#cloud-backup", { hash: "#data", preserve: true }]
]);

type SettingsCardProps = Omit<React.HTMLAttributes<HTMLElement>, "title"> & {
  actions?: React.ReactNode;
  children?: React.ReactNode;
  subtitle?: React.ReactNode;
  title: React.ReactNode;
  variant?: "default" | "unavailable" | "danger";
};

const SettingsCard = React.forwardRef<HTMLElement, SettingsCardProps>(function SettingsCard(
  { actions, children, className, subtitle, title, variant = "default", ...sectionProps },
  ref
) {
  const variantClass = variant === "default" ? null : `settings-card-${variant}`;
  return (
    <section {...sectionProps} ref={ref} className={classNames("panel settings-card", variantClass, className)}>
      <div className={classNames("settings-card-header")}>
        <div className={classNames("settings-card-title-block")}>
          <h2>{title}</h2>
          {subtitle ? <p className={classNames("panel-subtitle")}>{subtitle}</p> : null}
        </div>
        {actions ? <div className={classNames("settings-card-actions")}>{actions}</div> : null}
      </div>
      {children ? <div className={classNames("settings-card-body")}>{children}</div> : null}
    </section>
  );
});

function sectionFromHash(hash: string): OptionsSectionId {
  const canonicalHash = canonicalizeOptionsHash(hash);
  return SECTION_BY_HASH.get(canonicalHash === "#cloud-backup" ? "#data" : canonicalHash) ?? "basic";
}

function canonicalizeOptionsHash(hash: string) {
  const alias = HASH_ALIASES.get(hash);
  if (alias?.preserve) return hash;
  if (alias) return alias.hash;
  if (SECTION_BY_HASH.has(hash)) return hash;
  return "#basic";
}

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
  const [telegramToken, setTelegramToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
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
    setTelegramToken(state.settings.telegramBotToken ?? "");
    setTelegramChatId(state.settings.telegramChatId ?? "");
  }, [state.settings.telegramBotToken, state.settings.telegramChatId]);

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

  async function handleSaveTelegram() {
    setTelegramBusy("save");
    setTelegramMessage(null);
    try {
      const response = await sendCommand<typeof state>({
        type: "updateSettings",
        settings: { telegramBotToken: telegramToken.trim(), telegramChatId: telegramChatId.trim() }
      });
      if (response.ok) {
        setState(response.data);
        setTelegramMessage(telegramToken.trim() ? "Telegram 配置已保存。" : "已清除 Telegram 配置。");
      } else {
        setTelegramMessage(response.error);
      }
    } finally {
      setTelegramBusy(null);
    }
  }

  async function handleTestTelegram() {
    setTelegramBusy("test");
    setTelegramMessage(null);
    try {
      const response = await sendCommand<unknown>({ type: "testTelegramNotification" });
      setTelegramMessage(response.ok ? "测试消息已发送，请检查 Telegram。" : response.error);
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
          <h1 >佬朋友设置</h1>
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
            <div className={classNames("settings-card-list")}>
              <VersionDiagnostics now={relativeNow} onCheck={() => void checkForUpdates(true)} state={updateCheck} />
              <SettingsCard
                title="本地账号探测"
                subtitle={state.currentAccount ? `当前探测为 @${state.currentAccount.username}` : "尚未探测到 linux.do 登录账号。"}
                actions={
                  <button className={classNames("small-action")} type="button" disabled={accountBusy} onClick={() => void handleIdentifyAccount()}>
                    {accountBusy ? "探测中" : "重新探测"}
                  </button>
                }
              >
                {state.currentAccount?.verifiedAt ? (
                  <p className={classNames("settings-meta")}>上次探测：{new Date(state.currentAccount.verifiedAt).toLocaleString()}</p>
                ) : (
                  <p className={classNames("settings-meta")}>打开已登录的 linux.do 页面后可探测当前账号。</p>
                )}
              </SettingsCard>
              <SettingsCard title="动态跳转" subtitle="选择打开动态详情的位置。">
                <div className={classNames("segmented-control")} role="radiogroup" aria-label="动态跳转">
                  <button
                    className={classNames("segmented-option", state.settings.openActivityLinksInPage && "active")}
                    type="button"
                    aria-pressed={state.settings.openActivityLinksInPage}
                    onClick={() => void updateSettings({ openActivityLinksInPage: true })}
                  >
                    页内跳转
                  </button>
                  <button
                    className={classNames("segmented-option", !state.settings.openActivityLinksInPage && "active")}
                    type="button"
                    aria-pressed={!state.settings.openActivityLinksInPage}
                    onClick={() => void updateSettings({ openActivityLinksInPage: false })}
                  >
                    新标签页
                  </button>
                </div>
                <p className={classNames("settings-meta")}>页内跳转会优先使用当前 linux.do 标签页；不可用时仍打开新标签。</p>
              </SettingsCard>
            </div>
          ) : null}

          {activeSection === "scope" ? (
            <div className={classNames("settings-card-list")}>
              <SettingsCard
                title="关注同步"
                subtitle="获取你的 linux.do 关注列表，便于添加佬朋友。"
                actions={
                  <button className={classNames("small-action")} type="button" disabled={syncBusy} onClick={() => void handleSyncFollows()}>
                    {syncBusy ? "获取中" : "获取我的关注列表"}
                  </button>
                }
              />
              <SettingsCard title="范围管理" subtitle="管理会被打捞和展示动态的已关注用户。">
                <input
                  className={classNames("modal-search-input settings-search-input")}
                  value={friendsQuery}
                  onChange={(event) => setFriendsQuery(event.target.value)}
                  placeholder="筛选已关注，或输入用户名"
                />
                <FriendCandidateList
                  candidates={followedCandidates}
                  friends={friends}
                  loading={syncBusy}
                  mode="full"
                  onAdd={(target, profile) => void addFriendFromKnownUser(target, profile)}
                  onLookup={(target) => lookupFriendProfile(target)}
                  onRemove={(target) => void removeFriend(target)}
                  onUpdateScope={handleUpdateFriendScope}
                  query={friendsQuery}
                />
                {friends.length > 0 ? <p className={classNames("friend-count-footer")}>共 {friends.length} 位佬朋友</p> : null}
              </SettingsCard>
            </div>
          ) : null}

          {activeSection === "notifications" ? (
            <div className={classNames("settings-card-list")}>
              <SettingsCard title="Telegram" subtitle="刷新到新动态时发送提醒。">
                <div>
                  <label className={classNames("settings-meta")} htmlFor="tg-bot-token" style={{ display: "block", marginBottom: 4 }}>
                    Bot Token
                  </label>
                  <input
                    id="tg-bot-token"
                    type="password"
                    placeholder="123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"
                    value={telegramToken}
                    onChange={(e) => setTelegramToken(e.currentTarget.value)}
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className={classNames("settings-meta")} htmlFor="tg-chat-id" style={{ display: "block", marginBottom: 4 }}>
                    Chat ID
                  </label>
                  <input
                    id="tg-chat-id"
                    type="text"
                    placeholder="123456789"
                    value={telegramChatId}
                    onChange={(e) => setTelegramChatId(e.currentTarget.value)}
                    autoComplete="off"
                  />
                </div>
                <div className={classNames("maintenance-actions")}>
                  <button className={classNames("small-action")} type="button" disabled={telegramBusy != null} onClick={() => void handleSaveTelegram()}>
                    {telegramBusy === "save" ? "保存中" : "保存"}
                  </button>
                  <button className={classNames("small-action")} type="button" disabled={telegramBusy != null} onClick={() => void handleTestTelegram()}>
                    {telegramBusy === "test" ? "发送中" : "发送测试消息"}
                  </button>
                </div>
                {telegramMessage ? <p className={classNames("settings-meta")}>{telegramMessage}</p> : null}
                <p className={classNames("settings-meta")}>先在 Telegram 创建 Bot，再填入自己的 Chat ID。</p>
              </SettingsCard>
              <SettingsCard
                variant="unavailable"
                title="Webhook 通知"
                subtitle="以后可把提醒发送到你自己的地址。"
                actions={<span className={classNames("settings-unavailable-badge")}>暂未开放</span>}
              />
            </div>
          ) : null}

          {activeSection === "lao-finds" ? (
            <div className={classNames("settings-card-list")}>
              <SettingsCard title="自动捞料" subtitle="保持插件界面打开，命中规则的新动态会自动打捞。">
                <div className={classNames("settings-setting-row timed-setting-row")}>
                  <div>
                    <strong>运行状态</strong>
                    <span>{state.settings.timedActivityRefreshEnabled ? "已开启自动捞料。" : "开启后会按规则定时打捞。"}</span>
                  </div>
                  <button
                    className={classNames("switch-button", state.settings.timedActivityRefreshEnabled && "active")}
                    type="button"
                    aria-pressed={state.settings.timedActivityRefreshEnabled}
                    onClick={() => void updateSettings({ timedActivityRefreshEnabled: !state.settings.timedActivityRefreshEnabled })}
                  >
                    {state.settings.timedActivityRefreshEnabled ? "已启用" : "未启用"}
                  </button>
                </div>
              </SettingsCard>
              <SettingsCard title="打捞设置" subtitle="控制自动捞料的请求范围、间隔和起点。">
                <div className={classNames("timed-settings-grid")}>
                  <div className={classNames("settings-setting-row timed-setting-row")}>
                    <div>
                      <strong>打捞请求范围</strong>
                      <span>按规则只请求命中规则需要的范围；全量会按每位用户的视奸范围刷新。</span>
                    </div>
                    <div className={classNames("segmented-control timed-mode-control")} role="radiogroup" aria-label="打捞请求范围">
                      <button
                        className={classNames("segmented-option", state.settings.timedActivityRefreshScopeMode === "rules" && "active")}
                        type="button"
                        aria-pressed={state.settings.timedActivityRefreshScopeMode === "rules"}
                        onClick={() => void updateSettings({ timedActivityRefreshScopeMode: "rules" })}
                      >
                        按规则
                      </button>
                      <button
                        className={classNames("segmented-option", state.settings.timedActivityRefreshScopeMode === "all" && "active")}
                        type="button"
                        aria-pressed={state.settings.timedActivityRefreshScopeMode === "all"}
                        onClick={() => void updateSettings({ timedActivityRefreshScopeMode: "all" })}
                      >
                        全量
                      </button>
                    </div>
                  </div>
                  <div className={classNames("settings-setting-row timed-setting-row")}>
                    <div>
                      <strong>打捞间隔</strong>
                      <span>范围 30 到 720 分钟。</span>
                    </div>
                    <input
                      className={classNames("timed-interval-input")}
                      type="number"
                      min={30}
                      max={720}
                      step={30}
                      value={state.settings.timedActivityRefreshIntervalMinutes}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        if (!Number.isFinite(value)) return;
                        void updateSettings({ timedActivityRefreshIntervalMinutes: value });
                      }}
                      aria-label="打捞间隔分钟"
                    />
                  </div>
                  <div className={classNames("settings-setting-row timed-setting-row")}>
                    <div>
                      <strong>打捞起点</strong>
                      <span>{formatLaoFindsStartedAt(state.laoFindsStartedAt, relativeNow)}</span>
                    </div>
                    <button className={classNames("small-action")} type="button" onClick={() => void handleResetLaoFindsStartedAt()} disabled={dredgeRulesLocked}>
                      重设为现在
                    </button>
                  </div>
                </div>
              </SettingsCard>
              <DredgeRuleEditor
                locked={dredgeRulesLocked}
                lockReason={dredgeRulesLockReason}
                rules={state.dredgeRules}
                state={state}
                onRemoveRule={(id) => void removeDredgeRule(id)}
                onUpsertRule={(rule) => void upsertDredgeRule(rule)}
              />
            </div>
          ) : null}

          {activeSection === "data" ? (
            <div className={classNames("settings-card-list")}>
              <SettingsCard
                title="配置迁移"
                subtitle="导入导出佬朋友、设置和请求统计；账号登录状态、动态内容和头像缓存不会导出。"
                actions={
                  <>
                    <button className={classNames("small-action")} type="button" onClick={() => void handleExportConfig()}>
                      导出配置
                    </button>
                    <button className={classNames("small-action")} type="button" onClick={() => importInputRef.current?.click()}>
                      导入配置
                    </button>
                    <input
                      ref={importInputRef}
                      className="visually-hidden-file"
                      type="file"
                      accept="application/json,.json"
                      onChange={(event) => void handleImportConfig(event.currentTarget.files?.[0])}
                    />
                  </>
                }
              >
                {configMessage ? <p className={classNames("settings-meta")}>{configMessage}</p> : null}
              </SettingsCard>

              <SettingsCard
                id="cloud-backup"
                ref={cloudBackupRef}
                title="云存档"
                subtitle={cloudArchiveStatusDescription(cloudArchiveState)}
                actions={
                  <>
                    <button className={classNames("small-action")} type="button" disabled={cloudBusy != null} onClick={() => void handleBindCloudSave()}>
                      {cloudBusy === "bind" ? "绑定中" : cloudBound ? "重新绑定" : "绑定"}
                    </button>
                    <button className={classNames("small-action")} type="button" disabled={cloudBusy != null} onClick={() => void refreshCloudStatus()}>
                      {cloudBusy === "status" ? "检查中" : "检查云端"}
                    </button>
                    <button
                      className={classNames("small-action", cloudArchiveState?.archiveState === "different" && "primary-action")}
                      type="button"
                      disabled={cloudBusy != null || !cloudBound}
                      onClick={() => void handleBackupCloudConfig()}
                    >
                      {cloudBusy === "backup" ? "备份中" : "备份到云端"}
                    </button>
                    <button
                      className={classNames("small-action")}
                      type="button"
                      disabled={cloudBusy != null || !cloudBound}
                      onClick={() => void handleRestoreCloudConfig()}
                    >
                      {cloudBusy === "restore" ? "恢复中" : "从云端恢复"}
                    </button>
                    <button
                      className={classNames("small-action danger-action")}
                      type="button"
                      disabled={cloudBusy != null || !cloudBound}
                      onClick={() => void handleClearCloudBinding()}
                    >
                      断开绑定
                    </button>
                  </>
                }
              >
                <div className={classNames(`cloud-backup-status cloud-backup-${cloudArchiveState?.archiveState ?? "unbound"}`)}>
                  <strong>{cloudArchiveStatusTitle(cloudArchiveState)}</strong>
                  <span>{cloudArchiveStatusHint(cloudArchiveState)}</span>
                </div>
                <p className={classNames("settings-meta cloud-backup-remote")}>{cloudStatusText(cloudState?.status)}</p>
                {cloudBinding ? <p className={classNames("settings-meta cloud-backup-meta")}>{cloudBindingMetaText(cloudBinding)}</p> : null}
                {cloudMessage ? <p className={classNames("settings-meta")}>{cloudMessage}</p> : null}
              </SettingsCard>

              <SettingsCard
                title="请求统计每日自动同步"
                subtitle={cloudBound ? "开启后每天最多自动上传一次请求统计。" : "绑定云存档后可开启，本地统计不会丢失。"}
              >
                <div className={classNames("settings-setting-row timed-setting-row cloud-stats-sync-row")}>
                  <div>
                    <strong>同步状态</strong>
                    <span>
                      {cloudBound
                        ? "只自动上传，不会自动从云端恢复；多设备以后上传的统计会覆盖云端。"
                        : "绑定云存档后可开启；本地统计不会因为未绑定而丢失。"}
                    </span>
                  </div>
                  <button
                    className={classNames("switch-button", state.settings.requestStatsAutoSyncEnabled && cloudBound && "active")}
                    type="button"
                    disabled={cloudBusy != null || (!cloudBound && !state.settings.requestStatsAutoSyncEnabled)}
                    onClick={() => void updateSettings({ requestStatsAutoSyncEnabled: !state.settings.requestStatsAutoSyncEnabled })}
                  >
                    {!cloudBound && !state.settings.requestStatsAutoSyncEnabled ? "未绑定" : state.settings.requestStatsAutoSyncEnabled ? "关闭" : "开启"}
                  </button>
                </div>
                <p className={classNames("settings-meta cloud-backup-meta")}>{requestStatsSyncText(cloudBinding)}</p>
              </SettingsCard>

              <SettingsCard
                variant="danger"
                title="数据维护"
                subtitle="清理缓存会保留佬朋友、设置和当前账号；全量重置会恢复到刚安装状态。"
                actions={
                  <>
                    <button className={classNames("small-action")} type="button" onClick={() => void handleClearCache()}>
                      清理缓存
                    </button>
                    <button className={classNames("small-action danger-action")} type="button" onClick={() => void handleResetExtension()}>
                      全量重置
                    </button>
                  </>
                }
              />
            </div>
          ) : null}

          {activeSection === "request-stats" ? <RequestStatsSettingsPanel view={requestStatsView} /> : null}

          {activeSection === "sponsor" ? (
            <div className={classNames("settings-card-list")}>
              <SettingsCard
                className="sponsor-panel"
                title="赞助本项目"
                subtitle="给佬朋友续一口 LDC。"
                actions={
                  <div className={classNames("sponsor-actions")}>
                    <a className={classNames("small-action sponsor-action")} href={LDC_SPONSOR_20_URL} target="_blank" rel="noreferrer">
                      20 LDC
                    </a>
                    <a className={classNames("small-action sponsor-action")} href={LDC_SPONSOR_200_URL} target="_blank" rel="noreferrer">
                      200 LDC
                    </a>
                  </div>
                }
              />
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}

function RequestStatsSettingsPanel({ view }: { view: RequestStatsView }) {
  const [hourlyTab, setHourlyTab] = useState<"today" | "yesterday">("today");
  const hourlyItems = hourlyTab === "today" ? view.todayHours : view.yesterdayHours;
  const hourlyLabel = hourlyTab === "today" ? "今天" : "昨天";
  const hourlySubtitle = hourlyTab === "today" ? "今天 0 点到现在的请求次数。" : "昨天全天的请求次数。";

  return (
    <div className={classNames("settings-card-list request-stats-panel")}>
      <SettingsCard
        title="统计总览"
        subtitle="统计插件已发出的 linux.do 请求，失败和被拦截的请求也会计入。"
        actions={
          <div className={classNames("request-stats-total-badge")} aria-label={`总请求 ${view.total}`}>
            <span>总请求</span>
            <strong>{view.total}</strong>
          </div>
        }
      />
      <SettingsCard
        title="按小时"
        subtitle={hourlySubtitle}
        actions={
          <div className={classNames("segmented-control request-stats-tabs")} role="tablist" aria-label="请求统计小时视图">
            <button
              className={classNames("segmented-option", hourlyTab === "today" && "active")}
              type="button"
              role="tab"
              aria-selected={hourlyTab === "today"}
              aria-controls="request-stats-hourly-chart"
              onClick={() => setHourlyTab("today")}
            >
              今天
            </button>
            <button
              className={classNames("segmented-option", hourlyTab === "yesterday" && "active")}
              type="button"
              role="tab"
              aria-selected={hourlyTab === "yesterday"}
              aria-controls="request-stats-hourly-chart"
              onClick={() => setHourlyTab("yesterday")}
            >
              昨天
            </button>
          </div>
        }
      >
        <RequestStatsBarChart id="request-stats-hourly-chart" ariaLabel={`${hourlyLabel}每小时请求次数柱状图`} density="hourly" items={hourlyItems} />
      </SettingsCard>
      <SettingsCard title="近 7 天" subtitle="含今天在内的 7 天滑动窗口。">
        <RequestStatsBarChart ariaLabel="近 7 天每天请求次数柱状图" density="daily" items={view.last7Days} />
      </SettingsCard>
    </div>
  );
}

function RequestStatsBarChart({
  ariaLabel,
  density,
  id,
  items
}: {
  ariaLabel: string;
  density: "hourly" | "daily";
  id?: string;
  items: Array<RequestStatsHourView | RequestStatsDayView>;
}) {
  const maxTotal = Math.max(1, ...items.map((item) => item.total));
  return (
    <div className={classNames("request-stats-chart-scroll")}>
      <div className={classNames("request-stats-chart", `request-stats-chart-${density}`)} id={id} role="list" aria-label={ariaLabel}>
        {items.map((item) => {
          const height = item.total === 0 ? 0 : Math.max(8, Math.round((item.total / maxTotal) * 100));
          const key = "hour" in item ? item.hour : item.date;
          const itemLabel = `${item.label}：${item.total}`;
          const axisLabel = chartAxisLabel(item, density);
          return (
            <div
              className={classNames("request-stats-bar-item", item.total === 0 && "is-zero")}
              key={key}
              role="listitem"
              aria-label={itemLabel}
              tabIndex={0}
            >
              <span className={classNames("request-stats-bar-tooltip")} aria-hidden="true">
                {itemLabel}
              </span>
              <span className={classNames("request-stats-bar-value")}>{item.total}</span>
              <span className={classNames("request-stats-bar-track")} aria-hidden="true">
                <span className={classNames("request-stats-bar-fill")} style={{ height: `${height}%` }} />
              </span>
              <span className={classNames("request-stats-bar-label")} aria-hidden={axisLabel ? undefined : "true"}>
                {axisLabel}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function chartAxisLabel(item: RequestStatsHourView | RequestStatsDayView, density: "hourly" | "daily"): string {
  if (density === "daily" || !("hour" in item)) return item.label;
  const hour = Number(item.hour);
  return hour % 3 === 0 || item.hour === "23" || item.total > 0 ? item.hour : "";
}

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function configFileName(exportedAt: string) {
  return `linuxdo-friends-config-${exportedAt.replace(/[:.]/g, "-")}.json`;
}

function cloudArchiveStatusTitle(state: CloudArchiveLocalStateResult | null): string {
  return cloudArchiveStatusCopy(state).title;
}

function cloudArchiveStatusDescription(state: CloudArchiveLocalStateResult | null): string {
  return cloudArchiveStatusCopy(state).description;
}

function cloudArchiveStatusHint(state: CloudArchiveLocalStateResult | null): string {
  return cloudArchiveStatusCopy(state).hint;
}

function cloudArchiveStatusCopy(state: CloudArchiveLocalStateResult | null): { title: string; description: string; hint: string } {
  const archiveState: CloudArchiveLocalState = state?.archiveState ?? "unbound";
  if (archiveState === "same") {
    return {
      title: "已备份",
      description: "本地配置已备份到云端。",
      hint: state?.syncedAt ? `同步于 ${new Date(state.syncedAt).toLocaleString()}` : "本地配置已备份到云端。"
    };
  }
  if (archiveState === "different") {
    return {
      title: "待备份",
      description: "本地配置有更新，尚未备份到云端。",
      hint: "建议备份到云端。"
    };
  }
  return {
    title: "未绑定",
    description: "绑定后可以把佬朋友、设置和请求统计备份到云端。",
    hint: "尚未绑定云存档。"
  };
}

function cloudStatusText(status: CloudConfigStatus | undefined): string {
  if (!status || status.state === "unchecked") return "云端配置尚未检查。";
  if (status.state === "remote_config") {
    const exportedAt = status.exportedAt ? new Date(status.exportedAt).toLocaleString() : "未知时间";
    return `云端配置：${status.friendCount ?? 0} 位佬朋友，导出于 ${exportedAt}。`;
  }
  return status.message ?? "云端配置状态未知。";
}

function cloudBindingMetaText(binding: Extract<CloudConfigViewState["binding"], { bound: true }>): string {
  const parts = [`账号 ${binding.linuxDoId}`, `绑定于 ${new Date(binding.boundAt).toLocaleString()}`];
  if (binding.lastBackupAt) parts.push(`上次备份 ${new Date(binding.lastBackupAt).toLocaleString()}`);
  if (binding.lastRestoreAt) parts.push(`上次恢复 ${new Date(binding.lastRestoreAt).toLocaleString()}`);
  return parts.join(" · ");
}

function requestStatsSyncText(binding: Extract<CloudConfigViewState["binding"], { bound: true }> | null): string {
  if (!binding) return "请求统计每日同步需先绑定云存档。";
  if (binding.lastRequestStatsAutoSyncError && isRequestStatsAutoSyncErrorNewer(binding)) {
    return `请求统计上次自动同步失败：${binding.lastRequestStatsAutoSyncError.message ?? "请稍后重试。"}`;
  }
  if (binding.lastRequestStatsSyncedAt) {
    return `请求统计同步于 ${new Date(binding.lastRequestStatsSyncedAt).toLocaleString()} · 总计 ${binding.lastRequestStatsTotal ?? 0} 次`;
  }
  return "请求统计尚未自动同步。";
}

function isRequestStatsAutoSyncErrorNewer(binding: Extract<CloudConfigViewState["binding"], { bound: true }>): boolean {
  const errorAt = binding.lastRequestStatsAutoSyncError?.checkedAt;
  if (!errorAt) return false;
  if (!binding.lastRequestStatsSyncedAt) return true;
  return Date.parse(errorAt) > Date.parse(binding.lastRequestStatsSyncedAt);
}

function formatLaoFindsStartedAt(value: string | undefined, now: number): string {
  if (!value || Number.isNaN(Date.parse(value))) return "未设置，首次打捞会从当前时间开始。";
  return `${new Date(value).toLocaleString()}（${formatRelativeTime(value, now)}）`;
}

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(<OptionsApp />);
}
