import type { BackgroundResponse, SessionStorageChangeMessage } from "../shared/types";

export interface SessionStorageAreaLike {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export type SessionStorageChangeListener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void;

let contentScriptContext = false;

export function markContentScriptContext(): void {
  contentScriptContext = true;
}

export function getSessionStorageArea(): SessionStorageAreaLike | null {
  if (contentScriptContext) return createContentScriptSessionStorage();
  return chrome.storage?.session ?? null;
}

export function addSessionStorageChangeListener(listener: SessionStorageChangeListener): () => void {
  if (!contentScriptContext) {
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener?.(listener);
  }
  const runtimeListener = (message: unknown) => {
    if (!isSessionStorageChangeMessage(message)) return false;
    listener(message.changes, "session");
    return false;
  };
  chrome.runtime.onMessage.addListener(runtimeListener);
  return () => chrome.runtime.onMessage.removeListener?.(runtimeListener);
}

function createContentScriptSessionStorage(): SessionStorageAreaLike {
  const sendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
  return {
    async get(keys) {
      return unwrapSessionResponse<Record<string, unknown>>(
        await sendMessage({ type: "sessionStorageGet", keys })
      );
    },
    async set(values) {
      unwrapSessionResponse(await sendMessage({ type: "sessionStorageSet", values }));
    },
    async remove(keys) {
      unwrapSessionResponse(await sendMessage({ type: "sessionStorageRemove", keys }));
    }
  };
}

function unwrapSessionResponse<T = unknown>(response: BackgroundResponse<T>): T {
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

function isSessionStorageChangeMessage(value: unknown): value is SessionStorageChangeMessage {
  return typeof value === "object" && value != null && (value as { type?: unknown }).type === "sessionStorageChanged";
}
