import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { classifyFetchResponse } from "../api/responseClassifier";
import { FriendsApp } from "../app/FriendsApp";
import { FriendNoteDialog, FriendNoteEditButton, FriendNotePreview } from "../app/FriendNoteEditor";
import type { AppState } from "../shared/types";
import type {
  ActivityItem,
  ActivityKindFilter,
  ActivityRefreshKind,
  ActivityRefreshRequestKind,
  ContentScriptActivityResponse,
  ContentScriptAvatarResponse,
  ContentScriptCommand,
  ContentScriptCurrentAccountResponse,
  ContentScriptFollowingResponse,
  ContentScriptNavigationResponse,
  ContentScriptProfileResponse,
  ContentScriptResponse,
  FollowedUserInput,
  FriendActivitySummary,
  FriendProfileSummary,
  RefreshFailureReason,
  Username
} from "../shared/types";
import appCss from "../styles/app.css?inline";
import { markContentScriptContext } from "../storage/sessionStorageAdapter";

const markerClass = "linuxdo-friends-marker";
const friendAvatarClass = "linuxdo-friends-friend-avatar";
const friendNameMarkClass = "linuxdo-friends-name-mark";
const launcherId = "linuxdo-friends-launcher";
const pageStyleId = "linuxdo-friends-page-style";
const profileActionButtonId = "linuxdo-friends-profile-action";
const profileActionButtonClass = "linuxdo-friends-profile-action";
const friendActionWrapperClass = "linuxdo-friends-action-wrapper";
const friendActionSurfaceAttr = "data-linuxdo-friends-surface";
const friendNoteContainerClass = "linuxdo-friends-note-container";
const friendNoteRowClass = "linuxdo-friends-note-row";
const postFriendNoteClass = "linuxdo-friends-post-note";
const friendNoteDialogHostId = "linuxdo-friends-note-dialog";
const friendNoteTooltipHostId = "linuxdo-friends-note-tooltip-layer";
const userMenuTabId = "linuxdo-friends-user-menu-tab";
const userMenuPanelId = "linuxdo-friends-user-menu-panel";
const userMenuActiveClass = "linuxdo-friends-user-menu-active";
const userMenuDrawerClass = "linuxdo-friends-user-menu-drawer";
const userMenuHiddenAttr = "data-linuxdo-friends-menu-hidden";
const userMenuPreviousDisplayAttr = "data-linuxdo-friends-previous-display";
const heartbeatIntervalMs = 15_000;
const heartbeatChangeDebounceMs = 350;
const themeAttributeFilter = ["class", "style", "data-theme", "data-color-scheme", "data-color-mode", "data-scheme"];
const schemeLinkSelector = "link.light-scheme, link.dark-scheme";
type PageTheme = "light" | "dark";
type NavigationDeps = {
  currentHref?: () => string;
  clickLink?: (href: string) => void;
  assign?: (href: string) => void;
  delay?: () => Promise<void>;
};

let userMenuRoot: Root | null = null;
let userMenuRootElement: HTMLElement | null = null;
let userMenuObserver: MutationObserver | null = null;
let pageThemeObserver: MutationObserver | null = null;
let userMenuEnhanceTimer: number | null = null;
let launcherPlacementTimer: number | null = null;
let friendMarkerTimer: number | null = null;
let friendActionsTimer: number | null = null;
let themeSyncTimer: number | null = null;
let heartbeatChangeTimer: number | null = null;
let suppressFriendMarkerMutations = false;
let suppressFriendActionMutations = false;
let heartbeatTimer: number | null = null;
let heartbeatTitleObserver: MutationObserver | null = null;
let lastHeartbeatStatus: "pending" | "connected" | "disconnected" = "pending";
let latestState: AppState | null = null;
let lastPageTheme: PageTheme | null = null;
let routePopstateListener: (() => void) | null = null;
let originalPushState: History["pushState"] | null = null;
let originalReplaceState: History["replaceState"] | null = null;
interface FriendNoteRowMount {
  root: Root;
  rootElement: HTMLElement;
}

const friendNoteRowRoots = new Map<HTMLElement, FriendNoteRowMount>();
const postFriendNoteRoots = new Map<HTMLElement, FriendNoteRowMount>();
let friendNoteDialogRoot: Root | null = null;
let friendNoteDialogRootElement: HTMLElement | null = null;
let friendNoteDialogUsername: Username | null = null;
let friendNoteTooltipRootElement: HTMLElement | null = null;

markContentScriptContext();
void init();
subscribeToStorageChanges();
subscribeToRuntimeMessages();
startHeartbeat();
startUserMenuIntegration();
startRouteTracking();

async function init() {
  const state = await getState();
  ensurePageStyle();
  syncPageTheme();
  ensureLauncher();
  if (!state) return;
  latestState = state;
  markFriends(state);
  enhanceFriendActions(state);
}

async function getState(): Promise<AppState | null> {
  try {
    const response = await chrome.runtime.sendMessage({ type: "getState" });
    return response?.ok ? response.data : null;
  } catch {
    return null;
  }
}

export function markFriends(state: AppState) {
  ensurePageStyle();
  suppressFriendMarkerMutations = true;
  sweepDetachedPostFriendNotes();
  clearMarkers();
  const activePostNoteHosts = new Set<HTMLElement>();
  const friends = Object.keys(state.friends);
  try {
    if (friends.length === 0) return;
    const friendSet = new Set(friends);
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="/u/"], a[href*="linux.do/u/"]'));
    for (const link of links) {
      const username = extractUsername(link);
      if (!username || !friendSet.has(username) || !isProfileIdentityLink(link)) continue;
      markAvatarElements(link);
      const displayName = getFriendDisplayName(state, username);
      markNameText(link, displayName);
      const postNoteHost = renderPostFriendNote(link, username, state.friends[username].note);
      if (postNoteHost) activePostNoteHosts.add(postNoteHost);
    }
  } finally {
    reconcilePostFriendNotes(activePostNoteHosts);
    window.setTimeout(() => {
      suppressFriendMarkerMutations = false;
    }, 0);
  }
}

export function ensureLauncher() {
  let launcher = document.getElementById(launcherId) as HTMLButtonElement | null;
  if (!launcher) {
    launcher = document.createElement("button");
    launcher.id = launcherId;
    launcher.type = "button";
    launcher.className = "btn no-text icon btn-flat";
    launcher.title = "佬朋友";
    launcher.setAttribute("aria-label", "打开佬朋友");
    launcher.innerHTML = discourseFriendIconSvg();
    launcher.append(createLauncherStatusDot());
    updateLauncherStatusDot(lastHeartbeatStatus);
    launcher.addEventListener("click", () => {
      void openFriendsUserMenu();
    });
  }

  if (!placeLauncher(launcher)) {
    dockLauncherToFallback(launcher);
  }
  sendHeartbeat();
}

function ensurePageStyle() {
  if (document.getElementById(pageStyleId)) return;
  const style = document.createElement("style");
  style.id = pageStyleId;
  style.textContent = `
    :root {
      --linuxdo-friends-accent: #5eead4;
      --linuxdo-friends-accent-soft: rgba(94, 234, 212, 0.28);
      --linuxdo-friends-accent-glow: rgba(94, 234, 212, 0.52);
      --linuxdo-friends-profile-action-text: #071312;
      --linuxdo-friends-profile-action-hover-text: #04100f;
      --linuxdo-friends-profile-action-active-bg: #1d2322;
      --linuxdo-friends-profile-action-active-mix: #1f2726;
      --linuxdo-friends-panel-bg: #101414;
    }

    :root[data-linuxdo-friends-theme="light"] {
      --linuxdo-friends-accent: #0d9488;
      --linuxdo-friends-accent-soft: rgba(13, 148, 136, 0.20);
      --linuxdo-friends-accent-glow: rgba(13, 148, 136, 0.42);
      --linuxdo-friends-profile-action-text: #04100f;
      --linuxdo-friends-profile-action-hover-text: #031514;
      --linuxdo-friends-profile-action-active-bg: #ecfffb;
      --linuxdo-friends-profile-action-active-mix: #f7fffd;
      --linuxdo-friends-panel-bg: #f6f8f7;
    }

    :root[data-linuxdo-friends-theme="dark"] {
      --linuxdo-friends-accent: #5eead4;
      --linuxdo-friends-accent-soft: rgba(94, 234, 212, 0.28);
      --linuxdo-friends-accent-glow: rgba(94, 234, 212, 0.52);
      --linuxdo-friends-profile-action-text: #071312;
      --linuxdo-friends-profile-action-hover-text: #04100f;
      --linuxdo-friends-profile-action-active-bg: #1d2322;
      --linuxdo-friends-profile-action-active-mix: #1f2726;
      --linuxdo-friends-panel-bg: #101414;
    }

    .${friendNameMarkClass} {
      position: relative !important;
      display: inline-block !important;
      isolation: isolate !important;
      padding-inline: 1ch !important;
      margin-inline: -1ch !important;
      text-decoration: inherit !important;
    }

    .${friendNameMarkClass}::before {
      content: "" !important;
      position: absolute !important;
      z-index: -1 !important;
      left: 0 !important;
      right: 0 !important;
      top: 56% !important;
      height: 34% !important;
      border-radius: 999px 8px 999px 10px / 8px 999px 10px 999px !important;
      background:
        linear-gradient(
          100deg,
          transparent 0%,
          color-mix(in srgb, var(--linuxdo-friends-accent) 20%, transparent) 10%,
          color-mix(in srgb, var(--linuxdo-friends-accent) 40%, transparent) 47%,
          color-mix(in srgb, var(--linuxdo-friends-accent) 22%, transparent) 88%,
          transparent 100%
        ) !important;
      filter: blur(0.25px) !important;
      transform: rotate(-1.2deg) !important;
      pointer-events: none !important;
    }

    .${friendAvatarClass} {
      border-radius: 999px !important;
      animation: linuxdo-friends-avatar-breathe 2.2s ease-in-out infinite !important;
      box-shadow:
        0 0 0 1px color-mix(in srgb, var(--linuxdo-friends-accent) 34%, transparent),
        0 0 12px color-mix(in srgb, var(--linuxdo-friends-accent) 46%, transparent),
        0 0 30px color-mix(in srgb, var(--linuxdo-friends-accent) 34%, transparent),
        0 0 52px color-mix(in srgb, var(--linuxdo-friends-accent) 20%, transparent) !important;
    }

    @keyframes linuxdo-friends-avatar-breathe {
      0%, 100% {
        box-shadow:
          0 0 0 1px color-mix(in srgb, var(--linuxdo-friends-accent) 22%, transparent),
          0 0 8px color-mix(in srgb, var(--linuxdo-friends-accent) 24%, transparent),
          0 0 20px color-mix(in srgb, var(--linuxdo-friends-accent) 16%, transparent),
          0 0 34px color-mix(in srgb, var(--linuxdo-friends-accent) 8%, transparent);
      }
      50% {
        box-shadow:
          0 0 0 2px color-mix(in srgb, var(--linuxdo-friends-accent) 46%, transparent),
          0 0 16px color-mix(in srgb, var(--linuxdo-friends-accent) 62%, transparent),
          0 0 38px color-mix(in srgb, var(--linuxdo-friends-accent) 46%, transparent),
          0 0 68px color-mix(in srgb, var(--linuxdo-friends-accent) 28%, transparent);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .${friendAvatarClass} {
        animation: none !important;
      }
    }

    .${profileActionButtonClass} {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 0.45em !important;
      color: var(--linuxdo-friends-profile-action-text) !important;
      border: 1px solid color-mix(in srgb, var(--linuxdo-friends-accent) 72%, transparent) !important;
      background:
        linear-gradient(
          180deg,
          color-mix(in srgb, var(--linuxdo-friends-accent) 96%, white 4%),
          color-mix(in srgb, var(--linuxdo-friends-accent) 72%, black 18%)
        ) !important;
      box-shadow:
        inset 0 1px 0 color-mix(in srgb, white 26%, transparent),
        0 0 18px color-mix(in srgb, var(--linuxdo-friends-accent) 26%, transparent) !important;
    }

    .${profileActionButtonClass}:hover,
    .${profileActionButtonClass}:focus-visible {
      color: var(--linuxdo-friends-profile-action-hover-text) !important;
      border-color: color-mix(in srgb, var(--linuxdo-friends-accent) 88%, transparent) !important;
      background:
        linear-gradient(
          180deg,
          color-mix(in srgb, var(--linuxdo-friends-accent) 100%, white 0%),
          color-mix(in srgb, var(--linuxdo-friends-accent) 82%, black 12%)
        ) !important;
      box-shadow:
        inset 0 1px 0 color-mix(in srgb, white 30%, transparent),
        0 0 24px color-mix(in srgb, var(--linuxdo-friends-accent) 36%, transparent) !important;
    }

    .${profileActionButtonClass}[data-linuxdo-friends-active="true"] {
      color: var(--linuxdo-friends-accent) !important;
      background:
        linear-gradient(
          180deg,
          color-mix(in srgb, var(--linuxdo-friends-profile-action-active-mix) 88%, var(--linuxdo-friends-accent) 12%),
          var(--linuxdo-friends-profile-action-active-bg)
        ) !important;
      border-color: color-mix(in srgb, var(--linuxdo-friends-accent) 48%, transparent) !important;
      box-shadow:
        inset 0 1px 0 rgb(255 255 255 / 0.06),
        0 0 16px color-mix(in srgb, var(--linuxdo-friends-accent) 18%, transparent) !important;
    }

    .${profileActionButtonClass}[disabled] {
      cursor: wait !important;
      opacity: 0.72 !important;
    }

    .${friendNoteContainerClass} {
      min-width: 0 !important;
      flex-wrap: wrap !important;
    }

    .${friendNoteRowClass} {
      display: block !important;
      width: 100% !important;
      min-width: 0 !important;
      max-width: 100% !important;
      flex: 1 0 100% !important;
      grid-column: 1 / -1 !important;
      clear: both !important;
      margin-top: 0.25rem !important;
    }

    .${postFriendNoteClass} {
      display: inline-block !important;
      min-width: 0 !important;
      max-width: min(160px, 40vw) !important;
      vertical-align: baseline !important;
    }

    .${friendActionWrapperClass} {
      list-style: none !important;
    }

    #${userMenuPanelId} {
      display: block;
      flex: 0 0 min(320px, calc(100vw - 64px));
      width: min(320px, calc(100vw - 64px));
      max-width: 100%;
      min-width: 0;
      height: 100%;
      min-height: 0;
      overflow: hidden;
      background: var(--linuxdo-friends-panel-bg);
    }

    .user-menu.${userMenuActiveClass} .panel-body,
    .user-menu.${userMenuActiveClass} .panel-body-contents {
      min-width: 0;
    }

    .user-menu.${userMenuActiveClass} .panel-body-contents {
      overflow: hidden;
    }

    .user-menu.${userMenuActiveClass} .panel-body-contents > .menu-tabs-container {
      flex: 0 0 46px;
    }

    .user-menu.${userMenuActiveClass}.${userMenuDrawerClass} #${userMenuPanelId} {
      flex: 1 1 calc(100% - 46px);
      width: calc(100% - 46px);
      max-width: calc(100% - 46px);
    }
  `;
  document.documentElement.append(style);
}

