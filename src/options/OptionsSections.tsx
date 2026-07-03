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
  formatLaoFindsStartedAt,
  requestStatsSyncText
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
          onAdd={onAddFriend}
          onLookup={onLookupFriend}
          onRemove={onRemoveFriend}
          onUpdateScope={onUpdateScope}
          query={friendsQuery}
        />
        {friends.length > 0 ? <p className={classNames("friend-count-footer")}>共 {friends.length} 位佬朋友</p> : null}
      </SettingsCard>
    </div>
  );
}

export function NotificationsSettingsSection({
  onSaveTelegram,
  onTestTelegram,
  setTelegramChatId,
  setTelegramToken,
  state,
  telegramBusy,
  telegramChatId,
  telegramMessage,
  telegramToken,
  updateSettings
}: {
  onSaveTelegram: () => void;
  onTestTelegram: () => void;
  setTelegramChatId: (value: string) => void;
  setTelegramToken: (value: string) => void;
  state: AppState;
  telegramBusy: "save" | "test" | null;
  telegramChatId: string;
  telegramMessage: string | null;
  telegramToken: string;
  updateSettings: UpdateSettings;
}) {
  return (
    <div className={classNames("settings-card-list")}>
      <SettingsCard title="佬有料通知" subtitle="自动捞料有新收录会提醒；手动打捞默认不提醒。">
        <div className={classNames("settings-setting-row timed-setting-row")}>
          <div>
            <strong>浏览器本地通知</strong>
            <span>只显示来源和新增数量，点击后打开佬有料。</span>
          </div>
          <button
            className={classNames("switch-button", state.settings.laoFindsBrowserNotificationsEnabled && "active")}
            type="button"
            aria-pressed={state.settings.laoFindsBrowserNotificationsEnabled}
            onClick={() => void updateSettings({ laoFindsBrowserNotificationsEnabled: !state.settings.laoFindsBrowserNotificationsEnabled })}
          >
            {state.settings.laoFindsBrowserNotificationsEnabled ? "已启用" : "未启用"}
          </button>
        </div>
        <div className={classNames("settings-setting-row timed-setting-row")}>
          <div>
            <strong>手动打捞通知</strong>
            <span>开启后，点击立即打捞并有新收录时也会提醒。</span>
          </div>
          <button
            className={classNames("switch-button", state.settings.laoFindsManualNotificationsEnabled && "active")}
            type="button"
            aria-pressed={state.settings.laoFindsManualNotificationsEnabled}
            onClick={() => void updateSettings({ laoFindsManualNotificationsEnabled: !state.settings.laoFindsManualNotificationsEnabled })}
          >
            {state.settings.laoFindsManualNotificationsEnabled ? "已启用" : "未启用"}
          </button>
        </div>
      </SettingsCard>
      <SettingsCard title="Telegram" subtitle="佬有料有新收录时发送 digest 提醒。">
        <div>
          <label className={classNames("settings-meta")} htmlFor="tg-bot-token" style={{ display: "block", marginBottom: 4 }}>
            Bot Token
          </label>
          <input
            id="tg-bot-token"
            type="password"
            placeholder="123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"
            value={telegramToken}
            onChange={(event) => setTelegramToken(event.currentTarget.value)}
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
            onChange={(event) => setTelegramChatId(event.currentTarget.value)}
            autoComplete="off"
          />
        </div>
        <div className={classNames("maintenance-actions")}>
          <button className={classNames("small-action")} type="button" disabled={telegramBusy != null} onClick={onSaveTelegram}>
            {telegramBusy === "save" ? "保存中" : "保存"}
          </button>
          <button className={classNames("small-action")} type="button" disabled={telegramBusy != null} onClick={onTestTelegram}>
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
              <span>范围 5 到 720 分钟。</span>
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
  return (
    <div className={classNames("settings-card-list")}>
      <SettingsCard
        title="配置迁移"
        subtitle="导入导出佬朋友、设置和请求统计；账号登录状态、动态内容和头像缓存不会导出。"
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
        <div className={classNames(`cloud-backup-status cloud-backup-${cloudArchiveState?.archiveState ?? "unbound"}`)}>
          <strong>{cloudArchiveStatusTitle(cloudArchiveState)}</strong>
          <span>{cloudArchiveStatusHint(cloudArchiveState)}</span>
        </div>
        <p className={classNames("settings-meta cloud-backup-remote")}>{cloudStatusText(cloudState?.status)}</p>
        {cloudBinding ? <p className={classNames("settings-meta cloud-backup-meta")}>{cloudBindingMetaText(cloudBinding)}</p> : null}
        {cloudMessage ? <p className={classNames("settings-meta")}>{cloudMessage}</p> : null}
      </SettingsCard>

      <SettingsCard title="请求统计每日自动同步" subtitle={cloudBound ? "开启后每天最多自动上传一次请求统计。" : "绑定云存档后可开启，本地统计不会丢失。"}>
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
