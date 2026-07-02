import React, { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useAtom, useSetAtom } from "jotai";
import {
  Check,
  ChevronDown,
  Cloud,
  ExternalLink,
  LoaderCircle,
  PanelRightOpen,
  RefreshCw,
  Settings,
  Sparkles,
  Telescope,
  Timer,
  X
} from "lucide-react";
import {
  autoRefreshSessionAtom,
  claimAutoRefreshControllerAtom,
  loadAutoRefreshSessionAtom,
  observeAutoRefreshSessionAtom,
  recordAutoRefreshFinishedAtom,
  registerAutoRefreshSurfaceAtom,
  unregisterAutoRefreshSurfaceAtom,
  updateAutoRefreshEnabledAtom,
  updateAutoRefreshIntervalAtom
} from "../state/autoRefreshAtoms";
import {
  AUTO_REFRESH_HEARTBEAT_MS,
  type FriendStatusAutoRefreshIntervalMinutes,
  type FriendStatusAutoRefreshSession
} from "../storage/autoRefreshSessionStorage";
import { TIMED_ACTIVITY_HEARTBEAT_MS, type TimedActivityRefreshSession } from "../storage/timedActivityRefreshSessionStorage";
import {
  claimTimedActivityRefreshControllerAtom,
  loadTimedActivityRefreshSessionAtom,
  observeTimedActivityRefreshSessionAtom,
  patchTimedActivityRefreshSessionAtom,
  registerTimedActivityRefreshSurfaceAtom,
  timedActivityRefreshSessionAtom,
  unregisterTimedActivityRefreshSurfaceAtom
} from "../state/timedActivityRefreshAtoms";
import {
  addFriendFromKnownUserAtom,
  archiveLaoFindsItemAtom,
  appStateAtom,
  cacheAvatarsAtom,
  checkForUpdatesAtom,
  clearStatusMessageAtom,
  cloudArchiveLocalStateAtom,
  identifyCurrentAccountAtom,
  loadCloudArchiveLocalStateAtom,
  loadPageScriptStatusAtom,
  loadingAtom,
  loadSiteDataProgressAtom,
  loadStateAtom,
  loadUpdateCheckAtom,
  lookupFriendProfileAtom,
  markLaoFindsItemReadAtom,
  observeAppStateAtom,
  observePageScriptStatusAtom,
  observeSiteDataProgressAtom,
  observeUpdateCheckAtom,
  openLinuxDoHomeAtom,
  openActivityLinkAtom,
  openOptionsPageAtom,
  openSidePanelAtom,
  pageScriptStatusAtom,
  refreshFriendActivityForTimedRunAtom,
  refreshFriendActivityAtom,
  refreshFriendProfilesAtom,
  repairLinuxDoPageScriptAtom,
  removeFriendAtom,
  siteDataProgressAtom,
  statusMessageAtom,
  syncFollowsAtom,
  updateSettingsAtom,
  updateCheckAtom
} from "../state/atoms";
import { VersionBadge } from "./VersionStatus";
import { AvatarImageContext } from "./AvatarContext";
import { FriendCandidateList } from "./FriendManagement";
import { kindIcon, kindText } from "./activityKinds";
import { UserIdentityRow } from "./UserIdentityRow";
import { loadUiSceneAtom, observeUiSceneAtom, uiSceneAtom, updateUiSceneAtom } from "../state/uiSceneAtoms";
import { formatRelativeTime } from "../shared/time";
import { CLOUD_AUTH_STORAGE_KEY } from "../storage/cloudAuthStorage";
import { isStaleRunningSiteDataProgress, SITE_DATA_PROGRESS_RUNNING_TTL_MS } from "../storage/siteDataProgressStorage";
import type {
  ActivityItem,
  ActivityKindFilter,
  ActivityRefreshScope,
  AppState,
  BackgroundResponse,
  CloudArchiveLocalStateResult,
  RefreshFailureReason,
  FollowedUserInput,
  FriendProfileSummary,
  PageScriptStatusSnapshot,
  SiteDataTaskProgress,
  UiSceneState,
  Username
} from "../shared/types";
import { deriveTimedActivityRefreshScopes } from "../domain/activityRefresh";
import {
  type UserIdentityView,
  deriveActivityRequestCounts,
  deriveActivityFreshness,
  deriveActivityRefreshScope,
  deriveFeedItems,
  deriveFeedRenderEntries,
  deriveFeedUserOptions,
  deriveFollowedCandidates,
  deriveFriendList,
  deriveLaoFindsItems,
  identityForActivityItem,
  identityForUsername
} from "../popup/selectors";
import "../styles/app.css";

type AppSurface = "side-panel" | "in-page";
type FilterOption<T extends string> = {
  value: T;
  label: string;
  meta?: number | string;
  icon?: ReactNode;
  content?: ReactNode;
  searchText?: string;
  tone?: ActivityKindFilter;
};

const RELATIVE_TIME_TICK_MS = 30_000;
const AUTO_REFRESH_COUNTDOWN_TICK_MS = 1_000;
const TIMED_ACTIVITY_COUNTDOWN_TICK_MS = 1_000;
const TIMED_ACTIVITY_BUSY_RETRY_DELAY_MS = 15_000;
const FEED_SCROLL_TOP_GAP = 8;

type AutoRefreshCountdownSchedule = {
  dueAt: number;
  intervalMinutes: FriendStatusAutoRefreshIntervalMinutes;
};

const activityKindOptions: Array<FilterOption<ActivityKindFilter>> = [
  { value: "all", label: "全部", icon: <Sparkles size={15} aria-hidden="true" /> },
  { value: "topic", label: "话题", icon: kindIcon("topic"), tone: "topic" },
  { value: "reply", label: "回复", icon: kindIcon("reply"), tone: "reply" },
  { value: "boost", label: "Boost", icon: kindIcon("boost"), tone: "boost" },
  { value: "reaction", label: "回应", icon: kindIcon("reaction"), tone: "reaction" }
];

function scrollTargetBelowSticky(target: HTMLElement) {
  const stickyHeight = stickyTopHeightFor(target);
  const scrollContainer = findScrollContainer(target);
  const targetRect = target.getBoundingClientRect();

  if (scrollContainer) {
    const containerRect = scrollContainer.getBoundingClientRect();
    scrollContainer.scrollTo({
      top: Math.max(0, scrollContainer.scrollTop + targetRect.top - containerRect.top - stickyHeight - FEED_SCROLL_TOP_GAP),
      behavior: "smooth"
    });
    return;
  }

  window.scrollTo({
    top: Math.max(0, window.scrollY + targetRect.top - stickyHeight - FEED_SCROLL_TOP_GAP),
    behavior: "smooth"
  });
}

function stickyTopHeightFor(target: HTMLElement) {
  const root = target.getRootNode();
  const sticky =
    root instanceof Document || root instanceof ShadowRoot
      ? root.querySelector<HTMLElement>(".sticky-top")
      : document.querySelector<HTMLElement>(".sticky-top");
  return sticky?.getBoundingClientRect().height ?? 0;
}

