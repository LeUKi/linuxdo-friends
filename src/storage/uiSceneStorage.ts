import type { ActivityKindFilter, FilterPopoverScene, UiSceneState, UiSceneTab, Username } from "../shared/types";

export const UI_SCENE_STORAGE_PREFIX = "linuxdoFriendsUiScene.";

const keys = {
  version: `${UI_SCENE_STORAGE_PREFIX}version`,
  tab: `${UI_SCENE_STORAGE_PREFIX}tab`,
  feedKindFilter: `${UI_SCENE_STORAGE_PREFIX}feedKindFilter`,
  feedUserFilter: `${UI_SCENE_STORAGE_PREFIX}feedUserFilter`,
  addFriendModalOpen: `${UI_SCENE_STORAGE_PREFIX}addFriendModalOpen`,
  addFriendQuery: `${UI_SCENE_STORAGE_PREFIX}addFriendQuery`,
  activityKindPopoverOpen: `${UI_SCENE_STORAGE_PREFIX}activityKindPopover.open`,
  activityKindPopoverQuery: `${UI_SCENE_STORAGE_PREFIX}activityKindPopover.query`,
  feedUserPopoverOpen: `${UI_SCENE_STORAGE_PREFIX}feedUserPopover.open`,
  feedUserPopoverQuery: `${UI_SCENE_STORAGE_PREFIX}feedUserPopover.query`
} as const;

export const uiSceneStorageKeys = keys;
export const allUiSceneStorageKeys = Object.values(keys);

export type UiScenePatch = Partial<{
  tab: UiSceneTab;
  feedKindFilter: ActivityKindFilter;
  feedUserFilter: "all" | Username;
  addFriendModalOpen: boolean;
  addFriendQuery: string;
  activityKindPopover: Partial<FilterPopoverScene>;
  feedUserPopover: Partial<FilterPopoverScene>;
}>;

type SessionStorageLike = {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(value: Record<string, unknown>): Promise<void>;
};

type StorageChanges = Record<string, chrome.storage.StorageChange>;

const fallbackStore: Record<string, unknown> = {};

export const defaultUiSceneState: UiSceneState = {
  version: 1,
  tab: "friends",
  feedKindFilter: "all",
  feedUserFilter: "all",
  addFriendModalOpen: false,
  addFriendQuery: "",
  activityKindPopover: { open: false, query: "" },
  feedUserPopover: { open: false, query: "" }
};

export function hasUiSceneStorageKey(key: string): boolean {
  return key.startsWith(UI_SCENE_STORAGE_PREFIX);
}

export function loadUiSceneState(storage: SessionStorageLike | null = getChromeSessionStorage()): Promise<UiSceneState> {
  return readStorage(storage).then(normalizeUiSceneState);
}

export async function patchUiSceneState(
  patch: UiScenePatch,
  storage: SessionStorageLike | null = getChromeSessionStorage()
): Promise<UiSceneState> {
  const currentRaw = await readStorage(storage);
  const current = normalizeUiSceneState(currentRaw);
  const next = normalizeUiSceneState(sceneToRaw({ ...current, ...normalizePatchForMerge(current, patch) }));
  const values = diffSceneToStorageValues(current, next);
  if (currentRaw[keys.version] !== 1 && Object.keys(values).length > 0) {
    values[keys.version] = 1;
  }
  if (Object.keys(values).length > 0) {
    await writeStorage(values, storage);
  }
  return next;
}

export function normalizeUiSceneState(raw?: Record<string, unknown> | null): UiSceneState {
  if (!raw) return defaultUiSceneState;
  if (raw[keys.version] !== 1 && raw.version !== 1) return defaultUiSceneState;
  return {
    version: 1,
    tab: normalizeTab(raw[keys.tab] ?? raw.tab),
    feedKindFilter: normalizeActivityKindFilter(raw[keys.feedKindFilter] ?? raw.feedKindFilter),
    feedUserFilter: normalizeFeedUserFilter(raw[keys.feedUserFilter] ?? raw.feedUserFilter),
    addFriendModalOpen: normalizeBoolean(raw[keys.addFriendModalOpen] ?? raw.addFriendModalOpen),
    addFriendQuery: normalizeString(raw[keys.addFriendQuery] ?? raw.addFriendQuery),
    activityKindPopover: {
      open: normalizeBoolean(
        raw[keys.activityKindPopoverOpen] ??
          nestedValue(raw.activityKindPopover, "open") ??
          defaultUiSceneState.activityKindPopover.open
      ),
      query: normalizeString(raw[keys.activityKindPopoverQuery] ?? nestedValue(raw.activityKindPopover, "query"))
    },
    feedUserPopover: {
      open: normalizeBoolean(raw[keys.feedUserPopoverOpen] ?? nestedValue(raw.feedUserPopover, "open") ?? defaultUiSceneState.feedUserPopover.open),
      query: normalizeString(raw[keys.feedUserPopoverQuery] ?? nestedValue(raw.feedUserPopover, "query"))
    }
  };
}

export function uiSceneFromStorageChanges(changes: StorageChanges): UiScenePatch | null {
  let hasChange = false;
  const patch: UiScenePatch = {};
  for (const [key, change] of Object.entries(changes)) {
    if (!hasUiSceneStorageKey(key)) continue;
    hasChange = true;
    applyStorageValueToPatch(patch, key, change.newValue);
  }
  return hasChange ? patch : null;
}

