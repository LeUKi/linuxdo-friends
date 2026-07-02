import type { RefreshFailureReason, TimedActivityRefreshScopeMode } from "../shared/types";

export type TimedActivityRefreshSurface = "side-panel";

export interface TimedActivityRefreshVisibleSurface {
  surface: TimedActivityRefreshSurface;
  heartbeatAt: string;
}

export interface TimedActivityRefreshSession {
  visibleSurfaces: Record<string, TimedActivityRefreshVisibleSurface>;
  controllerSurfaceId?: string;
  controllerClaimedAt?: string;
  controllerHeartbeatAt?: string;
  enabledAt?: string;
  lastStartedAt?: string;
  lastFinishedAt?: string;
  lastFailureAt?: string;
  lastScopeMode?: TimedActivityRefreshScopeMode;
  nextDueAt?: string;
  pausedReason?: Extract<RefreshFailureReason, "challenge" | "blocked" | "rate_limited" | "unavailable" | "network_error">;
  pausedMessage?: string;
  pendingDue?: boolean;
  activeRunId?: string;
  noTargetAt?: string;
  noTargetMessage?: string;
  updatedAt: string;
}

export type TimedActivityRefreshSessionPatch = Partial<
  Omit<TimedActivityRefreshSession, "visibleSurfaces" | "updatedAt"> & {
    visibleSurfaces: Record<string, TimedActivityRefreshVisibleSurface>;
  }
>;

type SessionStorageLike = {
  get(key: string | string[] | null): Promise<Record<string, unknown>>;
  set(value: Record<string, unknown>): Promise<void>;
  remove?(key: string | string[]): Promise<void>;
};

type StorageChanges = Record<string, chrome.storage.StorageChange>;

const TIMED_ACTIVITY_SESSION_STORAGE_PREFIX = "linuxdoFriendsTimedActivityRefreshSession";
export const TIMED_ACTIVITY_SESSION_STORAGE_KEY = `${TIMED_ACTIVITY_SESSION_STORAGE_PREFIX}.config`;
export const TIMED_ACTIVITY_CONTROLLER_STORAGE_KEY = `${TIMED_ACTIVITY_SESSION_STORAGE_PREFIX}.controller`;
export const TIMED_ACTIVITY_SURFACE_STORAGE_PREFIX = `${TIMED_ACTIVITY_SESSION_STORAGE_PREFIX}.surface.`;
export const TIMED_ACTIVITY_HEARTBEAT_MS = 15_000;
export const TIMED_ACTIVITY_LEASE_TTL_MS = TIMED_ACTIVITY_HEARTBEAT_MS * 2;

const fallbackStore: { session: TimedActivityRefreshSession | null } = { session: null };

export function defaultTimedActivityRefreshSession(now = nowIso()): TimedActivityRefreshSession {
  return {
    visibleSurfaces: {},
    updatedAt: now
  };
}

export async function loadTimedActivityRefreshSessionState(
  storage: SessionStorageLike | null = getChromeSessionStorage(),
  now = Date.now()
): Promise<TimedActivityRefreshSession> {
  if (!storage) return normalizeTimedActivityRefreshSession(fallbackStore.session, now);
  const result = await storage.get(null);
  return normalizeTimedActivityRefreshStorageRecord(result, now);
}

export async function patchTimedActivityRefreshSessionState(
  patch: TimedActivityRefreshSessionPatch,
  storage: SessionStorageLike | null = getChromeSessionStorage(),
  now = Date.now()
): Promise<TimedActivityRefreshSession> {
  const current = await loadTimedActivityRefreshSessionState(storage, now);
  const timestamp = new Date(now).toISOString();
  const next = normalizeTimedActivityRefreshSession({ ...current, ...patch, updatedAt: timestamp }, now);
  await writeConfigOrFallback(next, storage);
  if (!next.controllerSurfaceId) await removeStorageKey(TIMED_ACTIVITY_CONTROLLER_STORAGE_KEY, storage);
  return next;
}

export async function invalidateTimedActivityNoTargetSessionState(
  storage: SessionStorageLike | null = getChromeSessionStorage(),
  now = Date.now()
): Promise<TimedActivityRefreshSession> {
  return patchTimedActivityRefreshSessionState({ noTargetAt: undefined, noTargetMessage: undefined }, storage, now);
}

