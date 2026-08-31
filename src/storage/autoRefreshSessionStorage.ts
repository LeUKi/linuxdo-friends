import { getSessionStorageArea } from "./sessionStorageAdapter";

export type FriendStatusAutoRefreshIntervalMinutes = 1 | 10 | 30;
export type FriendStatusAutoRefreshSurface = "side-panel" | "in-page";

export interface AutoRefreshVisibleSurface {
  surface: FriendStatusAutoRefreshSurface;
  heartbeatAt: string;
}

export interface FriendStatusAutoRefreshSession {
  enabled: boolean;
  intervalMinutes: FriendStatusAutoRefreshIntervalMinutes;
  visibleSurfaces: Record<string, AutoRefreshVisibleSurface>;
  controllerSurfaceId?: string;
  controllerClaimedAt?: string;
  controllerHeartbeatAt?: string;
  enabledAt?: string;
  lastFinishedAt?: string;
  updatedAt: string;
}

export type FriendStatusAutoRefreshPatch = Partial<{
  enabled: boolean;
  intervalMinutes: FriendStatusAutoRefreshIntervalMinutes;
  visibleSurfaces: Record<string, AutoRefreshVisibleSurface>;
  controllerSurfaceId?: string;
  controllerClaimedAt?: string;
  controllerHeartbeatAt?: string;
  enabledAt?: string;
  lastFinishedAt?: string;
}>;

type SessionStorageLike = {
  get(key: string | string[] | null): Promise<Record<string, unknown>>;
  set(value: Record<string, unknown>): Promise<void>;
  remove?(key: string | string[]): Promise<void>;
};

type StorageChanges = Record<string, chrome.storage.StorageChange>;

const AUTO_REFRESH_SESSION_STORAGE_PREFIX = "linuxdoFriendsAutoRefreshSession";
const AUTO_REFRESH_LEGACY_SESSION_STORAGE_KEY = AUTO_REFRESH_SESSION_STORAGE_PREFIX;
export const AUTO_REFRESH_SESSION_STORAGE_KEY = `${AUTO_REFRESH_SESSION_STORAGE_PREFIX}.config`;
export const AUTO_REFRESH_CONTROLLER_STORAGE_KEY = `${AUTO_REFRESH_SESSION_STORAGE_PREFIX}.controller`;
export const AUTO_REFRESH_SURFACE_STORAGE_PREFIX = `${AUTO_REFRESH_SESSION_STORAGE_PREFIX}.surface.`;
export const AUTO_REFRESH_HEARTBEAT_MS = 15_000;
export const AUTO_REFRESH_LEASE_TTL_MS = AUTO_REFRESH_HEARTBEAT_MS * 2;

const fallbackStore: { session: FriendStatusAutoRefreshSession | null } = { session: null };

export function defaultAutoRefreshSession(now = nowIso()): FriendStatusAutoRefreshSession {
  return {
    enabled: false,
    intervalMinutes: 10,
    visibleSurfaces: {},
    updatedAt: now
  };
}

export async function loadAutoRefreshSessionState(
  storage: SessionStorageLike | null = getChromeSessionStorage(),
  now = Date.now()
): Promise<FriendStatusAutoRefreshSession> {
  if (!storage) return normalizeAutoRefreshSession(fallbackStore.session, now);
  const result = await storage.get(null);
  return normalizeAutoRefreshStorageRecord(result, now);
}

export async function saveAutoRefreshSessionState(
  session: FriendStatusAutoRefreshSession,
  storage: SessionStorageLike | null = getChromeSessionStorage()
): Promise<void> {
  const normalized = normalizeAutoRefreshSession(session, Date.now());
  if (!storage) {
    fallbackStore.session = normalized;
    return;
  }
  await writeConfig(normalized, storage);
  await writeController(normalized, storage);
  const desiredSurfaceKeys = new Set(Object.keys(normalized.visibleSurfaces).map(surfaceStorageKey));
  const current = await storage.get(null);
  const staleSurfaceKeys = Object.keys(current).filter(
    (key) => key.startsWith(AUTO_REFRESH_SURFACE_STORAGE_PREFIX) && !desiredSurfaceKeys.has(key)
  );
  if (staleSurfaceKeys.length > 0) await removeStorageKey(staleSurfaceKeys, storage);
  await storage.set(
    Object.fromEntries(
      Object.entries(normalized.visibleSurfaces).map(([surfaceId, surface]) => [surfaceStorageKey(surfaceId), surface])
    )
  );
}