function startUserMenuIntegration() {
  ensurePageStyle();
  syncPageTheme();
  scheduleUserMenuEnhancement();
  scheduleLauncherPlacement();
  startPageThemeObserver();
  if (userMenuObserver) return;
  userMenuObserver = new MutationObserver((mutations) => {
    if (mutationsContainPageThemeTarget(mutations)) {
      observePageThemeTargets();
      scheduleThemeSync();
    }
    scheduleUserMenuEnhancement();
    scheduleLauncherPlacement();
    if (!suppressFriendMarkerMutations) scheduleFriendMarkers();
    if (!suppressFriendActionMutations) scheduleFriendActions();
  });
  userMenuObserver.observe(document.body, {
    childList: true,
    subtree: true
  });
  window.addEventListener("load", () => scheduleLauncherPlacement(), { once: true });
}

function startPageThemeObserver() {
  if (pageThemeObserver) return;
  pageThemeObserver = new MutationObserver((mutations) => {
    if (mutationsContainPageThemeTarget(mutations)) observePageThemeTargets();
    scheduleThemeSync();
  });
  observePageThemeTargets();
}

function observePageThemeTargets() {
  const currentDocument = globalThis.document;
  if (!currentDocument) return;
  if (!pageThemeObserver) return;
  if (currentDocument.head) {
    pageThemeObserver.observe(currentDocument.head, { childList: true });
  }
  const targets = [
    currentDocument.documentElement,
    currentDocument.body,
    currentDocument.querySelector<HTMLElement>("#discourse-root"),
    currentDocument.querySelector<HTMLElement>(".d-header"),
    ...Array.from(currentDocument.querySelectorAll<HTMLElement>(schemeLinkSelector))
  ].filter((element): element is HTMLElement => Boolean(element));
  for (const target of targets) {
    pageThemeObserver.observe(target, {
      attributes: true,
      attributeFilter: target.matches(schemeLinkSelector) ? ["media", "class", "href"] : themeAttributeFilter
    });
  }
}

function mutationsContainPageThemeTarget(mutations: MutationRecord[]): boolean {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (nodeContainsPageThemeTarget(node)) return true;
    }
  }
  return false;
}

function nodeContainsPageThemeTarget(node: Node): boolean {
  if (typeof HTMLElement === "undefined") return false;
  if (!(node instanceof HTMLElement)) return false;
  return (
    node.matches(`#discourse-root, .d-header, ${schemeLinkSelector}`) ||
    Boolean(node.querySelector(`#discourse-root, .d-header, ${schemeLinkSelector}`))
  );
}

function startRouteTracking() {
  routePopstateListener = () => {
    scheduleFriendMarkers();
    scheduleFriendActions();
    scheduleHeartbeatRefresh();
  };
  window.addEventListener("popstate", routePopstateListener);
  wrapHistoryMethod("pushState");
  wrapHistoryMethod("replaceState");
}

function wrapHistoryMethod(method: "pushState" | "replaceState") {
  const original = window.history[method];
  if (method === "pushState") originalPushState = original;
  if (method === "replaceState") originalReplaceState = original;
  window.history[method] = function patchedHistoryMethod(this: History, ...args: Parameters<History[typeof method]>) {
    const result = original.apply(this, args);
    scheduleFriendMarkers();
    scheduleFriendActions();
    scheduleHeartbeatRefresh();
    return result;
  } as History[typeof method];
}

export function scheduleFriendMarkers() {
  if (typeof window === "undefined" || !latestState) return;
  if (friendMarkerTimer != null) return;
  friendMarkerTimer = window.setTimeout(() => {
    friendMarkerTimer = null;
    if (latestState) markFriends(latestState);
  }, 80);
}

function scheduleFriendActions() {
  if (typeof window === "undefined" || !latestState) return;
  if (friendActionsTimer != null) return;
  friendActionsTimer = window.setTimeout(() => {
    friendActionsTimer = null;
    if (latestState) enhanceFriendActions(latestState);
  }, 80);
}

function scheduleThemeSync() {
  if (typeof window === "undefined") return;
  if (themeSyncTimer != null) return;
  themeSyncTimer = window.setTimeout(() => {
    themeSyncTimer = null;
    syncPageTheme();
  }, 80);
}

function scheduleUserMenuEnhancement() {
  if (typeof window === "undefined") return;
  if (userMenuEnhanceTimer != null) return;
  userMenuEnhanceTimer = window.setTimeout(() => {
    userMenuEnhanceTimer = null;
    enhanceUserMenu();
  }, 0);
}

function scheduleLauncherPlacement() {
  if (typeof window === "undefined") return;
  if (launcherPlacementTimer != null) return;
  launcherPlacementTimer = window.setTimeout(() => {
    launcherPlacementTimer = null;
    refreshLauncherPlacement();
  }, 0);
}

function refreshLauncherPlacement() {
  const launcher = document.getElementById(launcherId) as HTMLButtonElement | null;
  if (!launcher) {
    ensureLauncher();
    return;
  }
  if (!placeLauncher(launcher)) {
    dockLauncherToFallback(launcher);
  }
}

export function enhanceUserMenu() {
  const menu = findUserMenu();
  if (!menu) {
    unmountUserMenuPanel();
    return;
  }

  const tabs = findUserMenuTopTabs(menu);
  const contents = findUserMenuContents(menu);
  if (!tabs || !contents) return;

  if (!menu.dataset.linuxdoFriendsTabsBound) {
    menu.dataset.linuxdoFriendsTabsBound = "true";
    tabs.closest(".menu-tabs-container")?.addEventListener(
      "click",
      (event) => {
        const tab = (event.target as Element | null)?.closest<HTMLElement>(".user-menu-tab");
        if (tab && tab.id !== userMenuTabId) {
          closeUserMenuPanel(menu);
        }
      },
      true
    );
  }

  if (!document.getElementById(userMenuTabId)) {
    tabs.append(createUserMenuTab(menu));
  }
}

function findUserMenu() {
  return document.querySelector<HTMLElement>(".user-menu.revamped.menu-panel, .user-menu.menu-panel");
}

function findUserMenuTopTabs(menu: HTMLElement) {
  return menu.querySelector<HTMLElement>(".menu-tabs-container .top-tabs, .menu-tabs-container .tabs-list");
}

function findUserMenuContents(menu: HTMLElement) {
  return menu.querySelector<HTMLElement>(".panel-body-contents");
}

function createUserMenuTab(menu: HTMLElement) {
  const tab = document.createElement("button");
  tab.id = userMenuTabId;
  tab.type = "button";
  tab.className = "btn btn-flat btn-icon no-text user-menu-tab linuxdo-friends-user-menu-tab";
  tab.title = "佬朋友";
  tab.setAttribute("aria-label", "佬朋友");
  tab.setAttribute("role", "tab");
  tab.setAttribute("aria-selected", "false");
  tab.innerHTML = discourseFriendIconSvg();
  tab.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openUserMenuPanel(menu);
  });
  return tab;
}

function openUserMenuPanel(menu: HTMLElement) {
  const contents = findUserMenuContents(menu);
  const tab = document.getElementById(userMenuTabId);
  if (!contents || !tab) return;

  markUserMenuLayout(menu);
  hideNativeUserMenuPanels(contents);
  const panel = ensureUserMenuPanel();
  const tabContainer = contents.querySelector<HTMLElement>(".menu-tabs-container");
  if (tabContainer?.parentElement === contents) {
    contents.insertBefore(panel, tabContainer.nextSibling);
  } else {
    contents.prepend(panel);
  }
  menu.querySelectorAll<HTMLElement>(".user-menu-tab.active").forEach((nativeTab) => {
    nativeTab.classList.remove("active");
    nativeTab.setAttribute("aria-selected", "false");
  });
  tab.classList.add("active");
  tab.setAttribute("aria-selected", "true");

  mountUserMenuPanel();
}

function ensureUserMenuPanel() {
  const existing = document.getElementById(userMenuPanelId) as HTMLDivElement | null;
  if (existing) return existing;
  const panel = document.createElement("div");
  panel.id = userMenuPanelId;
  panel.className = "linuxdo-friends-user-menu-panel";
  return panel;
}

function mountUserMenuPanel() {
  const panel = document.getElementById(userMenuPanelId) as HTMLDivElement | null;
  if (!panel || userMenuRoot) return;
  const shadow = panel.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `${appCss}\n${userMenuPanelCss()}`;
  const rootNode = document.createElement("div");
  rootNode.className = "linuxdo-friends-menu-root";
  rootNode.dataset.linuxdoFriendsTheme = currentPageTheme();
  shadow.append(style, rootNode);
  userMenuRootElement = rootNode;
  userMenuRoot = createRoot(rootNode);
  userMenuRoot.render(
    React.createElement(FriendsApp, {
      friendNoteTooltipPortalTarget: ensureFriendNoteTooltipRoot(),
      surface: "in-page"
    })
  );
}

function closeUserMenuPanel(menu: HTMLElement) {
  restoreNativeUserMenuPanels(menu);
  menu.classList.remove(userMenuActiveClass, userMenuDrawerClass);
  const tab = document.getElementById(userMenuTabId);
  tab?.classList.remove("active");
  tab?.setAttribute("aria-selected", "false");
  unmountUserMenuPanel();
}

function unmountUserMenuPanel() {
  userMenuRoot?.unmount();
  userMenuRoot = null;
  userMenuRootElement = null;
  document.getElementById(userMenuPanelId)?.remove();
}

