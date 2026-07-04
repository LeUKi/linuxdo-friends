import { nowIso } from "../shared/time";
import type { ActivityItem, AppState, FriendActivitySummary, Username } from "../shared/types";
import { normalizeUsername } from "./friends";

type RawRecord = Record<string, unknown>;

export interface RawUserAction {
  id?: number | string;
  action_type?: number;
  title?: string;
  topic_title?: string;
  excerpt?: string;
  created_at?: string;
  post_url?: string;
  slug?: string;
  topic_id?: number;
  target_name?: string | null;
  target_username?: string | null;
  post_number?: number;
  post_id?: number | null;
  reply_to_post_number?: number | null;
  username?: string;
  name?: string | null;
  acting_username?: string;
  acting_name?: string | null;
  avatar_template?: string;
  acting_avatar_template?: string;
  category_id?: number | null;
  deleted?: boolean;
  hidden?: boolean | null;
  closed?: boolean;
  archived?: boolean;
  truncated?: boolean;
}

export interface RawBoost {
  id?: number | string;
  raw?: string;
  cooked?: string;
  created_at?: string;
  post_id?: number;
  user?: RawRecord;
  post?: RawRecord;
}

export interface RawReaction {
  id?: number | string;
  user_id?: number;
  post_id?: number;
  created_at?: string;
  user?: RawRecord;
  post?: RawRecord;
  reaction?: RawRecord;
}

export interface RawFriendActivitySources {
  userActions: RawUserAction[];
  boosts: RawBoost[];
  reactions: RawReaction[];
}

export function extractUserActions(json: unknown): RawUserAction[] {
  if (!isRecord(json)) return [];
  const value = json.user_actions;
  return Array.isArray(value) ? value.filter(isRawUserAction) : [];
}

export function extractBoosts(json: unknown): RawBoost[] {
  if (!isRecord(json)) return [];
  const value = json.boosts;
  return Array.isArray(value) ? value.filter(isRawBoost) : [];
}

export function extractReactions(json: unknown): RawReaction[] {
  return Array.isArray(json) ? json.filter(isRawReaction) : [];
}

export function normalizeActivity(usernameInput: Username, actions: RawUserAction[]): FriendActivitySummary {
  return normalizeFriendActivity(usernameInput, { userActions: actions, boosts: [], reactions: [] });
}

export function normalizeFriendActivity(usernameInput: Username, sources: RawFriendActivitySources): FriendActivitySummary {
  const username = normalizeUsername(usernameInput);
  const items = sortActivityItems([
    ...sources.userActions.map((action) => normalizeUserAction(username, action)).filter(isActivityItem),
    ...sources.boosts.map(normalizeBoost),
    ...sources.reactions.map(normalizeReaction)
  ]);
  const lastPostAt = items.find((item) => item.occurredAt)?.occurredAt;
  return {
    username,
    refreshedAt: nowIso(),
    coarseStatus: classifyCoarseStatus(lastPostAt),
    lastPostAt,
    items
  };
}

export function normalizeUserAction(usernameInput: Username, action: RawUserAction): ActivityItem | undefined {
  const requestedUsername = normalizeUsername(usernameInput);
  const actorUsername = normalizeOptionalUsername(action.acting_username ?? action.username) ?? requestedUsername;
  const kind = activityKindFromUserActionType(action.action_type);
  if (!kind) return undefined;
  const topicId = readNumber(action.topic_id);
  const postId = readNumber(action.post_id);
  const postNumber = readNumber(action.post_number);
  const occurredAt = readStringValue(action.created_at);
  const title = readStringValue(action.title) ?? readStringValue(action.topic_title) ?? "未命名动态";
  return {
    id: `user_action:${requestedUsername}:${action.action_type ?? "unknown"}:${topicId ?? "no-topic"}:${
      postId ?? postNumber ?? occurredAt ?? "unknown"
    }`,
    username: actorUsername,
    kind,
    title,
    url: readStringValue(action.post_url) ?? topicUrl(action.slug, topicId, postNumber),
    occurredAt,
    excerpt: plainTextFromHtmlish(action.excerpt),
    source: "user_actions",
    actorUsername,
    actorName: readStringValue(action.acting_name) ?? readStringValue(action.name),
    actorAvatarUrl: avatarUrlFromTemplate(action.acting_avatar_template ?? action.avatar_template),
    targetUsername: normalizeOptionalUsername(action.target_username),
    targetName: readStringValue(action.target_name),
    topicId,
    topicTitle: title,
    postId,
    postNumber,
    replyToPostNumber: readNumber(action.reply_to_post_number),
    categoryId: readNumber(action.category_id),
    truncated: action.truncated === true,
    deleted: action.deleted === true,
    hidden: action.hidden === true,
    closed: action.closed === true,
    archived: action.archived === true
  };
}

function activityKindFromUserActionType(actionType: number | undefined): ActivityItem["kind"] | undefined {
  if (actionType === 1) return "like";
  if (actionType === 4) return "topic";
  if (actionType === 5) return "reply";
  return undefined;
}