function findScrollContainer(target: HTMLElement) {
  for (let parent = target.parentElement; parent; parent = parent.parentElement) {
    const { overflowY } = window.getComputedStyle(parent);
    if ((overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") && parent.scrollHeight > parent.clientHeight) {
      return parent;
    }
  }
  return null;
}

export function FriendsApp({ surface = "side-panel" }: { surface?: AppSurface }) {
  const [state] = useAtom(appStateAtom);
  const [loading] = useAtom(loadingAtom);
  const [status] = useAtom(statusMessageAtom);
  const [siteDataProgress] = useAtom(siteDataProgressAtom);
  const [pageScriptStatus] = useAtom(pageScriptStatusAtom);
  const [updateCheck] = useAtom(updateCheckAtom);
  const [cloudArchiveLocalState] = useAtom(cloudArchiveLocalStateAtom);
  const [autoRefreshSession] = useAtom(autoRefreshSessionAtom);
  const [timedActivityRefreshSession] = useAtom(timedActivityRefreshSessionAtom);
  const [uiScene] = useAtom(uiSceneAtom);
  const checkForUpdates = useSetAtom(checkForUpdatesAtom);
  const claimAutoRefreshController = useSetAtom(claimAutoRefreshControllerAtom);
  const claimTimedActivityRefreshController = useSetAtom(claimTimedActivityRefreshControllerAtom);
  const loadAutoRefreshSession = useSetAtom(loadAutoRefreshSessionAtom);
  const loadTimedActivityRefreshSession = useSetAtom(loadTimedActivityRefreshSessionAtom);
  const loadCloudArchiveLocalState = useSetAtom(loadCloudArchiveLocalStateAtom);
  const loadState = useSetAtom(loadStateAtom);
  const loadPageScriptStatus = useSetAtom(loadPageScriptStatusAtom);
  const loadSiteDataProgress = useSetAtom(loadSiteDataProgressAtom);
  const loadUpdateCheck = useSetAtom(loadUpdateCheckAtom);
  const loadUiScene = useSetAtom(loadUiSceneAtom);
  const lookupFriendProfile = useSetAtom(lookupFriendProfileAtom);
  const markLaoFindsItemRead = useSetAtom(markLaoFindsItemReadAtom);
  const observeAppState = useSetAtom(observeAppStateAtom);
  const observePageScriptStatus = useSetAtom(observePageScriptStatusAtom);
  const observeSiteDataProgress = useSetAtom(observeSiteDataProgressAtom);
  const observeUpdateCheck = useSetAtom(observeUpdateCheckAtom);
  const observeAutoRefreshSession = useSetAtom(observeAutoRefreshSessionAtom);
  const observeTimedActivityRefreshSession = useSetAtom(observeTimedActivityRefreshSessionAtom);
  const observeUiScene = useSetAtom(observeUiSceneAtom);
  const addFriendFromKnownUser = useSetAtom(addFriendFromKnownUserAtom);
  const cacheAvatars = useSetAtom(cacheAvatarsAtom);
  const identifyCurrentAccount = useSetAtom(identifyCurrentAccountAtom);
  const openLinuxDoHome = useSetAtom(openLinuxDoHomeAtom);
  const openActivityLink = useSetAtom(openActivityLinkAtom);
  const openOptionsPage = useSetAtom(openOptionsPageAtom);
  const openSidePanel = useSetAtom(openSidePanelAtom);
  const refreshFriendProfiles = useSetAtom(refreshFriendProfilesAtom);
  const refreshFriendActivity = useSetAtom(refreshFriendActivityAtom);
  const refreshFriendActivityForTimedRun = useSetAtom(refreshFriendActivityForTimedRunAtom);
  const repairLinuxDoPageScript = useSetAtom(repairLinuxDoPageScriptAtom);
  const removeFriend = useSetAtom(removeFriendAtom);
  const registerAutoRefreshSurface = useSetAtom(registerAutoRefreshSurfaceAtom);
  const registerTimedActivityRefreshSurface = useSetAtom(registerTimedActivityRefreshSurfaceAtom);
  const recordAutoRefreshFinished = useSetAtom(recordAutoRefreshFinishedAtom);
  const syncFollows = useSetAtom(syncFollowsAtom);
  const clearStatus = useSetAtom(clearStatusMessageAtom);
  const unregisterAutoRefreshSurface = useSetAtom(unregisterAutoRefreshSurfaceAtom);
  const unregisterTimedActivityRefreshSurface = useSetAtom(unregisterTimedActivityRefreshSurfaceAtom);
  const patchTimedActivityRefreshSession = useSetAtom(patchTimedActivityRefreshSessionAtom);
  const updateSettings = useSetAtom(updateSettingsAtom);
  const updateAutoRefreshEnabled = useSetAtom(updateAutoRefreshEnabledAtom);
  const updateAutoRefreshInterval = useSetAtom(updateAutoRefreshIntervalAtom);
  const updateUiScene = useSetAtom(updateUiSceneAtom);
  const archiveLaoFindsItem = useSetAtom(archiveLaoFindsItemAtom);
  const [appStateLoaded, setAppStateLoaded] = useState(false);
  const [siteDataProgressLoaded, setSiteDataProgressLoaded] = useState(false);
  const [accountDetecting, setAccountDetecting] = useState(false);
  const [relativeNow, setRelativeNow] = useState(() => Date.now());
  const [progressNow, setProgressNow] = useState(() => Date.now());
  const surfaceIdRef = useRef(`${surface}:${Date.now()}:${Math.random().toString(36).slice(2)}`);
  const feedTopRef = useRef<HTMLElement>(null);
  const { tab, feedKindFilter: kindFilter, feedUserFilter: userFilter, addFriendModalOpen: modalOpen } = uiScene;

  useEffect(() => {
    void loadUiScene();
    void loadState().finally(() => setAppStateLoaded(true));
    void loadPageScriptStatus();
    void loadSiteDataProgress().finally(() => setSiteDataProgressLoaded(true));
    void loadUpdateCheck();
    void loadAutoRefreshSession();
    void loadTimedActivityRefreshSession();
    void checkForUpdates();
    const cleanupAppState = observeAppState();
    const cleanupUiScene = observeUiScene();
    const cleanupPageScriptStatus = observePageScriptStatus();
    const cleanupSiteDataProgress = observeSiteDataProgress();
    const cleanupUpdateCheck = observeUpdateCheck();
    const cleanupAutoRefreshSession = observeAutoRefreshSession();
    const cleanupTimedActivityRefreshSession = observeTimedActivityRefreshSession();
    return () => {
      cleanupAppState?.();
      cleanupUiScene?.();
      cleanupPageScriptStatus?.();
      cleanupSiteDataProgress?.();
      cleanupUpdateCheck?.();
      cleanupAutoRefreshSession?.();
      cleanupTimedActivityRefreshSession?.();
    };
  }, [
    checkForUpdates,
    loadAutoRefreshSession,
    loadTimedActivityRefreshSession,
    loadPageScriptStatus,
    loadSiteDataProgress,
    loadState,
    loadUpdateCheck,
    loadUiScene,
    observeAppState,
    observePageScriptStatus,
    observeSiteDataProgress,
    observeUpdateCheck,
    observeAutoRefreshSession,
    observeTimedActivityRefreshSession,
    observeUiScene
  ]);

  useEffect(() => {
    const surfaceId = surfaceIdRef.current;
    void registerAutoRefreshSurface({ surfaceId, surface });
    const heartbeat = window.setInterval(() => {
      void registerAutoRefreshSurface({ surfaceId, surface });
    }, AUTO_REFRESH_HEARTBEAT_MS);
    return () => {
      window.clearInterval(heartbeat);
      void unregisterAutoRefreshSurface(surfaceId);
    };
  }, [registerAutoRefreshSurface, surface, unregisterAutoRefreshSurface]);

  useEffect(() => {
    if (surface !== "side-panel") return;
    const surfaceId = surfaceIdRef.current;
    void registerTimedActivityRefreshSurface(surfaceId);
    const heartbeat = window.setInterval(() => {
      void registerTimedActivityRefreshSurface(surfaceId);
    }, TIMED_ACTIVITY_HEARTBEAT_MS);
    return () => {
      window.clearInterval(heartbeat);
      void unregisterTimedActivityRefreshSurface(surfaceId);
    };
  }, [registerTimedActivityRefreshSurface, surface, unregisterTimedActivityRefreshSurface]);

  useEffect(() => {
    if (!appStateLoaded || state.currentAccount) return;
    void identifyCurrentAccount(true);
  }, [appStateLoaded, identifyCurrentAccount, state.currentAccount]);

  useEffect(() => {
    if (!appStateLoaded) return;
    void loadCloudArchiveLocalState();
  }, [appStateLoaded, loadCloudArchiveLocalState, state.dredgeRules, state.friends, state.settings]);

  useEffect(() => {
    if (!appStateLoaded || typeof chrome === "undefined" || !chrome.storage?.onChanged) return undefined;
    const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== "local" || !changes[CLOUD_AUTH_STORAGE_KEY]) return;
      void loadCloudArchiveLocalState();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => {
      chrome.storage.onChanged.removeListener?.(listener);
    };
  }, [appStateLoaded, loadCloudArchiveLocalState]);

  useEffect(() => {
    const interval = window.setInterval(() => setRelativeNow(Date.now()), RELATIVE_TIME_TICK_MS);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (siteDataProgress?.status !== "running") {
      setProgressNow(Date.now());
      return undefined;
    }
    const updatedAt = Date.parse(siteDataProgress.updatedAt);
    if (!Number.isFinite(updatedAt)) {
      setProgressNow(Date.now());
      return undefined;
    }
    const expiresIn = updatedAt + SITE_DATA_PROGRESS_RUNNING_TTL_MS - Date.now() + 250;
    if (expiresIn <= 0) {
      setProgressNow(Date.now());
      return undefined;
    }
    const timer = window.setTimeout(() => setProgressNow(Date.now()), expiresIn);
    return () => window.clearTimeout(timer);
  }, [siteDataProgress]);

  const friends = useMemo(() => deriveFriendList(state), [state]);
  const followedCandidates = useMemo(() => deriveFollowedCandidates(state), [state]);
  const feedUserOptions = useMemo(() => deriveFeedUserOptions(state), [state]);
  const feedItems = useMemo(() => deriveFeedItems(state, { kind: kindFilter, username: userFilter }), [kindFilter, state, userFilter]);
  const feedEntries = useMemo(() => deriveFeedRenderEntries(state, { kind: kindFilter, username: userFilter }), [kindFilter, state, userFilter]);
  const laoFindsItems = useMemo(() => deriveLaoFindsItems(state), [state]);
  const activityRefreshScope = useMemo(() => deriveActivityRefreshScope({ kind: kindFilter, username: userFilter }), [kindFilter, userFilter]);
  const activityRequestCounts = useMemo(() => deriveActivityRequestCounts(state, userFilter), [state, userFilter]);
  const activityFreshness = useMemo(() => deriveActivityFreshness(state, activityRefreshScope), [activityRefreshScope, state]);
  const profileFreshness = useMemo(() => deriveProfileFreshness(friends), [friends]);
  const visibleSiteDataProgress = useMemo(
    () => (isStaleRunningSiteDataProgress(siteDataProgress, progressNow) ? null : siteDataProgress),
    [progressNow, siteDataProgress]
  );
  const siteDataTaskRunning = visibleSiteDataProgress?.status === "running";
  const refreshDisabled = loading || siteDataTaskRunning || friends.length === 0;
  const timedActivityAutoRunEnabledRef = useRef(false);
  useEffect(() => {
    timedActivityAutoRunEnabledRef.current = appStateLoaded && surface === "side-panel" && state.settings.timedActivityRefreshEnabled;
  }, [appStateLoaded, state.settings.timedActivityRefreshEnabled, surface]);
  useFriendStatusAutoRefresh({
    autoRefreshSession,
    claimController: claimAutoRefreshController,
    friendsCount: friends.length,
    progress: visibleSiteDataProgress,
    progressLoaded: siteDataProgressLoaded,
    recordFinished: recordAutoRefreshFinished,
    refresh: refreshFriendProfiles,
    surfaceId: surfaceIdRef.current
  });
  const timedActivityRefresh = useTimedActivityRefresh({
    appStateLoaded,
    claimController: claimTimedActivityRefreshController,
    patchSession: patchTimedActivityRefreshSession,
    progress: visibleSiteDataProgress,
    progressLoaded: siteDataProgressLoaded,
    refresh: refreshFriendActivityForTimedRun,
    session: timedActivityRefreshSession,
    state,
    surface,
    autoRunEnabledRef: timedActivityAutoRunEnabledRef,
    surfaceId: surfaceIdRef.current
  });

  useEffect(() => {
    if (!appStateLoaded) return;
    if (userFilter === "all" || state.friends[userFilter]) return;
    void updateUiScene({ feedUserFilter: "all" });
  }, [appStateLoaded, state.friends, updateUiScene, userFilter]);

  useEffect(() => {
    if (surface !== "side-panel") return;
    const avatarUsernames = new Set([
      ...Object.keys(state.friends),
      ...Object.keys(state.followedUsers),
      ...Object.keys(state.friendProfiles)
    ]);
    const missingCachedAvatars = [...avatarUsernames].filter((username) => {
      const sourceUrl = state.friendProfiles[username]?.avatarUrl || state.followedUsers[username]?.avatarUrl;
      return sourceUrl && !state.avatarCache[username];
    });
    if (missingCachedAvatars.length === 0) return;
    void cacheAvatars(missingCachedAvatars);
  }, [cacheAvatars, state.avatarCache, state.followedUsers, state.friendProfiles, state.friends, surface]);

  function jumpToUserFeed(username: Username) {
    void updateUiScene({ feedUserFilter: username, tab: "feed" });
    clearStatus();
    void refreshVisibleFeedActivity({ kind: kindFilter, usernames: [username] });
  }

  async function refreshVisibleFeedActivity(scope: ActivityRefreshScope) {
    await timedActivityRefresh.suppressPending();
    await refreshFriendActivity(scope);
  }

  function scrollFeedToTop() {
    if (feedTopRef.current) {
      scrollTargetBelowSticky(feedTopRef.current);
    }
  }

  function scheduleFeedScrollToTop() {
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => scrollFeedToTop());
      return;
    }
    window.setTimeout(scrollFeedToTop, 0);
  }

  function changeTab(nextTab: typeof uiScene.tab) {
    void updateUiScene({ tab: nextTab });
    clearStatus();
    if (nextTab === "feed" || nextTab === "finds") {
      scheduleFeedScrollToTop();
    }
  }

  function openDredgeRules() {
    void updateUiScene({ addFriendModalOpen: false });
    clearStatus();
    void openOptionsPage("#lao-finds");
  }

  async function handleManualIdentifyCurrentAccount() {
    setAccountDetecting(true);
    try {
      await identifyCurrentAccount(false);
    } finally {
      setAccountDetecting(false);
    }
  }

  function handleActivityLinkClick(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
    if (!state.settings.openActivityLinksInPage || !shouldHandleActivityLinkClick(event) || !isLinuxDoActivityHref(href)) return;
    event.preventDefault();
    void openActivityLink(href);
  }

  const statusAction = status ? repairActionForStatus(status, repairLinuxDoPageScript, openLinuxDoHome) : null;

  return (
    <AvatarImageContext.Provider value={surface === "in-page"}>
      <main className={`shell shell-${surface}`}>
        <div className="sticky-top">
          <header className="header">
            <div className="header-brand">
              <p className="eyebrow">LinuxDo Friends</p>
              <h1>佬朋友</h1>
              <VersionBadge state={updateCheck} />
            </div>
            <div className="header-status">
              <div className="header-actions">
                {surface === "in-page" ? (
                  <SidePanelLauncherButton status={pageScriptStatus} onOpen={() => void openSidePanel()} />
                ) : (
                  <PageScriptStatusBadge status={pageScriptStatus} />
                )}
                <OptionsPageButton onOpen={() => void openOptionsPage()} />
              </div>
              <div className="header-account-row">
                <AccountDetectTag
                  detecting={accountDetecting}
                  username={state.currentAccount?.username}
                  onDetect={() => void handleManualIdentifyCurrentAccount()}
                />
                <CloudArchiveTag state={cloudArchiveLocalState} onOpen={() => void openOptionsPage("#cloud-backup")} />
              </div>
              {surface === "side-panel" ? (
                <div className="header-operation-row">
                  <TimedActivityRefreshControl
                    disabled={siteDataTaskRunning}
                    now={relativeNow}
                    onManualRefresh={() => void timedActivityRefresh.runNow()}
                    onOpenSettings={() => void openOptionsPage("#lao-finds")}
                    onToggle={(enabled) => {
                      timedActivityAutoRunEnabledRef.current = enabled;
                      void updateSettings({ timedActivityRefreshEnabled: enabled });
                    }}
                    progress={visibleSiteDataProgress}
                    session={timedActivityRefreshSession}
                    settings={state.settings}
                  />
                </div>
              ) : null}
            </div>
          </header>

          <section className="tab-bar" aria-label="视图切换">
            <nav className="tabs" aria-label="视图切换">
              <button className={tab === "friends" ? "active" : ""} onClick={() => changeTab("friends")} type="button">
                佬相好
              </button>
              <button className={tab === "feed" ? "active" : ""} onClick={() => changeTab("feed")} type="button">
                佬友圈
              </button>
              <button className={tab === "finds" ? "active" : ""} onClick={() => changeTab("finds")} type="button">
                佬有料
              </button>
            </nav>
          </section>

          {status && !modalOpen ? (
            <div className="status" role="status">
              <span>{status}</span>
              {statusAction ? (
                <button className="status-action" type="button" onClick={statusAction.onClick}>
                  {statusAction.label}
                </button>
              ) : null}
              <button className="status-close" type="button" onClick={() => clearStatus()} aria-label="关闭消息">
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          ) : null}
        </div>

      {tab === "friends" ? (
        <FriendListTab
          friends={friends}
          loading={loading}
          now={relativeNow}
          onJumpToFeed={jumpToUserFeed}
          onOpenModal={() => void updateUiScene({ addFriendModalOpen: true })}
          onRefresh={() => void refreshFriendProfiles()}
          onAutoRefreshEnabledChange={(enabled) => void updateAutoRefreshEnabled(enabled)}
          onAutoRefreshIntervalChange={(interval) => void updateAutoRefreshInterval(interval)}
          progress={visibleSiteDataProgress}
          profileFreshness={profileFreshness}
          refreshDisabled={refreshDisabled}
          autoRefresh={autoRefreshSession}
        />
      ) : tab === "feed" ? (
        <FeedTab
          activityFreshness={activityFreshness}
          friendsCount={friends.length}
          feedEntries={feedEntries}
          feedItemsCount={feedItems.length}
          feedTopRef={feedTopRef}
          kindFilter={kindFilter}
          now={relativeNow}
          onRefresh={() => void refreshVisibleFeedActivity(activityRefreshScope)}
          onKindFilterChange={(value) => void updateUiScene({ feedKindFilter: value })}
          onOpenActivityLink={handleActivityLinkClick}
          onUserFilterChange={(value) => void updateUiScene({ feedUserFilter: value })}
          onActivityKindPopoverChange={(activityKindPopover) => void updateUiScene({ activityKindPopover })}
          onFeedUserPopoverChange={(feedUserPopover) => void updateUiScene({ feedUserPopover })}
          progress={visibleSiteDataProgress}
          requestCounts={activityRequestCounts}
          refreshDisabled={refreshDisabled}
          scope={activityRefreshScope}
          state={state}
          uiScene={uiScene}
          userFilter={userFilter}
          userOptions={feedUserOptions}
        />
      ) : (
        <LaoFindsTab
          feedTopRef={feedTopRef}
          items={laoFindsItems}
          now={relativeNow}
          onArchive={(id, archived) => void archiveLaoFindsItem(id, archived)}
          onMarkRead={(id, read) => void markLaoFindsItemRead(id, read)}
          onManualRefresh={() => void timedActivityRefresh.runNow()}
          onOpenActivityLink={handleActivityLinkClick}
          onOpenRules={() => void openOptionsPage("#lao-finds")}
          refreshDisabled={refreshDisabled}
          state={state}
        />
      )}

      {modalOpen ? (
        <AddFriendModal
          candidates={followedCandidates}
          currentAccount={state.currentAccount?.username}
          friends={friends}
          loading={loading}
          query={uiScene.addFriendQuery}
          onAdd={(target, profile) => void addFriendFromKnownUser(target, profile)}
          onClose={() => void updateUiScene({ addFriendModalOpen: false })}
          onQueryChange={(query) => void updateUiScene({ addFriendQuery: query })}
          onLookup={(target) => lookupFriendProfile(target)}
          onOpenLinuxDoHome={() => void openLinuxDoHome()}
          onOpenDredgeRules={openDredgeRules}
          onRepairPageScript={() => void repairLinuxDoPageScript()}
          onRemove={(target) => void removeFriend(target)}
          onSync={() => void syncFollows()}
          status={status}
        />
      ) : null}
      </main>
    </AvatarImageContext.Provider>
  );
}

