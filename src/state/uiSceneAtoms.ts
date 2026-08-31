import { atom } from "jotai";
import type { Setter } from "jotai";
import type { UiSceneState } from "../shared/types";
import {
  defaultUiSceneState,
  loadUiSceneState,
  patchUiSceneState,
  uiSceneFromStorageChanges,
  type UiScenePatch
} from "../storage/uiSceneStorage";
import { addSessionStorageChangeListener } from "../storage/sessionStorageAdapter";

export const uiSceneAtom = atom<UiSceneState>(defaultUiSceneState);

let uiSceneStorageListenerRegistered = false;
const uiSceneSubscribers = new Set<Setter>();

export const loadUiSceneAtom = atom(null, async (_get, set) => {
  const scene = await loadUiSceneState();
  set(uiSceneAtom, scene);
});

export const updateUiSceneAtom = atom(null, async (get, set, patch: UiScenePatch) => {
  const current = get(uiSceneAtom);
  const localNext = mergeUiScenePatch(current, patch);
  if (sameUiScene(current, localNext)) return;
  set(uiSceneAtom, localNext);
  const storedNext = await patchUiSceneState(patch);
  set(uiSceneAtom, (latest) => mergeUiScenePatch(latest, pickPatchedFields(storedNext, patch)));
});

export const observeUiSceneAtom = atom(null, (_get, set) => {
  if (typeof chrome === "undefined" || !chrome.storage?.onChanged) return undefined;
  uiSceneSubscribers.add(set);
  if (!uiSceneStorageListenerRegistered) {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== "session") return;
      const patch = uiSceneFromStorageChanges(changes);
      if (!patch) return;
      uiSceneSubscribers.forEach((subscriber) => subscriber(uiSceneAtom, (current) => mergeUiScenePatch(current, patch)));
    };
    addSessionStorageChangeListener(listener);
    uiSceneStorageListenerRegistered = true;
  }
  return () => {
    uiSceneSubscribers.delete(set);
  };
});

export function resetUiSceneObserverForTest() {
  uiSceneStorageListenerRegistered = false;
  uiSceneSubscribers.clear();
}

export function mergeUiScenePatch(current: UiSceneState, patch: UiScenePatch | UiSceneState): UiSceneState {
  return {
    ...current,
    ...patch,
    version: 1,
    activityKindPopover: {
      ...current.activityKindPopover,
      ...patch.activityKindPopover
    },
    feedUserPopover: {
      ...current.feedUserPopover,
      ...patch.feedUserPopover
    }
  };
}

function sameUiScene(left: UiSceneState, right: UiSceneState): boolean {
  return (
    left.tab === right.tab &&
    left.feedKindFilter === right.feedKindFilter &&
    left.feedUserFilter === right.feedUserFilter &&
    left.addFriendModalOpen === right.addFriendModalOpen &&
    left.addFriendQuery === right.addFriendQuery &&
    left.activityKindPopover.open === right.activityKindPopover.open &&
    left.activityKindPopover.query === right.activityKindPopover.query &&
    left.feedUserPopover.open === right.feedUserPopover.open &&
    left.feedUserPopover.query === right.feedUserPopover.query
  );
}

function pickPatchedFields(scene: UiSceneState, patch: UiScenePatch): UiScenePatch {
  const normalized: UiScenePatch = {};
  if ("tab" in patch) normalized.tab = scene.tab;
  if ("feedKindFilter" in patch) normalized.feedKindFilter = scene.feedKindFilter;
  if ("feedUserFilter" in patch) normalized.feedUserFilter = scene.feedUserFilter;
  if ("addFriendModalOpen" in patch) normalized.addFriendModalOpen = scene.addFriendModalOpen;
  if ("addFriendQuery" in patch) normalized.addFriendQuery = scene.addFriendQuery;
  if (patch.activityKindPopover) {
    normalized.activityKindPopover = {};
    if ("open" in patch.activityKindPopover) normalized.activityKindPopover.open = scene.activityKindPopover.open;
    if ("query" in patch.activityKindPopover) normalized.activityKindPopover.query = scene.activityKindPopover.query;
  }
  if (patch.feedUserPopover) {
    normalized.feedUserPopover = {};
    if ("open" in patch.feedUserPopover) normalized.feedUserPopover.open = scene.feedUserPopover.open;
    if ("query" in patch.feedUserPopover) normalized.feedUserPopover.query = scene.feedUserPopover.query;
  }
  return normalized;
}