export function resetUiSceneFallbackStorage() {
  for (const key of Object.keys(fallbackStore)) {
    delete fallbackStore[key];
  }
}

function getChromeSessionStorage(): SessionStorageLike | null {
  if (typeof chrome === "undefined") return null;
  return chrome.storage?.session ?? null;
}

async function readStorage(storage: SessionStorageLike | null): Promise<Record<string, unknown>> {
  if (!storage) {
    return { ...fallbackStore };
  }
  return storage.get(allUiSceneStorageKeys);
}

async function writeStorage(values: Record<string, unknown>, storage: SessionStorageLike | null): Promise<void> {
  if (!storage) {
    Object.assign(fallbackStore, values);
    return;
  }
  await storage.set(values);
}

function diffSceneToStorageValues(current: UiSceneState, next: UiSceneState): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  if (current.version !== next.version) values[keys.version] = next.version;
  if (current.tab !== next.tab) values[keys.tab] = next.tab;
  if (current.feedKindFilter !== next.feedKindFilter) values[keys.feedKindFilter] = next.feedKindFilter;
  if (current.feedUserFilter !== next.feedUserFilter) values[keys.feedUserFilter] = next.feedUserFilter;
  if (current.addFriendModalOpen !== next.addFriendModalOpen) values[keys.addFriendModalOpen] = next.addFriendModalOpen;
  if (current.addFriendQuery !== next.addFriendQuery) values[keys.addFriendQuery] = next.addFriendQuery;
  if (current.activityKindPopover.open !== next.activityKindPopover.open) {
    values[keys.activityKindPopoverOpen] = next.activityKindPopover.open;
  }
  if (current.activityKindPopover.query !== next.activityKindPopover.query) {
    values[keys.activityKindPopoverQuery] = next.activityKindPopover.query;
  }
  if (current.feedUserPopover.open !== next.feedUserPopover.open) values[keys.feedUserPopoverOpen] = next.feedUserPopover.open;
  if (current.feedUserPopover.query !== next.feedUserPopover.query) values[keys.feedUserPopoverQuery] = next.feedUserPopover.query;
  if (Object.keys(values).length > 0 && current.version !== 1) values[keys.version] = 1;
  return values;
}

function sceneToRaw(scene: UiSceneState): Record<string, unknown> {
  return {
    [keys.version]: scene.version,
    [keys.tab]: scene.tab,
    [keys.feedKindFilter]: scene.feedKindFilter,
    [keys.feedUserFilter]: scene.feedUserFilter,
    [keys.addFriendModalOpen]: scene.addFriendModalOpen,
    [keys.addFriendQuery]: scene.addFriendQuery,
    [keys.activityKindPopoverOpen]: scene.activityKindPopover.open,
    [keys.activityKindPopoverQuery]: scene.activityKindPopover.query,
    [keys.feedUserPopoverOpen]: scene.feedUserPopover.open,
    [keys.feedUserPopoverQuery]: scene.feedUserPopover.query
  };
}

function normalizePatchForMerge(current: UiSceneState, patch: UiScenePatch): Partial<UiSceneState> {
  return {
    ...patch,
    activityKindPopover: patch.activityKindPopover ? { ...current.activityKindPopover, ...patch.activityKindPopover } : current.activityKindPopover,
    feedUserPopover: patch.feedUserPopover ? { ...current.feedUserPopover, ...patch.feedUserPopover } : current.feedUserPopover
  };
}

function applyStorageValueToPatch(patch: UiScenePatch, key: string, value: unknown) {
  if (key === keys.tab) patch.tab = normalizeTab(value);
  if (key === keys.feedKindFilter) patch.feedKindFilter = normalizeActivityKindFilter(value);
  if (key === keys.feedUserFilter) patch.feedUserFilter = normalizeFeedUserFilter(value);
  if (key === keys.addFriendModalOpen) patch.addFriendModalOpen = normalizeBoolean(value);
  if (key === keys.addFriendQuery) patch.addFriendQuery = normalizeString(value);
  if (key === keys.activityKindPopoverOpen) patch.activityKindPopover = { ...patch.activityKindPopover, open: normalizeBoolean(value) };
  if (key === keys.activityKindPopoverQuery) patch.activityKindPopover = { ...patch.activityKindPopover, query: normalizeString(value) };
  if (key === keys.feedUserPopoverOpen) patch.feedUserPopover = { ...patch.feedUserPopover, open: normalizeBoolean(value) };
  if (key === keys.feedUserPopoverQuery) patch.feedUserPopover = { ...patch.feedUserPopover, query: normalizeString(value) };
}

function normalizeTab(value: unknown): UiSceneTab {
  return value === "feed" || value === "friends" || value === "finds" ? value : defaultUiSceneState.tab;
}

function normalizeActivityKindFilter(value: unknown): ActivityKindFilter {
  return value === "topic" || value === "reply" || value === "boost" || value === "reaction" || value === "like" || value === "all"
    ? value
    : defaultUiSceneState.feedKindFilter;
}

function normalizeFeedUserFilter(value: unknown): "all" | Username {
  if (value === "all") return "all";
  return typeof value === "string" && value.trim() ? value.trim().replace(/^@/, "").toLowerCase() : defaultUiSceneState.feedUserFilter;
}

function normalizeBoolean(value: unknown): boolean {
  return typeof value === "boolean" ? value : false;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nestedValue(value: unknown, key: "open" | "query"): unknown {
  if (typeof value !== "object" || value == null) return undefined;
  return (value as Record<string, unknown>)[key];
}
