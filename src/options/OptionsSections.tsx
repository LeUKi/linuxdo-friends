import { useEffect, useState } from "react";
import type React from "react";
import { DredgeRuleEditor } from "../app/DredgeRuleEditor";
import { FriendCandidateList } from "../app/FriendManagement";
import { VersionDiagnostics } from "../app/VersionStatus";
import { TIMED_ACTIVITY_REFRESH_INTERVAL_MINUTES_MAX, TIMED_ACTIVITY_REFRESH_INTERVAL_MINUTES_MIN } from "../shared/settingsLimits";
import type { ActivityRefreshKind, AppState, BackgroundResponse, CloudArchiveLocalStateResult, CloudConfigViewState, FollowedUserInput, FriendProfileSummary, UpdateCheckState, Username } from "../shared/types";
import { deriveFollowedCandidates, deriveFriendList } from "../popup/selectors";
import { classNames } from "./classNames";
import { SettingsCard } from "./SettingsCard";
import {
  cloudArchiveStatusDescription,
  cloudArchiveStatusHint,
  cloudArchiveStatusTitle,
  cloudBindingMetaText,
  cloudStatusText,
  dailyBackupStatusText,
  formatLaoFindsStartedAt,
} from "./optionsHelpers";

const LDC_SPONSOR_20_URL = "https://credit.linux.do/paying/online?token=3b78efe60d34a77c55d52e84d60e33270b5cc69f7aa8979bbab4d1b41b6f95b7";
const LDC_SPONSOR_200_URL = "https://credit.linux.do/paying/online?token=276b84998e7864428f277f6d7260f7e65e8c531cda5413cb061ff4a91cc3caa4";

type UpdateSettings = (patch: Partial<AppState["settings"]>) => Promise<void>;
type Friends = ReturnType<typeof deriveFriendList>;
type FollowedCandidates = ReturnType<typeof deriveFollowedCandidates>;
type CloudBinding = Extract<CloudConfigViewState["binding"], { bound: true }> | null;