export async function patchAutoRefreshSessionState(
  patch: FriendStatusAutoRefreshPatch,
  storage: SessionStorageLike | null = getChromeSessionStorage(),
  now = Date.now()
): Promise<FriendStatusAutoRefreshSession> {
  const current = await loadAutoRefreshSessionState(storage, now);
  const timestamp = new Date(now).toISOString();
  const lifecyclePatch: FriendStatusAutoRefreshPatch = { ...patch };
  if ("enabled" in patch) {
    if (patch.enabled && !current.enabled) {
      lifecyclePatch.enabledAt = timestamp;
    }
    if (!patch.enabled) {
      lifecyclePatch.controllerSurfaceId = undefined;
      lifecyclePatch.controllerClaimedAt = undefined;
      lifecyclePatch.controllerHeartbeatAt = undefined;
      lifecyclePatch.enabledAt = undefined;
    }
  }
  const next = normalizeAutoRefreshSession({ ...current, ...lifecyclePatch, updatedAt: timestamp }, now);
  await writeConfigOrFallback(next, storage);
  if (!next.controllerSurfaceId) await removeStorageKey(AUTO_REFRESH_CONTROLLER_STORAGE_KEY, storage);
  return next;
}

export async function registerAutoRefreshSurface(
  surfaceId: string,
  surface: FriendStatusAutoRefreshSurface,
  storage: SessionStorageLike | null = getChromeSessionStorage(),
  now = Date.now()
): Promise<FriendStatusAutoRefreshSession> {
  if (!storage) {
    const current = await loadAutoRefreshSessionState(storage, now);
    const heartbeatAt = new Date(now).toISOString();
    const next = normalizeAutoRefreshSession(
      {
        ...current,
        visibleSurfaces: {
          ...current.visibleSurfaces,
          [surfaceId]: { surface, heartbeatAt }
        },
        controllerHeartbeatAt: current.controllerSurfaceId === surfaceId ? heartbeatAt : current.controllerHeartbeatAt,
        updatedAt: heartbeatAt
      },
      now
    );
    await writeConfigOrFallback(next, storage);
    return next;
  }
  const current = await loadAutoRefreshSessionState(storage, now);
  const heartbeatAt = new Date(now).toISOString();
  await storage.set({ [surfaceStorageKey(surfaceId)]: { surface, heartbeatAt } });
  if (current.controllerSurfaceId === surfaceId) {
    await storage.set({
      [AUTO_REFRESH_CONTROLLER_STORAGE_KEY]: {
        surfaceId,
        claimedAt: current.controllerClaimedAt ?? heartbeatAt,
        heartbeatAt
      }
    });
  }
  return loadAutoRefreshSessionState(storage, now);
}

export async function unregisterAutoRefreshSurface(
  surfaceId: string,
  storage: SessionStorageLike | null = getChromeSessionStorage(),
  now = Date.now()
): Promise<FriendStatusAutoRefreshSession> {
  if (!storage) {
    const current = await loadAutoRefreshSessionState(storage, now);
    const visibleSurfaces = { ...current.visibleSurfaces };
    delete visibleSurfaces[surfaceId];
    const clearsController = current.controllerSurfaceId === surfaceId;
    const next = normalizeAutoRefreshSession(
      {
        ...current,
        visibleSurfaces,
        controllerSurfaceId: clearsController ? undefined : current.controllerSurfaceId,
        controllerClaimedAt: clearsController ? undefined : current.controllerClaimedAt,
        controllerHeartbeatAt: clearsController ? undefined : current.controllerHeartbeatAt,
        updatedAt: new Date(now).toISOString()
      },
      now
    );
    await writeConfigOrFallback(next, storage);
    return next;
  }
  const current = await loadAutoRefreshSessionState(storage, now);
  await removeStorageKey(surfaceStorageKey(surfaceId), storage);
  if (current.controllerSurfaceId === surfaceId) {
    await removeStorageKey(AUTO_REFRESH_CONTROLLER_STORAGE_KEY, storage);
  }
  const afterRemove = await loadAutoRefreshSessionState(storage, now);
  if (Object.keys(afterRemove.visibleSurfaces).length === 0) {
    const disabled = normalizeAutoRefreshSession({ ...afterRemove, enabled: false, enabledAt: undefined, updatedAt: new Date(now).toISOString() }, now);
    await writeConfig(disabled, storage);
    await removeStorageKey(AUTO_REFRESH_CONTROLLER_STORAGE_KEY, storage);
    return disabled;
  }
  return afterRemove;
}