export async function registerTimedActivityRefreshSurface(
  surfaceId: string,
  surface: TimedActivityRefreshSurface,
  storage: SessionStorageLike | null = getChromeSessionStorage(),
  now = Date.now()
): Promise<TimedActivityRefreshSession> {
  const current = await loadTimedActivityRefreshSessionState(storage, now);
  const heartbeatAt = new Date(now).toISOString();
  if (!storage) {
    const next = normalizeTimedActivityRefreshSession(
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
  await storage.set({ [surfaceStorageKey(surfaceId)]: { surface, heartbeatAt } });
  if (current.controllerSurfaceId === surfaceId) {
    await storage.set({
      [TIMED_ACTIVITY_CONTROLLER_STORAGE_KEY]: {
        surfaceId,
        claimedAt: current.controllerClaimedAt ?? heartbeatAt,
        heartbeatAt
      }
    });
  }
  return loadTimedActivityRefreshSessionState(storage, now);
}

export async function unregisterTimedActivityRefreshSurface(
  surfaceId: string,
  storage: SessionStorageLike | null = getChromeSessionStorage(),
  now = Date.now()
): Promise<TimedActivityRefreshSession> {
  if (!storage) {
    const current = await loadTimedActivityRefreshSessionState(storage, now);
    const visibleSurfaces = { ...current.visibleSurfaces };
    delete visibleSurfaces[surfaceId];
    const clearsController = current.controllerSurfaceId === surfaceId;
    const next = normalizeTimedActivityRefreshSession(
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
  const current = await loadTimedActivityRefreshSessionState(storage, now);
  await removeStorageKey(surfaceStorageKey(surfaceId), storage);
  if (current.controllerSurfaceId === surfaceId) await removeStorageKey(TIMED_ACTIVITY_CONTROLLER_STORAGE_KEY, storage);
  return loadTimedActivityRefreshSessionState(storage, now);
}

export async function claimTimedActivityRefreshController(
  surfaceId: string,
  storage: SessionStorageLike | null = getChromeSessionStorage(),
  now = Date.now()
): Promise<TimedActivityRefreshSession> {
  const current = await loadTimedActivityRefreshSessionState(storage, now);
  if (!current.visibleSurfaces[surfaceId]) return current;
  if (current.pausedReason) return current;
  if (current.controllerSurfaceId && current.controllerSurfaceId !== surfaceId && current.controllerHeartbeatAt) return current;
  if (!current.controllerSurfaceId && electedControllerSurfaceId(current) !== surfaceId) return current;
  const timestamp = new Date(now).toISOString();
  const next = normalizeTimedActivityRefreshSession(
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

export function isTimedActivityRefreshSessionStorageChange(changes: StorageChanges): boolean {
  return Object.keys(changes).some(isTimedActivityRefreshStorageKey);
}

export function normalizeTimedActivityRefreshStorageRecord(record: Record<string, unknown>, now = Date.now()): TimedActivityRefreshSession {
  const config = isRecord(record[TIMED_ACTIVITY_SESSION_STORAGE_KEY]) ? record[TIMED_ACTIVITY_SESSION_STORAGE_KEY] : {};
  const visibleSurfaces: Record<string, TimedActivityRefreshVisibleSurface> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!key.startsWith(TIMED_ACTIVITY_SURFACE_STORAGE_PREFIX)) continue;
    const surfaceId = surfaceIdFromStorageKey(key);
    if (!surfaceId || !isRecord(value)) continue;
    visibleSurfaces[surfaceId] = {
      surface: value.surface,
      heartbeatAt: value.heartbeatAt
    } as TimedActivityRefreshVisibleSurface;
  }
  const controller = isRecord(record[TIMED_ACTIVITY_CONTROLLER_STORAGE_KEY]) ? record[TIMED_ACTIVITY_CONTROLLER_STORAGE_KEY] : undefined;
  return normalizeTimedActivityRefreshSession(
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

export function normalizeTimedActivityRefreshSession(value: unknown, now = Date.now()): TimedActivityRefreshSession {
  const nowText = new Date(now).toISOString();
  if (!isRecord(value)) return defaultTimedActivityRefreshSession(nowText);
  const visibleSurfaces = normalizeVisibleSurfaces(value.visibleSurfaces, now);
  const controllerSurfaceId = typeof value.controllerSurfaceId === "string" ? value.controllerSurfaceId : undefined;
  const controllerHeartbeatAt = freshIso(value.controllerHeartbeatAt, now);
  const controllerFresh = Boolean(controllerSurfaceId && controllerHeartbeatAt && visibleSurfaces[controllerSurfaceId]);
  const next: TimedActivityRefreshSession = {
    visibleSurfaces,
    pendingDue: value.pendingDue === true,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : nowText
  };
  if (controllerFresh) {
    next.controllerSurfaceId = controllerSurfaceId;
    next.controllerClaimedAt = typeof value.controllerClaimedAt === "string" ? value.controllerClaimedAt : controllerHeartbeatAt;
    next.controllerHeartbeatAt = controllerHeartbeatAt;
  }
  copyIso(next, value, "enabledAt");
  copyIso(next, value, "lastStartedAt");
  copyIso(next, value, "lastFinishedAt");
  copyIso(next, value, "lastFailureAt");
  copyIso(next, value, "nextDueAt");
  copyIso(next, value, "noTargetAt");
  if (value.lastScopeMode === "rules" || value.lastScopeMode === "all") next.lastScopeMode = value.lastScopeMode;
  if (isPausedReason(value.pausedReason)) next.pausedReason = value.pausedReason;
  if (typeof value.pausedMessage === "string" && value.pausedMessage.trim()) next.pausedMessage = value.pausedMessage;
  if (typeof value.activeRunId === "string" && value.activeRunId.trim()) next.activeRunId = value.activeRunId;
  if (typeof value.noTargetMessage === "string" && value.noTargetMessage.trim()) next.noTargetMessage = value.noTargetMessage;
  if (Object.keys(visibleSurfaces).length === 0) {
    delete next.controllerSurfaceId;
    delete next.controllerClaimedAt;
    delete next.controllerHeartbeatAt;
  }
  return next;
}

export function resetTimedActivityRefreshSessionFallbackStorage() {
  fallbackStore.session = null;
}

function normalizeVisibleSurfaces(value: unknown, now: number): Record<string, TimedActivityRefreshVisibleSurface> {
  if (!isRecord(value)) return {};
  const visibleSurfaces: Record<string, TimedActivityRefreshVisibleSurface> = {};
  for (const [surfaceId, surfaceValue] of Object.entries(value)) {
    if (!surfaceId || !isRecord(surfaceValue)) continue;
    const heartbeatAt = freshIso(surfaceValue.heartbeatAt, now);
    if (surfaceValue.surface !== "side-panel" || !heartbeatAt) continue;
    visibleSurfaces[surfaceId] = { surface: "side-panel", heartbeatAt };
  }
  return visibleSurfaces;
}

function electedControllerSurfaceId(session: TimedActivityRefreshSession): string | undefined {
  return Object.keys(session.visibleSurfaces).sort()[0];
}

function freshIso(value: unknown, now: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return undefined;
  return now - time <= TIMED_ACTIVITY_LEASE_TTL_MS ? value : undefined;
}

function validIso(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return Number.isFinite(Date.parse(value)) ? value : undefined;
}

function copyIso<T extends keyof TimedActivityRefreshSession>(
  target: TimedActivityRefreshSession,
  source: Record<string, unknown>,
  key: T
) {
  const value = validIso(source[key]);
  if (value) {
    (target as unknown as Record<string, unknown>)[key] = value;
  }
}

async function writeConfigOrFallback(session: TimedActivityRefreshSession, storage: SessionStorageLike | null) {
  if (!storage) {
    fallbackStore.session = session;
    return;
  }
  await writeConfig(session, storage);
}

async function writeConfig(session: TimedActivityRefreshSession, storage: SessionStorageLike) {
  const config: Record<string, unknown> = {
    pendingDue: session.pendingDue === true,
    updatedAt: session.updatedAt
  };
  for (const key of ["enabledAt", "lastStartedAt", "lastFinishedAt", "lastFailureAt", "nextDueAt", "noTargetAt"] as const) {
    if (session[key]) config[key] = session[key];
  }
  if (session.lastScopeMode) config.lastScopeMode = session.lastScopeMode;
  if (session.pausedReason) config.pausedReason = session.pausedReason;
  if (session.pausedMessage) config.pausedMessage = session.pausedMessage;
  if (session.activeRunId) config.activeRunId = session.activeRunId;
  if (session.noTargetMessage) config.noTargetMessage = session.noTargetMessage;
  await storage.set({ [TIMED_ACTIVITY_SESSION_STORAGE_KEY]: config });
}

async function writeController(session: TimedActivityRefreshSession, storage: SessionStorageLike) {
  if (!session.controllerSurfaceId || !session.controllerHeartbeatAt) {
    await removeStorageKey(TIMED_ACTIVITY_CONTROLLER_STORAGE_KEY, storage);
    return;
  }
  await storage.set({
    [TIMED_ACTIVITY_CONTROLLER_STORAGE_KEY]: {
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
  return `${TIMED_ACTIVITY_SURFACE_STORAGE_PREFIX}${surfaceId}`;
}

function surfaceIdFromStorageKey(key: string) {
  return key.startsWith(TIMED_ACTIVITY_SURFACE_STORAGE_PREFIX) ? key.slice(TIMED_ACTIVITY_SURFACE_STORAGE_PREFIX.length) : "";
}

function isTimedActivityRefreshStorageKey(key: string) {
  return (
    key === TIMED_ACTIVITY_SESSION_STORAGE_KEY ||
    key === TIMED_ACTIVITY_CONTROLLER_STORAGE_KEY ||
    key.startsWith(TIMED_ACTIVITY_SURFACE_STORAGE_PREFIX)
  );
}

function getChromeSessionStorage(): SessionStorageLike | null {
  if (typeof chrome === "undefined") return null;
  return chrome.storage?.session ?? null;
}

function isPausedReason(value: unknown): value is TimedActivityRefreshSession["pausedReason"] {
  return value === "challenge" || value === "blocked" || value === "rate_limited" || value === "unavailable" || value === "network_error";
}

function nowIso() {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}