function FriendListTab({
  autoRefresh,
  friends,
  loading,
  now,
  onAutoRefreshEnabledChange,
  onAutoRefreshIntervalChange,
  onJumpToFeed,
  onOpenModal,
  onRefresh,
  progress,
  profileFreshness,
  refreshDisabled
}: {
  autoRefresh: FriendStatusAutoRefreshSession;
  friends: ReturnType<typeof deriveFriendList>;
  loading: boolean;
  now: number;
  onAutoRefreshEnabledChange: (enabled: boolean) => void;
  onAutoRefreshIntervalChange: (interval: FriendStatusAutoRefreshIntervalMinutes) => void;
  onJumpToFeed: (username: Username) => void;
  onOpenModal: () => void;
  onRefresh: () => void;
  progress: SiteDataTaskProgress | null;
  profileFreshness: { label: string; refreshedAt?: string };
  refreshDisabled: boolean;
}) {
  const profileProgress = progress?.taskType === "profiles" ? progress : null;
  const countdown = deriveAutoRefreshCountdown(autoRefresh, now, friends.length > 0);
  return (
    <section>
      <div className="tab-action-row">
        <SplitRefreshButton
          autoRefresh={autoRefresh}
          disabled={refreshDisabled}
          freshness={profileFreshness}
          idleLabel="刷新状态"
          now={now}
          onAutoRefreshEnabledChange={onAutoRefreshEnabledChange}
          onAutoRefreshIntervalChange={onAutoRefreshIntervalChange}
          onRefresh={onRefresh}
          progress={profileProgress}
          progressMatches
          scheduledMeta={countdown}
          warning="自动刷新会按间隔请求所有佬相好状态；遇到验证、限流或正在刷新会跳过。"
        />
        <button className="manage-button" onClick={onOpenModal} disabled={loading} type="button">
          管理
        </button>
      </div>
      {friends.length === 0 ? (
        <p className="empty">还没有佬朋友。可以手动添加用户名，或从已关注列表里快速添加。</p>
      ) : (
        <div className="list">
          {friends.map(({ friend, identity, latestStatus }) => (
            <article className="friend-split-card" key={friend.username}>
              <a className="friend-main-button" href={profileUrl(friend.username)} target="_blank" rel="noreferrer">
                <UserIdentityRow identity={identity} />
                <div className="latest-status">
                  <span>{latestStatus.label}</span>
                  <small>{formatRelativeTime(latestStatus.at, now)}</small>
                </div>
                {friend.note ? <p className="friend-note">{friend.note}</p> : null}
              </a>
              <button
                className="friend-arrow-button"
                type="button"
                disabled={friend.activityKinds.length === 0}
                onClick={() => onJumpToFeed(friend.username)}
                aria-label={
                  friend.activityKinds.length === 0 ? `@${friend.username} 未选择动态范围` : `查看 @${friend.username} 的朋友圈动态`
                }
                title={friend.activityKinds.length === 0 ? "未选择动态范围" : "筛选朋友圈"}
              >
                ›
              </button>
            </article>
          ))}
        </div>
      )}
      {friends.length > 0 ? <p className="friend-count-footer">共 {friends.length} 位佬朋友</p> : null}
      <div className="tab-bottom-spacer" aria-hidden="true" />
    </section>
  );
}