export function normalizeBoost(boost: RawBoost): ActivityItem {
  const actor = isRecord(boost.user) ? boost.user : {};
  const post = isRecord(boost.post) ? boost.post : {};
  const actorUsername = normalizeOptionalUsername(readString(actor, "username")) ?? "unknown";
  const topicTitle = readString(post, "topic_title") ?? readString(post, "title") ?? "未命名主题";
  const boostText = plainTextFromHtmlish(boost.raw) ?? plainTextFromHtmlish(boost.cooked);
  return {
    id: `boost:${boost.id ?? `${actorUsername}:${boost.post_id ?? boost.created_at ?? "unknown"}`}`,
    username: actorUsername,
    kind: "boost",
    title: topicTitle,
    url: readString(post, "url"),
    occurredAt: readStringValue(boost.created_at),
    excerpt: plainTextFromHtmlish(readString(post, "excerpt")),
    source: "boosts",
    actorUsername,
    actorName: readString(actor, "name"),
    actorAvatarUrl: avatarUrlFromTemplate(readString(actor, "avatar_template")),
    targetUsername: normalizeOptionalUsername(readString(post, "username")),
    targetName: readString(post, "name"),
    targetAvatarUrl: avatarUrlFromTemplate(readString(post, "avatar_template")),
    topicId: readNumber(post.topic_id),
    topicTitle,
    postId: readNumber(post.id) ?? readNumber(boost.post_id),
    categoryId: readNumber(post.category_id),
    boostText
  };
}

export function normalizeReaction(reaction: RawReaction): ActivityItem {
  const actor = isRecord(reaction.user) ? reaction.user : {};
  const post = isRecord(reaction.post) ? reaction.post : {};
  const reactionRecord = isRecord(reaction.reaction) ? reaction.reaction : {};
  const actorUsername = normalizeOptionalUsername(readString(actor, "username")) ?? "unknown";
  const topicTitle = readString(post, "topic_title") ?? readNestedTopicTitle(post) ?? "未命名主题";
  const reactionValue = readString(reactionRecord, "reaction_value");
  return {
    id: `reaction:${reaction.id ?? `${actorUsername}:${reaction.post_id ?? reaction.created_at ?? "unknown"}`}`,
    username: actorUsername,
    kind: "reaction",
    title: topicTitle,
    url: readString(post, "url"),
    occurredAt: readStringValue(reaction.created_at) ?? readString(reactionRecord, "created_at"),
    excerpt: plainTextFromHtmlish(readString(post, "excerpt")),
    source: "reactions",
    actorUsername,
    actorName: readString(actor, "name"),
    actorAvatarUrl: avatarUrlFromTemplate(readString(actor, "avatar_template")),
    targetUsername: normalizeOptionalUsername(readString(post, "username")),
    targetName: readString(post, "name"),
    targetAvatarUrl: avatarUrlFromTemplate(readString(post, "avatar_template")),
    topicId: readNumber(post.topic_id),
    topicTitle,
    postId: readNumber(post.id) ?? readNumber(reaction.post_id),
    postNumber: readNumber(post.post_number),
    categoryId: readNumber(post.category_id),
    reactionValue
  };
}

export function sortActivityItems(items: ActivityItem[]): ActivityItem[] {
  return [...items].sort((a, b) => {
    const byTime = timestampValue(b.occurredAt) - timestampValue(a.occurredAt);
    if (byTime !== 0) return byTime;
    return a.id.localeCompare(b.id);
  });
}

export function applyActivitySummary(state: AppState, summary: FriendActivitySummary): AppState {
  return {
    ...state,
    activity: {
      ...state.activity,
      [summary.username]: summary
    }
  };
}

export function plainTextFromHtmlish(value?: string): string | undefined {
  if (!value) return undefined;
  const text = decodeHtmlEntities(
    value
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]*>/g, " ")
  )
    .replace(/\s+([,.;:!?，。；：！？…])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return text || undefined;
}

export function avatarUrlFromTemplate(value?: string): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace("{size}", "48");
  if (normalized.startsWith("//")) return `https:${normalized}`;
  if (normalized.startsWith("/")) return `https://linux.do${normalized}`;
  return normalized;
}

export function classifyCoarseStatus(value?: string): FriendActivitySummary["coarseStatus"] {
  if (!value) return "unknown";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "unknown";
  const age = Date.now() - timestamp;
  if (age < 3 * 24 * 60 * 60 * 1000) return "recently_active";
  if (age < 7 * 24 * 60 * 60 * 1000) return "active_this_week";
  return "quiet";
}

function topicUrl(slug: unknown, topicId?: number, postNumber?: number): string | undefined {
  if (!topicId) return undefined;
  const safeSlug = typeof slug === "string" && slug.trim() ? slug.trim() : "topic";
  return `/t/${safeSlug}/${topicId}${postNumber ? `/${postNumber}` : ""}`;
}

function readNestedTopicTitle(post: RawRecord): string | undefined {
  const topic = post.topic;
  if (!isRecord(topic)) return undefined;
  return readString(topic, "title") ?? readString(topic, "fancy_title");
}

function timestampValue(value?: string): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeOptionalUsername(value?: string | null): Username | undefined {
  if (!value) return undefined;
  const username = normalizeUsername(value);
  return username || undefined;
}

function readString(record: RawRecord, key: string): string | undefined {
  return readStringValue(record[key]);
}

function readStringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRawUserAction(value: unknown): value is RawUserAction {
  return isRecord(value);
}

function isRawBoost(value: unknown): value is RawBoost {
  return isRecord(value);
}

function isRawReaction(value: unknown): value is RawReaction {
  return isRecord(value);
}

function isActivityItem(value: ActivityItem | undefined): value is ActivityItem {
  return Boolean(value);
}

function isRecord(value: unknown): value is RawRecord {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
    nbsp: " ",
    hellip: "..."
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const key = entity.toLowerCase();
    if (key.startsWith("#x")) {
      const code = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (key.startsWith("#")) {
      const code = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return named[key] ?? match;
  });
}