export function syncPageTheme() {
  if (typeof document === "undefined") return;
  const theme = detectPageTheme();
  if (theme === lastPageTheme) return;
  lastPageTheme = theme;
  document.documentElement.dataset.linuxdoFriendsTheme = theme;
  document.querySelectorAll<HTMLElement>(".linuxdo-friends-menu-root").forEach((root) => {
    root.dataset.linuxdoFriendsTheme = theme;
  });
  if (userMenuRootElement) {
    userMenuRootElement.dataset.linuxdoFriendsTheme = theme;
  }
  if (friendNoteDialogRootElement) {
    friendNoteDialogRootElement.dataset.linuxdoFriendsTheme = theme;
  }
  friendNoteRowRoots.forEach(({ rootElement }) => {
    rootElement.dataset.linuxdoFriendsTheme = theme;
  });
  postFriendNoteRoots.forEach(({ rootElement }) => {
    rootElement.dataset.linuxdoFriendsTheme = theme;
  });
  if (friendNoteTooltipRootElement) {
    friendNoteTooltipRootElement.dataset.linuxdoFriendsTheme = theme;
  }
}

function currentPageTheme(): PageTheme {
  return lastPageTheme ?? detectPageTheme();
}

export function detectPageTheme(): PageTheme {
  if (typeof document === "undefined") return "light";
  return explicitPageTheme() ?? renderedPageTheme();
}

function explicitPageTheme(): PageTheme | null {
  const candidates = [
    document.documentElement,
    document.body,
    document.querySelector<HTMLElement>("#discourse-root"),
    document.querySelector<HTMLElement>(".d-header")
  ].filter((element): element is HTMLElement => Boolean(element));
  for (const element of candidates) {
    const values = [
      element.dataset.theme,
      element.dataset.colorScheme,
      element.dataset.colorMode,
      element.dataset.scheme,
      element.getAttribute("data-theme"),
      element.getAttribute("data-color-scheme"),
      element.getAttribute("data-color-mode"),
      element.getAttribute("data-scheme"),
      element.getAttribute("class")
    ];
    const theme = themeFromTokens(values);
    if (theme) return theme;
  }
  const rootStyle = getComputedStyle(document.documentElement);
  return themeFromTokens([
    rootStyle.getPropertyValue("--scheme-type"),
    rootStyle.getPropertyValue("--color-scheme"),
    rootStyle.getPropertyValue("color-scheme")
  ]);
}

function themeFromTokens(values: Array<string | null | undefined>): PageTheme | null {
  for (const rawValue of values) {
    const value = rawValue?.toLocaleLowerCase();
    if (!value) continue;
    if (/(^|[\s_-])(dark|night|黑暗|深色)([\s_-]|$)/.test(value)) return "dark";
    if (/(^|[\s_-])(light|day|白天|浅色|亮色)([\s_-]|$)/.test(value)) return "light";
  }
  return null;
}

function renderedPageTheme(): PageTheme {
  const sample = renderedBackgroundColor(document.body) ?? renderedBackgroundColor(document.documentElement);
  if (!sample) return "light";
  return relativeLuminance(sample) < 0.5 ? "dark" : "light";
}

function renderedBackgroundColor(start: Element | null): RGBColor | null {
  let current: Element | null = start;
  while (current) {
    const color = parseCssColor(getComputedStyle(current).backgroundColor);
    if (color && color.a > 0.1) return color;
    current = current.parentElement;
  }
  return null;
}

interface RGBColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseCssColor(value: string): RGBColor | null {
  const match = value.match(/rgba?\(([^)]+)\)/i);
  if (!match) return null;
  const parts = match[1].split(/[,\s/]+/).filter(Boolean);
  const [r, g, b] = parts.slice(0, 3).map((part) => Number.parseFloat(part));
  if (![r, g, b].every(Number.isFinite)) return null;
  const a = parts[3] === undefined ? 1 : Number.parseFloat(parts[3]);
  return { r, g, b, a: Number.isFinite(a) ? a : 1 };
}

function relativeLuminance(color: RGBColor) {
  const [r, g, b] = [color.r, color.g, color.b].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function hideNativeUserMenuPanels(contents: HTMLElement) {
  const tabContainer = contents.querySelector(".menu-tabs-container");
  Array.from(contents.children).forEach((child) => {
    if (!(child instanceof HTMLElement) || child === tabContainer || child.id === userMenuPanelId) return;
    if (!child.hasAttribute(userMenuHiddenAttr)) {
      child.setAttribute(userMenuPreviousDisplayAttr, child.style.display);
      child.setAttribute(userMenuHiddenAttr, "true");
    }
    child.style.display = "none";
  });
}

function restoreNativeUserMenuPanels(menu: HTMLElement) {
  menu.querySelectorAll<HTMLElement>(`[${userMenuHiddenAttr}]`).forEach((element) => {
    element.style.display = element.getAttribute(userMenuPreviousDisplayAttr) ?? "";
    element.removeAttribute(userMenuPreviousDisplayAttr);
    element.removeAttribute(userMenuHiddenAttr);
  });
}

function markUserMenuLayout(menu: HTMLElement) {
  menu.classList.add(userMenuActiveClass);
  menu.classList.toggle(userMenuDrawerClass, isSlideInUserMenu(menu));
}

function isSlideInUserMenu(menu: HTMLElement) {
  if (menu.classList.contains("slide-in")) return true;
  const style = window.getComputedStyle(menu);
  const rect = menu.getBoundingClientRect();
  return style.position === "fixed" && rect.height >= window.innerHeight - 2 && rect.width <= 360;
}

function enhanceFriendActions(state: AppState) {
  ensurePageStyle();
  suppressFriendActionMutations = true;
  try {
    sweepDetachedFriendNoteRows();
    const activeSurfaces = new Set<string>();
    const profileTarget = profileFriendActionTarget();
    if (profileTarget) {
      activeSurfaces.add(profileTarget.surface);
      const button = ensureFriendActionButton(profileTarget.surface);
      updateFriendActionButton(button, state, profileTarget);
      placeFriendActionButton(button, profileTarget);
      updateFriendNoteSurface(state, profileTarget);
    }
    for (const target of userCardFriendActionTargets()) {
      activeSurfaces.add(target.surface);
      const button = ensureFriendActionButton(target.surface);
      updateFriendActionButton(button, state, target);
      placeFriendActionButton(button, target);
      updateFriendNoteSurface(state, target);
    }
    document.querySelectorAll<HTMLButtonElement>(`.${profileActionButtonClass}`).forEach((button) => {
      if (!button.dataset.linuxdoFriendsSurface || activeSurfaces.has(button.dataset.linuxdoFriendsSurface)) return;
      removeFriendActionButton(button);
    });
    document.querySelectorAll<HTMLElement>(`.${friendNoteRowClass}`).forEach((element) => {
      const surface = element.getAttribute(friendActionSurfaceAttr);
      if (surface && activeSurfaces.has(surface)) return;
      removeFriendNoteElement(element);
    });
    if (friendNoteDialogUsername && !state.friends[friendNoteDialogUsername]) {
      closeFriendNoteDialog();
    }
  } finally {
    window.setTimeout(() => {
      suppressFriendActionMutations = false;
    }, 0);
  }
}

interface FriendActionTarget {
  surface: string;
  username: Username;
  container: HTMLElement;
  anchor?: HTMLElement;
  name?: string;
  avatarUrl?: string;
  wrapWithListItem?: boolean;
  noteContainer?: HTMLElement;
}

function profileFriendActionTarget(): FriendActionTarget | null {
  const username = currentProfileUsername();
  const container = username ? findProfileActionContainer() : null;
  if (!username || !container) return null;
  return {
    surface: "profile",
    username,
    container,
    anchor: findProfileFollowButton() ?? undefined,
    name: profilePageDisplayName(username),
    avatarUrl: profilePageAvatarUrl(),
    wrapWithListItem: container.matches("ul, ol"),
    noteContainer: findProfileNamesContainer() ?? undefined
  };
}

function currentProfileUsername(): Username | null {
  const parts = location.pathname.split("/").filter(Boolean);
  if (parts.length < 2 || parts[0] !== "u") return null;
  if (parts.length > 2 && parts[2] !== "summary") return null;
  return normalizeUsername(decodeURIComponent(parts[1] ?? ""));
}

function findProfileActionContainer(): HTMLElement | null {
  const followButton = findProfileFollowButton();
  if (followButton) return profileButtonListContainer(followButton) ?? followButton.parentElement;
  const firstButton = findProfileActionButtons().at(0);
  return firstButton ? profileButtonListContainer(firstButton) ?? firstButton.parentElement : null;
}

function profileButtonListContainer(button: HTMLElement): HTMLElement | null {
  const listItem = button.closest("li");
  const list = listItem?.parentElement;
  return list?.matches("ul, ol") ? list : null;
}

function findProfileFollowButton(): HTMLElement | null {
  return findProfileActionButtons().find((button) => {
    const text = button.textContent?.replace(/\s+/g, "") ?? "";
    return text.includes("关注") || text.includes("Follow") || text.includes("Unfollow");
  }) ?? null;
}

function findProfileActionButtons(): HTMLElement[] {
  const selectors = [
    ".user-main .controls button",
    ".user-main .controls .btn",
    ".user-profile .controls button",
    ".user-profile .controls .btn",
    ".user-main .user-profile-buttons button",
    ".user-main .user-profile-buttons .btn",
    ".user-main .user-profile-controls button",
    ".user-main .user-profile-controls .btn",
    ".user-profile .user-profile-buttons button",
    ".user-profile .user-profile-buttons .btn",
    ".user-profile .user-profile-controls button",
    ".user-profile .user-profile-controls .btn",
    ".user-profile-controls button",
    ".user-profile-controls .btn",
    ".user-content .controls button",
    ".user-content .controls .btn"
  ];
  return Array.from(document.querySelectorAll<HTMLElement>(selectors.join(","))).filter((button) => button.id !== profileActionButtonId);
}

function userCardFriendActionTargets(): FriendActionTarget[] {
  return findUserCards().flatMap((card, index) => {
    const username = userCardUsername(card);
    const container = username ? findUserCardActionContainer(card) : null;
    if (!username || !container) return [];
    return [
      {
        surface: `card:${index}:${username}`,
        username,
        container,
        anchor: findUserCardFollowButton(card) ?? findUserCardActionButtons(card).at(-1),
        name: userCardDisplayName(card, username),
        avatarUrl: userCardAvatarUrl(card),
        wrapWithListItem: container.matches("ul, ol"),
        noteContainer: findUserCardNamesContainer(card) ?? undefined
      }
    ];
  });
}

function findUserCards(): HTMLElement[] {
  const selectors = [
    ".user-card",
    ".user-card.show",
    ".user-card-container .user-card",
    ".user-card-content",
    "#user-card",
    ".card-content"
  ];
  const cards = Array.from(document.querySelectorAll<HTMLElement>(selectors.join(",")));
  return cards.filter((card, index) => cards.findIndex((candidate) => candidate === card || candidate.contains(card)) === index);
}

function userCardUsername(card: HTMLElement): Username | null {
  const direct = card.dataset.userCardUsername ?? card.dataset.username ?? card.getAttribute("data-user-card") ?? "";
  if (direct.trim()) return normalizeUsername(direct);
  const link = card.querySelector<HTMLAnchorElement>('a[href^="/u/"], a[href*="linux.do/u/"]');
  return link ? extractUsername(link) ?? null : null;
}

function findUserCardActionContainer(card: HTMLElement): HTMLElement | null {
  const followButton = findUserCardFollowButton(card);
  if (followButton) return userCardButtonListContainer(followButton) ?? followButton.parentElement;
  const firstButton = findUserCardActionButtons(card).at(0);
  return firstButton ? userCardButtonListContainer(firstButton) ?? firstButton.parentElement : null;
}

function userCardButtonListContainer(button: HTMLElement): HTMLElement | null {
  const listItem = button.closest("li");
  const list = listItem?.parentElement;
  return list?.matches("ul, ol") ? list : null;
}

function findUserCardFollowButton(card: HTMLElement): HTMLElement | null {
  return findUserCardActionButtons(card).find((button) => {
    const text = button.textContent?.replace(/\s+/g, "") ?? "";
    return text.includes("关注") || text.includes("Follow") || text.includes("Unfollow");
  }) ?? null;
}

function findUserCardActionButtons(card: HTMLElement): HTMLElement[] {
  const selectors = [
    ".controls button",
    ".controls .btn",
    ".usercard-controls button",
    ".usercard-controls .btn",
    ".user-card-controls button",
    ".user-card-controls .btn",
    ".card-controls button",
    ".card-controls .btn",
    ".buttons button",
    ".buttons .btn"
  ];
  return Array.from(card.querySelectorAll<HTMLElement>(selectors.join(","))).filter((button) => !button.classList.contains(profileActionButtonClass));
}

function userCardDisplayName(card: HTMLElement, username: Username): string | undefined {
  const candidates = [
    ".names .full-name",
    ".names .name",
    ".full-name",
    ".name",
    ".display-name",
    "h1",
    "h2"
  ];
  for (const selector of candidates) {
    const text = card.querySelector<HTMLElement>(selector)?.textContent?.trim();
    if (text && normalizeIdentityText(text) !== username) return text;
  }
  return undefined;
}

function findProfileNamesContainer(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".user-main .names, .user-profile .names, .user-main .user-profile-names, .user-profile .user-profile-names");
}

