import type { RefreshFailureReason } from "../shared/types";

export type ClassifiedResponse =
  | { ok: true; json: unknown }
  | { ok: false; reason: RefreshFailureReason; message: string };

export async function classifyFetchResponse(response: Response): Promise<ClassifiedResponse> {
  const text = await response.text();
  if (hasCloudflareChallengeHeader(response)) {
    return { ok: false, reason: "challenge", message: "遇到浏览器验证页面，已停止请求。" };
  }
  if (response.ok) {
    try {
      return { ok: true, json: JSON.parse(text) };
    } catch {
      // Non-JSON success responses are classified below.
    }
  }
  if (looksLikeChallengeHtml(text, response.headers.get("content-type"))) {
    return { ok: false, reason: "challenge", message: "遇到浏览器验证页面，已停止请求。" };
  }
  if (response.status === 403) {
    return { ok: false, reason: "blocked", message: "linux.do 拒绝了本次请求，已停止重试。" };
  }
  if (response.status === 429) {
    return { ok: false, reason: "rate_limited", message: "linux.do 返回限流，已停止重试。" };
  }
  if (!response.ok) {
    return { ok: false, reason: "network_error", message: `请求失败：${response.status}` };
  }
  return { ok: false, reason: "invalid_response", message: "响应不是可解析的 JSON。" };
}

export function looksLikeChallengeHtml(text: string, contentType: string | null = null): boolean {
  const lowered = text.trimStart().slice(0, 4000).toLowerCase();
  if (!looksLikeHtml(lowered, contentType)) return false;
  return (
    lowered.includes("cf-mitigated") ||
    /<title[^>]*>\s*just a moment(?:\.{3}|…)?\s*<\/title>/.test(lowered) ||
    lowered.includes("challenge-error-text") ||
    lowered.includes("/cdn-cgi/challenge-platform/") ||
    lowered.includes("enable javascript and cookies")
  );
}

function hasCloudflareChallengeHeader(response: Response): boolean {
  return response.headers.get("cf-mitigated")?.trim().toLowerCase() === "challenge";
}

function looksLikeHtml(lowered: string, contentType: string | null): boolean {
  const normalizedContentType = contentType?.toLowerCase() ?? "";
  return normalizedContentType.includes("text/html") || normalizedContentType.includes("application/xhtml+xml") || /^<!doctype\s+html\b/.test(lowered) || /^<html\b/.test(lowered);
}
