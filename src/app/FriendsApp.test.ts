import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addFriendFromProfile, removeFriend, updateFriend } from "../domain/friends";
import { deleteLaoFindsItem, resetLaoFindsStartedAt } from "../domain/laoFinds";
import { defaultAppState } from "../domain/defaultState";
import { recordRequestAttempts } from "../domain/requestStats";
import { createMockStorage } from "../test/mockStorage";
import { SITE_DATA_PROGRESS_STORAGE_KEY } from "../storage/siteDataProgressStorage";
import { uiSceneStorageKeys } from "../storage/uiSceneStorage";
import { CLOUD_AUTH_STORAGE_KEY } from "../storage/cloudAuthStorage";
import { AUTO_REFRESH_SESSION_STORAGE_KEY, loadAutoRefreshSessionState } from "../storage/autoRefreshSessionStorage";
import {
  loadTimedActivityRefreshSessionState,
  TIMED_ACTIVITY_CONTROLLER_STORAGE_KEY,
  TIMED_ACTIVITY_SESSION_STORAGE_KEY,
  TIMED_ACTIVITY_SURFACE_STORAGE_PREFIX
} from "../storage/timedActivityRefreshSessionStorage";
import { resetRuntimeObserversForTest } from "../state/atoms";
import { resetAutoRefreshSessionObserverForTest } from "../state/autoRefreshAtoms";
import { resetTimedActivityRefreshSessionObserverForTest } from "../state/timedActivityRefreshAtoms";
import { resetUiSceneObserverForTest } from "../state/uiSceneAtoms";
import type { ActivityRefreshScope, AppState, BackgroundResponse, CloudArchiveLocalStateResult, DredgeRule, PageScriptStatusSnapshot, SiteDataTaskProgress } from "../shared/types";
import { absoluteLinuxDoUrl, eventHappenedInside, isLinuxDoActivityHref, shouldHandleActivityLinkClick } from "./activityLinks";
import { FriendsApp } from "./FriendsApp";

describe("eventHappenedInside", () => {
  it("uses composedPath so shadow-dom retargeted events still count as inside", () => {
    const popover = document.createElement("div");
    const input = document.createElement("input");
    const host = document.createElement("div");
    popover.append(input);
    document.body.append(popover, host);

    const event = new PointerEvent("pointerdown");
    Object.defineProperty(event, "target", { value: host });
    Object.defineProperty(event, "composedPath", { value: () => [input, popover, host, document.body, document] });

    expect(eventHappenedInside(event, popover)).toBe(true);
  });

  it("falls back to target containment when composedPath is empty", () => {
    const popover = document.createElement("div");
    const input = document.createElement("input");
    popover.append(input);
    document.body.append(popover);

    const event = new PointerEvent("pointerdown");
    Object.defineProperty(event, "target", { value: input });
    Object.defineProperty(event, "composedPath", { value: () => [] });

    expect(eventHappenedInside(event, popover)).toBe(true);
  });

  it("treats events outside the popover as outside", () => {
    const popover = document.createElement("div");
    const outside = document.createElement("button");
    document.body.append(popover, outside);

    const event = new PointerEvent("pointerdown");
    Object.defineProperty(event, "target", { value: outside });
    Object.defineProperty(event, "composedPath", { value: () => [outside, document.body, document] });

    expect(eventHappenedInside(event, popover)).toBe(false);
  });
});

describe("activity link click handling", () => {
  it("handles only plain primary-button clicks", () => {
    expect(
      shouldHandleActivityLinkClick({
        button: 0,
        defaultPrevented: false,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false
      } as React.MouseEvent<HTMLAnchorElement>)
    ).toBe(true);
    expect(
      shouldHandleActivityLinkClick({
        button: 0,
        defaultPrevented: false,
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        altKey: false
      } as React.MouseEvent<HTMLAnchorElement>)
    ).toBe(false);
    expect(
      shouldHandleActivityLinkClick({
        button: 1,
        defaultPrevented: false,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false
      } as React.MouseEvent<HTMLAnchorElement>)
    ).toBe(false);
  });

  it("recognizes only linux.do activity hrefs for interception", () => {
    expect(isLinuxDoActivityHref("https://linux.do/t/topic/1")).toBe(true);
    expect(isLinuxDoActivityHref("/t/topic/1")).toBe(true);
    expect(isLinuxDoActivityHref("https://example.com/t/topic/1")).toBe(false);
  });

  it("builds absolute linux.do URLs with a safe fallback", () => {
    expect(absoluteLinuxDoUrl("/t/topic/1")).toBe("https://linux.do/t/topic/1");
    expect(absoluteLinuxDoUrl("https://linux.do/t/topic/1")).toBe("https://linux.do/t/topic/1");
    expect(absoluteLinuxDoUrl()).toBe("https://linux.do/");
    expect(absoluteLinuxDoUrl("https://[")).toBe("https://linux.do/");
  });
});

type MountedFriendsAppRoot = {
  host: HTMLDivElement;
  root: ReturnType<typeof createRoot>;
  unmounted: boolean;
};

const mountedFriendsAppRoots: MountedFriendsAppRoot[] = [];

