import { atom } from "jotai";
import type { Setter } from "jotai";
import {
  claimTimedActivityRefreshController,
  defaultTimedActivityRefreshSession,
  isTimedActivityRefreshSessionStorageChange,
  loadTimedActivityRefreshSessionState,
  patchTimedActivityRefreshSessionState,
  registerTimedActivityRefreshSurface,
  unregisterTimedActivityRefreshSurface,
  type TimedActivityRefreshSession,
  type TimedActivityRefreshSessionPatch
} from "../storage/timedActivityRefreshSessionStorage";
import { addSessionStorageChangeListener } from "../storage/sessionStorageAdapter";

export const timedActivityRefreshSessionAtom = atom<TimedActivityRefreshSession>(defaultTimedActivityRefreshSession());

let timedActivityRefreshSessionStorageListenerRegistered = false;
const timedActivityRefreshSessionSubscribers = new Set<Setter>();

export const loadTimedActivityRefreshSessionAtom = atom(null, async (_get, set) => {
  set(timedActivityRefreshSessionAtom, await loadTimedActivityRefreshSessionState());
});

export const observeTimedActivityRefreshSessionAtom = atom(null, (_get, set) => {
  if (typeof chrome === "undefined" || !chrome.storage?.onChanged) return undefined;
  timedActivityRefreshSessionSubscribers.add(set);
  if (!timedActivityRefreshSessionStorageListenerRegistered) {
    const storageListener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== "session") return;
      if (!isTimedActivityRefreshSessionStorageChange(changes)) return;
      void loadTimedActivityRefreshSessionState().then((session) => {
        timedActivityRefreshSessionSubscribers.forEach((subscriber) => subscriber(timedActivityRefreshSessionAtom, session));
      });
    };
    addSessionStorageChangeListener(storageListener);
    timedActivityRefreshSessionStorageListenerRegistered = true;
  }
  return () => {
    timedActivityRefreshSessionSubscribers.delete(set);
  };
});

export const patchTimedActivityRefreshSessionAtom = atom(null, async (_get, set, patch: TimedActivityRefreshSessionPatch) => {
  const session = await patchTimedActivityRefreshSessionState(patch);
  set(timedActivityRefreshSessionAtom, session);
  return session;
});

export const registerTimedActivityRefreshSurfaceAtom = atom(null, async (_get, set, surfaceId: string) => {
  const session = await registerTimedActivityRefreshSurface(surfaceId, "side-panel");
  set(timedActivityRefreshSessionAtom, session);
});

export const unregisterTimedActivityRefreshSurfaceAtom = atom(null, async (_get, set, surfaceId: string) => {
  const session = await unregisterTimedActivityRefreshSurface(surfaceId);
  set(timedActivityRefreshSessionAtom, session);
});

export const claimTimedActivityRefreshControllerAtom = atom(null, async (_get, set, surfaceId: string) => {
  const session = await claimTimedActivityRefreshController(surfaceId);
  set(timedActivityRefreshSessionAtom, session);
  return session;
});

export function resetTimedActivityRefreshSessionObserverForTest() {
  timedActivityRefreshSessionStorageListenerRegistered = false;
  timedActivityRefreshSessionSubscribers.clear();
}
