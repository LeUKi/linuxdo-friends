import type { ActivityKind, LaoFindsItem } from "../shared/types";

const TELEGRAM_API_BASE = "https://api.telegram.org";
const LINUXDO_BASE = "https://linux.do";
const MAX_MESSAGE_LENGTH = 4096;
const MAX_AUTHOR_LENGTH = 80;
const MAX_TITLE_LENGTH = 180;
const MAX_EXCERPT_LENGTH = 160;
const MAX_RULE_SUMMARY_LENGTH = 240;
const COMPACT_RULE_SUMMARY_LENGTH = 120;
const MAX_LINK_URL_LENGTH = 900;

export type LaoFindsNotificationSource = "manual" | "timed";

export async function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "MarkdownV2", disable_web_page_preview: true })
    });
    const json = (await response.json()) as { ok: boolean; description?: string };
    if (!json.ok) {
      return { ok: false, error: json.description ?? "Telegram API 返回错误。" };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "网络请求失败。" };
  }
}

export async function sendLaoFindsTelegramNotifications({
  botToken,
  chatId,
  items,
  source
}: {
  botToken?: string;
  chatId?: string;
  items: LaoFindsItem[];
  source: LaoFindsNotificationSource;
}): Promise<void> {
  if (!botToken || !chatId || items.length === 0) return;
  const batches = buildLaoFindsTelegramMessageBatches(items, source);
  for (const text of batches) {
    await sendTelegramMessage(botToken, chatId, text);
  }
}

export function buildLaoFindsTelegramMessageBatches(items: LaoFindsItem[], source: LaoFindsNotificationSource): string[] {
  if (items.length === 0) return [];
  const header = telegramHeader(items.length, source);
  const batches: string[] = [];
  let current = header;

  for (const [index, item] of items.entries()) {
    const line = formatLaoFindsItem(item, index + 1, {
      includeExcerpt: true,
      includeLink: true,
      maxRuleSummaryLength: MAX_RULE_SUMMARY_LENGTH
    });
    const next = `${current}\n\n${line}`;
    if (next.length > MAX_MESSAGE_LENGTH) {
      if (current !== header) batches.push(current);
      const partHeader = current === header && batches.length === 0 ? header : telegramHeader(items.length, source, batches.length + 1);
      const safeLine = formatTelegramSafeLaoFindsItem(item, index + 1, partHeader);
      current = `${partHeader}\n\n${safeLine}`;
    } else {
      current = next;
    }
  }
  if (current) batches.push(current);
  return batches;
}

function telegramHeader(count: number, source: LaoFindsNotificationSource, part?: number): string {
  const sourceLabel = source === "timed" ? "自动捞料" : "手动打捞";
  const partCopy = part == null ? "" : ` · 第 ${part} 段`;
  return escapeMd(`🔔 佬有料 ${sourceLabel}新增 ${count} 条${partCopy}`);
}

function formatTelegramSafeLaoFindsItem(item: LaoFindsItem, index: number, header: string): string {
  const full = formatLaoFindsItem(item, index, {
    includeExcerpt: true,
    includeLink: true,
    maxRuleSummaryLength: MAX_RULE_SUMMARY_LENGTH
  });
  if (messageFits(header, full)) return full;

  const compact = formatLaoFindsItem(item, index, {
    includeExcerpt: false,
    includeLink: false,
    maxRuleSummaryLength: COMPACT_RULE_SUMMARY_LENGTH
  });
  if (messageFits(header, compact)) return compact;

  return formatLaoFindsItem(item, index, {
    includeExcerpt: false,
    includeLink: false,
    maxRuleSummaryLength: 0,
    titleLength: 80
  });
}

function messageFits(header: string, line: string): boolean {
  return `${header}\n\n${line}`.length <= MAX_MESSAGE_LENGTH;
}

function formatLaoFindsItem(
  item: LaoFindsItem,
  index: number,
  options: {
    includeExcerpt: boolean;
    includeLink: boolean;
    maxRuleSummaryLength: number;
    titleLength?: number;
  }
): string {
  const activity = item.activity;
  const kindLabel = activityKindLabel(activity.kind);
  const title = truncate(activity.title, options.titleLength ?? MAX_TITLE_LENGTH);
  const author = truncate(activity.actorUsername ? `${activity.actorUsername} → ${activity.username}` : activity.username, MAX_AUTHOR_LENGTH);
  const main = `*${escapeMd(`${index}. @${author}`)}* ${escapeMd(`${kindLabel}：${title}`)}`;
  const ruleLine = formatRuleLine(item.matchedRuleIds, options.maxRuleSummaryLength);
  const excerpt = options.includeExcerpt && activity.excerpt?.trim() ? `\n${escapeMd(truncate(activity.excerpt.trim(), MAX_EXCERPT_LENGTH))}` : "";
  const absoluteUrl = toAbsoluteUrl(activity.url);
  const link =
    options.includeLink && absoluteUrl && absoluteUrl.length <= MAX_LINK_URL_LENGTH
      ? `\n[${escapeMd("查看动态")}](${escapeMarkdownUrl(absoluteUrl)})`
      : "";
  return `${main}${ruleLine}${excerpt}${link}`;
}

function formatRuleLine(ruleIds: string[], maxLength: number): string {
  if (ruleIds.length === 0 || maxLength <= 0) return "";
  let summary = "";
  let included = 0;
  for (const ruleId of ruleIds) {
    const nextRuleId = summary ? `、${ruleId}` : ruleId;
    if (summary.length + nextRuleId.length > maxLength) break;
    summary = `${summary}${nextRuleId}`;
    included += 1;
  }
  if (!summary) {
    summary = truncate(ruleIds[0], maxLength);
    included = 1;
  }
  if (included < ruleIds.length) {
    const suffix = ` 等 ${ruleIds.length} 条`;
    summary = `${truncate(summary, Math.max(0, maxLength - suffix.length))}${suffix}`;
  }
  return `\n${escapeMd(`命中规则：${summary}`)}`;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function toAbsoluteUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${LINUXDO_BASE}${url.startsWith("/") ? "" : "/"}${url}`;
}

function activityKindLabel(kind: ActivityKind): string {
  if (kind === "topic") return "话题";
  if (kind === "reply") return "回复";
  if (kind === "boost") return "Boost";
  if (kind === "reaction") return "回应";
  if (kind === "like") return "点赞";
  return kind;
}

// MarkdownV2 requires escaping: _ * [ ] ( ) ~ ` > # + - = | { } . !
function escapeMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}

function escapeMarkdownUrl(url: string): string {
  return url.replace(/[)\\]/g, "\\$&");
}