describe("FriendsApp UI scene persistence", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeObserversForTest();
    resetAutoRefreshSessionObserverForTest();
    resetTimedActivityRefreshSessionObserverForTest();
    resetUiSceneObserverForTest();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    for (const mounted of mountedFriendsAppRoots.splice(0)) {
      if (!mounted.unmounted) {
        act(() => {
          mounted.root.unmount();
        });
      }
      mounted.host.remove();
    }
    document.body.replaceChildren();
    try {
      vi.clearAllTimers();
    } catch {
      // Some tests use real timers only; timer cleanup is best-effort.
    }
    vi.useRealTimers();
  });

  it("restores tab, modal query, and filter popover scene from session storage", async () => {
    const session = createMockStorage({
      [uiSceneStorageKeys.version]: 1,
      [uiSceneStorageKeys.tab]: "feed",
      [uiSceneStorageKeys.addFriendModalOpen]: true,
      [uiSceneStorageKeys.addFriendQuery]: "neo",
      [uiSceneStorageKeys.activityKindPopoverOpen]: true,
      [uiSceneStorageKeys.activityKindPopoverQuery]: "bo"
    });
    setupChrome({ session });
    const { container } = await renderFriendsApp();

    expect(container.textContent).toContain("暂无匹配动态");
    expect(container.querySelector<HTMLInputElement>(".modal-search-input")?.value).toBe("neo");
    expect(container.querySelector<HTMLInputElement>(".filter-popover-menu input")?.value).toBe("bo");
  });

  it("persists tab and modal query changes to session storage", async () => {
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    Object.defineProperty(window, "scrollTo", { value: vi.fn(), configurable: true });
    setupChrome({ session });
    const { container } = await renderFriendsApp();

    await act(async () => {
      getButton(container, "管理").click();
    });
    await act(async () => {
      getButton(container, "佬有料").click();
    });
    await act(async () => {
      const input = container.querySelector<HTMLInputElement>(".modal-search-input");
      input?.focus();
      setInputValue(input!, "neo");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });

    expect(session.dump()).toMatchObject({
      [uiSceneStorageKeys.tab]: "finds",
      [uiSceneStorageKeys.addFriendModalOpen]: true,
      [uiSceneStorageKeys.addFriendQuery]: "neo"
    });
  });

  it("scrolls to the feed top when switching to the feed tab", async () => {
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    const frameCallbacks: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    const scrollTo = vi.fn();
    Object.defineProperty(window, "scrollTo", { value: scrollTo, configurable: true });
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function getRect(this: HTMLElement) {
      if (this.classList.contains("sticky-top")) {
        return { top: 0, left: 0, right: 320, bottom: 80, width: 320, height: 80, x: 0, y: 0, toJSON: () => ({}) };
      }
      return { top: 240, left: 0, right: 320, bottom: 300, width: 320, height: 60, x: 0, y: 240, toJSON: () => ({}) };
    });
    setupChrome({ session, state: activityFeedState() });
    const { container } = await renderFriendsApp();

    await act(async () => {
      getButton(container, "佬友圈").click();
    });
    await act(async () => {
      frameCallbacks.forEach((callback) => callback(0));
    });

    expect(raf).toHaveBeenCalled();
    expect(scrollTo).toHaveBeenCalledWith({ top: 152, behavior: "smooth" });
    rect.mockRestore();
  });

  it("resets a stale restored user filter to all", async () => {
    const session = createMockStorage({
      [uiSceneStorageKeys.version]: 1,
      [uiSceneStorageKeys.tab]: "feed",
      [uiSceneStorageKeys.feedUserFilter]: "ghost"
    });
    setupChrome({ session });
    await renderFriendsApp();

    expect(session.dump()).toMatchObject({
      [uiSceneStorageKeys.feedUserFilter]: "all"
    });
  });

  it("backfills observed app-state settings from storage changes", async () => {
    const session = createMockStorage({
      [uiSceneStorageKeys.version]: 1,
      [uiSceneStorageKeys.tab]: "feed"
    });
    const chromeMock = setupChrome({ session, state: activityFeedState() });
    const { container } = await renderFriendsApp();

    await act(async () => {
      chromeMock.emitStorageChange(
        {
          linuxdoFriendsState: {
            oldValue: null,
            newValue: {
              ...activityFeedState(),
              settings: { refreshIntervalMinutes: 90 }
            }
          }
        },
        "local"
      );
      await Promise.resolve();
    });

    await act(async () => {
      container.querySelector<HTMLAnchorElement>(".kind-card.kind-topic")?.click();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "openActivityLink", url: "https://linux.do/t/topic/1" });
  });

  it("renders reply activity kind cards as narrow stacked controls", async () => {
    const session = createMockStorage({
      [uiSceneStorageKeys.version]: 1,
      [uiSceneStorageKeys.tab]: "feed"
    });
    setupChrome({
      session,
      state: {
        ...defaultAppState,
        friends: {
          neo: {
            username: "neo",
            note: "",
            groups: [],
            pinned: false,
            activityKinds: ["topic", "reply", "boost", "reaction"],
            upgradedAt: "2026-06-28T00:00:00.000Z",
            updatedAt: "2026-06-28T00:00:00.000Z"
          }
        },
        activity: {
          neo: {
            username: "neo",
            refreshedAt: "2026-06-28T00:05:00.000Z",
            items: [
              {
                id: "reply:neo:1",
                username: "neo",
                kind: "reply",
                title: "回复目标",
                url: "/t/topic/1/3",
                occurredAt: "2026-06-28T00:04:00.000Z",
                excerpt: "回复内容",
                replyToPostNumber: 3
              }
            ]
          }
        }
      }
    });
    const { container } = await renderFriendsApp();

    const kindCard = container.querySelector<HTMLAnchorElement>(".kind-card.kind-reply");
    expect(kindCard?.querySelector(".kind-card-icon svg")).toBeTruthy();
    expect(kindCard?.querySelector(".kind-card-label")?.textContent).toBe("回复");
    expect(kindCard?.querySelector(".kind-card-floor")?.textContent).toBe("#3");
    expect(kindCard?.querySelector(".kind-card-link svg")).toBeTruthy();
  });

  it("keeps feed activity links as normal new-tab anchors when configured", async () => {
    const session = createMockStorage({
      [uiSceneStorageKeys.version]: 1,
      [uiSceneStorageKeys.tab]: "feed"
    });
    const chromeMock = setupChrome({
      session,
      state: {
        ...activityFeedState(),
        settings: { ...defaultAppState.settings, openActivityLinksInPage: false }
      }
    });
    const { container } = await renderFriendsApp();
    const link = container.querySelector<HTMLAnchorElement>(".feed-title");

    await act(async () => {
      link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    });

    expect(link?.target).toBe("_blank");
    expect(chromeMock.sendMessage).not.toHaveBeenCalledWith({ type: "openActivityLink", url: "https://linux.do/t/topic/1" });
  });

  it("opens feed activity links through the background command when in-page navigation is enabled", async () => {
    const session = createMockStorage({
      [uiSceneStorageKeys.version]: 1,
      [uiSceneStorageKeys.tab]: "feed"
    });
    const chromeMock = setupChrome({
      session,
      state: {
        ...activityFeedState(),
        settings: { ...defaultAppState.settings, openActivityLinksInPage: true }
      }
    });
    const { container } = await renderFriendsApp();

    await act(async () => {
      container.querySelector<HTMLAnchorElement>(".kind-card.kind-topic")?.click();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "openActivityLink", url: "https://linux.do/t/topic/1" });
  });

  it("does not intercept external feed links even when in-page navigation is enabled", async () => {
    const session = createMockStorage({
      [uiSceneStorageKeys.version]: 1,
      [uiSceneStorageKeys.tab]: "feed"
    });
    const chromeMock = setupChrome({
      session,
      state: {
        ...activityFeedState("https://example.com/t/topic/1"),
        settings: { ...defaultAppState.settings, openActivityLinksInPage: true }
      }
    });
    const { container } = await renderFriendsApp();

    await act(async () => {
      container.querySelector<HTMLAnchorElement>(".kind-card.kind-topic")?.click();
    });

    expect(chromeMock.sendMessage).not.toHaveBeenCalledWith({ type: "openActivityLink", url: "https://example.com/t/topic/1" });
  });

  it("shows running refresh progress in the in-page friends view", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T00:00:01.000Z"));
    const session = createMockStorage({
      [uiSceneStorageKeys.version]: 1,
      [uiSceneStorageKeys.tab]: "friends"
    });
    setupChrome({
      session,
      progress: {
        taskId: "profiles-1",
        taskType: "profiles",
        usernames: ["neo"],
        status: "running",
        completed: 0,
        total: 1,
        currentLabel: "@neo",
        startedAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z"
      }
    });
    const { container } = await renderFriendsApp("in-page");

    expect(container.querySelector(".refresh-button-inner.is-running")).toBeTruthy();
    expect(container.querySelector(".refresh-progress-track span")).toBeTruthy();
    expect(container.querySelector(".refresh-button-label")?.textContent).toBe("@neo");
    expect(container.querySelector(".spin-icon")).toBeTruthy();
    vi.useRealTimers();
  });

  it("disables refresh actions while a shared site-data task is running", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T00:00:01.000Z"));
    const session = createMockStorage({
      [uiSceneStorageKeys.version]: 1,
      [uiSceneStorageKeys.tab]: "friends"
    });
    setupChrome({
      session,
      progress: {
        taskId: "profiles-1",
        taskType: "profiles",
        usernames: ["neo"],
        status: "running",
        completed: 0,
        total: 1,
        currentLabel: "@neo",
        startedAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z"
      }
    });
    const { container } = await renderFriendsApp("in-page");

    expect(getButton(container, "@neo").disabled).toBe(true);
    vi.useRealTimers();
  });

  it("releases refresh actions when mounted shared site-data progress becomes stale", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T00:00:00.000Z"));
    const session = createMockStorage({
      [uiSceneStorageKeys.version]: 1,
      [uiSceneStorageKeys.tab]: "friends"
    });
    setupChrome({
      session,
      progress: {
        taskId: "profiles-stale",
        taskType: "profiles",
        usernames: ["neo"],
        status: "running",
        completed: 0,
        total: 1,
        currentLabel: "@neo",
        startedAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z"
      }
    });
    const { container } = await renderFriendsApp("side-panel");

    expect(getButton(container, "@neo").disabled).toBe(true);
    expect(container.querySelector(".refresh-button-inner.is-running")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000 + 500);
    });

    expect(getButton(container, "刷新状态").disabled).toBe(false);
    expect(container.querySelector(".refresh-button-inner.is-running")).toBeFalsy();
    vi.useRealTimers();
  });

  it("renders friend status auto-refresh controls in the split refresh menu", async () => {
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    setupChrome({ session });
    const { container } = await renderFriendsApp("side-panel");

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".split-refresh-toggle")?.click();
    });

    expect(container.textContent).toContain("启用自动刷新");
    expect(container.textContent).toContain("1 分钟");
    expect(container.textContent).toContain("10 分钟");
    expect(container.textContent).toContain("30 分钟");
    expect(container.textContent).toContain("遇到验证、限流或正在刷新会跳过");
    expect(container.querySelector(".refresh-menu")?.querySelectorAll("input")).toHaveLength(0);
  });

  it("writes session-only auto-refresh state from the friend status menu", async () => {
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    setupChrome({ session });
    const { container } = await renderFriendsApp("side-panel");

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".split-refresh-toggle")?.click();
    });
    await act(async () => {
      getButton(container, "1 分钟").click();
    });
    await act(async () => {
      getButton(container, "启用自动刷新").click();
    });

    expect(await loadAutoRefreshSessionState(session)).toMatchObject({
      enabled: true,
      intervalMinutes: 1
    });
  });

  it("shows an auto-refresh countdown without request progress while waiting", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T00:00:00.000Z"));
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    const chromeMock = setupChrome({ session });
    const { container } = await renderFriendsApp("side-panel");

    await enableAutoRefreshForTest({
      chromeMock,
      session,
      intervalMinutes: 1,
      lastFinishedAt: "2026-06-28T00:00:00.000Z"
    });

    expect(container.querySelector(".refresh-button-inner.is-scheduled")).toBeTruthy();
    expect(container.querySelector(".auto-refresh-wait-icon")).toBeTruthy();
    expect(container.querySelector(".refresh-button-meta")?.textContent).toBe("下次刷新 01:00");
    expect(container.querySelector(".refresh-progress-track span")).toBeFalsy();
    expect(container.querySelector(".spin-icon")).toBeFalsy();
    vi.useRealTimers();
  });

  it("updates the auto-refresh countdown while the UI stays open", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T00:00:00.000Z"));
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    const chromeMock = setupChrome({ session });
    const { container } = await renderFriendsApp("side-panel");

    await enableAutoRefreshForTest({
      chromeMock,
      session,
      intervalMinutes: 1,
      lastFinishedAt: "2026-06-28T00:00:00.000Z"
    });

    expect(container.querySelector(".refresh-button-meta")?.textContent).toBe("下次刷新 01:00");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(container.querySelector(".refresh-button-meta")?.textContent).toBe("下次刷新 00:59");
    vi.useRealTimers();
  });

  it("lets real profile refresh progress override the auto-refresh countdown", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T00:00:00.000Z"));
    const runningProfiles: SiteDataTaskProgress = {
      taskId: "profiles-live",
      taskType: "profiles",
      usernames: ["neo"],
      status: "running",
      completed: 0,
      total: 1,
      currentLabel: "@neo",
      startedAt: "2026-06-28T00:00:00.000Z",
      updatedAt: "2026-06-28T00:00:00.000Z"
    };
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    const chromeMock = setupChrome({ session, progress: runningProfiles });
    const { container } = await renderFriendsApp("side-panel");

    await enableAutoRefreshForTest({
      chromeMock,
      session,
      intervalMinutes: 1,
      lastFinishedAt: "2026-06-28T00:00:00.000Z"
    });

    expect(container.querySelector(".refresh-button-inner.is-running")).toBeTruthy();
    expect(container.querySelector(".refresh-button-inner.is-scheduled")).toBeFalsy();
    expect(container.querySelector(".refresh-button-label")?.textContent).toBe("@neo");
    expect(container.querySelector(".refresh-button-meta")).toBeFalsy();
    expect(container.querySelector(".refresh-progress-track span")).toBeTruthy();
    expect(container.querySelector(".spin-icon")).toBeTruthy();
    vi.useRealTimers();
  });

  it("does not duplicate auto-refresh requests across two mounted surfaces", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T00:00:00.000Z"));
    const session = createMockStorage({
      [uiSceneStorageKeys.version]: 1
    });
    const chromeMock = setupChrome({ session });
    await renderFriendsApp("side-panel");
    await renderFriendsApp("in-page");
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const registeredSession = await loadAutoRefreshSessionState(session);
    expect(Object.keys(registeredSession.visibleSurfaces)).toHaveLength(2);
    await session.set({
      [AUTO_REFRESH_SESSION_STORAGE_KEY]: {
        ...registeredSession,
        enabled: true,
        intervalMinutes: 1,
        lastFinishedAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z"
      }
    });
    expect(await loadAutoRefreshSessionState(session)).toMatchObject({
      enabled: true,
      intervalMinutes: 1
    });
    const enabledSession = session.dump()[AUTO_REFRESH_SESSION_STORAGE_KEY];
    await act(async () => {
      chromeMock.emitStorageChange(
        {
          [AUTO_REFRESH_SESSION_STORAGE_KEY]: {
            oldValue: null,
            newValue: enabledSession
          }
        },
        "session"
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
      await Promise.resolve();
    });

    const profileRefreshCalls = chromeMock.sendMessage.mock.calls.filter(([message]) => message.type === "refreshFriendProfiles");
    expect(profileRefreshCalls).toHaveLength(1);
    vi.useRealTimers();
  });

  it("skips a due auto-refresh while another site-data task is running without queuing it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T00:00:00.000Z"));
    const runningActivity: SiteDataTaskProgress = {
      taskId: "activity-live",
      taskType: "activity",
      scope: { kind: "all" },
      status: "running",
      completed: 0,
      total: 4,
      startedAt: "2026-06-28T00:00:00.000Z",
      updatedAt: "2026-06-28T00:00:00.000Z",
      source: "existing_tab"
    };
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    const chromeMock = setupChrome({ session, progress: runningActivity });
    await renderFriendsApp("side-panel");
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const registeredSession = await loadAutoRefreshSessionState(session);
    await session.set({
      [AUTO_REFRESH_SESSION_STORAGE_KEY]: {
        ...registeredSession,
        enabled: true,
        intervalMinutes: 1,
        lastFinishedAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z"
      }
    });
    const enabledSession = session.dump()[AUTO_REFRESH_SESSION_STORAGE_KEY];
    await act(async () => {
      chromeMock.emitStorageChange(
        {
          [AUTO_REFRESH_SESSION_STORAGE_KEY]: {
            oldValue: null,
            newValue: enabledSession
          }
        },
        "session"
      );
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
      await Promise.resolve();
    });
    expect(chromeMock.sendMessage.mock.calls.filter(([message]) => message.type === "refreshFriendProfiles")).toHaveLength(0);

    await act(async () => {
      chromeMock.emitStorageChange(
        {
          [SITE_DATA_PROGRESS_STORAGE_KEY]: {
            oldValue: runningActivity,
            newValue: {
              ...runningActivity,
              status: "success",
              completed: 4,
              updatedAt: "2026-06-28T00:01:05.000Z",
              finishedAt: "2026-06-28T00:01:05.000Z"
            } satisfies SiteDataTaskProgress
          }
        },
        "session"
      );
      await Promise.resolve();
    });
    expect(await loadAutoRefreshSessionState(session)).toMatchObject({
      lastFinishedAt: "2026-06-28T00:01:05.000Z"
    });
    expect(chromeMock.sendMessage.mock.calls.filter(([message]) => message.type === "refreshFriendProfiles")).toHaveLength(0);

    vi.setSystemTime(new Date("2026-06-28T00:01:05.000Z"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_000);
      await Promise.resolve();
    });
    expect(chromeMock.sendMessage.mock.calls.filter(([message]) => message.type === "refreshFriendProfiles")).toHaveLength(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
      await Promise.resolve();
    });
    expect(chromeMock.sendMessage.mock.calls.filter(([message]) => message.type === "refreshFriendProfiles")).toHaveLength(1);
    vi.useRealTimers();
  });

  it("records local auto-refresh completion when no shared profile progress finish arrives", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T00:00:00.000Z"));
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    const chromeMock = setupChrome({ session });
    await renderFriendsApp("side-panel");
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const registeredSession = await loadAutoRefreshSessionState(session);
    await session.set({
      [AUTO_REFRESH_SESSION_STORAGE_KEY]: {
        ...registeredSession,
        enabled: true,
        intervalMinutes: 1,
        enabledAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z"
      }
    });
    const enabledSession = session.dump()[AUTO_REFRESH_SESSION_STORAGE_KEY];
    await act(async () => {
      chromeMock.emitStorageChange(
        {
          [AUTO_REFRESH_SESSION_STORAGE_KEY]: {
            oldValue: null,
            newValue: enabledSession
          }
        },
        "session"
      );
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
      await Promise.resolve();
    });

    expect(chromeMock.sendMessage.mock.calls.filter(([message]) => message.type === "refreshFriendProfiles")).toHaveLength(1);
    expect(await loadAutoRefreshSessionState(session)).toMatchObject({
      lastFinishedAt: "2026-06-28T00:01:00.000Z"
    });
    vi.useRealTimers();
  });

  it("does not reuse stale shared profile progress as auto-refresh completion", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T00:00:00.000Z"));
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    const chromeMock = setupChrome({ session });
    await renderFriendsApp("side-panel");
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      chromeMock.emitStorageChange(
        {
          [SITE_DATA_PROGRESS_STORAGE_KEY]: {
            oldValue: null,
            newValue: {
              taskId: "profiles-live",
              taskType: "profiles",
              usernames: ["neo"],
              status: "success",
              completed: 1,
              total: 1,
              startedAt: "2026-06-27T23:58:00.000Z",
              updatedAt: "2026-06-27T23:59:00.000Z",
              finishedAt: "2026-06-27T23:59:00.000Z",
              source: "existing_tab"
            } satisfies SiteDataTaskProgress
          }
        },
        "session"
      );
    });
    expect(await loadAutoRefreshSessionState(session)).toMatchObject({
      lastFinishedAt: "2026-06-27T23:59:00.000Z"
    });

    const registeredSession = await loadAutoRefreshSessionState(session);
    await session.set({
      [AUTO_REFRESH_SESSION_STORAGE_KEY]: {
        ...registeredSession,
        enabled: true,
        intervalMinutes: 1,
        enabledAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z",
        lastFinishedAt: undefined
      }
    });
    const enabledSession = session.dump()[AUTO_REFRESH_SESSION_STORAGE_KEY];
    await act(async () => {
      chromeMock.emitStorageChange(
        {
          [AUTO_REFRESH_SESSION_STORAGE_KEY]: {
            oldValue: null,
            newValue: enabledSession
          }
        },
        "session"
      );
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
      await Promise.resolve();
    });

    expect(await loadAutoRefreshSessionState(session)).toMatchObject({
      lastFinishedAt: "2026-06-28T00:01:00.000Z"
    });
    vi.useRealTimers();
  });

  it("updates in-page refresh progress from shared session state changes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T00:00:01.000Z"));
    const session = createMockStorage({
      [uiSceneStorageKeys.version]: 1,
      [uiSceneStorageKeys.tab]: "friends"
    });
    const chromeMock = setupChrome({ session });
    const { container } = await renderFriendsApp("in-page");

    expect(container.querySelector(".refresh-button-inner.is-running")).toBeFalsy();

    await act(async () => {
      chromeMock.emitStorageChange(
        {
          [SITE_DATA_PROGRESS_STORAGE_KEY]: {
            oldValue: null,
            newValue: {
              taskId: "profiles-live",
              taskType: "profiles",
              usernames: ["neo"],
              status: "running",
              completed: 0,
              total: 1,
              currentLabel: "@neo",
              startedAt: "2026-06-28T00:00:00.000Z",
              updatedAt: "2026-06-28T00:00:00.000Z"
            }
          }
        }
      );
    });

    expect(container.querySelector(".refresh-button-inner.is-running")).toBeTruthy();
    expect(container.querySelector(".refresh-progress-track span")).toBeTruthy();
    expect(container.querySelector(".refresh-button-label")?.textContent).toBe("@neo");
    expect(container.querySelector(".spin-icon")).toBeTruthy();
    vi.useRealTimers();
  });

  it("keeps bottom breathing space in both friends and feed tabs", async () => {
    const friendsSession = createMockStorage({
      [uiSceneStorageKeys.version]: 1,
      [uiSceneStorageKeys.tab]: "friends"
    });
    setupChrome({ session: friendsSession });
    const friendsRender = await renderFriendsApp("side-panel");

    expect(friendsRender.container.querySelector(".tab-bottom-spacer")).toBeTruthy();

    act(() => {
      friendsRender.root.unmount();
    });

    const feedSession = createMockStorage({
      [uiSceneStorageKeys.version]: 1,
      [uiSceneStorageKeys.tab]: "feed"
    });
    setupChrome({ session: feedSession, state: activityFeedState() });
    const feedRender = await renderFriendsApp("side-panel");

    expect(feedRender.container.querySelector(".tab-bottom-spacer")).toBeTruthy();

    act(() => {
      feedRender.root.unmount();
    });

    const findsSession = createMockStorage({
      [uiSceneStorageKeys.version]: 1,
      [uiSceneStorageKeys.tab]: "finds"
    });
    setupChrome({ session: findsSession, state: activityFeedState() });
    const findsRender = await renderFriendsApp("side-panel");

    expect(findsRender.container.querySelector(".tab-bottom-spacer")).toBeTruthy();

    act(() => {
      findsRender.root.unmount();
    });
  });

  it("renders the lao finds tab empty by default", async () => {
    const session = createMockStorage({
      [uiSceneStorageKeys.version]: 1,
      [uiSceneStorageKeys.tab]: "finds"
    });
    setupChrome({ session, state: activityFeedState() });
    const { container } = await renderFriendsApp("side-panel");

    expect(container.textContent).toContain("佬有料");
    expect(container.textContent).toContain("暂时没有佬料");
    expect(container.textContent).toContain("手动刷新佬友圈或开启自动捞料");
    expect(container.textContent).toContain("立即打捞");
    expect(container.textContent).toContain("配置打捞规则");
    expect(container.querySelector(".finds-section h2")).toBeFalsy();
    const findsActionRow = container.querySelector(".finds-action-row");
    expect(findsActionRow?.textContent).not.toContain("佬有料");
    expect(container.querySelector(".finds-count")?.textContent).toBe("共 0 条");
    const actionChildren = Array.from(findsActionRow?.children ?? []);
    expect(actionChildren[0]?.classList.contains("finds-dredge-button")).toBe(true);
    expect(actionChildren[1]?.classList.contains("finds-count")).toBe(true);
    expect(actionChildren[2]?.classList.contains("finds-rules-button")).toBe(true);
    expect(getButton(container, "立即打捞").querySelector(".lucide-telescope")).toBeTruthy();
    expect(container.querySelector(".dredge-rule-panel")).toBeFalsy();
  });

  it("shows Lao Finds manual dredge progress in the large action button", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T00:00:01.000Z"));
    const session = createMockStorage({
      [uiSceneStorageKeys.version]: 1,
      [uiSceneStorageKeys.tab]: "finds"
    });
    setupChrome({
      session,
      progress: {
        taskId: "activity-live",
        taskType: "activity",
        scope: { kind: "all" },
        status: "running",
        completed: 1,
        total: 4,
        currentLabel: "话题 @neo",
        startedAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z",
        source: "existing_tab"
      },
      state: timedActivityState({ timedActivityRefreshEnabled: true })
    });
    const { container } = await renderFriendsApp("side-panel");

    const dredgeButton = container.querySelector<HTMLButtonElement>(".finds-dredge-button");
    expect(dredgeButton?.disabled).toBe(true);
    expect(dredgeButton?.querySelector(".refresh-button-inner.is-running")).toBeTruthy();
    expect(dredgeButton?.querySelector(".spin-icon")).toBeTruthy();
    expect(dredgeButton?.querySelector(".lucide-telescope")).toBeFalsy();
    expect(dredgeButton?.querySelector(".refresh-button-label")?.textContent).toBe("话题 @neo · 1/4");
    expect(dredgeButton?.querySelector<HTMLSpanElement>(".refresh-progress-track span")?.style.width).toBe("25%");
    vi.useRealTimers();
  });

  it("disables manual and automatic dredging controls when no final rule scope is available", async () => {
    const session = createMockStorage({
      [uiSceneStorageKeys.version]: 1,
      [uiSceneStorageKeys.tab]: "finds"
    });
    const chromeMock = setupChrome({
      session,
      state: {
        ...timedActivityState({ timedActivityRefreshEnabled: false, timedActivityRefreshScopeMode: "rules" }),
        dredgeRules: [currentRule({ id: "rule-boost", usernames: ["neo"], kinds: ["boost"] })]
      }
    });
    const { container } = await renderFriendsApp("side-panel");

    expect(container.textContent).toContain("当前没有可打捞范围，请先调整规则。");
    expect(container.querySelector(".header-operation-row .timed-refresh-hint")).toBeFalsy();
    expect(container.querySelector(".timed-refresh-copy")?.textContent).toBe("无规则");
    const findsDredgeButton = container.querySelector<HTMLButtonElement>(".finds-action-row .finds-dredge-button");
    expect(findsDredgeButton?.textContent).toContain("立即打捞");
    expect(findsDredgeButton?.disabled).toBe(true);
    expect(findsDredgeButton?.title).toBe("当前没有可打捞范围，请先调整规则。");

    await act(async () => {
      findsDredgeButton?.click();
      await Promise.resolve();
    });
    expect(activityRefreshMessages(chromeMock)).toEqual([]);

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".timed-refresh-main")?.click();
      await Promise.resolve();
    });

    const menuOptions = Array.from(container.querySelectorAll<HTMLButtonElement>(".timed-refresh-menu .refresh-menu-option"));
    const enableOption = menuOptions.find((button) => button.textContent?.includes("启用自动捞料"));
    const runNowOption = menuOptions.find((button) => button.textContent?.includes("立即打捞"));
    expect(enableOption?.disabled).toBe(true);
    expect(enableOption?.title).toBe("当前没有可打捞范围，请先调整规则。");
    expect(runNowOption?.disabled).toBe(true);

    await act(async () => {
      enableOption?.click();
      runNowOption?.click();
      await Promise.resolve();
    });

    expect(chromeMock.sendMessage).not.toHaveBeenCalledWith({
      type: "updateSettings",
      settings: { timedActivityRefreshEnabled: true }
    });
    expect(activityRefreshMessages(chromeMock)).toEqual([]);
  });

  it("opens lao finds rules in the options page from the lightweight management modal", async () => {
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    const chromeMock = setupChrome({ session, state: activityFeedState() });
    const { container } = await renderFriendsApp("side-panel");

    await act(async () => {
      getButton(container, "管理").click();
    });

    expect(Array.from(container.querySelectorAll("button")).filter((button) => button.textContent?.includes("更多设置"))).toHaveLength(1);

    await act(async () => {
      getButton(container, "更多设置").click();
      await Promise.resolve();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "openOptionsPage", hash: "#lao-finds" });
    expect(container.textContent).not.toContain("打捞规则");
    expect(container.querySelector(".modal")).toBeFalsy();
    expect(session.dump()).toMatchObject({
      [uiSceneStorageKeys.addFriendModalOpen]: false
    });
  });

  it("renders collected lao finds items with separated times and sends delete command", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T00:34:00.000Z"));
    const state: AppState = {
      ...activityFeedState(),
      dredgeRules: [
        currentRule({ id: "rule-ai", name: "AI", usernames: "all", kinds: ["topic"], patterns: ["AI"] })
      ],
      laoFindsItems: {
        "topic:neo:1": {
          id: "topic:neo:1",
          activityId: "topic:neo:1",
          activity: {
            id: "topic:neo:1",
            username: "neo",
            kind: "topic",
            title: "AI 新话题",
            url: "/t/topic/1",
            occurredAt: "2026-06-28T00:04:00.000Z"
          },
          collectedAt: "2026-06-28T00:05:00.000Z",
          matchedRuleIds: ["rule-ai"]
        }
      }
    };
    const session = createMockStorage({
      [uiSceneStorageKeys.version]: 1,
      [uiSceneStorageKeys.tab]: "finds"
    });
    const chromeMock = setupChrome({ session, state });
    const { container } = await renderFriendsApp("side-panel");

    expect(container.textContent).toContain("AI 新话题");
    expect(container.textContent).toContain("命中 AI · 29 分钟前打捞");
    const times = Array.from(container.querySelectorAll<HTMLTimeElement>(".finds-card time"));
    expect(times.map((time) => time.dateTime)).toContain("2026-06-28T00:04:00.000Z");
    expect(times.map((time) => time.dateTime)).not.toContain("2026-06-28T00:05:00.000Z");
    expect(container.textContent).not.toContain("标为已读");
    expect(container.textContent).not.toContain("标为未读");
    expect(container.textContent).not.toContain("归档");

    await act(async () => {
      getButton(container, "删除").click();
    });
    const deleteCallResult = chromeMock.sendMessage.mock.results.at(-1)?.value;
    const deleteResponse = await deleteCallResult;
    expect(deleteResponse).toMatchObject({ ok: true, data: { laoFindsItems: {} } });
    await act(async () => {
      chromeMock.emitStorageChange(
        {
          linuxdoFriendsState: {
            oldValue: state,
            newValue: deleteResponse.data
          }
        },
        "local"
      );
      await Promise.resolve();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "deleteLaoFindsItem", id: "topic:neo:1" });
    expect(container.textContent).not.toContain("AI 新话题");
    vi.useRealTimers();
  });

  it("keeps lao finds rule CRUD out of the main plugin surface", async () => {
    const session = createMockStorage({
      [uiSceneStorageKeys.version]: 1,
      [uiSceneStorageKeys.tab]: "finds"
    });
    setupChrome({
      session,
      state: {
        ...activityFeedState(),
        dredgeRules: [
          currentRule({ id: "rule-ai", name: "AI", usernames: "all", kinds: ["topic"], patterns: [] })
        ]
      }
    });
    const { container } = await renderFriendsApp("side-panel");

    expect(container.querySelector(".dredge-rule-panel")).toBeFalsy();
    expect(Array.from(container.querySelectorAll("button")).some((button) => button.textContent?.trim() === "新建")).toBe(false);
  });

  it("uses compact side-panel and settings launchers in the in-page header instead of the linked-session tag", async () => {
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    const chromeMock = setupChrome({ session });
    const { container } = await renderFriendsApp("in-page");

    expect(container.textContent).not.toContain("关联会话");
    const launcher = container.querySelector<HTMLButtonElement>(".side-panel-chip");
    const settings = container.querySelector<HTMLButtonElement>(".settings-chip");
    expect(launcher).toBeTruthy();
    expect(settings).toBeTruthy();

    await act(async () => {
      launcher?.click();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "openSidePanel" });

    await act(async () => {
      settings?.click();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "openOptionsPage" });
  });

  it("renders version metadata under the main plugin brand instead of the right status area", async () => {
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    const { container } = await renderFriendsApp("side-panel");

    expect(container.querySelector(".header-brand .version-badge")).toBeTruthy();
    expect(container.querySelector(".header-status .version-badge")).toBeFalsy();
    expect(container.querySelector<HTMLAnchorElement>(".version-github-link")?.href).toBe("https://github.com/LeUKi/linuxdo-friends");
  });

  it("shows local cloud archive status inside the account tag and opens cloud settings", async () => {
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    const chromeMock = setupChrome({ session });
    const { container } = await renderFriendsApp("side-panel");

    const cloudButton = container.querySelector<HTMLButtonElement>(".cloud-archive-chip");
    expect(cloudButton?.classList.contains("cloud-archive-unbound")).toBe(true);
    expect(cloudButton?.textContent).toContain("未绑定");
    expect(cloudButton?.querySelector(".cloud-archive-cross")).toBeTruthy();

    await act(async () => {
      cloudButton?.click();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "getCloudArchiveLocalState" });
    expect(chromeMock.sendMessage).not.toHaveBeenCalledWith({ type: "getCloudConfigStatus" });
    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "openOptionsPage", hash: "#cloud-backup" });
  });

  it("shows the request statistics capsule in the side-panel header and opens statistics settings", async () => {
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(new Date(2026, 6, 2, 9, 30).getTime());
    try {
      const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
      let state = recordRequestAttempts(defaultAppState, {
        family: "activity",
        count: 3,
        at: new Date(2026, 6, 1, 18, 0)
      });
      state = recordRequestAttempts(state, {
        family: "profile",
        count: 2,
        at: new Date(2026, 6, 2, 9, 10)
      });
      const chromeMock = setupChrome({ session, state });
      const { container } = await renderFriendsApp("side-panel");

      const chip = container.querySelector<HTMLButtonElement>(".request-stats-chip");
      expect(chip).toBeTruthy();
      expect(container.querySelector(".header-actions .request-stats-chip")).toBe(chip);
      expect(container.querySelector(".header-actions")?.firstElementChild).toBe(chip);
      expect(container.querySelector(".header-account-row .request-stats-chip")).toBeFalsy();
      expect(chip?.querySelector(".lucide-chart-column")).toBeTruthy();
      expect(chip?.textContent).toContain("2/ 5");
      expect(chip?.textContent).not.toContain("今");
      expect(chip?.textContent).not.toContain("总");
      expect(chip?.querySelector(".request-stats-today")?.textContent).toBe("2");
      expect(chip?.querySelector(".request-stats-total")?.textContent).toBe("/ 5");

      await act(async () => {
        chip?.click();
        await Promise.resolve();
      });

      expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "openOptionsPage", hash: "#request-stats" });
    } finally {
      dateNow.mockRestore();
    }
  });

  it("compacts large request statistics numbers in the side-panel header capsule", async () => {
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(new Date(2026, 6, 2, 9, 30).getTime());
    try {
      const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
      let state = recordRequestAttempts(defaultAppState, {
        family: "activity",
        count: 1_234_567,
        at: new Date(2026, 6, 1, 18, 0)
      });
      state = recordRequestAttempts(state, {
        family: "profile",
        count: 12_345,
        at: new Date(2026, 6, 2, 9, 10)
      });
      setupChrome({ session, state });
      const { container } = await renderFriendsApp("side-panel");

      const chip = container.querySelector<HTMLButtonElement>(".request-stats-chip");
      expect(chip?.textContent).toContain("12.35K/ 1.25M");
      expect(chip?.querySelector(".request-stats-today")?.textContent).toBe("12.35K");
      expect(chip?.querySelector(".request-stats-total")?.textContent).toBe("/ 1.25M");
      expect(chip?.title).toBe("今日请求 12345，总请求 1246912。打开请求统计。");
      expect(chip?.getAttribute("aria-label")).toBe("今日请求 12345，总请求 1246912。打开请求统计。");
    } finally {
      dateNow.mockRestore();
    }
  });

  it("uses a bright cloud icon when local cloud archive state is same", async () => {
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    setupChrome({ session, cloudState: sameCloudArchiveState() });
    const { container } = await renderFriendsApp("side-panel");

    const cloudButton = container.querySelector<HTMLButtonElement>(".cloud-archive-chip");
    expect(cloudButton?.classList.contains("cloud-archive-same")).toBe(true);
    expect(cloudButton?.textContent?.trim()).toBe("");
    expect(cloudButton?.querySelector(".cloud-archive-cross")).toBeFalsy();
  });

  it("shows pending backup copy when local cloud archive state differs", async () => {
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    setupChrome({ session, cloudState: differentCloudArchiveState() });
    const { container } = await renderFriendsApp("side-panel");

    const cloudButton = container.querySelector<HTMLButtonElement>(".cloud-archive-chip");
    expect(cloudButton?.classList.contains("cloud-archive-different")).toBe(true);
    expect(cloudButton?.textContent).toContain("待备份");
    expect(cloudButton?.textContent).not.toContain("不一致");
  });

  it("reloads local cloud archive state after cloud auth metadata changes", async () => {
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    const chromeMock = setupChrome({ session });
    const { container } = await renderFriendsApp("side-panel");

    expect(container.querySelector(".cloud-archive-chip")?.textContent).toContain("未绑定");

    chromeMock.setCloudState(sameCloudArchiveState());
    await act(async () => {
      chromeMock.emitStorageChange(
        {
          [CLOUD_AUTH_STORAGE_KEY]: {
            oldValue: undefined,
            newValue: { lastConfigDigest: "digest-1", lastConfigSyncedAt: "2026-06-28T00:01:00.000Z" }
          }
        },
        "local"
      );
      await Promise.resolve();
    });

    const cloudButton = container.querySelector<HTMLButtonElement>(".cloud-archive-chip");
    expect(cloudButton?.classList.contains("cloud-archive-same")).toBe(true);
    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "getCloudArchiveLocalState" });
    expect(chromeMock.sendMessage).not.toHaveBeenCalledWith({ type: "getCloudConfigStatus" });
  });

  it("shows only remove for added users in the lightweight modal", async () => {
    const session = createMockStorage({
      [uiSceneStorageKeys.version]: 1,
      [uiSceneStorageKeys.addFriendModalOpen]: true
    });
    const chromeMock = setupChrome({
      session,
      state: updateFriend(
        addFriendFromProfile(defaultAppState, {
          username: "Neo",
          name: "Neo",
          refreshedAt: "2026-06-28T00:00:00.000Z"
        }),
        "neo",
        { activityKinds: ["reply", "boost"] }
      )
    });
    const { container } = await renderFriendsApp("side-panel");

    expect(container.textContent).not.toContain("已添加");
    expect(container.textContent).not.toContain("去设置管理");
    expect(container.querySelector(".scope-select-trigger")).toBeFalsy();
    expect(container.querySelector(".candidate-action-remove")).toBeTruthy();

    await act(async () => {
      getButton(container, "移除").click();
      await Promise.resolve();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "removeFriend", username: "neo" });
    expect(chromeMock.sendMessage).not.toHaveBeenCalledWith({ type: "openOptionsPage", hash: "#scope" });
  });

  it("keeps full activity scope quick actions out of the lightweight modal", async () => {
    const session = createMockStorage({
      [uiSceneStorageKeys.version]: 1,
      [uiSceneStorageKeys.addFriendModalOpen]: true
    });
    setupChrome({
      session,
      state: updateFriend(
        addFriendFromProfile(defaultAppState, {
          username: "Neo",
          name: "Neo",
          refreshedAt: "2026-06-28T00:00:00.000Z"
        }),
        "neo",
        { activityKinds: ["reply"] }
      )
    });
    const { container } = await renderFriendsApp("side-panel");

    expect(container.querySelector(".scope-select-actions")).toBeFalsy();
    expect(Array.from(container.querySelectorAll("button")).some((button) => button.textContent?.includes("全选"))).toBe(false);
    expect(Array.from(container.querySelectorAll("button")).some((button) => button.textContent?.includes("全不选"))).toBe(false);
  });

  it("keeps empty activity scope controls in settings instead of the lightweight modal", async () => {
    const session = createMockStorage({
      [uiSceneStorageKeys.version]: 1,
      [uiSceneStorageKeys.addFriendModalOpen]: true
    });
    setupChrome({
      session,
      state: updateFriend(
        addFriendFromProfile(defaultAppState, {
          username: "Neo",
          name: "Neo",
          refreshedAt: "2026-06-28T00:00:00.000Z"
        }),
        "neo",
        { activityKinds: [] }
      )
    });
    const { container } = await renderFriendsApp("side-panel");

    expect(container.querySelector<HTMLButtonElement>(".scope-select-trigger")).toBeFalsy();
    expect(container.querySelector(".scope-trigger-empty")).toBeFalsy();
    expect(container.querySelector(".scope-trigger-icon")).toBeFalsy();
  });

  it("disables the feed jump button when a friend has no activity scope", async () => {
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    const chromeMock = setupChrome({
      session,
      state: updateFriend(activityFeedState(), "neo", { activityKinds: [] })
    });
    const { container } = await renderFriendsApp("side-panel");
    const arrowButton = container.querySelector<HTMLButtonElement>(".friend-arrow-button");

    expect(arrowButton?.disabled).toBe(true);
    expect(arrowButton?.title).toBe("未选择动态范围");
    await act(async () => {
      arrowButton?.click();
    });

    expect(chromeMock.sendMessage).not.toHaveBeenCalledWith({ type: "refreshFriendActivity", scope: { kind: "all", usernames: ["neo"] } });
  });

  it("shows a compact never-refreshed meta line on the activity refresh button", async () => {
    const session = createMockStorage({
      [uiSceneStorageKeys.version]: 1,
      [uiSceneStorageKeys.tab]: "feed"
    });
    setupChrome({ session, state: activityFeedState() });
    const { container } = await renderFriendsApp("side-panel");

    expect(container.querySelector(".refresh-button-label")?.textContent).toBe("刷新动态");
    expect(container.querySelector(".refresh-button-meta")?.textContent).toBe("未曾刷新");
    expect(container.textContent).not.toContain("全部佬朋友 全部动态未刷新");
  });

  it("shows effective request counts in the activity type selector", async () => {
    const session = createMockStorage({
      [uiSceneStorageKeys.version]: 1,
      [uiSceneStorageKeys.tab]: "feed",
      [uiSceneStorageKeys.activityKindPopoverOpen]: true
    });
    setupChrome({
      session,
      state: updateFriend(
        addFriendFromProfile(defaultAppState, {
          username: "Neo",
          name: "Neo",
          refreshedAt: "2026-06-28T00:00:00.000Z"
        }),
        "neo",
        { activityKinds: ["reply", "boost"] }
      )
    });
    const { container } = await renderFriendsApp("side-panel");

    expect(container.querySelector(".filter-popover-kind .filter-popover-menu")).toBeTruthy();
    const options = Array.from(container.querySelectorAll<HTMLButtonElement>(".filter-popover-menu button"));
    const optionText = options.map((option) => option.textContent?.trim());

    expect(optionText).toEqual(["全部2", "话题0", "回复1", "Boost1", "回应0"]);
    expect(container.textContent).not.toContain("x 2");
    expect(container.textContent).not.toContain("x 0");
    expect(container.querySelectorAll(".filter-popover-menu .filter-option-count")).toHaveLength(5);
  });

  it("shows the all-user filter as a compact label with a count tag", async () => {
    const session = createMockStorage({
      [uiSceneStorageKeys.version]: 1,
      [uiSceneStorageKeys.tab]: "feed",
      [uiSceneStorageKeys.feedUserPopoverOpen]: true
    });
    setupChrome({ session, state: activityFeedState() });
    const { container } = await renderFriendsApp("side-panel");

    expect(container.querySelector(".filter-popover-user .filter-popover-menu")).toBeTruthy();
    const userMenuOptions = Array.from(container.querySelectorAll<HTMLButtonElement>(".filter-popover-menu button"));

    expect(userMenuOptions[0]?.textContent?.trim()).toBe("全部1");
    expect(userMenuOptions[0]?.textContent).not.toContain("全部佬朋友");
    expect(userMenuOptions[0]?.querySelector(".filter-option-count")?.textContent).toBe("1");
  });

  it("keeps the linked-session tag and settings launcher in the browser side panel surface", async () => {
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    const chromeMock = await renderFriendsAppWithChrome({
      session,
      surface: "side-panel",
      pageStatus: {
        status: "connected",
        connectedCount: 2,
        staleCount: 0,
        heartbeats: [],
        updatedAt: "2026-06-28T00:00:00.000Z"
      }
    });
    const { container } = chromeMock;

    expect(container.textContent).toContain("关联会话 2");
    expect(container.querySelector(".side-panel-chip")).toBeFalsy();
    expect(container.querySelector(".settings-chip")).toBeTruthy();
  });

  it("opens a connected page dropdown with only fresh ready entries and activates without repair", async () => {
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    const now = Date.now();
    const chromeMock = setupChrome({
      session,
      pageStatus: {
        status: "connected",
        connectedCount: 2,
        staleCount: 1,
        selectedTabId: 456,
        heartbeats: [
          {
            tabId: 123,
            url: "https://linux.do/t/ready-one/1",
            title: "Ready One",
            status: "ready",
            hasLauncher: true,
            updatedAt: new Date(now).toISOString()
          },
          {
            tabId: 456,
            url: "https://linux.do/t/ready-two/2",
            title: "Ready Two",
            status: "ready",
            hasLauncher: true,
            updatedAt: new Date(now - 1_000).toISOString()
          },
          {
            tabId: 789,
            url: "https://linux.do/t/stale-ready/3",
            title: "Stale Ready",
            status: "ready",
            hasLauncher: true,
            updatedAt: new Date(now - 60_000).toISOString()
          },
          {
            tabId: 888,
            url: "https://linux.do/",
            title: "Challenge",
            status: "challenge",
            hasLauncher: false,
            updatedAt: new Date(now).toISOString()
          }
        ],
        updatedAt: new Date(now).toISOString()
      }
    });
    const { container } = await renderFriendsApp("side-panel");

    const badge = container.querySelector<HTMLButtonElement>(".page-script-badge");
    expect(badge?.tagName).toBe("BUTTON");
    expect(badge?.getAttribute("aria-haspopup")).toBe("menu");
    await act(async () => {
      badge?.click();
    });

    const popover = container.querySelector(".page-script-popover");
    expect(popover?.textContent).toContain("Ready One");
    expect(popover?.textContent).toContain("Ready Two");
    expect(popover?.textContent).not.toContain("Stale Ready");
    expect(popover?.textContent).not.toContain("Challenge");
    const options = Array.from(container.querySelectorAll<HTMLButtonElement>(".page-script-tab-option"));
    expect(options).toHaveLength(2);
    expect(options[1]?.classList.contains("is-selected")).toBe(true);
    expect(options[1]?.querySelector(".page-script-tab-check")).toBeTruthy();

    await act(async () => {
      options[0]?.click();
      await Promise.resolve();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "activateLinuxDoPageTab", tabId: 123 });
    expect(chromeMock.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "repairLinuxDoPageScript" }));
    expect(chromeMock.sendMessage).not.toHaveBeenCalledWith({ type: "openLinuxDoHome" });

    await act(async () => {
      badge?.click();
      await Promise.resolve();
    });
    const reopenedOptions = Array.from(container.querySelectorAll<HTMLButtonElement>(".page-script-tab-option"));
    expect(reopenedOptions[0]?.classList.contains("is-selected")).toBe(true);
    expect(reopenedOptions[0]?.querySelector(".page-script-tab-check")).toBeTruthy();
  });

  it("recomputes connected dropdown freshness when the chip is opened", async () => {
    vi.useFakeTimers();
    const base = new Date("2026-06-28T00:00:00.000Z");
    vi.setSystemTime(base);
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    setupChrome({
      session,
      pageStatus: {
        status: "connected",
        connectedCount: 1,
        staleCount: 0,
        selectedTabId: 123,
        heartbeats: [
          {
            tabId: 123,
            url: "https://linux.do/t/ready-one/1",
            title: "Ready One",
            status: "ready",
            hasLauncher: true,
            updatedAt: base.toISOString()
          }
        ],
        updatedAt: base.toISOString()
      }
    });
    const { container } = await renderFriendsApp("side-panel");

    vi.setSystemTime(new Date(base.getTime() + 60_000));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".page-script-badge")?.click();
    });

    const popover = container.querySelector(".page-script-popover");
    expect(popover?.textContent).not.toContain("Ready One");
    expect(popover?.textContent).toContain("暂无可切换页面");
  });

  it.each([
    [
      "missing",
      {
        status: "missing" as const,
        connectedCount: 0,
        staleCount: 0,
        heartbeats: [],
        updatedAt: "2026-06-28T00:00:00.000Z"
      },
      { type: "openLinuxDoHome" }
    ],
    [
      "challenge",
      {
        status: "challenge" as const,
        connectedCount: 0,
        staleCount: 0,
        heartbeats: [
          {
            tabId: 321,
            url: "https://linux.do/",
            title: "Challenge",
            status: "challenge" as const,
            hasLauncher: false,
            updatedAt: new Date().toISOString()
          }
        ],
        updatedAt: new Date().toISOString()
      },
      { type: "openLinuxDoHome" }
    ],
    [
      "stale",
      {
        status: "stale" as const,
        connectedCount: 0,
        staleCount: 1,
        heartbeats: [
          {
            tabId: 321,
            url: "https://linux.do/latest",
            title: "Latest",
            status: "ready" as const,
            hasLauncher: true,
            updatedAt: "2026-06-28T00:00:00.000Z"
          }
        ],
        updatedAt: "2026-06-28T00:00:00.000Z"
      },
      { type: "repairLinuxDoPageScript", tabId: 321 }
    ]
  ] satisfies Array<[string, PageScriptStatusSnapshot, Record<string, unknown>]>)("maps %s page-status chip clicks to the expected command", async (_name, pageStatus, expectedCommand) => {
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    const chromeMock = setupChrome({ session, pageStatus });
    const { container } = await renderFriendsApp("side-panel");

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".page-script-badge")?.click();
      await Promise.resolve();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith(expectedCommand);
  });

  it("shows installed version and triggers an update check when the plugin opens", async () => {
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    const chromeMock = setupChrome({ session });
    const { container } = await renderFriendsApp("side-panel");

    expect(container.querySelector<HTMLAnchorElement>(".version-github-link")?.href).toBe("https://github.com/LeUKi/linuxdo-friends");
    expect(container.querySelector(".version-current")?.textContent).toBe("v1.0.1");
    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "getUpdateCheck" });
    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "checkForUpdates", force: undefined });
  });

  it("auto-identifies the current account instead of showing a dead local tag", async () => {
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    const chromeMock = setupChrome({ session, state: defaultAppState });
    const { container } = await renderFriendsApp("side-panel");

    expect(container.textContent).not.toContain("本地优先");
    expect(container.textContent).toContain("@lafish");
    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "identifyCurrentAccount" });
  });

  it("keeps a manual identify account button when automatic identification fails", async () => {
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    const chromeMock = setupChrome({ session, state: defaultAppState, identifyFails: true });
    const { container } = await renderFriendsApp("side-panel");

    expect(container.textContent).not.toContain("本地优先");
    expect(getButton(container, "识别账号")).toBeTruthy();
    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "identifyCurrentAccount" });

    await act(async () => {
      getButton(container, "识别账号").click();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "identifyCurrentAccount" });
  });

  it("shows account detection pending only for manual account probing", async () => {
    const identify = createPendingIdentifyResponse();
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    const chromeMock = setupChrome({ session, state: defaultAppState, identifyResponse: identify.promise });
    const { container } = await renderFriendsApp("side-panel");

    expect(container.textContent).not.toContain("识别中");

    await act(async () => {
      getButton(container, "识别账号").click();
    });

    expect(container.textContent).toContain("识别中");
    expect(container.querySelector(".account-badge .spin-icon")).toBeTruthy();
    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "identifyCurrentAccount" });

    await act(async () => {
      identify.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("识别中");
  });

  it("highlights a newer version in the main plugin surfaces", async () => {
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    setupChrome({
      session,
      updateCheck: {
        installedVersion: "1.0.0",
        latestReleaseUrl: "https://github.com/LeUKi/linuxdo-friends/releases/latest",
        status: "update-available",
        latestVersion: "1.1.0",
        checkedAt: "2026-06-28T00:00:00.000Z",
        source: "github_release"
      }
    });
    const { container } = await renderFriendsApp("in-page");

    const link = container.querySelector<HTMLAnchorElement>(".version-update-link");
    expect(link?.textContent).toContain("新 v1.1.0");
    expect(link?.href).toBe("https://github.com/LeUKi/linuxdo-friends/releases/latest");
  });

  it("keeps update-check failures quiet in the main plugin surfaces", async () => {
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    setupChrome({
      session,
      updateCheck: {
        installedVersion: "1.0.0",
        latestReleaseUrl: "https://github.com/LeUKi/linuxdo-friends/releases/latest",
        status: "error",
        checkedAt: "2026-06-28T00:00:00.000Z",
        error: "GitHub Release 检查失败：HTTP 403",
        source: "github_release"
      }
    });
    const { container } = await renderFriendsApp("side-panel");

    expect(container.querySelector(".version-current")?.textContent).toBe("v1.0.0");
    expect(container.querySelector(".version-update-link")).toBeFalsy();
    expect(container.textContent).not.toContain("GitHub Release 检查失败");
  });

  it("opens the options page from the browser side panel surface", async () => {
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    const chromeMock = setupChrome({
      session,
      pageStatus: {
        status: "connected",
        connectedCount: 2,
        staleCount: 0,
        heartbeats: [],
        updatedAt: "2026-06-28T00:00:00.000Z"
      }
    });
    const { container } = await renderFriendsApp("side-panel");

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".settings-chip")?.click();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "openOptionsPage" });
  });

  it("renders feed refresh as a single current-filter action without a dredging dropdown", async () => {
    const session = createMockStorage({
      [uiSceneStorageKeys.version]: 1,
      [uiSceneStorageKeys.tab]: "feed"
    });
    const chromeMock = setupChrome({ session });
    const { container } = await renderFriendsApp("side-panel");

    expect(container.querySelector(".feed-refresh-button")).toBeTruthy();
    expect(container.querySelector(".split-refresh-toggle")).toBeFalsy();
    expect(container.querySelector(".refresh-menu-feed")).toBeFalsy();
    expect(container.textContent).not.toContain("去设置");
    expect(container.textContent).not.toContain("定时刷新只在侧栏打开时运行");
    await act(async () => {
      getButton(container, "刷新动态").click();
      await Promise.resolve();
    });

    expect(chromeMock.sendMessage).not.toHaveBeenCalledWith({ type: "openOptionsPage", hash: "#lao-finds" });
    expect(activityRefreshMessages(chromeMock)).toEqual([{ type: "refreshFriendActivity", scope: { kind: "all" } }]);
  });

  it("shows a side-panel header automatic dredging capsule in the operation row", async () => {
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    const chromeMock = setupChrome({ session, state: timedActivityState({ timedActivityRefreshEnabled: false }) });
    const { container } = await renderFriendsApp("side-panel");

    const capsule = container.querySelector(".timed-refresh-control");
    const accountBadge = container.querySelector(".account-badge");
    const cloudBadge = container.querySelector(".cloud-archive-chip");
    expect(capsule).toBeTruthy();
    expect(accountBadge).toBeTruthy();
    expect(cloudBadge).toBeTruthy();
    expect(container.querySelector(".header-status .timed-refresh-control")).toBe(capsule);
    expect(container.querySelector(".header-account-row .timed-refresh-control")).toBeFalsy();
    expect(container.querySelector(".header-operation-row .timed-refresh-control")).toBe(capsule);
    expect(container.querySelector(".tab-bar + .timed-refresh-control")).toBeFalsy();
    expect(container.textContent).not.toContain("佬料打捞");
    expect(container.textContent).toContain("未开启");

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".timed-refresh-main")?.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("启用自动捞料");
    expect(container.textContent).toContain("需保持插件界面前台显示");
    expect(container.textContent).toContain("立即打捞");
    expect(container.textContent).toContain("配置打捞规则");
    expect(container.querySelector(".timed-refresh-control .lucide-telescope")).toBeTruthy();
    expect(container.querySelector(".timed-refresh-main .lucide-telescope")).toBeTruthy();
    expect(container.querySelector(".timed-refresh-menu .refresh-menu-option-with-note .refresh-menu-label-note")?.textContent).toBe("需保持插件界面前台显示");
    const settingsOption = Array.from(container.querySelectorAll<HTMLButtonElement>(".timed-refresh-menu .refresh-menu-option")).find((button) => button.textContent?.includes("配置打捞规则"));
    expect(settingsOption?.classList.contains("refresh-menu-option-no-icon")).toBe(true);
    expect(settingsOption?.querySelector("svg")).toBeFalsy();
    expect(container.querySelector(".timed-refresh-menu .refresh-menu-check")).toBeTruthy();
    expect(container.querySelector(".timed-refresh-menu .refresh-menu-option.is-selected")).toBeFalsy();
    expect(container.querySelector(".timed-refresh-menu .refresh-menu-check .lucide-check")).toBeFalsy();
    expect(chromeMock.sendMessage).not.toHaveBeenCalledWith({
      type: "updateSettings",
      settings: { timedActivityRefreshEnabled: true }
    });

    await act(async () => {
      getButton(container, "启用自动捞料").click();
      await Promise.resolve();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({
      type: "updateSettings",
      settings: { timedActivityRefreshEnabled: true }
    });
    expect(chromeMock.sendMessage).not.toHaveBeenCalledWith({
      type: "updateSettings",
      settings: expect.objectContaining({ timedActivityRefreshScopeMode: expect.anything() })
    });
  });

  it("shows the timed dredging enabled option as checked in the dropdown", async () => {
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    setupChrome({ session, state: timedActivityState({ timedActivityRefreshEnabled: true }) });
    const { container } = await renderFriendsApp("side-panel");

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".timed-refresh-main")?.click();
      await Promise.resolve();
    });

    const selected = container.querySelector<HTMLButtonElement>(".timed-refresh-menu .refresh-menu-option.is-selected");
    expect(selected?.textContent).toContain("启用自动捞料");
    expect(selected?.textContent).toContain("需保持插件界面前台显示");
    expect(selected?.getAttribute("aria-pressed")).toBe("true");
    expect(selected?.querySelector(".refresh-menu-check .lucide-check")).toBeTruthy();
  });

  it("does not render the dredging capsule inside the in-page menu surface", async () => {
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    setupChrome({ session, state: timedActivityState({ timedActivityRefreshEnabled: true }) });
    const { container } = await renderFriendsApp("in-page");

    expect(container.querySelector(".timed-refresh-control")).toBeFalsy();
  });

  it("resumes paused timed refresh from the global side-panel control", async () => {
    const session = createMockStorage({
      [uiSceneStorageKeys.version]: 1,
      [TIMED_ACTIVITY_SESSION_STORAGE_KEY]: {
        pausedReason: "challenge",
        pausedMessage: "遇到浏览器验证页面，已停止请求。",
        pendingDue: false,
        updatedAt: "2026-06-28T00:00:00.000Z"
      }
    });
    const chromeMock = setupChrome({ session, state: timedActivityState({ timedActivityRefreshEnabled: true }) });
    const { container } = await renderFriendsApp("side-panel");

    expect(container.textContent).toContain("已暂停");

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".timed-refresh-main")?.click();
      await Promise.resolve();
    });
    await act(async () => {
      getButton(container, "启用自动捞料").click();
      await Promise.resolve();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({
      type: "updateSettings",
      settings: { timedActivityRefreshEnabled: true }
    });
  });

  it("opens timed refresh settings from the side-panel timed control", async () => {
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    const chromeMock = setupChrome({ session });
    const { container } = await renderFriendsApp("side-panel");

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".timed-refresh-main")?.click();
      await Promise.resolve();
    });
    await act(async () => {
      getButton(container, "配置打捞规则").click();
      await Promise.resolve();
    });

    expect(chromeMock.sendMessage).toHaveBeenCalledWith({ type: "openOptionsPage", hash: "#lao-finds" });
  });

  it("shows concise no-rule state in the header dredging capsule", async () => {
    const session = createMockStorage({
      [uiSceneStorageKeys.version]: 1,
      [TIMED_ACTIVITY_SESSION_STORAGE_KEY]: {
        noTargetMessage: "没有启用规则",
        nextDueAt: "2026-06-28T02:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z"
      }
    });
    setupChrome({
      session,
      state: {
        ...timedActivityState({ timedActivityRefreshEnabled: true }),
        dredgeRules: []
      }
    });
    const { container } = await renderFriendsApp("side-panel");

    expect(container.querySelector(".timed-refresh-copy")?.textContent).toBe("无规则");
    expect(container.querySelector(".timed-refresh-copy strong")).toBeFalsy();
    expect(container.querySelector(".timed-refresh-copy span")).toBeFalsy();
  });

  it("clears stale no-rule copy when timed dredging is enabled after rules become available", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T00:00:00.000Z"));
    const session = createMockStorage({
      [uiSceneStorageKeys.version]: 1,
      [TIMED_ACTIVITY_SESSION_STORAGE_KEY]: {
        noTargetAt: "2026-06-27T23:00:00.000Z",
        noTargetMessage: "没有启用规则",
        nextDueAt: "2026-06-28T02:00:00.000Z",
        updatedAt: "2026-06-27T23:00:00.000Z"
      }
    });
    setupChrome({
      session,
      state: timedActivityState({ timedActivityRefreshEnabled: false })
    });
    const { container } = await renderFriendsApp("side-panel");

    expect(container.querySelector(".timed-refresh-copy")?.textContent).toBe("未开启");

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".timed-refresh-main")?.click();
      await Promise.resolve();
    });
    await act(async () => {
      getButton(container, "启用自动捞料").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector(".timed-refresh-copy")?.textContent).toBe("下次打捞 00:20:00");
    const timedSession = await loadTimedActivityRefreshSessionState(session);
    expect(timedSession.noTargetMessage).toBeUndefined();
    expect(timedSession.noTargetAt).toBeUndefined();
    vi.useRealTimers();
  });

  it("shows current activity progress in the header dredging capsule", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T00:00:01.000Z"));
    const runningActivity: SiteDataTaskProgress = {
      taskId: "activity-live",
      taskType: "activity",
      scope: { kind: "all" },
      status: "running",
      completed: 1,
      total: 4,
      currentLabel: "话题 @neo",
      startedAt: "2026-06-28T00:00:00.000Z",
      updatedAt: "2026-06-28T00:00:00.000Z",
      source: "existing_tab"
    };
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    setupChrome({ session, progress: runningActivity, state: timedActivityState({ timedActivityRefreshEnabled: true }) });
    const { container } = await renderFriendsApp("side-panel");

    const capsule = container.querySelector(".timed-refresh-control");
    expect(capsule?.querySelector(".timed-refresh-copy")?.textContent).toBe("打捞中 25%");
    expect(capsule?.textContent).not.toContain("话题 @neo · 1/4");
    expect(capsule?.querySelector(".spin-icon")).toBeTruthy();
    vi.useRealTimers();
  });

  it("updates the header dredging countdown while the side panel stays open", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T00:00:00.000Z"));
    const session = createMockStorage({
      [uiSceneStorageKeys.version]: 1,
      [TIMED_ACTIVITY_SESSION_STORAGE_KEY]: {
        enabledAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z"
      }
    });
    setupChrome({
      session,
      state: timedActivityState({
        timedActivityRefreshEnabled: true,
        timedActivityRefreshIntervalMinutes: 1
      })
    });
    const { container } = await renderFriendsApp("side-panel");

    expect(container.querySelector(".timed-refresh-copy")?.textContent).toBe("下次打捞 00:01:00");
    expect(container.querySelector(".timed-refresh-control .spin-icon")).toBeFalsy();
    expect(container.querySelector(".timed-refresh-control .timed-refresh-pulse-icon")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(container.querySelector(".timed-refresh-copy")?.textContent).toBe("下次打捞 00:00:59");
    vi.useRealTimers();
  });

  it("runs manual automatic dredging with timed rule scope instead of current feed filters", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T00:00:00.000Z"));
    const session = createMockStorage({
      [uiSceneStorageKeys.version]: 1,
      [uiSceneStorageKeys.tab]: "finds",
      [uiSceneStorageKeys.feedKindFilter]: "boost",
      [uiSceneStorageKeys.feedUserFilter]: "neo"
    });
    const chromeMock = setupChrome({
      session,
      state: timedActivityState({
        timedActivityRefreshEnabled: false,
        timedActivityRefreshScopeMode: "rules",
        timedActivityRefreshIntervalMinutes: 120
      })
    });
    const { container } = await renderFriendsApp("side-panel");

    await act(async () => {
      getButton(container, "立即打捞").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(activityRefreshMessages(chromeMock)).toEqual([
      { type: "refreshFriendActivity", scope: { kind: "topic", usernames: ["neo"] } },
      { type: "refreshFriendActivity", scope: { kind: "reaction", usernames: ["neo"] } }
    ]);
    expect(chromeMock.sendMessage).toHaveBeenCalledWith({
      type: "completeRuleDerivedLaoFindsDredge",
      startedAt: "2026-06-28T00:00:00.000Z",
      scopes: [
        { kind: "topic", usernames: ["neo"] },
        { kind: "reaction", usernames: ["neo"] }
      ],
      trigger: "manual"
    });
    const commands = activityRefreshCommands(chromeMock);
    expect(commands[0]).toMatchObject({ trigger: "manual", timedRunId: expect.stringMatching(/^timed-activity:/) });
    expect(commands[1]?.timedRunId).toBe(commands[0]?.timedRunId);
    expect(activityRefreshMessages(chromeMock)).not.toEqual([{ type: "refreshFriendActivity", scope: { kind: "boost", usernames: ["neo"] } }]);
    expect(await loadTimedActivityRefreshSessionState(session)).toMatchObject({
      lastScopeMode: "rules",
      lastFinishedAt: "2026-06-28T00:00:00.000Z"
    });
    vi.useRealTimers();
  });

  it("completes rule-derived notifications after an all-scope manual dredge covers rules", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T00:00:00.000Z"));
    const session = createMockStorage({
      [uiSceneStorageKeys.version]: 1,
      [uiSceneStorageKeys.tab]: "finds"
    });
    const chromeMock = setupChrome({
      session,
      state: timedActivityState({
        timedActivityRefreshEnabled: false,
        timedActivityRefreshScopeMode: "all",
        timedActivityRefreshIntervalMinutes: 120
      })
    });
    const { container } = await renderFriendsApp("side-panel");

    await act(async () => {
      getButton(container, "立即打捞").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(activityRefreshMessages(chromeMock)).toEqual([{ type: "refreshFriendActivity", scope: { kind: "all" } }]);
    expect(chromeMock.sendMessage).toHaveBeenCalledWith({
      type: "completeRuleDerivedLaoFindsDredge",
      startedAt: "2026-06-28T00:00:00.000Z",
      scopes: [{ kind: "all" }],
      trigger: "manual"
    });
    vi.useRealTimers();
  });

  it("does not advance the dredge start point when rule-derived manual dredging fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T00:00:00.000Z"));
    const session = createMockStorage({
      [uiSceneStorageKeys.version]: 1,
      [uiSceneStorageKeys.tab]: "finds"
    });
    const chromeMock = setupChrome({
      session,
      refreshActivityResponses: [() => ({ ok: false, error: "刷新失败。", reason: "unavailable" })],
      state: timedActivityState({
        timedActivityRefreshEnabled: false,
        timedActivityRefreshScopeMode: "rules",
        timedActivityRefreshIntervalMinutes: 120
      })
    });
    const { container } = await renderFriendsApp("side-panel");

    await act(async () => {
      getButton(container, "立即打捞").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(activityRefreshMessages(chromeMock)).toEqual([{ type: "refreshFriendActivity", scope: { kind: "topic", usernames: ["neo"] } }]);
    expect(chromeMock.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "completeRuleDerivedLaoFindsDredge" }));
    expect(container.textContent).toContain("刷新失败。");
    vi.useRealTimers();
  });

  it("lets explicit manual dredging retry after a stale timed pause", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T00:00:00.000Z"));
    const session = createMockStorage({
      [uiSceneStorageKeys.version]: 1,
      [uiSceneStorageKeys.tab]: "finds",
      [TIMED_ACTIVITY_SESSION_STORAGE_KEY]: {
        pausedReason: "challenge",
        pausedMessage: "遇到浏览器验证页面，已停止请求。",
        updatedAt: "2026-06-27T23:00:00.000Z"
      }
    });
    const chromeMock = setupChrome({
      session,
      state: timedActivityState({
        timedActivityRefreshEnabled: false,
        timedActivityRefreshScopeMode: "rules",
        timedActivityRefreshIntervalMinutes: 120
      })
    });
    const { container } = await renderFriendsApp("side-panel");

    await act(async () => {
      getButton(container, "立即打捞").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(activityRefreshMessages(chromeMock)).toEqual([
      { type: "refreshFriendActivity", scope: { kind: "topic", usernames: ["neo"] } },
      { type: "refreshFriendActivity", scope: { kind: "reaction", usernames: ["neo"] } }
    ]);
    const timedSession = await loadTimedActivityRefreshSessionState(session);
    expect(timedSession.pausedReason).toBeUndefined();
    expect(timedSession.pausedMessage).toBeUndefined();
    expect(timedSession).toMatchObject({ lastFinishedAt: "2026-06-28T00:00:00.000Z" });
    vi.useRealTimers();
  });

  it("preserves a stale timed pause when manual retry cannot claim the controller", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T00:00:00.000Z"));
    const session = createMockStorage({
      [uiSceneStorageKeys.version]: 1,
      [uiSceneStorageKeys.tab]: "finds",
      [TIMED_ACTIVITY_SESSION_STORAGE_KEY]: {
        pausedReason: "challenge",
        pausedMessage: "遇到浏览器验证页面，已停止请求。",
        lastFailureAt: "2026-06-27T23:00:00.000Z",
        updatedAt: "2026-06-27T23:00:00.000Z"
      }
    });
    const chromeMock = setupChrome({
      session,
      state: timedActivityState({
        timedActivityRefreshEnabled: false,
        timedActivityRefreshScopeMode: "rules",
        timedActivityRefreshIntervalMinutes: 120
      })
    });
    const { container } = await renderFriendsApp("side-panel");
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await session.set({
      [`${TIMED_ACTIVITY_SURFACE_STORAGE_PREFIX}other-panel`]: {
        surface: "side-panel",
        heartbeatAt: "2026-06-28T00:00:00.000Z"
      },
      [TIMED_ACTIVITY_CONTROLLER_STORAGE_KEY]: {
        surfaceId: "other-panel",
        claimedAt: "2026-06-28T00:00:00.000Z",
        heartbeatAt: "2026-06-28T00:00:00.000Z"
      }
    });

    await act(async () => {
      getButton(container, "立即打捞").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(activityRefreshMessages(chromeMock)).toEqual([]);
    expect(container.textContent).toContain("另一个插件侧栏正在打捞，请稍后再试。");
    const timedSession = await loadTimedActivityRefreshSessionState(session);
    expect(timedSession).toMatchObject({
      pausedReason: "challenge",
      pausedMessage: "遇到浏览器验证页面，已停止请求。",
      lastFailureAt: "2026-06-27T23:00:00.000Z"
    });
    vi.useRealTimers();
  });

  it("aggregates multi-scope manual dredging into one continuous progress display", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T00:00:00.000Z"));
    const state = timedActivityState({
      timedActivityRefreshEnabled: false,
      timedActivityRefreshScopeMode: "rules",
      timedActivityRefreshIntervalMinutes: 120
    });
    const session = createMockStorage({
      [uiSceneStorageKeys.version]: 1,
      [uiSceneStorageKeys.tab]: "finds"
    });
    let resolveFirstRefresh: ((response: BackgroundResponse<AppState>) => void) | undefined;
    let resolveSecondRefresh: ((response: BackgroundResponse<AppState>) => void) | undefined;
    const firstRefresh = new Promise<BackgroundResponse<AppState>>((resolve) => {
      resolveFirstRefresh = resolve;
    });
    const secondRefresh = new Promise<BackgroundResponse<AppState>>((resolve) => {
      resolveSecondRefresh = resolve;
    });
    const chromeMock = setupChrome({
      session,
      refreshActivityResponses: [() => firstRefresh, () => secondRefresh],
      state
    });
    const { container } = await renderFriendsApp("side-panel");

    await act(async () => {
      getButton(container, "立即打捞").click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    let commands = activityRefreshCommands(chromeMock);
    expect(commands).toHaveLength(1);
    const timedRunId = commands[0].timedRunId;
    expect(timedRunId).toBeTruthy();
    const dredgeButton = () => container.querySelector<HTMLButtonElement>(".finds-dredge-button");
    expect(dredgeButton()?.querySelector(".refresh-button-label")?.textContent).toBe("@neo 话题 · 0/2");

    await act(async () => {
      chromeMock.emitStorageChange({
        [SITE_DATA_PROGRESS_STORAGE_KEY]: {
          oldValue: null,
          newValue: {
            taskId: "scope-topic",
            taskType: "activity",
            scope: { kind: "topic", usernames: ["neo"] },
            status: "running",
            trigger: "timed",
            timedRunId,
            completed: 1,
            total: 1,
            currentLabel: "话题 @neo",
            startedAt: "2026-06-28T00:00:00.000Z",
            updatedAt: "2026-06-28T00:00:01.000Z",
            source: "existing_tab"
          } satisfies SiteDataTaskProgress
        }
      });
      await Promise.resolve();
    });

    expect(dredgeButton()?.querySelector(".refresh-button-label")?.textContent).toBe("话题 @neo · 1/2");
    expect(dredgeButton()?.querySelector<HTMLSpanElement>(".refresh-progress-track span")?.style.width).toBe("50%");
    expect(container.querySelector(".timed-refresh-copy")?.textContent).toBe("打捞中 50%");

    await act(async () => {
      resolveFirstRefresh?.({ ok: true, data: state });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    commands = activityRefreshCommands(chromeMock);
    expect(commands).toHaveLength(2);
    expect(commands[1].timedRunId).toBe(timedRunId);
    expect(dredgeButton()?.querySelector(".refresh-button-label")?.textContent).toBe("@neo 回应 · 1/2");
    expect(dredgeButton()?.querySelector<HTMLSpanElement>(".refresh-progress-track span")?.style.width).toBe("50%");

    await act(async () => {
      chromeMock.emitStorageChange({
        [SITE_DATA_PROGRESS_STORAGE_KEY]: {
          oldValue: null,
          newValue: {
            taskId: "scope-reaction",
            taskType: "activity",
            scope: { kind: "reaction", usernames: ["neo"] },
            status: "running",
            trigger: "timed",
            timedRunId,
            completed: 1,
            total: 1,
            currentLabel: "回应 @neo",
            startedAt: "2026-06-28T00:00:02.000Z",
            updatedAt: "2026-06-28T00:00:03.000Z",
            source: "existing_tab"
          } satisfies SiteDataTaskProgress
        }
      });
      await Promise.resolve();
    });

    expect(dredgeButton()?.querySelector(".refresh-button-label")?.textContent).toBe("回应 @neo · 2/2");
    expect(dredgeButton()?.querySelector<HTMLSpanElement>(".refresh-progress-track span")?.style.width).toBe("100%");
    expect(container.querySelector(".timed-refresh-copy")?.textContent).toBe("打捞中 100%");

    await act(async () => {
      resolveSecondRefresh?.({ ok: true, data: state });
      chromeMock.emitStorageChange({
        [SITE_DATA_PROGRESS_STORAGE_KEY]: {
          oldValue: null,
          newValue: {
            taskId: "scope-reaction",
            taskType: "activity",
            scope: { kind: "reaction", usernames: ["neo"] },
            status: "success",
            trigger: "timed",
            timedRunId,
            completed: 1,
            total: 1,
            currentLabel: "回应 @neo",
            startedAt: "2026-06-28T00:00:02.000Z",
            updatedAt: "2026-06-28T00:00:04.000Z",
            finishedAt: "2026-06-28T00:00:04.000Z",
            source: "existing_tab"
          } satisfies SiteDataTaskProgress
        }
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(dredgeButton()?.textContent).toContain("立即打捞");
    vi.useRealTimers();
  });

  it("registers timed activity refresh surfaces only from the browser side panel", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T00:00:00.000Z"));
    const sidePanelSession = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    await renderFriendsAppWithChrome({ session: sidePanelSession, surface: "side-panel", pageStatus: missingPageStatus() });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(Object.keys((await loadTimedActivityRefreshSessionState(sidePanelSession)).visibleSurfaces)).toHaveLength(1);

    const inPageSession = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    setupChrome({ session: inPageSession });
    await renderFriendsApp("in-page");
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(Object.keys((await loadTimedActivityRefreshSessionState(inPageSession)).visibleSurfaces)).toHaveLength(0);
    vi.useRealTimers();
  });

  it("runs due timed activity refresh in all mode through the existing activity command", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T00:00:00.000Z"));
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    const chromeMock = setupChrome({
      session,
      state: timedActivityState({
        timedActivityRefreshEnabled: true,
        timedActivityRefreshScopeMode: "all",
        timedActivityRefreshIntervalMinutes: 120
      })
    });
    await renderFriendsApp("side-panel");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });

    expect(activityRefreshMessages(chromeMock)).toEqual([{ type: "refreshFriendActivity", scope: { kind: "all" } }]);
    expect(await loadTimedActivityRefreshSessionState(session)).toMatchObject({
      lastScopeMode: "all",
      lastFinishedAt: "2026-06-28T00:00:00.000Z",
      nextDueAt: "2026-06-28T02:00:00.000Z",
      pendingDue: false
    });
    vi.useRealTimers();
  });

  it("runs due timed activity refresh in rule mode as the derived existing scope sequence", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T00:00:00.000Z"));
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    const chromeMock = setupChrome({
      session,
      state: timedActivityState({
        timedActivityRefreshEnabled: true,
        timedActivityRefreshScopeMode: "rules",
        timedActivityRefreshIntervalMinutes: 120
      })
    });
    await renderFriendsApp("side-panel");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });

    expect(activityRefreshMessages(chromeMock)).toEqual([
      { type: "refreshFriendActivity", scope: { kind: "topic", usernames: ["neo"] } },
      { type: "refreshFriendActivity", scope: { kind: "reaction", usernames: ["neo"] } }
    ]);
    const commands = activityRefreshCommands(chromeMock);
    expect(commands[0]).toMatchObject({ trigger: "timed", timedRunId: expect.stringMatching(/^timed-activity:/) });
    expect(commands[1]?.timedRunId).toBe(commands[0]?.timedRunId);
    expect(await loadTimedActivityRefreshSessionState(session)).toMatchObject({
      lastScopeMode: "rules",
      lastFinishedAt: "2026-06-28T00:00:00.000Z"
    });
    vi.useRealTimers();
  });

  it("records a no-target timed refresh without requesting activity", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T00:00:00.000Z"));
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    const chromeMock = setupChrome({
      session,
      state: {
        ...timedActivityState({
          timedActivityRefreshEnabled: true,
          timedActivityRefreshScopeMode: "rules",
          timedActivityRefreshIntervalMinutes: 120
        }),
        dredgeRules: []
      }
    });
    await renderFriendsApp("side-panel");

    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
      await Promise.resolve();
    });

    expect(activityRefreshMessages(chromeMock)).toHaveLength(0);
    expect(await loadTimedActivityRefreshSessionState(session)).toMatchObject({
      lastScopeMode: "rules",
      noTargetAt: "2026-06-28T00:00:00.000Z",
      noTargetMessage: "没有启用规则",
      nextDueAt: "2026-06-28T02:00:00.000Z",
      pendingDue: false
    });
    expect((await loadTimedActivityRefreshSessionState(session)).pausedReason).toBeUndefined();
    vi.useRealTimers();
  });

  it("defers a due timed activity refresh while busy and retries it once after progress finishes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T00:00:00.000Z"));
    const runningProfiles: SiteDataTaskProgress = {
      taskId: "profiles-live",
      taskType: "profiles",
      usernames: ["neo"],
      status: "running",
      completed: 0,
      total: 1,
      currentLabel: "@neo",
      startedAt: "2026-06-28T00:00:00.000Z",
      updatedAt: "2026-06-28T00:00:00.000Z"
    };
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    const chromeMock = setupChrome({
      session,
      progress: runningProfiles,
      state: timedActivityState({
        timedActivityRefreshEnabled: true,
        timedActivityRefreshScopeMode: "all",
        timedActivityRefreshIntervalMinutes: 120
      })
    });
    await renderFriendsApp("side-panel");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });

    expect(activityRefreshMessages(chromeMock)).toHaveLength(0);
    expect(await loadTimedActivityRefreshSessionState(session)).toMatchObject({ pendingDue: true });

    await act(async () => {
      chromeMock.emitStorageChange(
        {
          [SITE_DATA_PROGRESS_STORAGE_KEY]: {
            oldValue: runningProfiles,
            newValue: {
              ...runningProfiles,
              status: "success",
              completed: 1,
              updatedAt: "2026-06-28T00:00:05.000Z",
              finishedAt: "2026-06-28T00:00:05.000Z"
            } satisfies SiteDataTaskProgress
          }
        },
        "session"
      );
      await Promise.resolve();
    });

    expect(activityRefreshMessages(chromeMock)).toEqual([{ type: "refreshFriendActivity", scope: { kind: "all" } }]);
    const timedSession = await loadTimedActivityRefreshSessionState(session);
    expect(timedSession.pendingDue).toBe(false);
    expect(timedSession.lastFinishedAt).toBeTruthy();
    vi.useRealTimers();
  });

  it("keeps timed activity refresh pending when service worker reports busy through lastSync", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T00:00:00.000Z"));
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    const chromeMock = setupChrome({
      session,
      refreshActivityResponses: [
        (state) => ({
          ok: true,
          data: {
            ...state,
            lastSync: {
              ok: false,
              source: "manual",
              reason: "unavailable",
              message: "已有刷新正在进行。",
              refreshedAt: "2026-06-28T00:00:00.000Z"
            }
          }
        })
      ],
      state: timedActivityState({
        timedActivityRefreshEnabled: true,
        timedActivityRefreshScopeMode: "all",
        timedActivityRefreshIntervalMinutes: 120
      })
    });
    await renderFriendsApp("side-panel");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });

    expect(activityRefreshMessages(chromeMock)).toEqual([{ type: "refreshFriendActivity", scope: { kind: "all" } }]);
    const timedSession = await loadTimedActivityRefreshSessionState(session);
    expect(timedSession).toMatchObject({
      pendingDue: true
    });
    expect(timedSession.pausedReason).toBeUndefined();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(14_999);
      await Promise.resolve();
    });
    expect(activityRefreshMessages(chromeMock)).toEqual([{ type: "refreshFriendActivity", scope: { kind: "all" } }]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
    });
    expect(activityRefreshMessages(chromeMock)).toEqual([
      { type: "refreshFriendActivity", scope: { kind: "all" } },
      { type: "refreshFriendActivity", scope: { kind: "all" } }
    ]);
    vi.useRealTimers();
  });

  it("pauses timed activity refresh and skips remaining derived scopes on challenge", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T00:00:00.000Z"));
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    const chromeMock = setupChrome({
      session,
      refreshActivityResponses: [
        (state) => ({ ok: true, data: state }),
        (state) => ({
          ok: true,
          data: {
            ...state,
            lastSync: {
              ok: false,
              source: "direct_fetch",
              reason: "challenge",
              message: "遇到浏览器验证页面，已停止请求。",
              refreshedAt: "2026-06-28T00:00:00.000Z"
            }
          }
        })
      ],
      state: timedActivityState({
        timedActivityRefreshEnabled: true,
        timedActivityRefreshScopeMode: "rules",
        timedActivityRefreshIntervalMinutes: 120
      })
    });
    await renderFriendsApp("side-panel");

    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
      await Promise.resolve();
    });

    expect(activityRefreshMessages(chromeMock)).toEqual([
      { type: "refreshFriendActivity", scope: { kind: "topic", usernames: ["neo"] } },
      { type: "refreshFriendActivity", scope: { kind: "reaction", usernames: ["neo"] } }
    ]);
    const timedSession = await loadTimedActivityRefreshSessionState(session);
    expect(timedSession).toMatchObject({
      pausedReason: "challenge",
      pausedMessage: "遇到浏览器验证页面，已停止请求。",
      pendingDue: false
    });
    expect(timedSession.lastFinishedAt).toBeUndefined();
    vi.useRealTimers();
  });

  it("preserves direct refresh failure reasons in timed activity pause state", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T00:00:00.000Z"));
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    setupChrome({
      session,
      refreshActivityResponses: [
        () => ({
          ok: false,
          reason: "rate_limited",
          error: "429 Too Many Requests"
        })
      ],
      state: timedActivityState({
        timedActivityRefreshEnabled: true,
        timedActivityRefreshScopeMode: "rules",
        timedActivityRefreshIntervalMinutes: 120
      })
    });
    await renderFriendsApp("side-panel");

    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
      await Promise.resolve();
    });

    expect(await loadTimedActivityRefreshSessionState(session)).toMatchObject({
      pausedReason: "rate_limited",
      pausedMessage: "429 Too Many Requests"
    });
    vi.useRealTimers();
  });

  it("does not duplicate a timed activity scope sequence while one logical run is in flight", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T00:00:00.000Z"));
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    let releaseFirstRefresh: (() => void) | undefined;
    const firstRefresh = new Promise<BackgroundResponse<AppState>>((resolve) => {
      releaseFirstRefresh = () => resolve({ ok: true, data: timedActivityState({ timedActivityRefreshEnabled: true }) });
    });
    const chromeMock = setupChrome({
      session,
      refreshActivityResponses: [
        () => firstRefresh,
        (state) => ({ ok: true, data: state })
      ],
      state: timedActivityState({
        timedActivityRefreshEnabled: true,
        timedActivityRefreshScopeMode: "rules",
        timedActivityRefreshIntervalMinutes: 120
      })
    });
    await renderFriendsApp("side-panel");

    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(activityRefreshMessages(chromeMock)).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(240 * 60_000);
      await Promise.resolve();
    });

    expect(activityRefreshMessages(chromeMock)).toHaveLength(1);

    await act(async () => {
      releaseFirstRefresh?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(activityRefreshMessages(chromeMock)).toEqual([
      { type: "refreshFriendActivity", scope: { kind: "topic", usernames: ["neo"] } },
      { type: "refreshFriendActivity", scope: { kind: "reaction", usernames: ["neo"] } }
    ]);
    vi.useRealTimers();
  });

  it("invalidates an in-flight timed dredge when automatic dredging is disabled", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T00:00:00.000Z"));
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    let releaseFirstRefresh: (() => void) | undefined;
    const firstRefresh = new Promise<BackgroundResponse<AppState>>((resolve) => {
      releaseFirstRefresh = () => resolve({ ok: true, data: timedActivityState({ timedActivityRefreshEnabled: true }) });
    });
    const chromeMock = setupChrome({
      session,
      refreshActivityResponses: [
        () => firstRefresh,
        (state) => ({ ok: true, data: state })
      ],
      state: timedActivityState({
        timedActivityRefreshEnabled: true,
        timedActivityRefreshScopeMode: "rules",
        timedActivityRefreshIntervalMinutes: 120
      })
    });
    const { container } = await renderFriendsApp("side-panel");

    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(activityRefreshMessages(chromeMock)).toHaveLength(1);
    expect((await loadTimedActivityRefreshSessionState(session)).activeRunId).toBeTruthy();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".timed-refresh-main")?.click();
      await Promise.resolve();
    });
    await act(async () => {
      getButton(container, "启用自动捞料").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(await loadTimedActivityRefreshSessionState(session)).toMatchObject({
      pendingDue: false
    });
    const disabledSession = await loadTimedActivityRefreshSessionState(session);
    expect(disabledSession.activeRunId).toBeUndefined();
    expect(disabledSession.controllerSurfaceId).toBeUndefined();
    expect(disabledSession.controllerClaimedAt).toBeUndefined();
    expect(disabledSession.controllerHeartbeatAt).toBeUndefined();

    await act(async () => {
      releaseFirstRefresh?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(activityRefreshMessages(chromeMock)).toHaveLength(1);
    const timedSession = await loadTimedActivityRefreshSessionState(session);
    expect(timedSession.lastFinishedAt).toBeUndefined();
    expect(timedSession.pendingDue).toBe(false);
    vi.useRealTimers();
  });

  it("does not start a fired timed dredge timer after automatic dredging is disabled", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T00:00:00.000Z"));
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    let releaseControllerClaim: (() => void) | undefined;
    const controllerClaim = new Promise<void>((resolve) => {
      releaseControllerClaim = resolve;
    });
    const chromeMock = setupChrome({
      session,
      state: timedActivityState({
        timedActivityRefreshEnabled: true,
        timedActivityRefreshScopeMode: "rules",
        timedActivityRefreshIntervalMinutes: 120
      }),
      beforeTimedControllerClaim: () => controllerClaim
    });
    const { container } = await renderFriendsApp("side-panel");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".timed-refresh-main")?.click();
      await Promise.resolve();
    });
    await act(async () => {
      getButton(container, "启用自动捞料").click();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      releaseControllerClaim?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(activityRefreshMessages(chromeMock)).toHaveLength(0);
    const timedSession = await loadTimedActivityRefreshSessionState(session);
    expect(timedSession.activeRunId).toBeUndefined();
    expect(timedSession.controllerSurfaceId).toBeUndefined();
    expect(timedSession.pendingDue).toBe(false);
    vi.useRealTimers();
  });

  it("releases refresh buttons after disabling timed dredge while its command promise is still pending", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T00:00:00.000Z"));
    const session = createMockStorage({ [uiSceneStorageKeys.version]: 1 });
    let releaseFirstRefresh: (() => void) | undefined;
    const firstRefresh = new Promise<BackgroundResponse<AppState>>((resolve) => {
      releaseFirstRefresh = () => resolve({ ok: true, data: timedActivityState({ timedActivityRefreshEnabled: true }) });
    });
    setupChrome({
      session,
      refreshActivityResponses: [() => firstRefresh],
      state: timedActivityState({
        timedActivityRefreshEnabled: true,
        timedActivityRefreshScopeMode: "rules",
        timedActivityRefreshIntervalMinutes: 120
      })
    });
    const { container } = await renderFriendsApp("side-panel");

    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".timed-refresh-main")?.click();
      await Promise.resolve();
    });
    await act(async () => {
      getButton(container, "启用自动捞料").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getButton(container, "刷新状态").disabled).toBe(false);
    await act(async () => {
      getButton(container, "佬友圈").click();
      await Promise.resolve();
    });
    expect(getButton(container, "刷新动态").disabled).toBe(false);

    await act(async () => {
      releaseFirstRefresh?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    vi.useRealTimers();
  });

  it("suppresses a pending timed dredge after manual feed refresh without recording a full dredge finish", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T00:00:00.000Z"));
    const session = createMockStorage({
      [uiSceneStorageKeys.version]: 1,
      [uiSceneStorageKeys.tab]: "feed",
      [uiSceneStorageKeys.feedKindFilter]: "boost",
      [uiSceneStorageKeys.feedUserFilter]: "neo",
      [TIMED_ACTIVITY_SESSION_STORAGE_KEY]: {
        enabledAt: "2026-06-27T22:00:00.000Z",
        nextDueAt: "2026-06-28T00:00:00.000Z",
        pendingDue: false,
        updatedAt: "2026-06-28T00:00:00.000Z"
      }
    });
    const chromeMock = setupChrome({
      session,
      state: {
        ...timedActivityState({
          timedActivityRefreshEnabled: true,
          timedActivityRefreshScopeMode: "all",
          timedActivityRefreshIntervalMinutes: 120
        }),
        friends: {
          neo: {
            username: "neo",
            note: "",
            groups: [],
            pinned: false,
            activityKinds: ["topic", "reply", "boost", "reaction"],
            upgradedAt: "2026-06-28T00:00:00.000Z",
            updatedAt: "2026-06-28T00:00:00.000Z"
          }
        }
      }
    });
    const { container } = await renderFriendsApp("side-panel");

    await act(async () => {
      getButton(container, "刷新动态").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(activityRefreshMessages(chromeMock)).toEqual([{ type: "refreshFriendActivity", scope: { kind: "boost", usernames: ["neo"] } }]);
    const timedSession = await loadTimedActivityRefreshSessionState(session);
    expect(timedSession).toMatchObject({
      pendingDue: false,
      nextDueAt: "2026-06-28T02:00:00.000Z"
    });
    expect(timedSession.lastFinishedAt).toBeUndefined();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(119 * 60_000);
      await Promise.resolve();
    });

    expect(activityRefreshMessages(chromeMock)).toEqual([{ type: "refreshFriendActivity", scope: { kind: "boost", usernames: ["neo"] } }]);
    vi.useRealTimers();
  });

  it("suppresses a pending timed dredge after jumping from a friend row to filtered feed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T00:00:00.000Z"));
    const session = createMockStorage({
      [uiSceneStorageKeys.version]: 1,
      [TIMED_ACTIVITY_SESSION_STORAGE_KEY]: {
        enabledAt: "2026-06-27T22:00:00.000Z",
        nextDueAt: "2026-06-28T00:00:00.000Z",
        pendingDue: false,
        updatedAt: "2026-06-28T00:00:00.000Z"
      }
    });
    const chromeMock = setupChrome({
      session,
      state: timedActivityState({
        timedActivityRefreshEnabled: true,
        timedActivityRefreshScopeMode: "rules",
        timedActivityRefreshIntervalMinutes: 120
      })
    });
    const { container } = await renderFriendsApp("side-panel");

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".friend-arrow-button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(activityRefreshMessages(chromeMock)).toEqual([{ type: "refreshFriendActivity", scope: { kind: "all", usernames: ["neo"] } }]);
    const timedSession = await loadTimedActivityRefreshSessionState(session);
    expect(timedSession).toMatchObject({
      pendingDue: false,
      nextDueAt: "2026-06-28T02:00:00.000Z"
    });
    expect(timedSession.lastFinishedAt).toBeUndefined();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });
    expect(activityRefreshMessages(chromeMock)).toEqual([{ type: "refreshFriendActivity", scope: { kind: "all", usernames: ["neo"] } }]);
    vi.useRealTimers();
  });
});