function findUserCardNamesContainer(card: HTMLElement): HTMLElement | null {
  return card.querySelector<HTMLElement>(".names, .user-card-names, .usercard-names");
}

function userCardAvatarUrl(card: HTMLElement): string | undefined {
  const avatar = card.querySelector<HTMLImageElement>(
    "img.avatar, img.user-avatar, img[src*='/user_avatar/'], img[src*='/letter_avatar/']"
  );
  return avatar?.src || undefined;
}

function ensureFriendActionButton(surface: string) {
  const selector = `.${profileActionButtonClass}[${friendActionSurfaceAttr}="${cssEscape(surface)}"]`;
  let button = document.querySelector<HTMLButtonElement>(selector);
  if (button) return button;
  button = document.createElement("button");
  if (surface === "profile") button.id = profileActionButtonId;
  button.type = "button";
  button.className = `btn btn-primary ${profileActionButtonClass}`;
  button.setAttribute(friendActionSurfaceAttr, surface);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void toggleFriendAction(button);
  });
  return button;
}

function updateFriendActionButton(button: HTMLButtonElement, state: AppState, target: FriendActionTarget) {
  const active = Boolean(state.friends[target.username]);
  button.dataset.username = target.username;
  button.dataset.name = target.name ?? "";
  button.dataset.avatarUrl = target.avatarUrl ?? "";
  button.dataset.linuxdoFriendsActive = active ? "true" : "false";
  button.disabled = false;
  button.title = active ? "从我的佬朋友中移除" : "添加为我的佬朋友";
  button.setAttribute("aria-label", active ? "取消视奸" : "视奸");
  button.replaceChildren(discourseProfileActionIcon(active), document.createTextNode(active ? "取消视奸" : "视奸"));
}

function placeFriendActionButton(button: HTMLButtonElement, target: FriendActionTarget) {
  const node = target.wrapWithListItem ? ensureFriendActionWrapper(button, target.surface) : button;
  const anchorNode = target.anchor ? childUnderContainer(target.anchor, target.container) : null;
  if (node.parentElement !== target.container) {
    if (anchorNode) {
      target.container.insertBefore(node, anchorNode.nextSibling);
    } else {
      target.container.append(node);
    }
    return;
  }
  if (anchorNode && anchorNode.nextSibling !== node) {
    target.container.insertBefore(node, anchorNode.nextSibling);
  }
}

function ensureFriendActionWrapper(button: HTMLButtonElement, surface: string) {
  const existing = button.closest<HTMLElement>(`.${friendActionWrapperClass}`);
  if (existing) return existing;
  const wrapper = document.createElement("li");
  wrapper.className = friendActionWrapperClass;
  wrapper.setAttribute(friendActionSurfaceAttr, surface);
  wrapper.append(button);
  return wrapper;
}

function childUnderContainer(element: HTMLElement, container: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = element;
  while (current && current.parentElement && current.parentElement !== container) {
    current = current.parentElement;
  }
  return current?.parentElement === container ? current : null;
}

function removeFriendActionButton(button: HTMLButtonElement) {
  const wrapper = button.closest<HTMLElement>(`.${friendActionWrapperClass}`);
  if (wrapper) {
    wrapper.remove();
    return;
  }
  button.remove();
}

function updateFriendNoteSurface(state: AppState, target: FriendActionTarget) {
  const friend = state.friends[target.username];
  if (!friend) {
    removeFriendNoteSurface(target.surface);
    return;
  }
  placeFriendNoteRow(friend.note, target);
}

function placeFriendNoteRow(note: string, target: FriendActionTarget) {
  const container = target.noteContainer;
  if (!container) {
    removeFriendNoteSurface(target.surface);
    return;
  }
  const host = ensureFriendNoteRowHost(target.surface);
  host.dataset.username = target.username;
  container.classList.add(friendNoteContainerClass);
  if (host.parentElement !== container || container.lastElementChild !== host) container.append(host);
  const mount = friendNoteRowRoots.get(host) ?? createFriendNoteRowRoot(host);
  mount.rootElement.dataset.linuxdoFriendsTheme = currentPageTheme();
  const surface = target.surface === "profile" ? "profile" : "user-card";
  const hasNote = Boolean(note.trim());
  const openEditor = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    openFriendNoteDialogForUsername(target.username);
  };
  mount.root.render(
    React.createElement(
      "div",
      { className: `friend-note-inline-row friend-note-inline-row-${surface}` },
      hasNote
        ? React.createElement(FriendNotePreview, {
            note,
            surface,
            tooltipPortalTarget: ensureFriendNoteTooltipRoot()
          })
        : React.createElement(
            "button",
            {
              "aria-label": "添加好友备注",
              className: "friend-note-placeholder",
              onClick: openEditor,
              title: "添加好友备注",
              type: "button"
            },
            "视奸备注"
          ),
      React.createElement(FriendNoteEditButton, {
        ariaLabel: "编辑好友备注",
        className: "friend-note-edit-button",
        disabled: false,
        note,
        onClick: openEditor,
        showNoteTooltip: true,
        title: "编辑好友备注",
        tooltipPortalTarget: hasNote ? ensureFriendNoteTooltipRoot() : undefined,
        username: target.username
      })
    )
  );
}

function ensureFriendNoteTooltipRoot() {
  const existingHost = document.getElementById(friendNoteTooltipHostId);
  if (friendNoteTooltipRootElement && existingHost) return friendNoteTooltipRootElement;
  const host = document.createElement("div");
  host.id = friendNoteTooltipHostId;
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = appCss;
  const rootElement = document.createElement("div");
  rootElement.className = "linuxdo-friends-menu-root linuxdo-friends-note-tooltip-root";
  rootElement.dataset.linuxdoFriendsTheme = currentPageTheme();
  shadow.append(style, rootElement);
  document.body.append(host);
  friendNoteTooltipRootElement = rootElement;
  return rootElement;
}

function sweepDetachedFriendNoteRows() {
  friendNoteRowRoots.forEach((mount, host) => {
    if (host.isConnected) return;
    mount.root.unmount();
    friendNoteRowRoots.delete(host);
  });
}

function createFriendNoteRowRoot(host: HTMLElement) {
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = appCss;
  const rootElement = document.createElement("div");
  rootElement.className = "linuxdo-friends-menu-root linuxdo-friends-note-row-root";
  rootElement.dataset.linuxdoFriendsTheme = currentPageTheme();
  shadow.append(style, rootElement);
  const mount = { root: createRoot(rootElement), rootElement };
  friendNoteRowRoots.set(host, mount);
  return mount;
}

function renderPostFriendNote(link: HTMLAnchorElement, username: Username, note: string) {
  if (!isTopicPostDisplayNameLink(link) || !link.textContent?.trim() || !note.trim()) return null;
  const host = ensurePostFriendNoteHost(link);
  if (!host) return null;
  host.dataset.username = username;
  const mount = postFriendNoteRoots.get(host) ?? createPostFriendNoteRoot(host);
  mount.rootElement.dataset.linuxdoFriendsTheme = currentPageTheme();
  mount.root.render(
    React.createElement(FriendNotePreview, {
      note,
      surface: "post",
      tooltipPortalTarget: ensureFriendNoteTooltipRoot()
    })
  );
  return host;
}

function isTopicPostDisplayNameLink(link: HTMLAnchorElement) {
  return (
    location.pathname.startsWith("/t/") &&
    link.matches(".topic-post .topic-meta-data > .names.trigger-user-card .full-name > a[data-user-card]")
  );
}

function ensurePostFriendNoteHost(link: HTMLAnchorElement) {
  const container = link.parentElement;
  if (!container) return null;
  const existing = Array.from(container.children).find(
    (element): element is HTMLElement => element instanceof HTMLElement && element.classList.contains(postFriendNoteClass)
  );
  if (existing && postFriendNoteRoots.has(existing)) {
    if (existing.previousElementSibling !== link) link.after(existing);
    return existing;
  }
  existing?.remove();
  const host = document.createElement("span");
  host.className = postFriendNoteClass;
  link.after(host);
  return host;
}

function createPostFriendNoteRoot(host: HTMLElement) {
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = appCss;
  const rootElement = document.createElement("span");
  rootElement.className = "linuxdo-friends-menu-root linuxdo-friends-post-note-root";
  rootElement.dataset.linuxdoFriendsTheme = currentPageTheme();
  shadow.append(style, rootElement);
  const mount = { root: createRoot(rootElement), rootElement };
  postFriendNoteRoots.set(host, mount);
  return mount;
}

function sweepDetachedPostFriendNotes() {
  postFriendNoteRoots.forEach((_mount, host) => {
    if (!host.isConnected) removePostFriendNoteElement(host);
  });
}

function reconcilePostFriendNotes(activeHosts: Set<HTMLElement>) {
  postFriendNoteRoots.forEach((_mount, host) => {
    if (!activeHosts.has(host) || !host.isConnected) removePostFriendNoteElement(host);
  });
  document.querySelectorAll<HTMLElement>(`.${postFriendNoteClass}`).forEach((host) => {
    if (!activeHosts.has(host)) removePostFriendNoteElement(host);
  });
}

function removePostFriendNoteElement(host: HTMLElement) {
  postFriendNoteRoots.get(host)?.root.unmount();
  postFriendNoteRoots.delete(host);
  host.remove();
}

function ensureFriendNoteRowHost(surface: string) {
  const selector = `.${friendNoteRowClass}[${friendActionSurfaceAttr}="${cssEscape(surface)}"]`;
  const existing = document.querySelector<HTMLElement>(selector);
  if (existing) return existing;
  const host = document.createElement("div");
  host.className = friendNoteRowClass;
  host.setAttribute(friendActionSurfaceAttr, surface);
  return host;
}

function removeFriendNoteSurface(surface: string) {
  document.querySelectorAll<HTMLElement>(`.${friendNoteRowClass}[${friendActionSurfaceAttr}="${cssEscape(surface)}"]`).forEach(removeFriendNoteElement);
}

function removeFriendNoteElement(element: HTMLElement) {
  const container = element.parentElement;
  friendNoteRowRoots.get(element)?.root.unmount();
  friendNoteRowRoots.delete(element);
  element.remove();
  container?.classList.remove(friendNoteContainerClass);
}

function openFriendNoteDialogForUsername(username: Username) {
  const friend = latestState?.friends[username];
  if (!friend) return;
  openFriendNoteDialog(username, friend.note);
}

function openFriendNoteDialog(username: Username, initialNote: string) {
  const rootNode = ensureFriendNoteDialogRoot();
  friendNoteDialogUsername = username;
  rootNode.dataset.linuxdoFriendsTheme = currentPageTheme();
  friendNoteDialogRoot?.render(
    React.createElement(FriendNoteDialog, {
      username,
      initialNote,
      onClose: closeFriendNoteDialog,
      onSave: (note: string) => saveFriendNote(username, note)
    })
  );
}