function FeedTab({
  activityFreshness,
  feedTopRef,
  friendsCount,
  feedEntries,
  feedItemsCount,
  kindFilter,
  now,
  onRefresh,
  onActivityKindPopoverChange,
  onFeedUserPopoverChange,
  onKindFilterChange,
  onOpenActivityLink,
  onUserFilterChange,
  progress,
  refreshDisabled,
  requestCounts,
  scope,
  state,
  uiScene,
  userFilter,
  userOptions
}: {
  activityFreshness: { label: string; refreshedAt?: string };
  feedTopRef: React.RefObject<HTMLElement | null>;
  friendsCount: number;
  feedEntries: ReturnType<typeof deriveFeedRenderEntries>;
  feedItemsCount: number;
  kindFilter: ActivityKindFilter;
  now: number;
  onRefresh: () => void;
  onActivityKindPopoverChange: (scene: { open?: boolean; query?: string }) => void;
  onFeedUserPopoverChange: (scene: { open?: boolean; query?: string }) => void;
  onKindFilterChange: (value: ActivityKindFilter) => void;
  onOpenActivityLink: (event: React.MouseEvent<HTMLAnchorElement>, href: string) => void;
  onUserFilterChange: (value: "all" | Username) => void;
  progress: SiteDataTaskProgress | null;
  refreshDisabled: boolean;
  requestCounts: Record<ActivityKindFilter, number>;
  scope: ActivityRefreshScope;
  state: Parameters<typeof identityForActivityItem>[0];
  uiScene: UiSceneState;
  userFilter: "all" | Username;
  userOptions: UserIdentityView[];
}) {
  const activityProgress = progress?.taskType === "activity" ? progress : null;
  const selectedIdentity = userFilter === "all" ? undefined : identityForUsername(state, userFilter);
  const userFilterOptions = useMemo<Array<FilterOption<"all" | Username>>>(
    () => [
      { value: "all", label: "全部", meta: userOptions.length, searchText: "全部 全部佬朋友" },
      ...userOptions.map((identity) => ({
        value: identity.username,
        label: identity.primary,
        content: <UserIdentityRow identity={identity} compact />,
        searchText: `${identity.primary} ${identity.username}`
      }))
    ],
    [userOptions]
  );
  const activityOptions = useMemo(
    () =>
      activityKindOptions.map((option) => ({
        ...option,
        meta: requestCounts[option.value]
      })),
    [requestCounts]
  );
  function scrollFeedToTop() {
    if (feedTopRef.current) {
      scrollTargetBelowSticky(feedTopRef.current);
    }
  }

  return (
    <section ref={feedTopRef}>
      <div className="tab-action-row">
        <button className="refresh-button refresh-button-with-meta feed-refresh-button" onClick={onRefresh} disabled={refreshDisabled} type="button">
          <RefreshButtonContent
            idleLabel="刷新动态"
            idleMetaMode="freshness"
            now={now}
            progress={activityProgress}
            progressMatches={Boolean(activityProgress && sameScope(activityProgress.scope, scope))}
            freshness={activityFreshness}
          />
        </button>
      </div>
      <div className="filters">
        <FilterPopover
          label="类型"
          onChange={onKindFilterChange}
          onOpenChange={(open) => onActivityKindPopoverChange({ open })}
          onQueryChange={(query) => onActivityKindPopoverChange({ query })}
          open={uiScene.activityKindPopover.open}
          options={activityOptions}
          query={uiScene.activityKindPopover.query}
          variant="kind"
          value={kindFilter}
        />
        <FilterPopover
          label="用户"
          onChange={onUserFilterChange}
          onOpenChange={(open) => onFeedUserPopoverChange({ open })}
          onQueryChange={(query) => onFeedUserPopoverChange({ query })}
          open={uiScene.feedUserPopover.open}
          options={userFilterOptions}
          query={uiScene.feedUserPopover.query}
          selectedContent={selectedIdentity ? <UserIdentityRow identity={selectedIdentity} compact /> : undefined}
          variant="user"
          value={userFilter}
        />
      </div>

      {friendsCount === 0 ? (
        <p className="empty">还没有佬朋友，朋友圈暂时空着。</p>
      ) : feedItemsCount === 0 ? (
        <p className="empty">暂无匹配动态。可以刷新动态，或换个筛选条件。</p>
      ) : (
        <div className="list">
          {feedEntries.map((entry) =>
            entry.type === "waterline" ? (
              <FeedWaterline key={entry.id} onBackToTop={scrollFeedToTop} />
            ) : (
              <FeedActivityCard item={entry.item} key={entry.item.id} now={now} onOpenActivityLink={onOpenActivityLink} state={state} />
            )
          )}
        </div>
      )}
      <div className="tab-bottom-spacer" aria-hidden="true" />
    </section>
  );
}