async function renderFriendsApp(surface?: React.ComponentProps<typeof FriendsApp>["surface"]) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const mounted: MountedFriendsAppRoot = { host, root, unmounted: false };
  const unmount = root.unmount.bind(root);
  root.unmount = () => {
    if (mounted.unmounted) return;
    mounted.unmounted = true;
    unmount();
    host.remove();
  };
  mountedFriendsAppRoots.push(mounted);
  await act(async () => {
    root.render(React.createElement(FriendsApp, surface ? { surface } : undefined));
  });
  await act(async () => {
    await Promise.resolve();
  });
  return { container: host, root };
}

async function renderFriendsAppWithChrome({
  session,
  surface,
  pageStatus
}: {
  session: ReturnType<typeof createMockStorage>;
  surface?: React.ComponentProps<typeof FriendsApp>["surface"];
  pageStatus: Parameters<typeof setupChrome>[0]["pageStatus"];
}) {
  setupChrome({ session, pageStatus });
  return renderFriendsApp(surface);
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
}

function setupChrome({
  pageStatus = { status: "missing", connectedCount: 0, staleCount: 0, heartbeats: [], updatedAt: new Date(0).toISOString() },
  progress = null,
  refreshActivityResponses = [],
  session,
  state = addFriendFromProfile(defaultAppState, {
    username: "neo",
    name: "Neo",
    refreshedAt: "2026-06-28T00:00:00.000Z"
  }),
  identifyFails = false,
  identifyResponse,
  cloudState = unboundCloudState(),
  updateCheck = {
    installedVersion: "1.0.1",
    latestReleaseUrl: "https://github.com/LeUKi/linuxdo-friends/releases/latest",
    status: "up-to-date" as const,
    latestVersion: "1.0.1",
    checkedAt: "2026-06-28T00:00:00.000Z",
    source: "github_release" as const
  },
  beforeTimedControllerClaim
}: {
  pageStatus?: PageScriptStatusSnapshot;
  progress?: SiteDataTaskProgress | null;
  refreshActivityResponses?: Array<
    (state: AppState, scope?: ActivityRefreshScope) => BackgroundResponse<AppState> | Promise<BackgroundResponse<AppState>>
  >;
  session: ReturnType<typeof createMockStorage>;
  state?: AppState;
  identifyFails?: boolean;
  identifyResponse?: Promise<unknown>;
  cloudState?: CloudArchiveLocalStateResult;
  updateCheck?: {
    installedVersion: string;
    latestReleaseUrl: string;
    status: "idle" | "checking" | "up-to-date" | "update-available" | "no-release" | "error";
    latestVersion?: string;
    checkedAt?: string;
    error?: string;
    source?: "github_release";
  };
  beforeTimedControllerClaim?: () => Promise<void>;
}) {
  const storageListeners: Array<(changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void> = [];
  const activityResponseQueue = [...refreshActivityResponses];
  let currentCloudState = cloudState;
  let currentState = state;
  if (beforeTimedControllerClaim) {
    const setSession = session.set.bind(session);
    session.set = async (value: Record<string, unknown>) => {
      if (TIMED_ACTIVITY_CONTROLLER_STORAGE_KEY in value) {
        await beforeTimedControllerClaim();
      }
      await setSession(value);
    };
  }
  const sendMessage = vi.fn(async (message) => {
    if (message.type === "getState") return { ok: true, data: currentState };
    if (message.type === "getPageScriptStatus") {
      return { ok: true, data: pageStatus };
    }
    if (message.type === "getSiteDataProgress") return { ok: true, data: progress };
    if (message.type === "getUpdateCheck") return { ok: true, data: updateCheck };
    if (message.type === "checkForUpdates") return { ok: true, data: updateCheck };
    if (message.type === "getCloudArchiveLocalState") return { ok: true, data: currentCloudState };
    if (message.type === "identifyCurrentAccount") {
      if (identifyResponse) return identifyResponse;
      if (identifyFails) return { ok: false, error: "需要打开 linux.do 后识别。" };
      return {
        ok: true,
        data: {
          ...currentState,
          currentAccount: { username: "lafish", verifiedAt: "2026-06-28T00:00:00.000Z", source: "latest_header" }
        }
      };
    }
    if (message.type === "openSidePanel") return { ok: true, data: { message: "已打开插件侧栏。" } };
    if (message.type === "openOptionsPage") return { ok: true, data: { message: "已打开配置页。" } };
    if (message.type === "openLinuxDoHome") return { ok: true, data: { message: "已打开 linux.do 首页。", tabId: 901, openedNewTab: false } };
    if (message.type === "repairLinuxDoPageScript") return { ok: true, data: { message: "已切换并刷新 linux.do 页面。", tabId: message.tabId, openedNewTab: false } };
    if (message.type === "activateLinuxDoPageTab") {
      pageStatus = { ...pageStatus, selectedTabId: message.tabId };
      return { ok: true, data: { message: "已切换到 linux.do 页面。", tabId: message.tabId, openedNewTab: false } };
    }
    if (message.type === "removeFriend") return { ok: true, data: removeFriend(state, message.username) };
    if (message.type === "updateFriend") return { ok: true, data: updateFriend(state, message.username, message.patch) };
    if (message.type === "upsertDredgeRule") return { ok: true, data: state };
    if (message.type === "removeDredgeRule") return { ok: true, data: state };
    if (message.type === "markLaoFindsItemRead") return { ok: true, data: state };
    if (message.type === "archiveLaoFindsItem") return { ok: true, data: state };
    if (message.type === "deleteLaoFindsItem") {
      currentState = deleteLaoFindsItem(currentState, message.id);
      return { ok: true, data: currentState };
    }
    if (message.type === "completeRuleDerivedLaoFindsDredge") {
      currentState = resetLaoFindsStartedAt(currentState, message.startedAt);
      return { ok: true, data: currentState };
    }
    if (message.type === "updateSettings") {
      const nextState = { ...state, settings: { ...state.settings, ...message.settings } };
      if (typeof message.settings?.timedActivityRefreshEnabled === "boolean") {
        const oldValue = session.dump()[TIMED_ACTIVITY_SESSION_STORAGE_KEY];
        const oldControllerValue = session.dump()[TIMED_ACTIVITY_CONTROLLER_STORAGE_KEY];
        const current = typeof oldValue === "object" && oldValue != null && !Array.isArray(oldValue) ? oldValue : {};
        const updatedAt = new Date().toISOString();
        const nextValue =
          message.settings.timedActivityRefreshEnabled === true
            ? omitUndefined({
                ...current,
                activeRunId: undefined,
                enabledAt: updatedAt,
                lastFailureAt: undefined,
                nextDueAt: new Date(Date.now() + nextState.settings.timedActivityRefreshIntervalMinutes * 60_000).toISOString(),
                noTargetAt: undefined,
                noTargetMessage: undefined,
                pausedMessage: undefined,
                pausedReason: undefined,
                pendingDue: false,
                updatedAt
              })
            : omitUndefined({
                ...current,
                activeRunId: undefined,
                controllerClaimedAt: undefined,
                controllerHeartbeatAt: undefined,
                controllerSurfaceId: undefined,
                pendingDue: false,
                updatedAt
              });
        await session.set({ [TIMED_ACTIVITY_SESSION_STORAGE_KEY]: nextValue });
        if (message.settings.timedActivityRefreshEnabled === false) {
          await session.remove(TIMED_ACTIVITY_CONTROLLER_STORAGE_KEY);
        }
        for (const listener of storageListeners) {
          listener({ [TIMED_ACTIVITY_SESSION_STORAGE_KEY]: { oldValue, newValue: nextValue } }, "session");
          if (message.settings.timedActivityRefreshEnabled === false && oldControllerValue !== undefined) {
            listener({ [TIMED_ACTIVITY_CONTROLLER_STORAGE_KEY]: { oldValue: oldControllerValue, newValue: undefined } }, "session");
          }
        }
      }
      state = nextState;
      currentState = nextState;
      return { ok: true, data: nextState };
    }
    if (message.type === "refreshFriendProfiles") return { ok: true, data: currentState };
    if (message.type === "refreshFriendActivity") {
      const responder = activityResponseQueue.shift();
      return responder ? responder(currentState, message.scope) : { ok: true, data: currentState };
    }
    return { ok: true, data: currentState };
  });
  vi.stubGlobal("chrome", {
    storage: {
      session,
      onChanged: {
        addListener: vi.fn((callback) => {
          storageListeners.push(callback);
        })
      }
    },
    runtime: {
      sendMessage,
      getManifest: vi.fn(() => ({ version: "1.0.1" })),
      onMessage: {
        addListener: vi.fn()
      }
    }
  });
  return {
    sendMessage,
    setCloudState(nextState: CloudArchiveLocalStateResult) {
      currentCloudState = nextState;
    },
    emitStorageChange(changes: Record<string, chrome.storage.StorageChange>, areaName = "session") {
      for (const listener of storageListeners) listener(changes, areaName);
    }
  };
}

function activityRefreshMessages(chromeMock: ReturnType<typeof setupChrome>) {
  return activityRefreshCommands(chromeMock).map(({ scope }) => ({ type: "refreshFriendActivity" as const, scope }));
}

function activityRefreshCommands(chromeMock: ReturnType<typeof setupChrome>) {
  return chromeMock.sendMessage.mock.calls
    .map(([message]) => message)
    .filter(
      (message): message is { type: "refreshFriendActivity"; scope?: ActivityRefreshScope; trigger?: string; timedRunId?: string } =>
        message.type === "refreshFriendActivity"
    );
}

async function enableAutoRefreshForTest({
  chromeMock,
  intervalMinutes,
  lastFinishedAt,
  session
}: {
  chromeMock: ReturnType<typeof setupChrome>;
  intervalMinutes: 1 | 10 | 30;
  lastFinishedAt: string;
  session: ReturnType<typeof createMockStorage>;
}) {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  const registeredSession = await loadAutoRefreshSessionState(session);
  await session.set({
    [AUTO_REFRESH_SESSION_STORAGE_KEY]: {
      ...registeredSession,
      enabled: true,
      intervalMinutes,
      lastFinishedAt,
      updatedAt: lastFinishedAt
    }
  });
  const enabledSession = session.dump()[AUTO_REFRESH_SESSION_STORAGE_KEY];
  await act(async () => {
    chromeMock.emitStorageChange(
      {
        [AUTO_REFRESH_SESSION_STORAGE_KEY]: {
          oldValue: null,
          newValue: enabledSession
        }
      },
      "session"
    );
    await Promise.resolve();
  });
}

function getButton(container: HTMLElement, text: string) {
  const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes(text));
  if (!button) throw new Error(`Button not found: ${text}`);
  return button;
}