function ensureFriendNoteDialogRoot() {
  if (friendNoteDialogRootElement && friendNoteDialogRoot) return friendNoteDialogRootElement;
  const host = document.createElement("div");
  host.id = friendNoteDialogHostId;
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = appCss;
  const rootNode = document.createElement("div");
  rootNode.className = "linuxdo-friends-menu-root linuxdo-friends-note-dialog-root";
  rootNode.dataset.linuxdoFriendsTheme = currentPageTheme();
  shadow.append(style, rootNode);
  document.body.append(host);
  friendNoteDialogRootElement = rootNode;
  friendNoteDialogRoot = createRoot(rootNode);
  return rootNode;
}

async function saveFriendNote(username: Username, note: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!latestState?.friends[username]) {
    closeFriendNoteDialog();
    return { ok: false, error: "该用户已不在佬朋友中。" };
  }
  try {
    const response = await chrome.runtime.sendMessage({ type: "updateFriend", username, patch: { note } });
    if (!response?.ok) {
      return { ok: false, error: response?.error ?? "备注保存失败。" };
    }
    if (!response.data?.friends?.[username]) {
      latestState = response.data;
      markFriends(response.data);
      enhanceFriendActions(response.data);
      return { ok: false, error: "该用户已不在佬朋友中。" };
    }
    latestState = response.data;
    markFriends(response.data);
    enhanceFriendActions(response.data);
    closeFriendNoteDialog();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "备注保存失败。" };
  }
}

function closeFriendNoteDialog() {
  friendNoteDialogRoot?.unmount();
  friendNoteDialogRoot = null;
  friendNoteDialogRootElement = null;
  friendNoteDialogUsername = null;
  document.getElementById(friendNoteDialogHostId)?.remove();
}

async function toggleFriendAction(button: HTMLButtonElement) {
  const username = button.dataset.username ? normalizeUsername(button.dataset.username) : currentProfileUsername();
  if (!username || button.disabled) return;
  const active = button.dataset.linuxdoFriendsActive === "true";
  button.disabled = true;
  button.replaceChildren(discourseProfileActionIcon(active), document.createTextNode(active ? "取消中..." : "视奸中..."));
  try {
    const response = active
      ? await chrome.runtime.sendMessage({ type: "removeFriend", username })
      : await chrome.runtime.sendMessage({ type: "addFriendFromKnownUser", user: knownUserFromFriendAction(button, username) });
    if (!response?.ok) throw new Error(response?.error ?? "操作失败。");
    latestState = response.data;
    markFriends(response.data);
    enhanceFriendActions(response.data);
  } catch {
    button.disabled = false;
    if (latestState) {
      updateFriendActionButton(button, latestState, {
        surface: button.dataset.linuxdoFriendsSurface ?? "profile",
        username,
        container: button.parentElement ?? document.body,
        name: button.dataset.name || undefined,
        avatarUrl: button.dataset.avatarUrl || undefined
      });
    }
  }
}

function knownUserFromFriendAction(button: HTMLButtonElement, username: Username): FollowedUserInput {
  return {
    username,
    name: button.dataset.name || profilePageDisplayName(username),
    avatarUrl: button.dataset.avatarUrl || profilePageAvatarUrl()
  };
}

function profilePageDisplayName(username: Username): string | undefined {
  const candidates = [
    ".user-main .names .full-name",
    ".user-main .names .name",
    ".user-main .names h1",
    ".user-main h1",
    ".user-profile .names .full-name",
    ".user-profile .names .name",
    ".user-profile h1"
  ];
  for (const selector of candidates) {
    const text = document.querySelector<HTMLElement>(selector)?.textContent?.trim();
    if (text && normalizeIdentityText(text) !== username) return text;
  }
  return undefined;
}

function profilePageAvatarUrl(): string | undefined {
  const avatar = document.querySelector<HTMLImageElement>(
    ".user-main img.avatar, .user-main img.user-avatar, .user-main img[src*='/user_avatar/'], .user-main img[src*='/letter_avatar/'], .user-profile img.avatar, .user-profile img.user-avatar, .user-profile img[src*='/user_avatar/'], .user-profile img[src*='/letter_avatar/']"
  );
  if (!avatar?.src) return undefined;
  return avatar.src;
}

function discourseProfileActionIcon(active: boolean) {
  const span = document.createElement("span");
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = active
    ? '<svg class="fa d-icon d-icon-user-times svg-icon fa-width-auto svg-string" width="1em" height="1em" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><use href="#user-times"></use></svg>'
    : discourseFriendIconSvg();
  return span;
}

function clearMarkers() {
  document.querySelectorAll(`.${markerClass}`).forEach((marker) => marker.remove());
  document.querySelectorAll(`.${friendAvatarClass}`).forEach((marker) => marker.classList.remove(friendAvatarClass));
  document.querySelectorAll(`.${friendNameMarkClass}`).forEach((marker) => unwrapElement(marker));
}

function isProfileIdentityLink(link: HTMLAnchorElement): boolean {
  try {
    const url = new URL(link.href, location.origin);
    if (url.hostname !== "linux.do" && url.origin !== location.origin) return false;
    const parts = url.pathname.split("/").filter(Boolean);
    return parts.length === 2 && parts[0] === "u" && Boolean(parts[1]);
  } catch {
    return false;
  }
}

function markAvatarElements(link: HTMLAnchorElement) {
  const avatarSelector = [
    "img.avatar",
    "img.user-avatar",
    "img[src*='/user_avatar/']",
    "img[src*='/letter_avatar/']",
    ".avatar img",
    ".user-avatar img"
  ].join(",");
  for (const avatar of link.querySelectorAll<HTMLElement>(avatarSelector)) {
    avatar.classList.add(friendAvatarClass);
  }
}

function markNameText(link: HTMLAnchorElement, displayName: string | null) {
  if (!displayName) return;
  const target = findNameTextNode(link, displayName);
  if (!target?.textContent?.trim()) return;
  const wrapper = document.createElement("span");
  wrapper.className = friendNameMarkClass;
  target.parentNode?.insertBefore(wrapper, target);
  wrapper.append(target);
}

function findNameTextNode(link: HTMLAnchorElement, displayName: string): Text | null {
  const walker = document.createTreeWalker(link, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.textContent?.trim();
      if (!text || !isSameDisplayName(text, displayName)) return NodeFilter.FILTER_REJECT;
      if (node.parentElement?.closest("svg, img, .avatar, .user-avatar, .username, .user-name, .mention")) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  return walker.nextNode() as Text | null;
}

function getFriendDisplayName(state: AppState, username: Username): string | null {
  const rawName = state.friendProfiles[username]?.name ?? state.followedUsers[username]?.name;
  const displayName = rawName?.trim();
  if (!displayName) return null;
  if (normalizeIdentityText(displayName) === username) return null;
  return displayName;
}

function isSameDisplayName(text: string, displayName: string) {
  return normalizeDisplayText(text) === normalizeDisplayText(displayName);
}

function normalizeDisplayText(text: string) {
  return text.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function normalizeIdentityText(text: string) {
  return text.trim().replace(/^@/, "").toLocaleLowerCase();
}

function cssEscape(value: string) {
  return globalThis.CSS?.escape ? globalThis.CSS.escape(value) : value.replace(/["\\]/g, "\\$&");
}

function unwrapElement(element: Element) {
  const parent = element.parentNode;
  if (!parent) return;
  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element);
  }
  element.remove();
}

async function openFriendsUserMenu() {
  const existingMenu = findUserMenu();
  if (!existingMenu) {
    const toggle = document.querySelector<HTMLButtonElement>("#toggle-current-user");
    toggle?.click();
  }

  const menu = (await waitForUserMenu()) ?? findUserMenu();
  if (!menu) return;
  enhanceUserMenu();
  openUserMenuPanel(menu);
}

function waitForUserMenu() {
  return new Promise<HTMLElement | null>((resolve) => {
    const existingMenu = findUserMenu();
    if (existingMenu) {
      resolve(existingMenu);
      return;
    }

    let settled = false;
    const observer = new MutationObserver(() => {
      const menu = findUserMenu();
      if (menu) finish(menu);
    });
    const timer = window.setTimeout(() => finish(null), 800);

    function finish(menu: HTMLElement | null) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      observer.disconnect();
      resolve(menu);
    }

    observer.observe(document.body, { childList: true, subtree: true });
  });
}

function placeLauncher(launcher: HTMLButtonElement): boolean {
  const currentUserItem = findCurrentUserHeaderItem();
  if (currentUserItem?.parentElement) {
    if (currentUserItem.tagName.toLowerCase() === "li") {
      const wrapper = ensureLauncherHeaderItem(launcher);
      if (wrapper.parentElement !== currentUserItem.parentElement || wrapper.nextElementSibling !== currentUserItem) {
        currentUserItem.parentElement.insertBefore(wrapper, currentUserItem);
      }
      dockLauncherToHeader(launcher);
      return true;
    }
    moveLauncherDirectlyBefore(launcher, currentUserItem);
    dockLauncherToHeader(launcher);
    return true;
  }

  const anchor = findLauncherAnchor();
  if (anchor?.parentElement) {
    moveLauncherDirectlyBefore(launcher, anchor);
    dockLauncherToHeader(launcher);
    return true;
  }
  return false;
}

function ensureLauncherHeaderItem(launcher: HTMLButtonElement) {
  const existingWrapper = launcher.closest<HTMLElement>(".linuxdo-friends-header-item");
  if (existingWrapper) return existingWrapper;
  const wrapper = document.createElement("li");
  wrapper.className = "header-dropdown-toggle linuxdo-friends-header-item";
  wrapper.append(launcher);
  return wrapper;
}

function moveLauncherDirectlyBefore(launcher: HTMLButtonElement, anchor: HTMLElement) {
  const parent = anchor.parentElement;
  if (!parent) return;
  const wrapper = launcher.closest<HTMLElement>(".linuxdo-friends-header-item");
  if (wrapper) {
    parent.insertBefore(launcher, anchor);
    if (!wrapper.contains(launcher)) wrapper.remove();
    removeEmptyLauncherWrappers();
    return;
  }
  if (launcher.parentElement !== parent || launcher.nextElementSibling !== anchor) {
    parent.insertBefore(launcher, anchor);
  }
}

function removeEmptyLauncherWrappers() {
  document.querySelectorAll<HTMLElement>(".linuxdo-friends-header-item").forEach((wrapper) => {
    if (!wrapper.querySelector(`#${launcherId}`)) wrapper.remove();
  });
}

function dockLauncherToHeader(launcher: HTMLButtonElement) {
  launcher.style.cssText = launcherStyle();
}

function dockLauncherToFallback(launcher: HTMLButtonElement) {
  const wrapper = launcher.closest<HTMLElement>(".linuxdo-friends-header-item");
  if (wrapper) {
    document.body.append(launcher);
    wrapper.remove();
  } else if (launcher.parentElement !== document.body) {
    document.body.append(launcher);
  }
  launcher.style.cssText = fallbackLauncherStyle();
}

function findCurrentUserHeaderItem(): HTMLElement | null {
  const currentUser = document.querySelector<HTMLElement>(".d-header-icons .current-user, header .current-user");
  if (!currentUser) return null;
  return (
    currentUser.closest<HTMLElement>(".header-dropdown-toggle") ??
    currentUser.closest<HTMLElement>("li") ??
    currentUser
  );
}

function findLauncherAnchor(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>(".d-header-icons .current-user, header .current-user") ??
    document.querySelector<HTMLElement>(".d-header-icons") ??
    null
  );
}

function launcherStyle() {
  return [
    "margin:0",
    "vertical-align:middle",
    "position:relative"
  ].join(";");
}

function fallbackLauncherStyle() {
  return [
    launcherStyle(),
    "position:fixed",
    "top:12px",
    "right:72px",
    "z-index:999999"
  ].join(";");
}

function createLauncherStatusDot() {
  const dot = document.createElement("span");
  dot.className = "linuxdo-friends-launcher-status-dot";
  dot.setAttribute("aria-hidden", "true");
  dot.textContent = "×";
  dot.style.cssText = [
    "position:absolute",
    "right:5px",
    "bottom:4px",
    "display:none",
    "width:11px",
    "height:11px",
    "place-items:center",
    "color:#ef4444",
    "font-size:12px",
    "font-weight:800",
    "line-height:1",
    "text-shadow:0 1px 1px rgb(0 0 0 / 0.35)",
    "pointer-events:none"
  ].join(";");
  return dot;
}

