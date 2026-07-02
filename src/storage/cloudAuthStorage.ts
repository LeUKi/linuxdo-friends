import { nowIso } from "../shared/time";
import type { CloudAuthExchangeResult, CloudAuthState, CloudBindingPublicState, CloudConfigStatus } from "../shared/types";

export const CLOUD_AUTH_STORAGE_KEY = "linuxdoFriendsCloudAuth";

type ChromeLikeStorage = {
  get(key: string): Promise<Record<string, unknown>>;
  set(value: Record<string, unknown>): Promise<void>;
  remove?(key: string | string[]): Promise<void>;
  setAccessLevel?(details: { accessLevel: "TRUSTED_CONTEXTS" | "TRUSTED_AND_UNTRUSTED_CONTEXTS" }): Promise<void>;
};

function hasChromeStorage(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

export async function configureCloudAuthStorageAccess(
  storage: ChromeLikeStorage | null = hasChromeStorage() ? chrome.storage.local : null
): Promise<void> {
  await storage?.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
}

export async function loadCloudAuth(
  storage: ChromeLikeStorage | null = hasChromeStorage() ? chrome.storage.local : null
): Promise<CloudAuthState | null> {
  if (!storage) return null;
  const result = await storage.get(CLOUD_AUTH_STORAGE_KEY);
  return normalizeCloudAuthState(result[CLOUD_AUTH_STORAGE_KEY]);
}

export async function saveCloudAuth(
  auth: CloudAuthState,
  storage: ChromeLikeStorage | null = hasChromeStorage() ? chrome.storage.local : null
): Promise<CloudAuthState> {
  const normalized = normalizeCloudAuthState(auth);
  if (!normalized) throw new Error("云存档登录状态无效。");
  if (storage) await storage.set({ [CLOUD_AUTH_STORAGE_KEY]: normalized });
  return normalized;
}

export async function saveCloudAuthFromExchange(
  result: CloudAuthExchangeResult,
  storage: ChromeLikeStorage | null = hasChromeStorage() ? chrome.storage.local : null,
  boundAt: string = nowIso()
): Promise<CloudAuthState> {
  return saveCloudAuth(
    {
      app: result.app,
      linuxDoId: result.linuxDoId,
      tokenType: result.tokenType,
      tokenKind: result.tokenKind,
      token: result.token,
      boundAt
    },
    storage
  );
}

export async function updateCloudAuth(
  updater: (auth: CloudAuthState) => CloudAuthState,
  storage: ChromeLikeStorage | null = hasChromeStorage() ? chrome.storage.local : null
): Promise<CloudAuthState | null> {
  const current = await loadCloudAuth(storage);
  if (!current) return null;
  return saveCloudAuth(updater(current), storage);
}

export async function clearCloudAuth(storage: ChromeLikeStorage | null = hasChromeStorage() ? chrome.storage.local : null): Promise<void> {
  if (!storage) return;
  if (typeof storage.remove === "function") {
    await storage.remove(CLOUD_AUTH_STORAGE_KEY);
  } else {
    await storage.set({ [CLOUD_AUTH_STORAGE_KEY]: undefined });
  }
}

export function toPublicCloudBinding(auth: CloudAuthState | null): CloudBindingPublicState {
  if (!auth) return { bound: false };
  return {
    bound: true,
    app: auth.app,
    linuxDoId: auth.linuxDoId,
    tokenType: auth.tokenType,
    tokenKind: auth.tokenKind,
    boundAt: auth.boundAt,
    lastStatus: auth.lastStatus,
    lastBackupAt: auth.lastBackupAt,
    lastRestoreAt: auth.lastRestoreAt,
    lastConfigDigest: auth.lastConfigDigest,
    lastConfigSyncedAt: auth.lastConfigSyncedAt
  };
}

function normalizeCloudAuthState(value: unknown): CloudAuthState | null {
  if (!isRecord(value)) return null;
  if (value.app !== "linuxdo-friends") return null;
  if (typeof value.linuxDoId !== "string" || !value.linuxDoId.trim()) return null;
  if (value.tokenType !== "Bearer") return null;
  if (value.tokenKind !== "jwt") return null;
  if (typeof value.token !== "string" || !value.token.trim()) return null;
  if (typeof value.boundAt !== "string" || !value.boundAt.trim()) return null;
  return {
    app: "linuxdo-friends",
    linuxDoId: value.linuxDoId,
    tokenType: "Bearer",
    tokenKind: "jwt",
    token: value.token,
    boundAt: value.boundAt,
    lastStatus: normalizeCloudStatus(value.lastStatus),
    lastBackupAt: normalizeOptionalString(value.lastBackupAt),
    lastRestoreAt: normalizeOptionalString(value.lastRestoreAt),
    lastConfigDigest: normalizeOptionalString(value.lastConfigDigest),
    lastConfigSyncedAt: normalizeOptionalString(value.lastConfigSyncedAt)
  };
}

function normalizeCloudStatus(value: unknown): CloudConfigStatus | undefined {
  if (!isRecord(value)) return undefined;
  const state = value.state;
  if (
    state !== "unchecked" &&
    state !== "remote_config" &&
    state !== "missing" &&
    state !== "unauthorized" &&
    state !== "invalid_config" &&
    state !== "network_error"
  ) {
    return undefined;
  }
  return {
    state,
    checkedAt: normalizeOptionalString(value.checkedAt),
    exportedAt: normalizeOptionalString(value.exportedAt),
    friendCount: typeof value.friendCount === "number" && Number.isFinite(value.friendCount) ? value.friendCount : undefined,
    message: normalizeOptionalString(value.message)
  };
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}