function activityFeedState(url = "/t/topic/1"): AppState {
  return {
    ...defaultAppState,
    friends: {
      neo: {
        username: "neo",
        note: "",
        groups: [],
        pinned: false,
        activityKinds: ["topic", "reply", "boost", "reaction"],
        upgradedAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z"
      }
    },
    activity: {
      neo: {
        username: "neo",
        refreshedAt: "2026-06-28T00:05:00.000Z",
        items: [
          {
            id: "topic:neo:1",
            username: "neo",
            kind: "topic" as const,
            title: "新话题",
            url,
            occurredAt: "2026-06-28T00:04:00.000Z"
          }
        ]
      }
    }
  };
}

function currentRule(patch: Partial<DredgeRule> = {}): DredgeRule {
  return {
    schemaVersion: 2,
    id: "rule",
    name: "Rule",
    enabled: true,
    mode: "allow",
    usernames: "all",
    kinds: ["topic", "reply", "boost", "reaction"],
    patterns: [],
    createdAt: "2026-06-28T00:00:00.000Z",
    updatedAt: "2026-06-28T00:00:00.000Z",
    ...patch
  };
}

function timedActivityState(settings: Partial<AppState["settings"]> = {}): AppState {
  return {
    ...defaultAppState,
    friends: {
      neo: {
        username: "neo",
        note: "",
        groups: [],
        pinned: false,
        activityKinds: ["topic", "reaction"],
        upgradedAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z"
      }
    },
    dredgeRules: [
      currentRule({
        id: "rule-neo",
        name: "Neo",
        usernames: ["neo"],
        kinds: ["topic", "reply", "reaction"],
        patterns: []
      })
    ],
    settings: {
      ...defaultAppState.settings,
      ...settings
    }
  };
}

