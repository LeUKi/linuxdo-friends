import { parseConfigImportJson } from "./configTransfer";
import { nowIso } from "../shared/time";
import type { CloudAuthExchangeResult, CloudConfigStatus, ConfigExportFile } from "../shared/types";

export const CLOUD_SAVE_BASE_URL = "https://linuxdo-cloud-save.lafish.workers.dev";
export const CLOUD_SAVE_APP_ID = "linuxdo-friends";
export const CLOUD_SAVE_AUTH_FLOW_ID = "browser_code";
export const CLOUD_SAVE_SLOT_ID = "config";
export const CLOUD_SAVE_TOKEN_TYPE = "Bearer";
export const CLOUD_SAVE_TOKEN_KIND = "jwt";

export class CloudConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloudConfigError";
  }
}

export function buildBrowserCodeAuthStartUrl(challenge: string): string {
  const url = new URL("/auth/start", CLOUD_SAVE_BASE_URL);
  url.searchParams.set("app", CLOUD_SAVE_APP_ID);
  url.searchParams.set("flow", CLOUD_SAVE_AUTH_FLOW_ID);
  url.searchParams.set("challenge", challenge);
  return url.toString();
}

export function cloudAuthExchangeUrl(): string {
  return new URL("/auth/exchange", CLOUD_SAVE_BASE_URL).toString();
}

export function cloudAuthCompleteUrlPattern(): string {
  return `${CLOUD_SAVE_BASE_URL}/auth/complete/${CLOUD_SAVE_AUTH_FLOW_ID}*`;
}

export function cloudConfigSlotUrl(): string {
  return new URL(`/api/apps/${CLOUD_SAVE_APP_ID}/slots/${CLOUD_SAVE_SLOT_ID}`, CLOUD_SAVE_BASE_URL).toString();
}

export function parseCloudAuthExchangePayload(value: unknown): CloudAuthExchangeResult {
  if (!isRecord(value)) throw new CloudConfigError("云存档登录响应不是有效的 JSON 对象。");
  const app = typeof value.app === "string" ? value.app : "";
  const token = typeof value.token === "string" ? value.token : "";
  const tokenType = typeof value.token_type === "string" ? value.token_type : "";
  const tokenKind = typeof value.token_kind === "string" ? value.token_kind : "";
  const linuxDoId = typeof value.linux_do_id === "string" ? value.linux_do_id : "";

  if (app !== CLOUD_SAVE_APP_ID) throw new CloudConfigError("云存档登录来源不正确。");
  if (tokenType !== CLOUD_SAVE_TOKEN_TYPE) throw new CloudConfigError("云存档登录凭证类型不正确。");
  if (tokenKind !== CLOUD_SAVE_TOKEN_KIND) throw new CloudConfigError("云存档登录凭证格式不正确。");
  if (!token.trim()) throw new CloudConfigError("云存档登录缺少凭证。");
  if (!linuxDoId.trim()) throw new CloudConfigError("云存档登录缺少账号标识。");

  return {
    app: CLOUD_SAVE_APP_ID,
    token,
    tokenType: CLOUD_SAVE_TOKEN_TYPE,
    tokenKind: CLOUD_SAVE_TOKEN_KIND,
    linuxDoId
  };
}

export function parseCloudConfigPayload(value: unknown): ConfigExportFile {
  if (!isRecord(value)) throw new CloudConfigError("云端配置不是有效的 JSON 对象。");
  const config = unwrapCloudConfigPayload(value);
  try {
    return parseConfigImportJson(JSON.stringify(config));
  } catch (error) {
    throw new CloudConfigError(error instanceof Error ? error.message : "云端配置格式不正确。");
  }
}

export function summarizeCloudConfigPayload(value: unknown, checkedAt: string = nowIso()): CloudConfigStatus {
  if (isMissingCloudConfigPayload(value)) {
    return cloudConfigStatusFromError("missing", "云端还没有配置备份。", checkedAt);
  }
  const file = parseCloudConfigPayload(value);
  return {
    state: "remote_config",
    checkedAt,
    exportedAt: file.exportedAt,
    friendCount: Object.keys(file.friends).length,
    requestStatsTotal: file.requestStats.total
  };
}

export function cloudConfigStatusFromError(kind: CloudConfigStatus["state"], message: string, checkedAt: string = nowIso()): CloudConfigStatus {
  return {
    state: kind,
    checkedAt,
    message: sanitizeCloudErrorMessage(message)
  };
}

export function sanitizeCloudErrorMessage(message: string): string {
  if (!message.trim()) return "云存档操作失败。";
  let sanitized = message.replace(/token=[^&\s]+/gi, "token=<redacted>");
  sanitized = sanitized.replace(/code=[^&\s]+/gi, "code=<redacted>");
  sanitized = sanitized.replace(/verifier=[^&\s]+/gi, "verifier=<redacted>");
  sanitized = sanitized.replace(/Authorization:\s*Bearer\s+[^\s]+/gi, "Authorization: Bearer <redacted>");
  sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer <redacted>");
  sanitized = sanitized.replace(/https:\/\/[^\s]+/g, "[redacted-url]");
  return sanitized;
}

function unwrapCloudConfigPayload(value: Record<string, unknown>): unknown {
  if (isCloudConfigSlotPayload(value)) {
    if (value.found === false) throw new CloudConfigError("云端还没有配置备份。");
    if (!isRecord(value.data)) throw new CloudConfigError("云端配置格式不正确。");
    return value.data;
  }
  return value;
}

function isMissingCloudConfigPayload(value: unknown): boolean {
  return isRecord(value) && isCloudConfigSlotPayload(value) && value.found === false;
}

function isCloudConfigSlotPayload(value: Record<string, unknown>): boolean {
  return (
    "data" in value &&
    "version" in value &&
    "updatedAt" in value &&
    ("found" in value || "app" in value || "slot" in value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}
