import { createStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addFriendFromProfile } from "../domain/friends";
import { defaultAppState } from "../domain/defaultState";
import { PAGE_SCRIPT_STATUS_STORAGE_KEY } from "../storage/pageScriptStatusStorage";
import { SITE_DATA_PROGRESS_STORAGE_KEY } from "../storage/siteDataProgressStorage";
import { APP_STATE_STORAGE_KEY } from "../storage/storage";
import {
  activateLinuxDoPageTabAtom,
  appStateAtom,
  observeAppStateAtom,
  observePageScriptStatusAtom,
  observeSiteDataProgressAtom,
  pageScriptStatusAtom,
  resetAppStateObserverForTest,
  resetRuntimeObserversForTest,
  siteDataProgressAtom,
  statusMessageAtom
} from "./atoms";

describe("app state atom storage observation", () => {
  beforeEach(() => {
    resetAppStateObserverForTest();
    resetRuntimeObserversForTest();
    vi.unstubAllGlobals();
  });

  it("syncs durable app state changes from another surface", () => {
    let listener: ((changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void) | undefined;
    vi.stubGlobal("chrome", {
      storage: {
        onChanged: {
          addListener: vi.fn((callback) => {
            listener = callback;
          })
        }
      }
    });
    const store = createStore();
    const refreshedState = addFriendFromProfile(defaultAppState, {
      username: "neo",
      refreshedAt: "2026-06-28T12:00:00.000Z"
    });

    store.set(observeAppStateAtom);
    listener?.({ [APP_STATE_STORAGE_KEY]: { oldValue: defaultAppState, newValue: refreshedState } }, "local");

    expect(store.get(appStateAtom).friendProfiles.neo?.refreshedAt).toBe("2026-06-28T12:00:00.000Z");
  });

  it("fans site-data progress storage updates out to multiple mounted surfaces", () => {
    let storageListener: ((changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void) | undefined;
    vi.stubGlobal("chrome", {
      storage: {
        onChanged: {
          addListener: vi.fn((callback) => {
            storageListener = callback;
          })
        }
      },
      runtime: {
        onMessage: {
          addListener: vi.fn()
        }
      }
    });
    const sidePanelStore = createStore();
    const inPageStore = createStore();
    const progress = {
      type: "linuxdoFriends.siteDataProgress",
      progress: {
        taskId: "task-1",
        taskType: "activity",
        scope: { kind: "all" },
        status: "running",
        completed: 1,
        total: 4,
        currentLabel: "回复 @neo",
        startedAt: "2026-06-28T12:00:00.000Z",
        updatedAt: "2026-06-28T12:00:01.000Z"
      }
    };

    sidePanelStore.set(observeSiteDataProgressAtom);
    inPageStore.set(observeSiteDataProgressAtom);
    storageListener?.(
      {
        [SITE_DATA_PROGRESS_STORAGE_KEY]: {
          oldValue: null,
          newValue: progress.progress
        }
      },
      "session"
    );

    expect(sidePanelStore.get(siteDataProgressAtom)?.currentLabel).toBe("回复 @neo");
    expect(inPageStore.get(siteDataProgressAtom)?.currentLabel).toBe("回复 @neo");
  });

  it("removes unmounted site-data progress observers from fan-out", () => {
    let storageListener: ((changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void) | undefined;
    vi.stubGlobal("chrome", {
      storage: {
        onChanged: {
          addListener: vi.fn((callback) => {
            storageListener = callback;
          })
        }
      },
      runtime: {
        onMessage: {
          addListener: vi.fn()
        }
      }
    });
    const sidePanelStore = createStore();
    const inPageStore = createStore();

    sidePanelStore.set(observeSiteDataProgressAtom);
    const cleanup = inPageStore.set(observeSiteDataProgressAtom);
    cleanup?.();
    storageListener?.(
      {
        [SITE_DATA_PROGRESS_STORAGE_KEY]: {
          oldValue: null,
          newValue: {
            taskId: "task-1",
            taskType: "profiles",
            usernames: ["neo"],
            status: "running",
            completed: 1,
            total: 2,
            currentLabel: "@neo",
            startedAt: "2026-06-28T12:00:00.000Z",
            updatedAt: "2026-06-28T12:00:01.000Z"
          }
        }
      },
      "session"
    );

    expect(sidePanelStore.get(siteDataProgressAtom)?.currentLabel).toBe("@neo");
    expect(inPageStore.get(siteDataProgressAtom)).toBeNull();
  });

  it("keeps runtime progress messages as a compatibility notification path", () => {
    let runtimeListener: ((message: unknown) => void) | undefined;
    vi.stubGlobal("chrome", {
      storage: {
        onChanged: {
          addListener: vi.fn()
        }
      },
      runtime: {
        onMessage: {
          addListener: vi.fn((callback) => {
            runtimeListener = callback;
          })
        }
      }
    });
    const store = createStore();

    store.set(observeSiteDataProgressAtom);
    runtimeListener?.({
      type: "linuxdoFriends.siteDataProgress",
      progress: {
        taskId: "task-2",
        taskType: "profiles",
        usernames: ["neo"],
        status: "running",
        completed: 1,
        total: 2,
        currentLabel: "@neo",
        startedAt: "2026-06-28T12:00:00.000Z",
        updatedAt: "2026-06-28T12:00:01.000Z"
      }
    });

    expect(store.get(siteDataProgressAtom)?.currentLabel).toBe("@neo");
  });

  it("fans page-script status storage updates out to multiple mounted surfaces", () => {
    let storageListener: ((changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void) | undefined;
    vi.stubGlobal("chrome", {
      storage: {
        onChanged: {
          addListener: vi.fn((callback) => {
            storageListener = callback;
          })
        }
      },
      runtime: {
        onMessage: {
          addListener: vi.fn()
        }
      }
    });
    const sidePanelStore = createStore();
    const inPageStore = createStore();

    sidePanelStore.set(observePageScriptStatusAtom);
    inPageStore.set(observePageScriptStatusAtom);
    storageListener?.(
      {
        [PAGE_SCRIPT_STATUS_STORAGE_KEY]: {
          oldValue: null,
          newValue: {
            status: "connected",
            connectedCount: 1,
            staleCount: 0,
            selectedTabId: 123,
            heartbeats: [
              {
                tabId: 123,
                url: "https://linux.do/",
                status: "ready",
                hasLauncher: true,
                updatedAt: "2026-06-28T12:00:00.000Z"
              }
            ],
            updatedAt: "2026-06-28T12:00:00.000Z"
          }
        }
      },
      "session"
    );

    expect(sidePanelStore.get(pageScriptStatusAtom).status).toBe("connected");
    expect(inPageStore.get(pageScriptStatusAtom).selectedTabId).toBe(123);
  });

  it("removes unmounted page-script status observers from fan-out", () => {
    let storageListener: ((changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void) | undefined;
    vi.stubGlobal("chrome", {
      storage: {
        onChanged: {
          addListener: vi.fn((callback) => {
            storageListener = callback;
          })
        }
      },
      runtime: {
        onMessage: {
          addListener: vi.fn()
        }
      }
    });
    const sidePanelStore = createStore();
    const inPageStore = createStore();

    sidePanelStore.set(observePageScriptStatusAtom);
    const cleanup = inPageStore.set(observePageScriptStatusAtom);
    cleanup?.();
    storageListener?.(
      {
        [PAGE_SCRIPT_STATUS_STORAGE_KEY]: {
          oldValue: null,
          newValue: {
            status: "connected",
            connectedCount: 1,
            staleCount: 0,
            selectedTabId: 123,
            heartbeats: [],
            updatedAt: "2026-06-28T12:00:00.000Z"
          }
        }
      },
      "session"
    );

    expect(sidePanelStore.get(pageScriptStatusAtom).selectedTabId).toBe(123);
    expect(inPageStore.get(pageScriptStatusAtom).status).toBe("missing");
  });

  it("keeps runtime page-script status messages as a compatibility notification path", () => {
    let runtimeListener: ((message: unknown) => void) | undefined;
    vi.stubGlobal("chrome", {
      storage: {
        onChanged: {
          addListener: vi.fn()
        }
      },
      runtime: {
        onMessage: {
          addListener: vi.fn((callback) => {
            runtimeListener = callback;
          })
        }
      }
    });
    const store = createStore();

    store.set(observePageScriptStatusAtom);
    runtimeListener?.({
      type: "linuxdoFriends.pageScriptStatus",
      status: {
        status: "challenge",
        connectedCount: 0,
        staleCount: 0,
        heartbeats: [],
        updatedAt: "2026-06-28T12:00:00.000Z"
      }
    });

    expect(store.get(pageScriptStatusAtom).status).toBe("challenge");
  });

  it("activates a linux.do page tab and refreshes page-script status", async () => {
    const refreshedStatus = {
      status: "connected" as const,
      connectedCount: 1,
      staleCount: 0,
      selectedTabId: 123,
      heartbeats: [
        {
          tabId: 123,
          url: "https://linux.do/t/topic/1",
          status: "ready" as const,
          hasLauncher: true,
          updatedAt: "2026-06-28T12:00:00.000Z"
        }
      ],
      updatedAt: "2026-06-28T12:00:01.000Z"
    };
    const sendMessage = vi.fn(async (command) => {
      if (command.type === "activateLinuxDoPageTab") {
        return { ok: true, data: { message: "已切换到 linux.do 页面。", tabId: command.tabId, openedNewTab: false } };
      }
      if (command.type === "getPageScriptStatus") {
        return { ok: true, data: refreshedStatus };
      }
      return { ok: false, error: "unexpected command" };
    });
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage
      }
    });
    const store = createStore();

    await store.set(activateLinuxDoPageTabAtom, 123);

    expect(sendMessage).toHaveBeenCalledWith({ type: "activateLinuxDoPageTab", tabId: 123 });
    expect(sendMessage).toHaveBeenCalledWith({ type: "getPageScriptStatus" });
    expect(store.get(statusMessageAtom)).toBe("已切换到 linux.do 页面。");
    expect(store.get(pageScriptStatusAtom).selectedTabId).toBe(123);
  });

  it("refreshes page-script status after activate-only failures", async () => {
    const missingStatus = {
      status: "missing" as const,
      connectedCount: 0,
      staleCount: 0,
      heartbeats: [],
      updatedAt: "2026-06-28T12:00:01.000Z"
    };
    const sendMessage = vi.fn(async (command) => {
      if (command.type === "activateLinuxDoPageTab") {
        return { ok: false, error: "这个 linux.do 页面已不可用，请重新打开。" };
      }
      if (command.type === "getPageScriptStatus") {
        return { ok: true, data: missingStatus };
      }
      return { ok: false, error: "unexpected command" };
    });
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage
      }
    });
    const store = createStore();
    store.set(pageScriptStatusAtom, {
      status: "connected",
      connectedCount: 1,
      staleCount: 0,
      selectedTabId: 123,
      heartbeats: [
        {
          tabId: 123,
          url: "https://linux.do/t/topic/1",
          status: "ready",
          hasLauncher: true,
          updatedAt: "2026-06-28T12:00:00.000Z"
        }
      ],
      updatedAt: "2026-06-28T12:00:00.000Z"
    });

    await store.set(activateLinuxDoPageTabAtom, 123);

    expect(sendMessage).toHaveBeenCalledWith({ type: "activateLinuxDoPageTab", tabId: 123 });
    expect(sendMessage).toHaveBeenCalledWith({ type: "getPageScriptStatus" });
    expect(store.get(statusMessageAtom)).toBe("这个 linux.do 页面已不可用，请重新打开。");
    expect(store.get(pageScriptStatusAtom).status).toBe("missing");
  });
});