function omitUndefined<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function missingPageStatus() {
  return {
    status: "missing" as const,
    connectedCount: 0,
    staleCount: 0,
    heartbeats: [] as [],
    updatedAt: "2026-06-28T00:00:00.000Z"
  };
}

function unboundCloudState(): CloudArchiveLocalStateResult {
  return {
    binding: { bound: false },
    archiveState: "unbound"
  };
}

function sameCloudArchiveState(): CloudArchiveLocalStateResult {
  return {
    binding: {
      bound: true,
      app: "linuxdo-friends",
      linuxDoId: "42",
      tokenType: "Bearer",
      tokenKind: "jwt",
      boundAt: "2026-06-28T00:00:00.000Z",
      lastConfigDigest: "digest-1",
      lastConfigSyncedAt: "2026-06-28T00:01:00.000Z"
    },
    archiveState: "same",
    syncedAt: "2026-06-28T00:01:00.000Z"
  };
}

function differentCloudArchiveState(): CloudArchiveLocalStateResult {
  return {
    binding: {
      bound: true,
      app: "linuxdo-friends",
      linuxDoId: "42",
      tokenType: "Bearer",
      tokenKind: "jwt",
      boundAt: "2026-06-28T00:00:00.000Z",
      lastConfigDigest: "digest-1",
      lastConfigSyncedAt: "2026-06-28T00:01:00.000Z"
    },
    archiveState: "different"
  };
}

function createPendingIdentifyResponse() {
  let resolve: () => void = () => undefined;
  const promise = new Promise((done) => {
    resolve = () =>
      done({
        ok: true,
        data: {
          ...defaultAppState,
          currentAccount: { username: "lafish", verifiedAt: "2026-06-28T00:00:00.000Z", source: "latest_header" }
        }
      });
  });
  return { promise, resolve };
}