function updateLauncherStatusDot(status: "pending" | "connected" | "disconnected") {
  lastHeartbeatStatus = status;
  const dot = document.querySelector<HTMLElement>("#linuxdo-friends-launcher .linuxdo-friends-launcher-status-dot");
  if (!dot) return;
  dot.style.display = status === "disconnected" ? "grid" : "none";
}

function startHeartbeat() {
  sendHeartbeat();
  startHeartbeatTitleObserver();
  if (heartbeatTimer != null) return;
  heartbeatTimer = window.setInterval(sendHeartbeat, heartbeatIntervalMs);
}

function startHeartbeatTitleObserver() {
  if (heartbeatTitleObserver != null || !document.head) return;
  heartbeatTitleObserver = new MutationObserver((mutations) => {
    if (mutationsContainTitleChange(mutations)) {
      scheduleHeartbeatRefresh();
    }
  });
  heartbeatTitleObserver.observe(document.head, {
    childList: true,
    characterData: true,
    subtree: true
  });
}

function scheduleHeartbeatRefresh() {
  if (typeof window === "undefined") return;
  if (heartbeatChangeTimer != null) {
    window.clearTimeout(heartbeatChangeTimer);
  }
  heartbeatChangeTimer = window.setTimeout(() => {
    heartbeatChangeTimer = null;
    sendHeartbeat();
  }, heartbeatChangeDebounceMs);
}

function sendHeartbeat() {
  try {
    const message = {
      type: "linuxdoFriends.pageHeartbeat",
      url: location.href,
      title: document.title,
      status: pageHeartbeatStatus(),
      hasLauncher: Boolean(document.getElementById(launcherId))
    };
    void chrome.runtime.sendMessage(message).then(
      () => updateLauncherStatusDot("connected"),
      () => updateLauncherStatusDot("disconnected")
    );
  } catch {
    updateLauncherStatusDot("disconnected");
  }
}

function pageHeartbeatStatus() {
  const title = document.title.trim().toLowerCase();
  const challengeTitle = title === "just a moment..." || title === "just a moment…";
  // Normal Turnstile widgets leave hidden cf-chl-widget-* inputs on ready pages.
  const challengeElement = document.querySelector(
    "#challenge-error-text, #challenge-running, script[src*='/cdn-cgi/challenge-platform/'], form[action*='/cdn-cgi/challenge-platform/']"
  );
  return challengeTitle || challengeElement ? "challenge" : "ready";
}

function mutationsContainTitleChange(mutations: MutationRecord[]): boolean {
  for (const mutation of mutations) {
    if (nodeTouchesTitle(mutation.target)) return true;
    for (const node of mutation.addedNodes) {
      if (nodeTouchesTitle(node)) return true;
    }
    for (const node of mutation.removedNodes) {
      if (nodeTouchesTitle(node)) return true;
    }
  }
  return false;
}

function nodeTouchesTitle(node: Node): boolean {
  if (node.nodeName === "TITLE") return true;
  if (node.parentNode?.nodeName === "TITLE") return true;
  if (typeof Element === "undefined" || !(node instanceof Element)) return false;
  return Boolean(node.querySelector("title"));
}

function discourseFriendIconSvg() {
  return [
    '<svg class="fa d-icon d-icon-user-group svg-icon fa-width-auto svg-string" width="1em" height="1em" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">',
    '<use href="#user-group"></use>',
    "</svg>"
  ].join("");
}

function userMenuPanelCss() {
  return `
    :host {
      color-scheme: inherit;
      all: initial;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .linuxdo-friends-menu-root {
      position: relative;
      width: 100%;
      height: 100%;
      min-height: 0;
      overflow-x: hidden;
      overflow-y: auto;
      background: var(--app-bg);
    }
    .linuxdo-friends-menu-root .shell {
      width: 100%;
      min-height: 100%;
      height: auto;
      padding: 10px;
    }
    .linuxdo-friends-menu-root .sticky-top {
      margin: -10px -10px 8px;
      padding: 10px 10px 1px;
    }
    .linuxdo-friends-menu-root .header {
      gap: 10px;
      margin-bottom: 10px;
    }
    .linuxdo-friends-menu-root .header h1 {
      font-size: 20px;
    }
    .linuxdo-friends-menu-root .tab-action-row {
      margin-top: 6px;
    }
    .linuxdo-friends-menu-root .modal-backdrop {
      position: absolute;
      inset: 0;
      align-items: stretch;
      justify-content: stretch;
      padding: 8px;
      background: var(--overlay);
    }
    .linuxdo-friends-menu-root .modal {
      width: 100%;
      height: 100%;
      max-height: none;
      min-width: 0;
      padding: 10px;
      box-shadow: none;
    }
    .linuxdo-friends-menu-root .modal-head {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: start;
      gap: 8px;
    }
    .linuxdo-friends-menu-root .modal-head > div {
      grid-column: 1;
      grid-row: 1;
    }
    .linuxdo-friends-menu-root .modal-head .icon-button {
      grid-column: 2;
      grid-row: 1;
      justify-self: end;
    }
    .linuxdo-friends-menu-root .modal-head .small-action {
      grid-row: 2;
      grid-column: 1 / -1;
      justify-content: center;
      width: 100%;
      max-width: 100%;
    }
    .linuxdo-friends-menu-root .modal-list {
      margin-right: 0;
      padding-right: 4px;
    }
  `;
}

function subscribeToStorageChanges() {
  try {
    chrome.storage?.onChanged?.addListener((_changes, areaName) => {
      if (areaName === "local") {
        void init();
      }
    });
  } catch {
    // Content script must stay non-breaking if extension APIs are unavailable in tests or restricted pages.
  }
}

function subscribeToRuntimeMessages() {
  try {
    chrome.runtime?.onMessage?.addListener((message: unknown, _sender, sendResponse) => {
      if (!isContentScriptCommand(message)) return false;
      const response = runContentScriptCommand(message);
      void response.then(sendResponse);
      return true;
    });
  } catch {
    // Content script must keep page enhancement working even if runtime messaging is unavailable.
  }
}

function runContentScriptCommand(message: ContentScriptCommand): Promise<ContentScriptResponse> {
  if (message.type === "linuxdoFriends.extractCurrentAccount") return extractCurrentAccountFromPage();
  if (message.type === "linuxdoFriends.extractFollowing") return extractFollowingFromPage();
  if (message.type === "linuxdoFriends.extractProfile") return extractProfileFromPage(message.username);
  if (message.type === "linuxdoFriends.extractAvatar") return extractAvatarFromPage(message.username, message.avatarUrl);
  if (message.type === "linuxdoFriends.navigateInPage") return navigateInPage(message.url);
  if (message.step) return extractActivityStepFromPage(message.username, message.step);
  return extractActivityFromPage(message.username, message.kind ?? "all");
}

export async function navigateInPage(url: string, deps: NavigationDeps = {}): Promise<ContentScriptNavigationResponse> {
  let target: URL;
  try {
    target = new URL(url, "https://linux.do");
  } catch {
    return { ok: false, reason: "unavailable", error: "动态地址无效。" };
  }
  if (target.origin !== "https://linux.do") {
    return { ok: false, reason: "unavailable", error: "只能在 linux.do 页面内跳转站内动态。" };
  }

  const before = deps.currentHref?.() ?? window.location.href;
  const relativeHref = `${target.pathname}${target.search}${target.hash}`;
  const clickLink = deps.clickLink ?? clickInSiteLink;
  const assign = deps.assign ?? ((href: string) => window.location.assign(href));
  const delay = deps.delay ?? (() => new Promise<void>((resolve) => window.setTimeout(resolve, 0)));
  clickLink(relativeHref);
  await delay();
  if ((deps.currentHref?.() ?? window.location.href) === before) {
    assign(target.href);
  }
  return { ok: true, url: target.href };
}

function clickInSiteLink(href: string) {
  const link = document.createElement("a");
  link.href = href;
  link.dataset.linuxdoFriendsNavigation = "true";
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
}

async function extractCurrentAccountFromPage(): Promise<ContentScriptCurrentAccountResponse> {
  const login = await fetchJson("/latest.json");
  if (!login.ok) {
    return { ok: false, reason: login.reason, error: login.error, requestCount: login.requestCount, requestAttemptedAts: login.requestAttemptedAts };
  }
  const username = login.response.headers.get("x-discourse-username")?.trim().replace(/^@/, "").toLowerCase();
  if (!username) {
    return { ok: false, reason: "unavailable", error: "当前 linux.do 页面没有识别到登录账号。", requestCount: login.requestCount, requestAttemptedAts: login.requestAttemptedAts };
  }
  return { ok: true, username, requestCount: login.requestCount, requestAttemptedAts: login.requestAttemptedAts };
}

async function extractFollowingFromPage(): Promise<ContentScriptFollowingResponse> {
  const account = await extractCurrentAccountFromPage();
  if (!account.ok) {
    return account;
  }
  const { username } = account;
  const following = await fetchJson(`/u/${encodeURIComponent(username)}/follow/following.json`);
  const requestCount = (account.requestCount ?? 0) + following.requestCount;
  const requestAttemptedAts = [...(account.requestAttemptedAts ?? []), ...following.requestAttemptedAts];
  if (!following.ok) {
    return { ok: false, reason: following.reason, error: following.error, requestCount, requestAttemptedAts };
  }
  return { ok: true, username, users: extractFollowedUsers(following.json), requestCount, requestAttemptedAts };
}

async function extractProfileFromPage(username: Username): Promise<ContentScriptProfileResponse> {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) {
    return { ok: false, reason: "unavailable", error: "缺少要添加的用户名。" };
  }
  const profile = await fetchJson(`/u/${encodeURIComponent(normalizedUsername)}.json`);
  if (!profile.ok) {
    return { ok: false, reason: profile.reason, error: profile.error, requestCount: profile.requestCount, requestAttemptedAts: profile.requestAttemptedAts };
  }
  try {
    return { ok: true, profile: extractFriendProfile(profile.json), requestCount: profile.requestCount, requestAttemptedAts: profile.requestAttemptedAts };
  } catch {
    return { ok: false, reason: "invalid_response", error: "linux.do 返回的用户资料格式不完整。", requestCount: profile.requestCount, requestAttemptedAts: profile.requestAttemptedAts };
  }
}

async function extractActivityFromPage(
  username: Username,
  kind: ActivityKindFilter | ActivityRefreshRequestKind = "all"
): Promise<ContentScriptActivityResponse> {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) {
    return { ok: false, reason: "unavailable", error: "缺少要刷新的好友用户名。" };
  }
  const items: ActivityItem[] = [];
  let requestCount = 0;
  const requestAttemptedAts: string[] = [];
  for (const step of activityRequestStepsForUser(normalizedUsername, kind)) {
    const response = await fetchJson(step.path);
    requestCount += response.requestCount;
    requestAttemptedAts.push(...response.requestAttemptedAts);
    if (!response.ok) return { ok: false, reason: response.reason, error: response.error, requestCount, requestAttemptedAts };
    items.push(...normalizeStepItems(normalizedUsername, step.kind, response.json));
  }
  return { ok: true, activity: summaryFromItems(normalizedUsername, items), requestCount, requestAttemptedAts };
}

async function extractActivityStepFromPage(
  username: Username,
  step: { kind: ActivityRefreshRequestKind; path: string }
): Promise<ContentScriptActivityResponse> {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) {
    return { ok: false, reason: "unavailable", error: "缺少要刷新的好友用户名。" };
  }
  const response = await fetchJson(step.path);
  if (!response.ok) return { ok: false, reason: response.reason, error: response.error, requestCount: response.requestCount, requestAttemptedAts: response.requestAttemptedAts };
  return {
    ok: true,
    activity: summaryFromItems(normalizedUsername, normalizeStepItems(normalizedUsername, step.kind, response.json)),
    requestCount: response.requestCount,
    requestAttemptedAts: response.requestAttemptedAts
  };
}