function LaoFindsTab({
  feedTopRef,
  items,
  now,
  onArchive,
  onMarkRead,
  onManualRefresh,
  onOpenActivityLink,
  onOpenRules,
  refreshDisabled,
  state
}: {
  feedTopRef: React.RefObject<HTMLElement | null>;
  items: ReturnType<typeof deriveLaoFindsItems>;
  now: number;
  onArchive: (id: string, archived: boolean) => void;
  onMarkRead: (id: string, read: boolean) => void;
  onManualRefresh: () => void;
  onOpenActivityLink: (event: React.MouseEvent<HTMLAnchorElement>, href: string) => void;
  onOpenRules: () => void;
  refreshDisabled: boolean;
  state: Parameters<typeof identityForActivityItem>[0];
}) {
  return (
    <section ref={feedTopRef}>
      <div className="finds-layout">
        <section className="finds-section">
          <div className="finds-section-head">
            <div>
              <h2 className="finds-title-with-icon">
                <Telescope size={16} aria-hidden="true" />
                <span>佬有料</span>
              </h2>
            </div>
            <div className="finds-section-actions">
              <span className="badge">共 {items.length} 条</span>
              <button className="small-action primary-action" type="button" onClick={onManualRefresh} disabled={refreshDisabled}>
                <Telescope size={14} aria-hidden="true" />
                <span>手动打捞</span>
              </button>
              <button className="small-action" type="button" onClick={onOpenRules}>
                配置打捞规则
              </button>
            </div>
          </div>
          {items.length === 0 ? (
            <p className="empty finds-empty">
              暂时没有佬料。先到设置页新建打捞规则，然后手动刷新佬友圈或开启自动捞料。
            </p>
          ) : (
            <div className="list">
              {items.map(({ item, identity, matchedRules }) => (
                <article className={`finds-card${item.readAt ? " is-read" : ""}`} key={item.id}>
                  <div className="finds-card-head">
                    <UserIdentityRow identity={identity} compact />
                    <div className="finds-card-meta">
                      <time dateTime={item.collectedAt}>{formatRelativeTime(item.collectedAt, now)}打捞</time>
                      {!item.readAt ? <span className="new-dot" aria-label="未读" /> : null}
                    </div>
                  </div>
                  <ActivityCardBody item={item.activity} onOpenActivityLink={onOpenActivityLink} />
                  <div className="finds-card-foot">
                    <span title={matchedRules.map((rule) => rule.name).join("、")}>
                      {matchedRules.length ? `命中 ${matchedRules.map((rule) => rule.name).join("、")}` : "规则已删除"}
                    </span>
                    <div className="finds-card-actions">
                      <button type="button" onClick={() => onMarkRead(item.id, !item.readAt)}>
                        {item.readAt ? "标为未读" : "标为已读"}
                      </button>
                      <button type="button" onClick={() => onArchive(item.id, true)}>
                        归档
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
      <div className="tab-bottom-spacer" aria-hidden="true" />
    </section>
  );
}

function TimedActivityRefreshControl({
  disabled,
  now,
  onManualRefresh,
  onOpenSettings,
  onToggle,
  progress,
  session,
  settings
}: {
  disabled: boolean;
  now: number;
  onManualRefresh: () => void;
  onOpenSettings: () => void;
  onToggle: (enabled: boolean) => void;
  progress: SiteDataTaskProgress | null;
  session: TimedActivityRefreshSession;
  settings: AppState["settings"];
}) {
  const [open, setOpen] = useState(false);
  const [countdownNow, setCountdownNow] = useState(now);
  const menuRef = useRef<HTMLElement>(null);
  const runningProgress = progress?.taskType === "activity" && progress.status === "running" ? progress : null;
  const model = deriveTimedActivityRefreshControlModel({ now: countdownNow, progress: runningProgress, session, settings });
  const nextEnabled = settings.timedActivityRefreshEnabled && !session.pausedReason ? false : true;
  const toggleLabel = nextEnabled ? "开启自动捞料" : "关闭自动捞料";

  useEffect(() => {
    setCountdownNow(now);
  }, [now]);

  useEffect(() => {
    if (!model.countdownActive) return;
    const timer = window.setTimeout(() => setCountdownNow(Date.now()), TIMED_ACTIVITY_COUNTDOWN_TICK_MS);
    return () => window.clearTimeout(timer);
  }, [countdownNow, model.countdownActive]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (menuRef.current && !eventHappenedInside(event, menuRef.current)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <section className={`timed-refresh-control timed-refresh-${model.tone}`} aria-label="自动捞料状态" ref={menuRef}>
      <button className="timed-refresh-main" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className="timed-refresh-icon" aria-hidden="true">
          {model.spinning ? <LoaderCircle className="spin-icon" size={15} /> : <Telescope className={model.blinking ? "timed-refresh-pulse-icon" : undefined} size={15} />}
        </span>
        <span className="timed-refresh-copy" title={model.copy}>
          {model.copy}
        </span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open ? (
        <div className="refresh-menu timed-refresh-menu">
          <button
            className={`refresh-menu-option${settings.timedActivityRefreshEnabled && !session.pausedReason ? " is-selected" : ""}`}
            type="button"
            aria-pressed={settings.timedActivityRefreshEnabled && !session.pausedReason}
            onClick={() => {
              setOpen(false);
              onToggle(nextEnabled);
            }}
          >
            <span>{toggleLabel}</span>
            <span className="refresh-menu-check" aria-hidden="true">
              {settings.timedActivityRefreshEnabled && !session.pausedReason ? <Check size={16} /> : null}
            </span>
          </button>
          <button
            className="refresh-menu-option"
            type="button"
            disabled={disabled}
            onClick={() => {
              setOpen(false);
              onManualRefresh();
            }}
          >
            <span>手动打捞</span>
            <Telescope size={15} aria-hidden="true" />
          </button>
          <div className="refresh-menu-group">
            <button
              className="refresh-menu-option"
              type="button"
              onClick={() => {
                setOpen(false);
                onOpenSettings();
              }}
            >
              <span>配置打捞规则</span>
              <Settings size={15} aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function deriveTimedActivityRefreshControlModel({
  now,
  progress,
  session,
  settings
}: {
  now: number;
  progress: SiteDataTaskProgress | null;
  session: TimedActivityRefreshSession;
  settings: AppState["settings"];
}) {
  if (!settings.timedActivityRefreshEnabled) {
    return { copy: "未开启", tone: "idle", spinning: false, blinking: false, countdownActive: false };
  }
  if (session.pausedReason) {
    return { copy: "已暂停", tone: "paused", spinning: false, blinking: false, countdownActive: false };
  }
  if (progress?.status === "running") {
    return {
      copy: `${progress.currentLabel ?? "自动捞料中"} · ${progress.completed}/${progress.total}`,
      tone: "running",
      spinning: true,
      blinking: false,
      countdownActive: false
    };
  }
  if (session.pendingDue) {
    return { copy: "等待空闲", tone: "waiting", spinning: false, blinking: true, countdownActive: false };
  }
  if (session.noTargetMessage) {
    return { copy: "无规则", tone: "waiting", spinning: false, blinking: false, countdownActive: false };
  }
  const intervalMs = settings.timedActivityRefreshIntervalMinutes * 60_000;
  const dueAt = deriveTimedActivityDueAt(session, intervalMs, now);
  const remainingMs = Math.max(0, dueAt - now);
  return {
    copy: remainingMs <= 0 ? "即将打捞" : `下次打捞 ${formatLongCountdown(remainingMs)}`,
    tone: "waiting",
    spinning: false,
    blinking: true,
    countdownActive: true
  };
}

function SplitRefreshButton({
  autoRefresh,
  disabled,
  freshness,
  idleLabel,
  now,
  onAutoRefreshEnabledChange,
  onAutoRefreshIntervalChange,
  onRefresh,
  progress,
  progressMatches,
  scheduledMeta,
  warning
}: {
  autoRefresh: FriendStatusAutoRefreshSession;
  disabled: boolean;
  freshness: { label: string; refreshedAt?: string };
  idleLabel: string;
  now: number;
  onAutoRefreshEnabledChange: (enabled: boolean) => void;
  onAutoRefreshIntervalChange: (interval: FriendStatusAutoRefreshIntervalMinutes) => void;
  onRefresh: () => void;
  progress: SiteDataTaskProgress | null;
  progressMatches: boolean;
  scheduledMeta?: AutoRefreshCountdownSchedule;
  warning: string;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (menuRef.current && !eventHappenedInside(event, menuRef.current)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="split-refresh" ref={menuRef}>
      <button className="refresh-button refresh-button-with-meta split-refresh-main" onClick={onRefresh} disabled={disabled} type="button">
        <RefreshButtonContent
          idleLabel={idleLabel}
          idleMetaMode="freshness"
          now={now}
          progress={progress}
          progressMatches={progressMatches}
          freshness={freshness}
          scheduledMeta={scheduledMeta}
        />
      </button>
      <button
        className={`split-refresh-toggle${autoRefresh.enabled ? " active" : ""}`}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label="自动刷新设置"
      >
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open ? (
        <div className="refresh-menu">
          <button
            className="refresh-menu-option"
            type="button"
            onClick={() => onAutoRefreshEnabledChange(!autoRefresh.enabled)}
            aria-pressed={autoRefresh.enabled}
          >
            <span>启用自动刷新</span>
            {autoRefresh.enabled ? <Check size={16} aria-hidden="true" /> : null}
          </button>
          <div className="refresh-menu-group" role="radiogroup" aria-label="自动刷新间隔">
            {([1, 10, 30] as const).map((interval) => (
              <button
                className="refresh-menu-option"
                key={interval}
                type="button"
                role="radio"
                aria-checked={autoRefresh.intervalMinutes === interval}
                onClick={() => onAutoRefreshIntervalChange(interval)}
              >
                <span>{interval} 分钟</span>
                {autoRefresh.intervalMinutes === interval ? <Check size={16} aria-hidden="true" /> : null}
              </button>
            ))}
          </div>
          <p className="refresh-menu-warning">{warning}</p>
        </div>
      ) : null}
    </div>
  );
}

function useFriendStatusAutoRefresh({
  autoRefreshSession,
  claimController,
  friendsCount,
  progress,
  progressLoaded,
  recordFinished,
  refresh,
  surfaceId
}: {
  autoRefreshSession: FriendStatusAutoRefreshSession;
  claimController: (surfaceId: string) => Promise<FriendStatusAutoRefreshSession>;
  friendsCount: number;
  progress: SiteDataTaskProgress | null;
  progressLoaded: boolean;
  recordFinished: (finishedAt: string) => Promise<void>;
  refresh: () => Promise<void>;
  surfaceId: string;
}) {
  const refreshInFlightRef = useRef(false);
  const lastFinishedProgressRef = useRef<string | undefined>(undefined);
  const latestProfileFinishedAtRef = useRef<string | undefined>(undefined);
  const skippedDueWhileRunningRef = useRef(false);

  useEffect(() => {
    if (progress?.status === "running" || !progress?.finishedAt) return;
    if (progress.taskType === "profiles") {
      latestProfileFinishedAtRef.current = progress.finishedAt;
    }
    const shouldRecordAnchor = progress.taskType === "profiles" || skippedDueWhileRunningRef.current;
    if (!shouldRecordAnchor) return;
    skippedDueWhileRunningRef.current = false;
    if (lastFinishedProgressRef.current === progress.finishedAt) return;
    lastFinishedProgressRef.current = progress.finishedAt;
    void recordFinished(progress.finishedAt);
  }, [progress, recordFinished]);

  useEffect(() => {
    if (!progressLoaded) return;
    if (!autoRefreshSession.enabled || friendsCount === 0) return;
    if (autoRefreshSession.controllerSurfaceId && autoRefreshSession.controllerSurfaceId !== surfaceId) return;
    let cancelled = false;
    const intervalMs = autoRefreshSession.intervalMinutes * 60_000;
    const anchor = Date.parse(autoRefreshSession.lastFinishedAt ?? autoRefreshSession.enabledAt ?? "");
    const elapsed = Number.isFinite(anchor) ? Date.now() - anchor : intervalMs;
    const delay = Math.max(0, intervalMs - elapsed);
    if (progress?.status === "running") {
      const skipTimer = window.setTimeout(() => {
        if (!cancelled) skippedDueWhileRunningRef.current = true;
      }, delay);
      return () => {
        cancelled = true;
        window.clearTimeout(skipTimer);
      };
    }
    const timer = window.setTimeout(() => {
      void (async () => {
        if (cancelled || refreshInFlightRef.current) return;
        if (progress?.status === "running") return;
        const claimed = await claimController(surfaceId);
        if (cancelled || claimed.controllerSurfaceId !== surfaceId || !claimed.controllerHeartbeatAt) return;
        const startedAt = Date.now();
        refreshInFlightRef.current = true;
        try {
          await refresh();
        } finally {
          refreshInFlightRef.current = false;
          const finishedAt = latestProfileFinishedAtRef.current;
          const finishedTime = finishedAt ? Date.parse(finishedAt) : Number.NaN;
          const fallbackFinishedAt = Number.isFinite(finishedTime) && finishedTime >= startedAt ? finishedAt : undefined;
          const recordedFinishedAt = fallbackFinishedAt ?? new Date().toISOString();
          if (!cancelled && lastFinishedProgressRef.current !== recordedFinishedAt) void recordFinished(recordedFinishedAt);
        }
      })();
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [autoRefreshSession, claimController, friendsCount, progress, progressLoaded, recordFinished, refresh, surfaceId]);
}

function useTimedActivityRefresh({
  appStateLoaded,
  claimController,
  patchSession,
  progress,
  progressLoaded,
  refresh,
  session,
  state,
  surface,
  autoRunEnabledRef,
  surfaceId
}: {
  appStateLoaded: boolean;
  claimController: (surfaceId: string) => Promise<TimedActivityRefreshSession>;
  patchSession: (patch: Partial<TimedActivityRefreshSession>) => Promise<TimedActivityRefreshSession>;
  progress: SiteDataTaskProgress | null;
  progressLoaded: boolean;
  refresh: (scope: ActivityRefreshScope, timedRunId: string) => Promise<BackgroundResponse<AppState> | void>;
  session: TimedActivityRefreshSession;
  state: AppState;
  surface: AppSurface;
  autoRunEnabledRef: React.MutableRefObject<boolean>;
  surfaceId: string;
}) {
  const refreshInFlightRef = useRef(false);
  const pendingDueRef = useRef(false);
  const latestRef = useRef({ progress, session, state });

  useEffect(() => {
    latestRef.current = { progress, session, state };
    if (session.pendingDue) pendingDueRef.current = true;
  }, [progress, session, state]);

  const enabled = appStateLoaded && progressLoaded && surface === "side-panel" && state.settings.timedActivityRefreshEnabled;
  const intervalMinutes = state.settings.timedActivityRefreshIntervalMinutes;
  const scopeMode = state.settings.timedActivityRefreshScopeMode;
  const controllerSurfaceId = session.controllerSurfaceId;
  const pausedReason = session.pausedReason;
  const lastFinishedAt = session.lastFinishedAt;
  const enabledAt = session.enabledAt;
  const nextDueAt = session.nextDueAt;

  useEffect(() => {
    if (!enabled) return;
    if (pausedReason) return;
    if (controllerSurfaceId && controllerSurfaceId !== surfaceId) return;
    if (refreshInFlightRef.current) return;
    const intervalMs = state.settings.timedActivityRefreshIntervalMinutes * 60_000;
    const dueAt = deriveTimedActivityDueAt(latestRef.current.session, intervalMs);
    const delay = Math.max(0, dueAt - Date.now());
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        if (cancelled) return;
        if (!autoRunEnabledRef.current || !latestRef.current.state.settings.timedActivityRefreshEnabled) return;
        const latestIntervalMs = latestRef.current.state.settings.timedActivityRefreshIntervalMinutes * 60_000;
        if (deriveTimedActivityDueAt(latestRef.current.session, latestIntervalMs) > Date.now()) return;
        if (refreshInFlightRef.current || latestRef.current.progress?.status === "running") {
          markTimedActivityPending(pendingDueRef, latestRef.current.session, patchSession);
          return;
        }
        await runTimedActivityRefresh({
          claimController,
          getState: () => latestRef.current.state,
          patchSession,
          refresh,
          shouldRun: () => autoRunEnabledRef.current && latestRef.current.state.settings.timedActivityRefreshEnabled,
          surfaceId,
          refreshInFlightRef
        });
      })();
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    claimController,
    autoRunEnabledRef,
    controllerSurfaceId,
    enabled,
    enabledAt,
    intervalMinutes,
    lastFinishedAt,
    nextDueAt,
    patchSession,
    pausedReason,
    refresh,
    scopeMode,
    surfaceId,
    state.settings.timedActivityRefreshIntervalMinutes
  ]);

  useEffect(() => {
    if (!enabled) return;
    if (pausedReason) return;
    if (controllerSurfaceId && controllerSurfaceId !== surfaceId) return;
    if (!pendingDueRef.current && !session.pendingDue) return;
    if (progress?.status === "running" || refreshInFlightRef.current) return;
    const intervalMs = state.settings.timedActivityRefreshIntervalMinutes * 60_000;
    if (deriveTimedActivityDueAt(latestRef.current.session, intervalMs) > Date.now()) return;
    if (!autoRunEnabledRef.current || !latestRef.current.state.settings.timedActivityRefreshEnabled) return;
    pendingDueRef.current = false;
    void runTimedActivityRefresh({
      claimController,
      getState: () => latestRef.current.state,
      patchSession,
      refresh,
      shouldRun: () => autoRunEnabledRef.current && latestRef.current.state.settings.timedActivityRefreshEnabled,
      surfaceId,
      refreshInFlightRef
    });
  }, [claimController, autoRunEnabledRef, controllerSurfaceId, enabled, patchSession, pausedReason, progress?.status, refresh, session.pendingDue, surfaceId]);

  function runNow() {
    if (surface !== "side-panel") return Promise.resolve();
    if (refreshInFlightRef.current || latestRef.current.progress?.status === "running") return Promise.resolve();
    return runTimedActivityRefresh({
      claimController,
      getState: () => latestRef.current.state,
      patchSession,
      refresh,
      surfaceId,
      refreshInFlightRef
    });
  }

  async function suppressPending() {
    if (!enabled) return;
    const latest = latestRef.current;
    if (latest.session.pausedReason) return;
    const intervalMs = latest.state.settings.timedActivityRefreshIntervalMinutes * 60_000;
    const dueAt = deriveTimedActivityDueAt(latest.session, intervalMs);
    if (!pendingDueRef.current && !latest.session.pendingDue && dueAt > Date.now()) return;
    pendingDueRef.current = false;
    const nextSession = await patchSession({
      nextDueAt: new Date(Date.now() + intervalMs).toISOString(),
      pendingDue: false
    });
    latestRef.current = { ...latestRef.current, session: nextSession };
  }

  return { runNow, suppressPending };
}

async function runTimedActivityRefresh({
  claimController,
  getState,
  patchSession,
  refresh,
  refreshInFlightRef,
  shouldRun,
  surfaceId
}: {
  claimController: (surfaceId: string) => Promise<TimedActivityRefreshSession>;
  getState: () => AppState;
  patchSession: (patch: Partial<TimedActivityRefreshSession>) => Promise<TimedActivityRefreshSession>;
  refresh: (scope: ActivityRefreshScope, timedRunId: string) => Promise<BackgroundResponse<AppState> | void>;
  refreshInFlightRef?: React.MutableRefObject<boolean>;
  shouldRun?: () => boolean;
  surfaceId: string;
}) {
  const localRefreshInFlightRef = refreshInFlightRef ?? { current: false };
  if (localRefreshInFlightRef.current) return;
  if (shouldRun && !shouldRun()) return;
  localRefreshInFlightRef.current = true;
  const claimed = await claimController(surfaceId);
  if (shouldRun && !shouldRun()) {
    await clearTimedActivityControllerLease(patchSession);
    localRefreshInFlightRef.current = false;
    return;
  }
  if (claimed.controllerSurfaceId !== surfaceId || !claimed.controllerHeartbeatAt) {
    localRefreshInFlightRef.current = false;
    return;
  }
  const state = getState();
  if (shouldRun && !shouldRun()) {
    await clearTimedActivityControllerLease(patchSession);
    localRefreshInFlightRef.current = false;
    return;
  }
  const scopes = deriveTimedActivityRefreshScopes(state, state.settings.timedActivityRefreshScopeMode);
  const now = new Date();
  if (scopes.length === 0) {
    const nextDueAt = new Date(now.getTime() + state.settings.timedActivityRefreshIntervalMinutes * 60_000).toISOString();
    await patchSession({
      activeRunId: undefined,
      enabledAt: claimed.enabledAt ?? now.toISOString(),
      lastScopeMode: state.settings.timedActivityRefreshScopeMode,
      noTargetAt: now.toISOString(),
      noTargetMessage: "没有启用规则",
      nextDueAt,
      pendingDue: false,
      pausedReason: undefined,
      pausedMessage: undefined
    });
    localRefreshInFlightRef.current = false;
    return;
  }

  const runId = `timed-activity:${now.getTime()}:${Math.random().toString(36).slice(2)}`;
  await patchSession({
    activeRunId: runId,
    enabledAt: claimed.enabledAt ?? now.toISOString(),
    lastStartedAt: now.toISOString(),
    lastScopeMode: state.settings.timedActivityRefreshScopeMode,
    pendingDue: false,
    pausedReason: undefined,
    pausedMessage: undefined,
    noTargetMessage: undefined
  });
  try {
    for (const scope of scopes) {
      const response = await refresh(scope, runId);
      if (!(await timedRunStillActive(patchSession, runId))) return;
      if (response && !response.ok) {
        if (isBusyRefreshError(response.error)) {
          await patchTimedActivityBusy(patchSession);
          return;
        }
        const reason = isTimedActivityPauseReason(response.reason) ? response.reason : "unavailable";
        await patchTimedActivityFailure(patchSession, response.error, reason);
        return;
      }
      const lastSync = response?.ok ? response.data.lastSync : undefined;
      if (lastSync && !lastSync.ok && isBusyRefreshError(lastSync.message)) {
        await patchTimedActivityBusy(patchSession);
        return;
      }
      if (lastSync && !lastSync.ok && isTimedActivityPauseReason(lastSync.reason)) {
        await patchTimedActivityFailure(patchSession, lastSync.message, lastSync.reason);
        return;
      }
    }
    if (!(await timedRunStillActive(patchSession, runId))) return;
    const finishedAt = new Date().toISOString();
    await patchSession({
      activeRunId: undefined,
      lastFinishedAt: finishedAt,
      nextDueAt: new Date(Date.parse(finishedAt) + state.settings.timedActivityRefreshIntervalMinutes * 60_000).toISOString(),
      pendingDue: false,
      pausedReason: undefined,
      pausedMessage: undefined,
      noTargetMessage: undefined
    });
  } finally {
    localRefreshInFlightRef.current = false;
  }
}

async function clearTimedActivityControllerLease(patchSession: (patch: Partial<TimedActivityRefreshSession>) => Promise<TimedActivityRefreshSession>) {
  await patchSession({
    controllerSurfaceId: undefined,
    controllerClaimedAt: undefined,
    controllerHeartbeatAt: undefined
  });
}

async function timedRunStillActive(patchSession: (patch: Partial<TimedActivityRefreshSession>) => Promise<TimedActivityRefreshSession>, runId: string) {
  const latest = await patchSession({});
  return latest.activeRunId === runId;
}

async function patchTimedActivityFailure(
  patchSession: (patch: Partial<TimedActivityRefreshSession>) => Promise<TimedActivityRefreshSession>,
  message: string,
  reason: TimedActivityRefreshSession["pausedReason"] = "unavailable"
) {
  const failureAt = new Date().toISOString();
  await patchSession({
    activeRunId: undefined,
    lastFailureAt: failureAt,
    pausedReason: reason,
    pausedMessage: message,
    pendingDue: false
  });
}

async function patchTimedActivityBusy(patchSession: (patch: Partial<TimedActivityRefreshSession>) => Promise<TimedActivityRefreshSession>) {
  await patchSession({
    activeRunId: undefined,
    nextDueAt: new Date(Date.now() + TIMED_ACTIVITY_BUSY_RETRY_DELAY_MS).toISOString(),
    pendingDue: true
  });
}

function markTimedActivityPending(
  pendingDueRef: React.MutableRefObject<boolean>,
  session: TimedActivityRefreshSession,
  patchSession: (patch: Partial<TimedActivityRefreshSession>) => Promise<TimedActivityRefreshSession>
) {
  pendingDueRef.current = true;
  if (!session.pendingDue) void patchSession({ pendingDue: true });
}

function deriveTimedActivityDueAt(session: TimedActivityRefreshSession, intervalMs: number, now = Date.now()) {
  const nextDue = parseTimestamp(session.nextDueAt);
  if (session.pendingDue && nextDue !== undefined) return nextDue;
  const lastFinished = parseTimestamp(session.lastFinishedAt);
  if (lastFinished !== undefined) return lastFinished + intervalMs;
  if (nextDue !== undefined) return nextDue;
  const enabledAt = parseTimestamp(session.enabledAt);
  if (enabledAt !== undefined) return enabledAt + intervalMs;
  return now;
}

function parseTimestamp(value: string | undefined) {
  const timestamp = Date.parse(value ?? "");
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function isBusyRefreshError(message: string) {
  return message.includes("已有刷新正在进行");
}

function isTimedActivityPauseReason(reason: unknown): reason is NonNullable<TimedActivityRefreshSession["pausedReason"]> {
  return reason === "challenge" || reason === "blocked" || reason === "rate_limited" || reason === "unavailable" || reason === "network_error";
}

function FeedActivityCard({
  item,
  now,
  onOpenActivityLink,
  state
}: {
  item: ActivityItem;
  now: number;
  onOpenActivityLink: (event: React.MouseEvent<HTMLAnchorElement>, href: string) => void;
  state: Parameters<typeof identityForActivityItem>[0];
}) {
  return (
    <article className="feed-card">
      <div className="feed-head">
        <UserIdentityRow identity={identityForActivityItem(state, item)} compact />
        <div className="feed-time">
          {item.isNew ? <span className="new-dot" aria-label="新动态" /> : null}
          <time dateTime={item.occurredAt}>{formatRelativeTime(item.occurredAt, now)}</time>
        </div>
      </div>
      <ActivityCardBody item={item} onOpenActivityLink={onOpenActivityLink} />
    </article>
  );
}

function FeedWaterline({ onBackToTop }: { onBackToTop: () => void }) {
  return (
    <div className="feed-waterline" role="separator">
      <span>-- 上次更新到此为止，</span>
      <button type="button" onClick={onBackToTop}>
        点我回到顶部
      </button>
      <span> --</span>
    </div>
  );
}

function RefreshButtonContent({
  freshness,
  idleLabel,
  idleMetaMode,
  now,
  progress,
  progressMatches,
  scheduledMeta
}: {
  freshness: { label: string; refreshedAt?: string };
  idleLabel: string;
  idleMetaMode: "hidden" | "freshness";
  now: number;
  progress: SiteDataTaskProgress | null;
  progressMatches: boolean;
  scheduledMeta?: AutoRefreshCountdownSchedule;
}) {
  const [countdownNow, setCountdownNow] = useState(now);
  const visibleProgress = progress && progress.status === "running" && progressMatches ? progress : null;
  const visibleSchedule = !visibleProgress ? scheduledMeta : undefined;
  const renderNow = visibleSchedule ? countdownNow : now;
  useEffect(() => {
    setCountdownNow(now);
  }, [now]);
  useEffect(() => {
    if (!visibleSchedule) return;
    const interval = window.setInterval(() => setCountdownNow(Date.now()), AUTO_REFRESH_COUNTDOWN_TICK_MS);
    return () => window.clearInterval(interval);
  }, [visibleSchedule]);
  const percent = visibleProgress?.total ? Math.round((visibleProgress.completed / visibleProgress.total) * 100) : 0;
  const idleMeta =
    idleMetaMode === "hidden"
      ? ""
      : freshness.refreshedAt
        ? `${formatRelativeTime(freshness.refreshedAt, renderNow)}已刷新`
        : idleLabel === "刷新动态"
          ? "未曾刷新"
          : freshness.label;
  const progressText = visibleProgress ? (visibleProgress.currentLabel ?? idleLabel) : idleLabel;
  const scheduleMeta = visibleSchedule ? deriveAutoRefreshCountdownText(visibleSchedule, renderNow) : undefined;
  const metaText = visibleProgress ? "" : scheduleMeta?.label ?? idleMeta;
  const titleText = visibleProgress
    ? progressText
    : scheduleMeta
      ? scheduleMeta.title
    : freshness.refreshedAt
      ? `${freshness.label}，${formatRelativeTime(freshness.refreshedAt, renderNow)}已刷新`
      : freshness.label;
  return (
    <span className={`refresh-button-inner${visibleProgress ? " is-running" : ""}${visibleSchedule ? " is-scheduled" : ""}${metaText ? " has-meta" : ""}`}>
      <span className="refresh-icon-pane" aria-hidden="true">
        {visibleProgress ? (
          <LoaderCircle className="spin-icon" size={15} aria-hidden="true" />
        ) : (
          <RefreshCw className={visibleSchedule ? "auto-refresh-wait-icon" : undefined} size={15} aria-hidden="true" />
        )}
      </span>
      <span className="refresh-button-body">
        <span className="refresh-button-main">
          <span className="refresh-button-label" title={visibleProgress ? progressText : undefined}>
            {visibleProgress ? progressText : idleLabel}
          </span>
          {metaText ? (
            <span className="refresh-button-meta" title={titleText}>
              {metaText}
            </span>
          ) : null}
        </span>
      </span>
      {visibleProgress ? (
        <span className="refresh-progress" aria-hidden="true">
          <span className="refresh-progress-track">
            <span style={{ width: `${percent}%` }} />
          </span>
        </span>
      ) : null}
    </span>
  );
}

function ActivityCardBody({
  item,
  onOpenActivityLink
}: {
  item: ActivityItem;
  onOpenActivityLink: (event: React.MouseEvent<HTMLAnchorElement>, href: string) => void;
}) {
  const title = item.topicTitle || item.title;
  const href = absoluteLinuxDoUrl(item.url);
  const kindCard = <ActivityKindCard href={href} item={item} onOpenActivityLink={onOpenActivityLink} />;
  if (item.kind === "boost") {
    return (
      <div className="feed-main">
        {kindCard}
        <div className="feed-primary-block">
          <p className="feed-primary">{item.boostText || "Boost 了帖子"}</p>
          <a className="feed-context-link" href={href} target="_blank" rel="noreferrer" onClick={(event) => onOpenActivityLink(event, href)}>
            <ExternalText text={title} />
          </a>
          {item.excerpt ? <p className="feed-excerpt">{item.excerpt}</p> : null}
        </div>
      </div>
    );
  }
  if (item.kind === "reaction") {
    return (
      <div className="feed-main">
        {kindCard}
        <div className="feed-primary-block">
          <p className="feed-primary">{item.reactionValue ? `回应了 ${item.reactionValue}` : "回应了帖子"}</p>
          <a className="feed-context-link" href={href} target="_blank" rel="noreferrer" onClick={(event) => onOpenActivityLink(event, href)}>
            <ExternalText text={title} />
          </a>
          {item.excerpt ? <p className="feed-excerpt">{item.excerpt}</p> : null}
        </div>
      </div>
    );
  }
  if (item.kind === "reply") {
    return (
      <div className="feed-main">
        {kindCard}
        <div className="feed-primary-block">
          {item.excerpt ? <p className="feed-primary">{item.excerpt}</p> : <p className="feed-primary">回复了话题</p>}
          <a className="feed-context-link" href={href} target="_blank" rel="noreferrer" onClick={(event) => onOpenActivityLink(event, href)}>
            <ExternalText text={title} />
          </a>
        </div>
      </div>
    );
  }
  return (
    <div className="feed-main">
      {kindCard}
      <div className="feed-primary-block">
        <a className="feed-title" href={href} target="_blank" rel="noreferrer" onClick={(event) => onOpenActivityLink(event, href)}>
          <ExternalText text={title} />
        </a>
        {item.excerpt ? <p className="feed-excerpt">{item.excerpt}</p> : null}
      </div>
    </div>
  );
}

function ActivityKindCard({
  href,
  item,
  onOpenActivityLink
}: {
  href: string;
  item: ActivityItem;
  onOpenActivityLink: (event: React.MouseEvent<HTMLAnchorElement>, href: string) => void;
}) {
  return (
    <a
      className={`kind-card kind-${item.kind}`}
      href={href}
      target="_blank"
      rel="noreferrer"
      title={`打开${kindText(item.kind)}动态`}
      onClick={(event) => onOpenActivityLink(event, href)}
    >
      <span className="kind-card-icon">{kindIcon(item.kind, 15)}</span>
      <span className="kind-card-label">{kindText(item.kind)}</span>
      {item.kind === "reply" && item.replyToPostNumber ? <span className="kind-card-floor">#{item.replyToPostNumber}</span> : null}
      <span className="kind-card-link">
        <ExternalLink size={12} aria-hidden="true" />
      </span>
    </a>
  );
}

function FilterPopover<T extends string>({
  label,
  onChange,
  onOpenChange,
  onQueryChange,
  open,
  options,
  query,
  selectedContent,
  variant,
  value
}: {
  label: string;
  onChange: (value: T) => void;
  onOpenChange: (open: boolean) => void;
  onQueryChange: (query: string) => void;
  open: boolean;
  options: Array<FilterOption<T>>;
  query: string;
  selectedContent?: ReactNode;
  variant: "kind" | "user";
  value: T;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const selected = options.find((option) => option.value === value) ?? options[0];
  const filtered = normalizedQuery ? options.filter((option) => optionSearchText(option).includes(normalizedQuery)) : options;

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (popoverRef.current && !eventHappenedInside(event, popoverRef.current)) {
        onOpenChange(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onOpenChange(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onOpenChange, open]);

  return (
    <div className={`filter-popover filter-popover-${variant}`} ref={popoverRef}>
      <span>{label}</span>
      <button
        className="filter-popover-trigger"
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
      >
        <span className="filter-popover-value">{selectedContent ?? optionContent(selected)}</span>
        <ChevronDown className="filter-popover-arrow" size={15} aria-hidden="true" />
      </button>
      {open ? (
        <div className="filter-popover-menu">
          <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={`搜索${label}`} />
          {filtered.map((option) => (
            <button
              className={value === option.value ? "active" : ""}
              key={option.value}
              onClick={() => {
                onChange(option.value);
                onOpenChange(false);
              }}
              type="button"
            >
              {optionContent(option)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function eventHappenedInside(event: Event, element: HTMLElement) {
  const path = event.composedPath();
  if (path.length > 0) {
    return path.includes(element);
  }
  return element.contains(event.target as Node | null);
}

export function shouldHandleActivityLinkClick(event: React.MouseEvent<HTMLAnchorElement>) {
  return event.button === 0 && !event.defaultPrevented && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export function isLinuxDoActivityHref(href: string) {
  try {
    const url = new URL(href, "https://linux.do");
    return url.protocol === "https:" && url.hostname === "linux.do";
  } catch {
    return false;
  }
}

function ExternalText({ text }: { text: string }) {
  return (
    <span className="external-text">
      <span>{text}</span>
      <ExternalLink size={12} aria-hidden="true" />
    </span>
  );
}

function AddFriendModal({
  candidates,
  currentAccount,
  friends,
  loading,
  query,
  onAdd,
  onClose,
  onQueryChange,
  onLookup,
  onOpenLinuxDoHome,
  onOpenDredgeRules,
  onRepairPageScript,
  onRemove,
  onSync,
  status
}: {
  candidates: ReturnType<typeof deriveFollowedCandidates>;
  currentAccount?: Username;
  friends: ReturnType<typeof deriveFriendList>;
  loading: boolean;
  query: string;
  onAdd: (user: FollowedUserInput, profile?: FriendProfileSummary) => void;
  onClose: () => void;
  onQueryChange: (query: string) => void;
  onLookup: (username: Username) => Promise<BackgroundResponse<FriendProfileSummary>>;
  onOpenLinuxDoHome: () => void;
  onOpenDredgeRules: () => void;
  onRepairPageScript: () => void;
  onRemove: (username: Username) => void;
  onSync: () => void;
  status: string | null;
}) {
  const statusAction = status ? repairActionForStatus(status, onRepairPageScript, onOpenLinuxDoHome) : null;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="followed-title" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <p className="eyebrow">管理</p>
            <h2 id="followed-title">我的佬朋友</h2>
          </div>
          <button
            className="small-action"
            onClick={onSync}
            disabled={loading}
            title={currentAccount ? `获取 @${currentAccount} 的关注列表` : "需要先在 linux.do 登录"}
            type="button"
          >
            <RefreshCw className={loading ? "spin-icon" : undefined} size={13} aria-hidden="true" />
            获取我的关注列表
          </button>
          <button className="icon-button" onClick={onClose} type="button" aria-label="关闭">
            ×
          </button>
        </div>
        {status ? (
          <div className="modal-status" role="status">
            <span>{status}</span>
            {statusAction ? (
              <button className="status-action" type="button" onClick={statusAction.onClick}>
                {statusAction.label}
              </button>
            ) : null}
          </div>
        ) : !currentAccount ? (
          <div className="modal-status modal-status-warning" role="status">
            <span>需要先在浏览器里登录 linux.do，识别到用户名后才能获取我的关注列表。</span>
            <button className="status-action" type="button" onClick={onOpenLinuxDoHome}>
              打开 linux.do
            </button>
          </div>
        ) : null}

        <section className="modal-section">
          <div className="modal-section-head">
            <div>
              <h3>快速添加</h3>
            </div>
            <button className="small-action" type="button" onClick={onOpenDredgeRules}>
              更多设置
            </button>
          </div>
          <input
            className="modal-search-input"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="筛选已关注，或输入用户名"
            autoFocus
          />
          <FriendCandidateList
            candidates={candidates}
            friends={friends}
            loading={loading}
            mode="light"
            onAdd={onAdd}
            onLookup={onLookup}
            onRemove={onRemove}
            query={query}
          />
        </section>
      </section>
    </div>
  );
}

function PageScriptStatusBadge({ status }: { status: PageScriptStatusSnapshot }) {
  const label = pageScriptStatusLabel(status);
  return (
    <span className={`page-script-badge page-script-${status.status}`} title={pageScriptStatusTitle(status)}>
      <span aria-hidden="true" />
      {label}
    </span>
  );
}

function SidePanelLauncherButton({ status, onOpen }: { status: PageScriptStatusSnapshot; onOpen: () => void }) {
  return (
    <button className={`header-icon-chip side-panel-chip page-script-${status.status}`} type="button" onClick={onOpen} title="打开浏览器侧栏" aria-label="打开浏览器侧栏">
      <PanelRightOpen size={14} aria-hidden="true" />
    </button>
  );
}

function AccountDetectTag({
  detecting,
  onDetect,
  username
}: {
  detecting: boolean;
  onDetect: () => void;
  username?: Username;
}) {
  const label = username ? `重新探测本地账号：@${username}` : "探测本地账号";
  return (
    <button
      className={`badge badge-button account-badge${detecting ? " is-loading" : ""}`}
      type="button"
      onClick={onDetect}
      disabled={detecting}
      title={label}
      aria-label={label}
    >
      {detecting ? <LoaderCircle className="spin-icon" size={13} aria-hidden="true" /> : username ? null : <RefreshCw size={13} aria-hidden="true" />}
      <span>{detecting ? "识别中" : username ? `@${username}` : "识别账号"}</span>
    </button>
  );
}

function CloudArchiveTag({ state, onOpen }: { state: CloudArchiveLocalStateResult | null; onOpen: () => void }) {
  const archiveState = state?.archiveState ?? "unbound";
  const same = archiveState === "same";
  const text = archiveState === "different" ? "待备份" : archiveState === "unbound" ? "未绑定" : "";
  const label = same ? "云存档已备份" : archiveState === "different" ? "云存档待备份" : "云存档未绑定";
  return (
    <button
      className={`cloud-archive-chip cloud-archive-${archiveState}`}
      type="button"
      onClick={onOpen}
      title={`${label}，打开云端备份设置`}
      aria-label={`${label}，打开云端备份设置`}
    >
      <span className="cloud-archive-icon" aria-hidden="true">
        <Cloud size={13} />
        {archiveState === "unbound" ? <span className="cloud-archive-cross" /> : null}
      </span>
      {text ? <span className="cloud-archive-text">{text}</span> : null}
    </button>
  );
}

function OptionsPageButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button className="header-icon-chip settings-chip" type="button" onClick={onOpen} title="打开配置页" aria-label="打开配置页">
      <Settings size={14} aria-hidden="true" />
    </button>
  );
}

function pageScriptStatusLabel(status: PageScriptStatusSnapshot) {
  if (status.status === "connected") return `关联会话 ${status.connectedCount}`;
  if (status.status === "challenge") return "页面验证";
  if (status.status === "stale") return "页面断开";
  return "页面未连";
}

function pageScriptStatusTitle(status: PageScriptStatusSnapshot) {
  const latest = status.heartbeats[0];
  if (!latest) return "还没有 linux.do 页面脚本心跳。";
  return `最近页面：${latest.title || latest.url}`;
}

function repairActionForStatus(status: string, onRepairPageScript: () => void, onOpenLinuxDoHome: () => void) {
  if (status.includes("未加载佬朋友脚本") || status.includes("没有响应")) {
    return { label: "一键刷新页面", onClick: onRepairPageScript };
  }
  if (status.includes("浏览器验证") || status.includes("请打开一个 linux.do 页面")) {
    return { label: "打开 linux.do", onClick: onOpenLinuxDoHome };
  }
  return null;
}

function optionContent<T extends string>(option: FilterOption<T>) {
  return option.content ?? (
    <span className="filter-option-content">
      {option.tone ? <span className={`filter-option-icon kind-${option.tone}`}>{option.icon}</span> : option.icon}
      <span className="filter-option-label">{option.label}</span>
      {option.meta !== undefined ? <span className="filter-option-count">{option.meta}</span> : null}
    </span>
  );
}

function optionSearchText<T extends string>(option: FilterOption<T>) {
  return (option.searchText ?? `${option.label} ${option.value}`).toLowerCase();
}

function sameScope(left: ActivityRefreshScope, right: ActivityRefreshScope) {
  if (left.kind !== right.kind) return false;
  return normalizedScopeUsers(left).join(",") === normalizedScopeUsers(right).join(",");
}

function normalizedScopeUsers(scope: ActivityRefreshScope) {
  return [...(scope.usernames ?? [])].map((username) => username.trim().replace(/^@/, "").toLowerCase()).sort();
}

function deriveProfileFreshness(friends: ReturnType<typeof deriveFriendList>): { label: string; refreshedAt?: string } {
  const timestamps = friends.flatMap(({ profile }) => (profile?.refreshedAt ? [profile.refreshedAt] : []));
  if (timestamps.length === 0) {
    return { label: friends.length ? "尚未刷新状态" : "暂无佬朋友" };
  }
  return {
    label: "状态",
    refreshedAt: timestamps.sort((left, right) => Date.parse(right) - Date.parse(left))[0]
  };
}

function deriveAutoRefreshCountdown(session: FriendStatusAutoRefreshSession, now: number, hasFriends: boolean): AutoRefreshCountdownSchedule | undefined {
  if (!session.enabled || !hasFriends) return undefined;
  const intervalMs = session.intervalMinutes * 60_000;
  const anchor = Date.parse(session.lastFinishedAt ?? session.enabledAt ?? "");
  const dueAt = Number.isFinite(anchor) ? anchor + intervalMs : now;
  return { dueAt, intervalMinutes: session.intervalMinutes };
}

function deriveAutoRefreshCountdownText(
  schedule: { dueAt: number; intervalMinutes: FriendStatusAutoRefreshIntervalMinutes },
  now: number
) {
  const remainingMs = Math.max(0, schedule.dueAt - now);
  const countdown = remainingMs <= 0 ? "即将刷新" : `下次刷新 ${formatCountdown(remainingMs)}`;
  return {
    label: countdown,
    title: `${countdown}，间隔 ${schedule.intervalMinutes} 分钟`
  };
}

function formatCountdown(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function formatLongCountdown(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function absoluteLinuxDoUrl(url?: string) {
  if (!url) return "https://linux.do";
  if (url.startsWith("http")) return url;
  return `https://linux.do${url}`;
}

function profileUrl(username: Username) {
  return `https://linux.do/u/${encodeURIComponent(username)}`;
}