export function BasicSettingsSection({
  accountBusy,
  now,
  onCheckForUpdates,
  onIdentifyAccount,
  state,
  updateCheck,
  updateSettings
}: {
  accountBusy: boolean;
  now: number;
  onCheckForUpdates: () => void;
  onIdentifyAccount: () => void;
  state: AppState;
  updateCheck: UpdateCheckState;
  updateSettings: UpdateSettings;
}) {
  return (
    <div className={classNames("settings-card-list")}>
      <VersionDiagnostics now={now} onCheck={onCheckForUpdates} state={updateCheck} />
      <SettingsCard
        title="本地账号探测"
        subtitle={state.currentAccount ? `当前探测为 @${state.currentAccount.username}` : "尚未探测到 linux.do 登录账号。"}
        actions={
          <button className={classNames("small-action")} type="button" disabled={accountBusy} onClick={onIdentifyAccount}>
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
      <SettingsCard
        title="动态跳转"
        subtitle="选择打开动态详情的位置。"
        headerAside={
          <div className={classNames("segmented-control settings-card-segmented")} role="radiogroup" aria-label="动态跳转">
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
        }
      >
        <p className={classNames("settings-meta")}>页内跳转会优先使用当前 linux.do 标签页；不可用时仍打开新标签。</p>
      </SettingsCard>
    </div>
  );
}

export function ScopeSettingsSection({
  followedCandidates,
  friends,
  friendsQuery,
  onAddFriend,
  onLookupFriend,
  onRemoveFriend,
  onSyncFollows,
  onUpdateScope,
  setFriendsQuery,
  syncBusy
}: {
  followedCandidates: FollowedCandidates;
  friends: Friends;
  friendsQuery: string;
  onAddFriend: (target: FollowedUserInput, profile?: FriendProfileSummary) => void;
  onLookupFriend: (target: Username) => Promise<BackgroundResponse<FriendProfileSummary>>;
  onRemoveFriend: (target: Username) => void;
  onSyncFollows: () => void;
  onUpdateScope: (username: Username, activityKinds: ActivityRefreshKind[]) => void;
  setFriendsQuery: (query: string) => void;
  syncBusy: boolean;
}) {
  return (
    <div className={classNames("settings-card-list")}>
      <SettingsCard
        title="关注同步"
        subtitle="获取你的 linux.do 关注列表，便于添加佬朋友。"
        actions={
          <button className={classNames("small-action")} type="button" disabled={syncBusy} onClick={onSyncFollows}>
            {syncBusy ? "获取中" : "获取我的关注列表"}
          </button>
        }
      />
      <SettingsCard
        title="范围管理"
        subtitle="管理会被打捞和展示动态的已关注用户。"
        headerAside={friends.length > 0 ? <span className={classNames("settings-count-badge")}>共 {friends.length} 位佬朋友</span> : null}
      >
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
          onAdd={onAddFriend}
          onLookup={onLookupFriend}
          onRemove={onRemoveFriend}
          onUpdateScope={onUpdateScope}
          query={friendsQuery}
        />
      </SettingsCard>
    </div>
  );
}

export function NotificationsSettingsSection({
  onSaveTelegram,
  onTestTelegram,
  state,
  telegramBusy,
  telegramMessage,
  updateSettings
}: {
  onSaveTelegram: (token: string, chatId: string, enableTelegram?: boolean) => Promise<boolean>;
  onTestTelegram: (credentials?: { botToken: string; chatId: string }) => Promise<boolean>;
  state: AppState;
  telegramBusy: "save" | "test" | null;
  telegramMessage: string | null;
  updateSettings: UpdateSettings;
}) {
  const [telegramModalOpen, setTelegramModalOpen] = useState(false);
  const [telegramDraftToken, setTelegramDraftToken] = useState("");
  const [telegramDraftChatId, setTelegramDraftChatId] = useState("");
  const telegramConfigured = Boolean(state.settings.telegramBotToken && state.settings.telegramChatId);
  const savedTelegramToken = state.settings.telegramBotToken ?? "";
  const savedTelegramChatId = state.settings.telegramChatId ?? "";

  function resetTelegramDraft() {
    setTelegramDraftToken(savedTelegramToken);
    setTelegramDraftChatId(savedTelegramChatId);
  }

  function openTelegramModal() {
    resetTelegramDraft();
    setTelegramModalOpen(true);
  }

  function closeTelegramModal() {
    resetTelegramDraft();
    setTelegramModalOpen(false);
  }

  const telegramDraftComplete = Boolean(telegramDraftToken.trim() && telegramDraftChatId.trim());
  const telegramEnabled = state.settings.laoFindsTelegramNotificationsEnabled;

  async function saveTelegramFromModal(enableTelegram = false) {
    const saved = await onSaveTelegram(telegramDraftToken, telegramDraftChatId, enableTelegram);
    if (saved) setTelegramModalOpen(false);
  }

  function testTelegramDraftFromModal() {
    return onTestTelegram({ botToken: telegramDraftToken, chatId: telegramDraftChatId });
  }

  useEffect(() => {
    if (!telegramModalOpen) return undefined;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeTelegramModal();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [savedTelegramChatId, savedTelegramToken, telegramModalOpen]);

  return (
    <div className={classNames("settings-card-list")}>
      <SettingsCard
        title="浏览器本地通知"
        subtitle="自动捞料有新增时提醒。"
        actions={
          <button
            className={classNames("switch-button", state.settings.laoFindsBrowserNotificationsEnabled && "active")}
            type="button"
            aria-pressed={state.settings.laoFindsBrowserNotificationsEnabled}
            onClick={() => void updateSettings({ laoFindsBrowserNotificationsEnabled: !state.settings.laoFindsBrowserNotificationsEnabled })}
          >
            {state.settings.laoFindsBrowserNotificationsEnabled ? "已启用" : "未启用"}
          </button>
        }
      >
        <div className={classNames("settings-setting-row timed-setting-row")}>
          <div>
            <strong>手动打捞通知</strong>
            <span>立即打捞有新增时提醒。</span>
          </div>
          <button
            className={classNames("switch-button", state.settings.laoFindsManualNotificationsEnabled && "active")}
            type="button"
            disabled={!state.settings.laoFindsBrowserNotificationsEnabled}
            aria-pressed={state.settings.laoFindsManualNotificationsEnabled}
            onClick={() => void updateSettings({ laoFindsManualNotificationsEnabled: !state.settings.laoFindsManualNotificationsEnabled })}
          >
            {state.settings.laoFindsManualNotificationsEnabled ? "已启用" : "未启用"}
          </button>
        </div>
      </SettingsCard>
      <SettingsCard
        title="Telegram"
        subtitle="发送打捞通知到 Telegram。"
        actions={
          <>
            <button
              className={classNames("switch-button", state.settings.laoFindsTelegramNotificationsEnabled && "active")}
              type="button"
              aria-pressed={state.settings.laoFindsTelegramNotificationsEnabled}
              onClick={() => void updateSettings({ laoFindsTelegramNotificationsEnabled: !state.settings.laoFindsTelegramNotificationsEnabled })}
            >
              {state.settings.laoFindsTelegramNotificationsEnabled ? "已启用" : "未启用"}
            </button>
            <button className={classNames("small-action")} type="button" disabled={telegramBusy != null} onClick={() => void onTestTelegram()}>
              {telegramBusy === "test" ? "发送中" : "发送测试"}
            </button>
          </>
        }
      >
        <div className={classNames("settings-setting-row timed-setting-row telegram-config-row")}>
          <div>
            <strong>Telegram Bot</strong>
            <span>{telegramConfigured ? "已配置 Bot Token 和 Chat ID。" : "未配置 Bot Token 和 Chat ID。"}</span>
          </div>
          <button className={classNames("small-action")} type="button" onClick={openTelegramModal}>
            配置
          </button>
        </div>
        <p className={classNames("settings-meta")}>
          Bot Token 和 Chat ID 保存在本地；已配置时会随配置导出和云存档备份；只有启用 Telegram 通知或发送测试时才请求 Telegram API。
        </p>
        {telegramMessage ? <p className={classNames("settings-meta")}>{telegramMessage}</p> : null}
        {telegramModalOpen ? (
          <div className={classNames("modal-backdrop")} role="presentation">
            <section className={classNames("modal telegram-config-modal")} role="dialog" aria-modal="true" aria-labelledby="telegram-config-title">
              <div className={classNames("modal-head")}>
                <div>
                  <h2 id="telegram-config-title">Telegram Bot 配置</h2>
                  <p className={classNames("settings-meta")}>保存 Bot Token 和 Chat ID 后可发送通知；凭据会保存在本地并随配置迁移。</p>
                </div>
                <button className={classNames("icon-button")} type="button" aria-label="关闭 Telegram 配置" onClick={closeTelegramModal}>
                  ×
                </button>
              </div>
              <div className={classNames("modal-section telegram-config-form")}>
                <label className={classNames("telegram-config-field")} htmlFor="tg-bot-token">
                  <span>Bot Token</span>
                  <input
                    id="tg-bot-token"
                    type="password"
                    placeholder="123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"
                    value={telegramDraftToken}
                    onChange={(event) => setTelegramDraftToken(event.currentTarget.value)}
                    autoComplete="off"
                  />
                </label>
                <label className={classNames("telegram-config-field")} htmlFor="tg-chat-id">
                  <span>Chat ID</span>
                  <input
                    id="tg-chat-id"
                    type="text"
                    placeholder="123456789"
                    value={telegramDraftChatId}
                    onChange={(event) => setTelegramDraftChatId(event.currentTarget.value)}
                    autoComplete="off"
                  />
                </label>
                {telegramMessage ? <p className={classNames("settings-meta")}>{telegramMessage}</p> : null}
              </div>
              <div className={classNames("maintenance-actions telegram-modal-actions")}>
                <button
                  className={classNames("small-action", telegramEnabled && "primary-action")}
                  type="button"
                  disabled={telegramBusy != null}
                  onClick={() => void saveTelegramFromModal()}
                >
                  {telegramBusy === "save" ? "保存中" : "保存"}
                </button>
                {!telegramEnabled ? (
                  <button
                    className={classNames("small-action primary-action")}
                    type="button"
                    disabled={telegramBusy != null || !telegramDraftComplete}
                    onClick={() => void saveTelegramFromModal(true)}
                  >
                    {telegramBusy === "save" ? "保存中" : "保存并开启"}
                  </button>
                ) : null}
                <button className={classNames("small-action")} type="button" disabled={telegramBusy != null} onClick={() => void testTelegramDraftFromModal()}>
                  {telegramBusy === "test" ? "发送中" : "发送测试消息"}
                </button>
                <button className={classNames("small-action")} type="button" disabled={telegramBusy != null} onClick={closeTelegramModal}>
                  取消
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </SettingsCard>
      <SettingsCard
        variant="unavailable"
        title="Webhook"
        subtitle="发送到自定义地址。"
        actions={<span className={classNames("settings-unavailable-badge")}>正在施工</span>}
      />
    </div>
  );
}

export function LaoFindsSettingsSection({
  dredgeRulesLocked,
  dredgeRulesLockReason,
  now,
  onRemoveDredgeRule,
  onResetLaoFindsStartedAt,
  onUpsertDredgeRule,
  state,
  updateSettings
}: {
  dredgeRulesLocked: boolean;
  dredgeRulesLockReason?: string;
  now: number;
  onRemoveDredgeRule: (id: string) => void;
  onResetLaoFindsStartedAt: () => void;
  onUpsertDredgeRule: Parameters<typeof DredgeRuleEditor>[0]["onUpsertRule"];
  state: AppState;
  updateSettings: UpdateSettings;
}) {
  return (
    <div className={classNames("settings-card-list")}>
      <SettingsCard
        title="自动捞料"
        subtitle="需保持插件界面前台显示。"
        headerAside={
          <button
            className={classNames("switch-button", state.settings.timedActivityRefreshEnabled && "active")}
            type="button"
            aria-pressed={state.settings.timedActivityRefreshEnabled}
            onClick={() => void updateSettings({ timedActivityRefreshEnabled: !state.settings.timedActivityRefreshEnabled })}
          >
            {state.settings.timedActivityRefreshEnabled ? "已启用" : "未启用"}
          </button>
        }
      />
      <SettingsCard title="打捞设置">
        <div className={classNames("timed-settings-grid")}>
          <div className={classNames("settings-setting-row timed-setting-row")}>
            <div>
              <strong>打捞请求范围</strong>
              <span>选择自动打捞范围。</span>
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
              <span>5 到 720 分钟。</span>
            </div>
            <input
              className={classNames("timed-interval-input")}
              type="number"
              min={TIMED_ACTIVITY_REFRESH_INTERVAL_MINUTES_MIN}
              max={TIMED_ACTIVITY_REFRESH_INTERVAL_MINUTES_MAX}
              step={5}
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
              <span>{formatLaoFindsStartedAt(state.laoFindsStartedAt, now)}</span>
            </div>
            <button className={classNames("small-action")} type="button" onClick={onResetLaoFindsStartedAt} disabled={dredgeRulesLocked}>
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
        onRemoveRule={onRemoveDredgeRule}
        onUpsertRule={onUpsertDredgeRule}
      />
    </div>
  );
}

export function DataSettingsSection({
  cloudArchiveState,
  cloudBackupRef,
  cloudBinding,
  cloudBound,
  cloudBusy,
  cloudMessage,
  cloudState,
  configMessage,
  importInputRef,
  onBackupCloudConfig,
  onBindCloudSave,
  onClearCache,
  onClearCloudBinding,
  onExportConfig,
  onImportConfig,
  onRefreshCloudStatus,
  onResetExtension,
  onRestoreCloudConfig,
  state,
  updateSettings
}: {
  cloudArchiveState: CloudArchiveLocalStateResult | null;
  cloudBackupRef: React.RefObject<HTMLElement | null>;
  cloudBinding: CloudBinding;
  cloudBound: boolean;
  cloudBusy: "bind" | "status" | "backup" | "restore" | "clear" | null;
  cloudMessage: string | null;
  cloudState: CloudConfigViewState | null;
  configMessage: string | null;
  importInputRef: React.RefObject<HTMLInputElement | null>;
  onBackupCloudConfig: () => void;
  onBindCloudSave: () => void;
  onClearCache: () => void;
  onClearCloudBinding: () => void;
  onExportConfig: () => void;
  onImportConfig: (file: File | undefined) => void;
  onRefreshCloudStatus: () => void;
  onResetExtension: () => void;
  onRestoreCloudConfig: () => void;
  state: AppState;
  updateSettings: UpdateSettings;
}) {
  const dailyBackupEnabled = state.settings.requestStatsAutoSyncEnabled;
  return (
    <div className={classNames("settings-card-list")}>
      <SettingsCard
        title="配置迁移"
        subtitle="导入导出佬朋友、打捞规则、请求统计和设置；已配置的 Telegram Bot Token / Chat ID 也会随配置迁移。"
        actions={
          <>
            <button className={classNames("small-action")} type="button" onClick={onExportConfig}>
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
              onChange={(event) => onImportConfig(event.currentTarget.files?.[0])}
            />
          </>
        }
      >
        <p className={classNames("settings-meta")}>账号登录状态、动态内容和头像缓存不会导出。导出的 JSON 可能包含通知凭据，请作为私密备份保存。</p>
        {configMessage ? <p className={classNames("settings-meta")}>{configMessage}</p> : null}
      </SettingsCard>

      <SettingsCard
        id="cloud-backup"
        ref={cloudBackupRef}
        title="云存档"
        subtitle={cloudArchiveStatusDescription(cloudArchiveState)}
        actions={
          <>
            <button className={classNames("small-action")} type="button" disabled={cloudBusy != null} onClick={onBindCloudSave}>
              {cloudBusy === "bind" ? "绑定中" : cloudBound ? "重新绑定" : "绑定"}
            </button>
            <button className={classNames("small-action")} type="button" disabled={cloudBusy != null} onClick={onRefreshCloudStatus}>
              {cloudBusy === "status" ? "检查中" : "检查云端"}
            </button>
            <button
              className={classNames("small-action", cloudArchiveState?.archiveState === "different" && "primary-action")}
              type="button"
              disabled={cloudBusy != null || !cloudBound}
              onClick={onBackupCloudConfig}
            >
              {cloudBusy === "backup" ? "备份中" : "备份到云端"}
            </button>
            <button className={classNames("small-action")} type="button" disabled={cloudBusy != null || !cloudBound} onClick={onRestoreCloudConfig}>
              {cloudBusy === "restore" ? "恢复中" : "从云端恢复"}
            </button>
            <button className={classNames("small-action danger-action")} type="button" disabled={cloudBusy != null || !cloudBound} onClick={onClearCloudBinding}>
              断开绑定
            </button>
          </>
        }
      >
        <p className={classNames("settings-meta")}>
          备份会把可迁移配置上传到 linuxdo-cloud-save.lafish.workers.dev，包括佬朋友、打捞规则、请求统计、设置，以及已配置的 Telegram Bot Token / Chat ID。
        </p>
        <div className={classNames(`cloud-backup-status cloud-backup-${cloudArchiveState?.archiveState ?? "unbound"}`)}>
          <strong>{cloudArchiveStatusTitle(cloudArchiveState)}</strong>
          <span>{cloudArchiveStatusHint(cloudArchiveState)}</span>
        </div>
        <p className={classNames("settings-meta cloud-backup-remote")}>{cloudStatusText(cloudState?.status)}</p>
        {cloudBinding ? <p className={classNames("settings-meta cloud-backup-meta")}>{cloudBindingMetaText(cloudBinding)}</p> : null}
        <div className={classNames("settings-setting-row timed-setting-row cloud-stats-sync-row")}>
          <div>
            <strong>每日自动备份</strong>
            <span>{dailyBackupStatusText(cloudBinding)}</span>
          </div>
          <button
            className={classNames("switch-button", dailyBackupEnabled && cloudBound && "active")}
            type="button"
            disabled={cloudBusy != null || !cloudBound}
            aria-pressed={dailyBackupEnabled && cloudBound}
            onClick={() => void updateSettings({ requestStatsAutoSyncEnabled: !dailyBackupEnabled })}
          >
            {!cloudBound ? "未绑定" : dailyBackupEnabled ? "已启用" : "未启用"}
          </button>
        </div>
        {cloudMessage ? <p className={classNames("settings-meta")}>{cloudMessage}</p> : null}
      </SettingsCard>

      <SettingsCard
        variant="danger"
        title="数据维护"
        subtitle="清理缓存会保留佬朋友、设置和当前账号；全量重置会恢复到刚安装状态。"
        actions={
          <>
            <button className={classNames("small-action")} type="button" onClick={onClearCache}>
              清理缓存
            </button>
            <button className={classNames("small-action danger-action")} type="button" onClick={onResetExtension}>
              全量重置
            </button>
          </>
        }
      />
    </div>
  );
}

export function SponsorSettingsSection() {
  return (
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
  );
}