async function extractAvatarFromPage(
  username: Username,
  avatarUrl: string
): Promise<ContentScriptAvatarResponse> {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername || !isLinuxDoAvatarUrl(avatarUrl)) {
    return { ok: false, reason: "unavailable", error: "头像地址不在允许范围内。" };
  }
  let requestedAt: string | null = null;
  try {
    const url = new URL(avatarUrl);
    const requestCount = 1;
    requestedAt = new Date().toISOString();
    const response = await fetch(`${url.pathname}${url.search}`, {
      credentials: "same-origin",
      headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8" }
    });
    if (!response.ok) {
      return { ok: false, reason: response.status === 429 ? "rate_limited" : "network_error", error: `头像加载失败：${response.status}`, requestCount, requestAttemptedAts: [requestedAt] };
    }
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "image/png";
    if (!["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"].includes(contentType)) {
      return { ok: false, reason: "invalid_response", error: "头像响应不是图片。", requestCount, requestAttemptedAts: [requestedAt] };
    }
    const blob = await response.blob();
    if (blob.size > 96_000) {
      return { ok: false, reason: "invalid_response", error: "头像图片过大，未缓存。", requestCount, requestAttemptedAts: [requestedAt] };
    }
    return {
      ok: true,
      username: normalizedUsername,
      sourceUrl: avatarUrl,
      dataUrl: await blobToDataUrl(blob),
      contentType,
      byteLength: blob.size,
      requestCount,
      requestAttemptedAts: [requestedAt]
    };
  } catch {
    return { ok: false, reason: "network_error", error: "页面内头像加载失败。", requestCount: 1, requestAttemptedAts: [requestedAt ?? new Date().toISOString()] };
  }
}

async function fetchJson(path: string): Promise<
  | { ok: true; response: Response; json: unknown; requestCount: number; requestAttemptedAts: string[] }
  | { ok: false; reason: RefreshFailureReason | "unavailable"; error: string; requestCount: number; requestAttemptedAts: string[] }
> {
  const requestedAt = new Date().toISOString();
  try {
    const requestCount = 1;
    const response = await fetch(path, {
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    });
    const classified = await classifyFetchResponse(response);
    if (!classified.ok) {
      return {
        ok: false,
        reason: classified.reason,
        error: pageFetchError(classified.reason, response.status),
        requestCount,
        requestAttemptedAts: [requestedAt]
      };
    }
    return { ok: true, response, json: classified.json, requestCount, requestAttemptedAts: [requestedAt] };
  } catch {
    return { ok: false, reason: "network_error", error: "页面内请求失败，请确认 linux.do 标签页仍然可用。", requestCount: 1, requestAttemptedAts: [requestedAt] };
  }
}

function pageFetchError(reason: RefreshFailureReason, status: number): string {
  if (reason === "challenge") return "linux.do 要求浏览器验证，请在页面完成验证后再同步。";
  if (reason === "blocked") return "linux.do 拒绝了本次页面内同步。";
  if (reason === "rate_limited") return "linux.do 返回限流，已停止同步。";
  if (reason === "invalid_response") return "linux.do 返回的内容不是可解析 JSON。";
  return `页面内请求失败：${status}`;
}

function isContentScriptCommand(value: unknown): value is ContentScriptCommand {
  if (typeof value !== "object" || value == null) return false;
  const message = value as { type?: unknown; username?: unknown; kind?: unknown; avatarUrl?: unknown; step?: unknown };
  if (message.type === "linuxdoFriends.extractCurrentAccount") return true;
  if (message.type === "linuxdoFriends.extractFollowing") return true;
  if (message.type === "linuxdoFriends.navigateInPage") return typeof (message as { url?: unknown }).url === "string";
  if (message.type === "linuxdoFriends.extractAvatar") {
    return typeof message.username === "string" && message.username.trim().length > 0 && typeof message.avatarUrl === "string";
  }
  return (
    (message.type === "linuxdoFriends.extractActivity" || message.type === "linuxdoFriends.extractProfile") &&
    typeof message.username === "string" &&
    message.username.trim().length > 0 &&
    (message.type !== "linuxdoFriends.extractActivity" ||
      ((message.kind === undefined || isActivityKind(message.kind)) && (message.step === undefined || isActivityRequestStepMessage(message.step))))
  );
}

function isActivityRequestStepMessage(value: unknown): value is { kind: ActivityRefreshRequestKind; path: string } {
  if (typeof value !== "object" || value == null) return false;
  const step = value as { kind?: unknown; path?: unknown };
  return isActivityRequestKind(step.kind) && typeof step.path === "string" && isLinuxDoRelativeJsonPath(step.path);
}

function isActivityRequestKind(value: unknown): value is ActivityRefreshRequestKind {
  return value === "topic" || value === "reply" || value === "boost" || value === "reaction" || value === "like" || value === "user_actions";
}

function isLinuxDoRelativeJsonPath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  try {
    const url = new URL(path, "https://linux.do");
    return url.origin === "https://linux.do" && url.pathname.endsWith(".json");
  } catch {
    return false;
  }
}

function isLinuxDoAvatarUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "linux.do" && (url.pathname.startsWith("/user_avatar/") || url.pathname.startsWith("/letter_avatar/"));
  } catch {
    return false;
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Avatar conversion failed"));
    });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Avatar conversion failed")));
    reader.readAsDataURL(blob);
  });
}

function isActivityKind(value: unknown): value is ActivityKindFilter | ActivityRefreshRequestKind {
  return value === "all" || value === "topic" || value === "reply" || value === "boost" || value === "reaction" || value === "like" || value === "user_actions";
}

