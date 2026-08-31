import { atom } from "jotai";
import type { Setter } from "jotai";
import {
  claimAutoRefreshController,
  defaultAutoRefreshSession,
  isAutoRefreshSessionStorageChange,
  loadAutoRefreshSessionState,
  patchAutoRefreshSessionState,
  registerAutoRefreshSurface,
  unregisterAutoRefreshSurface,
  type FriendStatusAutoRefreshIntervalMinutes,
  type FriendStatusAutoRefreshSession,
  type FriendStatusAutoRefreshSurface
} from "../storage/autoRefreshSessionStorage";
import { addSessionStorageChangeListener } from "../storage/sessionStorageAdapter";

export const autoRefreshSessionAtom = atom<FriendStatusAutoRefreshSession>(defaultAutoRefreshSession());

let autoRefreshSessionStorageListenerRegistered = false;
const autoRefreshSessionSubscribers = new Set<Setter>();

export const loadAutoRefreshSessionAtom = atom(null, async (_get, set) => {
  set(autoRefreshSessionAtom, await loadAutoRefreshSessionState());
});

export const observeAutoRefreshSessionAtom = atom(null, (_get, set) => {
  if (typeof chrome === "undefined" || !chrome.storage?.onChanged) return undefined;
  autoRefreshSessionSubscribers.add(set);
  if (!autoRefreshSessionStorageListenerRegistered) {
    const storageListener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== "session") return;
      if (!isAutoRefreshSessionStorageChange(changes)) return;
      void loadAutoRefreshSessionState().then((session) => {
        autoRefreshSessionSubscribers.forEach((subscriber) => subscriber(autoRefreshSessionAtom, session));
      });
    };
    addSessionStorageChangeListener(storageListener);
    autoRefreshSessionStorageListenerRegistered = true;
  }
  return () => {
    autoRefreshSessionSubscribers.delete(set);
  };
});

export const updateAutoRefreshEnabledAtom = atom(null, async (_get, set, enabled: boolean) => {
  const session = await patchAutoRefreshSessionState({ enabled });
  set(autoRefreshSessionAtom, session);
});

export const updateAutoRefreshIntervalAtom = atom(null, async (_get, set, intervalMinutes: FriendStatusAutoRefreshIntervalMinutes) => {
  const session = await patchAutoRefreshSessionState({ intervalMinutes });
  set(autoRefreshSessionAtom, session);
});

export const recordAutoRefreshFinishedAtom = atom(null, async (_get, set, finishedAt: string) => {
  const session = await patchAutoRefreshSessionState({ lastFinishedAt: finishedAt });
  set(autoRefreshSessionAtom, session);
});

export const registerAutoRefreshSurfaceAtom = atom(
  null,
  async (_get, set, input: { surfaceId: string; surface: FriendStatusAutoRefreshSurface }) => {
    const session = await registerAutoRefreshSurface(input.surfaceId, input.surface);
    set(autoRefreshSessionAtom, session);
  }
);

export const unregisterAutoRefreshSurfaceAtom = atom(null, async (_get, set, surfaceId: string) => {
  const session = await unregisterAutoRefreshSurface(surfaceId);
  set(autoRefreshSessionAtom, session);
});

export const claimAutoRefreshControllerAtom = atom(null, async (_get, set, surfaceId: string) => {
  const session = await claimAutoRefreshController(surfaceId);
  set(autoRefreshSessionAtom, session);
  return session;
});

export function resetAutoRefreshSessionObserverForTest() {
  autoRefreshSessionStorageListenerRegistered = false;
  autoRefreshSessionSubscribers.clear();
}