export async function claimAutoRefreshController(
  surfaceId: string,
  storage: SessionStorageLike | null = getChromeSessionStorage(),
  now = Date.now()
): Promise<FriendStatusAutoRefreshSession> {
  const current = await loadAutoRefreshSessionState(storage, now);
  if (!current.enabled || !current.visibleSurfaces[surfaceId]) return current;
  if (current.controllerSurfaceId && current.controllerSurfaceId !== surfaceId && current.controllerHeartbeatAt) return current;
  if (!current.controllerSurfaceId && electedControllerSurfaceId(current) !== surfaceId) return current;
  const timestamp = new Date(now).toISOString();
  const next = normalizeAutoRefreshSession(
    {
      ...current,
      controllerSurfaceId: surfaceId,
      controllerClaimedAt: current.controllerSurfaceId === surfaceId ? current.controllerClaimedAt ?? timestamp : timestamp,
      controllerHeartbeatAt: timestamp,
      updatedAt: timestamp
    },
    now
  );
  if (!storage) {
    await writeConfigOrFallback(next, storage);
  } else {
    await writeController(next, storage);
  }
  return next;
}

export function isAutoRefreshSessionStorageChange(changes: StorageChanges): boolean {
  return Object.keys(changes).some(isAutoRefreshStorageKey);
}

export function normalizeAutoRefreshStorageRecord(record: Record<string, unknown>, now = Date.now()): FriendStatusAutoRefreshSession {
  const splitConfig = record[AUTO_REFRESH_SESSION_STORAGE_KEY];
  const hasSplitState =
    isRecord(splitConfig) ||
    isRecord(record[AUTO_REFRESH_CONTROLLER_STORAGE_KEY]) ||
    Object.keys(record).some((key) => key.startsWith(AUTO_REFRESH_SURFACE_STORAGE_PREFIX));
  if (!hasSplitState && AUTO_REFRESH_LEGACY_SESSION_STORAGE_KEY in record) {
    return normalizeAutoRefreshSession(record[AUTO_REFRESH_LEGACY_SESSION_STORAGE_KEY], now);
  }

  const config = isRecord(splitConfig) ? splitConfig : {};
  const visibleSurfaces: Record<string, AutoRefreshVisibleSurface> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!key.startsWith(AUTO_REFRESH_SURFACE_STORAGE_PREFIX)) continue;
    const surfaceId = surfaceIdFromStorageKey(key);
    if (!surfaceId || !isRecord(value)) continue;
    visibleSurfaces[surfaceId] = {
      surface: value.surface,
      heartbeatAt: value.heartbeatAt
    } as AutoRefreshVisibleSurface;
  }

  const controller = isRecord(record[AUTO_REFRESH_CONTROLLER_STORAGE_KEY]) ? record[AUTO_REFRESH_CONTROLLER_STORAGE_KEY] : undefined;
  return normalizeAutoRefreshSession(
    {
      ...config,
      visibleSurfaces,
      controllerSurfaceId: controller?.surfaceId,
      controllerClaimedAt: controller?.claimedAt,
      controllerHeartbeatAt: controller?.heartbeatAt
    },
    now
  );
}

export function normalizeAutoRefreshSession(value: unknown, now = Date.now()): FriendStatusAutoRefreshSession {
  const nowText = new Date(now).toISOString();
  if (!isRecord(value)) return defaultAutoRefreshSession(nowText);
  const visibleSurfaces = normalizeVisibleSurfaces(value.visibleSurfaces, now);
  const controllerSurfaceId = typeof value.controllerSurfaceId === "string" ? value.controllerSurfaceId : undefined;
  const controllerHeartbeatAt = freshIso(value.controllerHeartbeatAt, now);
  const controllerFresh = Boolean(controllerSurfaceId && controllerHeartbeatAt && visibleSurfaces[controllerSurfaceId]);
  const next: FriendStatusAutoRefreshSession = {
    enabled: typeof value.enabled === "boolean" ? value.enabled : false,
    intervalMinutes: normalizeInterval(value.intervalMinutes),
    visibleSurfaces,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : nowText
  };
  if (controllerFresh) {
    next.controllerSurfaceId = controllerSurfaceId;
    next.controllerClaimedAt = typeof value.controllerClaimedAt === "string" ? value.controllerClaimedAt : controllerHeartbeatAt;
    next.controllerHeartbeatAt = controllerHeartbeatAt;
  }
  if (next.enabled) {
    next.enabledAt = validIso(value.enabledAt) ?? validIso(next.updatedAt) ?? nowText;
  }
  const lastFinishedAt = validIso(value.lastFinishedAt);
  if (lastFinishedAt) next.lastFinishedAt = lastFinishedAt;
  if (!next.enabled || Object.keys(visibleSurfaces).length === 0) {
    next.enabled = false;
    delete next.controllerSurfaceId;
    delete next.controllerClaimedAt;
    delete next.controllerHeartbeatAt;
    delete next.enabledAt;
  }
  return next;
}