function extractUsername(link: HTMLAnchorElement) {
  const match = link.href.match(/\/u\/([^/?#]+)/);
  return match?.[1]?.toLowerCase();
}

function extractFollowedUsers(json: unknown): FollowedUserInput[] {
  const records = getFollowedUserRecords(json);
  return records.flatMap((record) => {
    const username = readString(record, "username");
    if (!username) return [];
    return [
      {
        username,
        name: readString(record, "name"),
        avatarUrl: avatarUrlFromRecord(record)
      }
    ];
  });
}

function getFollowedUserRecords(json: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(json)) return json.filter(isRecord);
  if (!isRecord(json)) return [];
  for (const key of ["users", "following", "members"]) {
    const value = json[key];
    if (Array.isArray(value)) return value.filter(isRecord);
  }
  return [];
}

function avatarUrlFromRecord(record: Record<string, unknown>): string | undefined {
  const avatarTemplate = readString(record, "avatar_template");
  const avatarUrl = avatarTemplate?.replace("{size}", "48") ?? readString(record, "avatar_url") ?? readString(record, "avatarUrl");
  if (!avatarUrl) return undefined;
  if (avatarUrl.startsWith("//")) return `https:${avatarUrl}`;
  if (avatarUrl.startsWith("/")) return `https://linux.do${avatarUrl}`;
  return avatarUrl;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

export function resetContentScriptForTest() {
  userMenuRoot?.unmount();
  userMenuRoot = null;
  userMenuRootElement = null;
  friendNoteDialogRoot?.unmount();
  friendNoteDialogRoot = null;
  friendNoteDialogRootElement = null;
  friendNoteDialogUsername = null;
  friendNoteTooltipRootElement = null;
  friendNoteRowRoots.forEach(({ root }) => root.unmount());
  friendNoteRowRoots.clear();
  postFriendNoteRoots.forEach(({ root }) => root.unmount());
  postFriendNoteRoots.clear();
  document.querySelectorAll(`.${postFriendNoteClass}`).forEach((element) => element.remove());
  document.getElementById(friendNoteDialogHostId)?.remove();
  document.getElementById(friendNoteTooltipHostId)?.remove();
  userMenuObserver?.disconnect();
  userMenuObserver = null;
  pageThemeObserver?.disconnect();
  pageThemeObserver = null;
  heartbeatTitleObserver?.disconnect();
  heartbeatTitleObserver = null;
  if (userMenuEnhanceTimer != null) window.clearTimeout(userMenuEnhanceTimer);
  if (launcherPlacementTimer != null) window.clearTimeout(launcherPlacementTimer);
  if (friendMarkerTimer != null) window.clearTimeout(friendMarkerTimer);
  if (friendActionsTimer != null) window.clearTimeout(friendActionsTimer);
  if (themeSyncTimer != null) window.clearTimeout(themeSyncTimer);
  if (heartbeatChangeTimer != null) window.clearTimeout(heartbeatChangeTimer);
  if (heartbeatTimer != null) window.clearInterval(heartbeatTimer);
  userMenuEnhanceTimer = null;
  launcherPlacementTimer = null;
  friendMarkerTimer = null;
  friendActionsTimer = null;
  themeSyncTimer = null;
  heartbeatChangeTimer = null;
  heartbeatTimer = null;
  suppressFriendMarkerMutations = false;
  suppressFriendActionMutations = false;
  latestState = null;
  lastPageTheme = null;
  if (routePopstateListener) {
    window.removeEventListener("popstate", routePopstateListener);
    routePopstateListener = null;
  }
  if (originalPushState) {
    window.history.pushState = originalPushState;
    originalPushState = null;
  }
  if (originalReplaceState) {
    window.history.replaceState = originalReplaceState;
    originalReplaceState = null;
  }
}

// Mirrored from src/api/profileParser.ts intentionally for the same self-contained MV3 content-script build boundary.
function extractFriendProfile(json: unknown): FriendProfileSummary {
  if (!isRecord(json) || !isRecord(json.user)) {
    throw new Error("Invalid linux.do profile response");
  }
  const username = readString(json.user, "username");
  if (!username) {
    throw new Error("Invalid linux.do profile response");
  }
  const avatarTemplate = readString(json.user, "avatar_template");
  const avatarUrl = avatarUrlFromTemplate(avatarTemplate) ?? avatarUrlFromTemplate(readString(json.user, "avatar_url"));
  return {
    username: normalizeUsername(username),
    name: readString(json.user, "name"),
    avatarUrl,
    lastPostedAt: readString(json.user, "last_posted_at"),
    lastSeenAt: readString(json.user, "last_seen_at"),
    refreshedAt: new Date().toISOString()
  };
}

interface RawUserAction {
  id?: number | string;
  action_type?: number;
  title?: string;
  topic_title?: string;
  excerpt?: string;
  created_at?: string;
  post_url?: string;
  slug?: string;
  topic_id?: number;
  target_name?: string | null;
  target_username?: string | null;
  post_number?: number;
  post_id?: number | null;
  reply_to_post_number?: number | null;
  username?: string;
  name?: string | null;
  acting_username?: string;
  acting_name?: string | null;
  avatar_template?: string;
  acting_avatar_template?: string;
  category_id?: number | null;
  deleted?: boolean;
  hidden?: boolean | null;
  closed?: boolean;
  archived?: boolean;
  truncated?: boolean;
}

interface RawBoost {
  id?: number | string;
  raw?: string;
  cooked?: string;
  created_at?: string;
  post_id?: number;
  user?: Record<string, unknown>;
  post?: Record<string, unknown>;
}

interface RawReaction {
  id?: number | string;
  post_id?: number;
  created_at?: string;
  user?: Record<string, unknown>;
  post?: Record<string, unknown>;
  reaction?: Record<string, unknown>;
}

interface RawFriendActivitySources {
  userActions: RawUserAction[];
  boosts: RawBoost[];
  reactions: RawReaction[];
}

interface ActivityRequestStep {
  username: Username;
  kind: ActivityRefreshRequestKind;
  path: string;
}

// Mirrored from src/domain/activity.ts intentionally: the MV3 content script must build as a self-contained non-module file.
// Keep src/content/contentScript.test.ts parity coverage in sync when endpoint normalization changes.
function extractUserActions(json: unknown): RawUserAction[] {
  if (!isRecord(json)) return [];
  const value = json.user_actions;
  return Array.isArray(value) ? value.filter(isRawUserAction) : [];
}

function isRawUserAction(value: unknown): value is RawUserAction {
  return isRecord(value);
}

function extractBoosts(json: unknown): RawBoost[] {
  if (!isRecord(json)) return [];
  const value = json.boosts;
  return Array.isArray(value) ? value.filter(isRawBoost) : [];
}

function isRawBoost(value: unknown): value is RawBoost {
  return isRecord(value);
}

function extractReactions(json: unknown): RawReaction[] {
  return Array.isArray(json) ? json.filter(isRawReaction) : [];
}

function isRawReaction(value: unknown): value is RawReaction {
  return isRecord(value);
}

function normalizeFriendActivity(usernameInput: Username, sources: RawFriendActivitySources): FriendActivitySummary {
  const username = normalizeUsername(usernameInput);
  const items = sortActivityItems([
    ...sources.userActions.map((action) => normalizeUserAction(username, action)).filter(isActivityItem),
    ...sources.boosts.map(normalizeBoost),
    ...sources.reactions.map(normalizeReaction)
  ]);
  const lastPostAt = items.find((item) => item.occurredAt)?.occurredAt;
  return {
    username,
    refreshedAt: new Date().toISOString(),
    coarseStatus: classifyCoarseStatus(lastPostAt),
    lastPostAt,
    items
  };
}

function summaryFromItems(usernameInput: Username, itemsInput: ActivityItem[]): FriendActivitySummary {
  const username = normalizeUsername(usernameInput);
  const items = sortActivityItems(itemsInput);
  const lastPostAt = items.find((item) => item.occurredAt)?.occurredAt;
  return {
    username,
    refreshedAt: new Date().toISOString(),
    coarseStatus: classifyCoarseStatus(lastPostAt),
    lastPostAt,
    items
  };
}

function activityRequestStepsForUser(username: Username, kind: ActivityKindFilter | ActivityRefreshRequestKind): ActivityRequestStep[] {
  if (kind === "topic") {
    return [{ username, kind: "topic", path: `/user_actions.json?offset=0&username=${encodeURIComponent(username)}&filter=4` }];
  }
  if (kind === "reply") {
    return [{ username, kind: "reply", path: `/user_actions.json?offset=0&username=${encodeURIComponent(username)}&filter=5` }];
  }
  if (kind === "boost") {
    return [{ username, kind: "boost", path: `/discourse-boosts/users/${encodeURIComponent(username)}/boosts-given.json` }];
  }
  if (kind === "reaction") {
    return [{ username, kind: "reaction", path: `/discourse-reactions/posts/reactions.json?username=${encodeURIComponent(username)}` }];
  }
  if (kind === "like") {
    return [{ username, kind: "like", path: `/user_actions.json?offset=0&username=${encodeURIComponent(username)}&filter=1` }];
  }
  if (kind === "user_actions") {
    return [{ username, kind: "user_actions", path: `/user_actions.json?offset=0&username=${encodeURIComponent(username)}&filter=4,5` }];
  }
  return [
    { username, kind: "topic", path: `/user_actions.json?offset=0&username=${encodeURIComponent(username)}&filter=4` },
    { username, kind: "reply", path: `/user_actions.json?offset=0&username=${encodeURIComponent(username)}&filter=5` },
    { username, kind: "boost", path: `/discourse-boosts/users/${encodeURIComponent(username)}/boosts-given.json` },
    { username, kind: "reaction", path: `/discourse-reactions/posts/reactions.json?username=${encodeURIComponent(username)}` },
    { username, kind: "like", path: `/user_actions.json?offset=0&username=${encodeURIComponent(username)}&filter=1` }
  ];
}

function normalizeStepItems(username: Username, kind: ActivityRefreshRequestKind, json: unknown): ActivityItem[] {
  if (kind === "topic" || kind === "reply" || kind === "like") {
    return extractUserActions(json)
      .map((action) => normalizeUserAction(username, action))
      .filter((item): item is ActivityItem => item !== undefined && item.kind === kind);
  }
  if (kind === "user_actions") {
    return extractUserActions(json).map((action) => normalizeUserAction(username, action)).filter(isActivityItem);
  }
  if (kind === "boost") return extractBoosts(json).map(normalizeBoost);
  return extractReactions(json).map(normalizeReaction);
}

function normalizeUserAction(usernameInput: Username, action: RawUserAction): ActivityItem | undefined {
  const requestedUsername = normalizeUsername(usernameInput);
  const kind = activityKindFromUserActionType(action.action_type);
  if (!kind) return undefined;
  const actorUsername = actorUsernameForUserAction(kind, requestedUsername, action);
  const actorName = actorNameForUserAction(kind, action);
  const actorAvatarUrl = actorAvatarUrlForUserAction(kind, action);
  const targetUsername = targetUsernameForUserAction(kind, action);
  const targetName = targetNameForUserAction(kind, action);
  const targetAvatarUrl = targetAvatarUrlForUserAction(kind, action);
  const topicId = readNumber(action.topic_id);
  const postId = readNumber(action.post_id);
  const postNumber = readNumber(action.post_number);
  const occurredAt = readStringValue(action.created_at);
  const title = readStringValue(action.title) ?? readStringValue(action.topic_title) ?? "未命名动态";
  return {
    id: `user_action:${requestedUsername}:${action.action_type ?? "unknown"}:${topicId ?? "no-topic"}:${
      postId ?? postNumber ?? occurredAt ?? "unknown"
    }`,
    username: actorUsername,
    kind,
    title,
    url: readStringValue(action.post_url) ?? topicUrl(action.slug, topicId, postNumber),
    occurredAt,
    excerpt: plainTextFromHtmlish(action.excerpt),
    source: "user_actions",
    actorUsername,
    actorName,
    actorAvatarUrl,
    targetUsername,
    targetName,
    targetAvatarUrl,
    topicId,
    topicTitle: title,
    postId,
    postNumber,
    replyToPostNumber: readNumber(action.reply_to_post_number),
    categoryId: readNumber(action.category_id),
    truncated: action.truncated === true,
    deleted: action.deleted === true,
    hidden: action.hidden === true,
    closed: action.closed === true,
    archived: action.archived === true
  };
}

function actorUsernameForUserAction(kind: ActivityItem["kind"], requestedUsername: Username, action: RawUserAction): Username {
  if (kind === "like") return normalizeOptionalUsername(action.acting_username) ?? requestedUsername;
  return normalizeOptionalUsername(action.acting_username ?? action.username) ?? requestedUsername;
}

function actorNameForUserAction(kind: ActivityItem["kind"], action: RawUserAction): string | undefined {
  if (kind === "like") return readStringValue(action.acting_name);
  return readStringValue(action.acting_name) ?? readStringValue(action.name);
}

function actorAvatarUrlForUserAction(kind: ActivityItem["kind"], action: RawUserAction): string | undefined {
  if (kind === "like") return avatarUrlFromTemplate(action.acting_avatar_template);
  return avatarUrlFromTemplate(action.acting_avatar_template ?? action.avatar_template);
}

function targetUsernameForUserAction(kind: ActivityItem["kind"], action: RawUserAction): Username | undefined {
  return normalizeOptionalUsername(action.target_username ?? (kind === "like" ? action.username : undefined));
}

function targetNameForUserAction(kind: ActivityItem["kind"], action: RawUserAction): string | undefined {
  return readStringValue(action.target_name) ?? (kind === "like" ? readStringValue(action.name) : undefined);
}

function targetAvatarUrlForUserAction(kind: ActivityItem["kind"], action: RawUserAction): string | undefined {
  if (kind !== "like") return undefined;
  return avatarUrlFromTemplate(action.avatar_template);
}

function activityKindFromUserActionType(actionType: number | undefined): ActivityItem["kind"] | undefined {
  if (actionType === 1) return "like";
  if (actionType === 4) return "topic";
  if (actionType === 5) return "reply";
  return undefined;
}

function isActivityItem(value: ActivityItem | undefined): value is ActivityItem {
  return Boolean(value);
}

function normalizeBoost(boost: RawBoost): ActivityItem {
  const actor = isRecord(boost.user) ? boost.user : {};
  const post = isRecord(boost.post) ? boost.post : {};
  const actorUsername = normalizeOptionalUsername(readString(actor, "username")) ?? "unknown";
  const topicTitle = readString(post, "topic_title") ?? readString(post, "title") ?? "未命名主题";
  return {
    id: `boost:${boost.id ?? `${actorUsername}:${boost.post_id ?? boost.created_at ?? "unknown"}`}`,
    username: actorUsername,
    kind: "boost",
    title: topicTitle,
    url: readString(post, "url"),
    occurredAt: readStringValue(boost.created_at),
    excerpt: plainTextFromHtmlish(readString(post, "excerpt")),
    source: "boosts",
    actorUsername,
    actorName: readString(actor, "name"),
    actorAvatarUrl: avatarUrlFromTemplate(readString(actor, "avatar_template")),
    targetUsername: normalizeOptionalUsername(readString(post, "username")),
    targetName: readString(post, "name"),
    targetAvatarUrl: avatarUrlFromTemplate(readString(post, "avatar_template")),
    topicId: readNumber(post.topic_id),
    topicTitle,
    postId: readNumber(post.id) ?? readNumber(boost.post_id),
    categoryId: readNumber(post.category_id),
    boostText: plainTextFromHtmlish(boost.raw) ?? plainTextFromHtmlish(boost.cooked)
  };
}

function normalizeReaction(reaction: RawReaction): ActivityItem {
  const actor = isRecord(reaction.user) ? reaction.user : {};
  const post = isRecord(reaction.post) ? reaction.post : {};
  const reactionRecord = isRecord(reaction.reaction) ? reaction.reaction : {};
  const actorUsername = normalizeOptionalUsername(readString(actor, "username")) ?? "unknown";
  const topicTitle = readString(post, "topic_title") ?? readNestedTopicTitle(post) ?? "未命名主题";
  return {
    id: `reaction:${reaction.id ?? `${actorUsername}:${reaction.post_id ?? reaction.created_at ?? "unknown"}`}`,
    username: actorUsername,
    kind: "reaction",
    title: topicTitle,
    url: readString(post, "url"),
    occurredAt: readStringValue(reaction.created_at) ?? readString(reactionRecord, "created_at"),
    excerpt: plainTextFromHtmlish(readString(post, "excerpt")),
    source: "reactions",
    actorUsername,
    actorName: readString(actor, "name"),
    actorAvatarUrl: avatarUrlFromTemplate(readString(actor, "avatar_template")),
    targetUsername: normalizeOptionalUsername(readString(post, "username")),
    targetName: readString(post, "name"),
    targetAvatarUrl: avatarUrlFromTemplate(readString(post, "avatar_template")),
    topicId: readNumber(post.topic_id),
    topicTitle,
    postId: readNumber(post.id) ?? readNumber(reaction.post_id),
    postNumber: readNumber(post.post_number),
    categoryId: readNumber(post.category_id),
    reactionValue: readString(reactionRecord, "reaction_value")
  };
}

function sortActivityItems(items: ActivityItem[]): ActivityItem[] {
  return [...items].sort((a, b) => {
    const byTime = timestampValue(b.occurredAt) - timestampValue(a.occurredAt);
    if (byTime !== 0) return byTime;
    return a.id.localeCompare(b.id);
  });
}

function classifyCoarseStatus(value?: string): FriendActivitySummary["coarseStatus"] {
  if (!value) return "unknown";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "unknown";
  const age = Date.now() - timestamp;
  if (age < 3 * 24 * 60 * 60 * 1000) return "recently_active";
  if (age < 7 * 24 * 60 * 60 * 1000) return "active_this_week";
  return "quiet";
}

function plainTextFromHtmlish(value?: string): string | undefined {
  if (!value) return undefined;
  const text = decodeHtmlEntities(
    value
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]*>/g, " ")
  )
    .replace(/\s+([,.;:!?，。；：！？…])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return text || undefined;
}

function avatarUrlFromTemplate(value?: string): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace("{size}", "48");
  if (normalized.startsWith("//")) return `https:${normalized}`;
  if (normalized.startsWith("/")) return `https://linux.do${normalized}`;
  return normalized;
}

function topicUrl(slug: unknown, topicId?: number, postNumber?: number): string | undefined {
  if (!topicId) return undefined;
  const safeSlug = typeof slug === "string" && slug.trim() ? slug.trim() : "topic";
  return `/t/${safeSlug}/${topicId}${postNumber ? `/${postNumber}` : ""}`;
}

function readNestedTopicTitle(post: Record<string, unknown>): string | undefined {
  const topic = post.topic;
  if (!isRecord(topic)) return undefined;
  return readString(topic, "title") ?? readString(topic, "fancy_title");
}

function timestampValue(value?: string): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeOptionalUsername(value?: string | null): Username | undefined {
  if (!value) return undefined;
  const username = normalizeUsername(value);
  return username || undefined;
}

function readStringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
    nbsp: " ",
    hellip: "..."
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const key = entity.toLowerCase();
    if (key.startsWith("#x")) {
      const code = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (key.startsWith("#")) {
      const code = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return named[key] ?? match;
  });
}

function normalizeUsername(username: Username): Username {
  return username.trim().replace(/^@/, "").toLowerCase();
}
