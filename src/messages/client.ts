import type { BackgroundCommand, BackgroundResponse } from "../shared/types";

export async function sendCommand<T>(command: BackgroundCommand): Promise<BackgroundResponse<T>> {
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
    return { ok: false, error: "扩展运行环境不可用。" };
  }
  try {
    return await chrome.runtime.sendMessage(command);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "扩展后台没有响应。" };
  }
}