export function resetAutoRefreshSessionFallbackStorage() {
  fallbackStore.session = null;
}

function normalizeVisibleSurfaces(value: unknown, now: number): Record<string, AutoRefreshVisibleSurface> {
  if (!isRecord(value)) return {};
  const visibleSurfaces: Record<string, AutoRefreshVisibleSurface> = {};
  for (const [surfaceId, surfaceValue] of Object.entries(value)) {
    if (!surfaceId || !isRecord(surfaceValue)) continue;
    const surface = surfaceValue.surface === "side-panel" || surfaceValue.surface === "in-page" ? surfaceValue.surface : undefined;
    const heartbeatAt = freshIso(surfaceValue.heartbeatAt, now);
    if (!surface || !heartbeatAt) continue;
    visibleSurfaces[surfaceId] = { surface, heartbeatAt };
  }
  return visibleSurfaces;
}

function normalizeInterval(value: unknown): FriendStatusAutoRefreshIntervalMinutes {
  return value === 1 || value === 10 || value === 30 ? value : 10;
}

function electedControllerSurfaceId(session: FriendStatusAutoRefreshSession): string | undefined {
  return Object.keys(session.visibleSurfaces).sort()[0];
}

function freshIso(value: unknown, now: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return undefined;
  return now - time <= AUTO_REFRESH_LEASE_TTL_MS ? value : undefined;
}

function validIso(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return Number.isFinite(Date.parse(value)) ? value : undefined;
}

async function writeConfigOrFallback(session: FriendStatusAutoRefreshSession, storage: SessionStorageLike | null) {
  if (!storage) {
    fallbackStore.session = session;
    return;
  }
  await writeConfig(session, storage);
}

async function writeConfig(session: FriendStatusAutoRefreshSession, storage: SessionStorageLike) {
  const config: Record<string, unknown> = {
    enabled: session.enabled,
    intervalMinutes: session.intervalMinutes,
    updatedAt: session.updatedAt
  };
  if (session.enabledAt) config.enabledAt = session.enabledAt;
  if (session.lastFinishedAt) config.lastFinishedAt = session.lastFinishedAt;
  await storage.set({ [AUTO_REFRESH_SESSION_STORAGE_KEY]: config });
}

async function writeController(session: FriendStatusAutoRefreshSession, storage: SessionStorageLike) {
  if (!session.controllerSurfaceId || !session.controllerHeartbeatAt) {
    await removeStorageKey(AUTO_REFRESH_CONTROLLER_STORAGE_KEY, storage);
    return;
  }
  await storage.set({
    [AUTO_REFRESH_CONTROLLER_STORAGE_KEY]: {
      surfaceId: session.controllerSurfaceId,
      claimedAt: session.controllerClaimedAt ?? session.controllerHeartbeatAt,
      heartbeatAt: session.controllerHeartbeatAt
    }
  });
}

async function removeStorageKey(key: string | string[], storage: SessionStorageLike | null) {
  if (!storage) return;
  if (storage.remove) {
    await storage.remove(key);
    return;
  }
  const keys = Array.isArray(key) ? key : [key];
  await storage.set(Object.fromEntries(keys.map((item) => [item, undefined])));
}

function surfaceStorageKey(surfaceId: string) {
  return `${AUTO_REFRESH_SURFACE_STORAGE_PREFIX}${surfaceId}`;
}

function surfaceIdFromStorageKey(key: string) {
  return key.startsWith(AUTO_REFRESH_SURFACE_STORAGE_PREFIX) ? key.slice(AUTO_REFRESH_SURFACE_STORAGE_PREFIX.length) : "";
}

function isAutoRefreshStorageKey(key: string) {
  return (
    key === AUTO_REFRESH_SESSION_STORAGE_KEY ||
    key === AUTO_REFRESH_CONTROLLER_STORAGE_KEY ||
    key === AUTO_REFRESH_LEGACY_SESSION_STORAGE_KEY ||
    key.startsWith(AUTO_REFRESH_SURFACE_STORAGE_PREFIX)
  );
}

function getChromeSessionStorage(): SessionStorageLike | null {
  if (typeof chrome === "undefined") return null;
  return getSessionStorageArea();
}

function nowIso() {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}
