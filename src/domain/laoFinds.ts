import { nowIso } from "../shared/time";
import type { ActivityItem, ActivityRefreshKind, AppState, LaoFindsItem, DredgeRule, DredgeRuleMode, Username } from "../shared/types";
import { ALL_ACTIVITY_KINDS, normalizeActivityKinds, normalizeUsername } from "./friends";

export function normalizeDredgeRules(value: unknown, fallback: DredgeRule[] = []): DredgeRule[] {
  if (!Array.isArray(value)) return [...fallback];
  const rules: DredgeRule[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecord(item)) continue;
    const rule = normalizeDredgeRule(item);
    if (!rule || seen.has(rule.id)) continue;
    seen.add(rule.id);
    rules.push(rule);
  }
  return rules;
}

export function normalizeLaoFindsItems(value: unknown): Record<string, LaoFindsItem> {
  if (!isRecord(value)) return {};
  const items: Record<string, LaoFindsItem> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!isRecord(item) || !isRecord(item.activity)) continue;
    const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : key;
    const activityId = typeof item.activityId === "string" && item.activityId.trim() ? item.activityId.trim() : id;
    items[id] = {
      id,
      activityId,
      activity: item.activity as unknown as ActivityItem,
      collectedAt: timestampOrNow(item.collectedAt),
      matchedRuleIds: normalizeStringList(item.matchedRuleIds),
      readAt: optionalTimestamp(item.readAt),
      archivedAt: optionalTimestamp(item.archivedAt)
    };
  }
  return items;
}

export function normalizeDredgeRule(value: Partial<DredgeRule> & { id?: string }, timestamp: string = nowIso()): DredgeRule | null {
  if (value.schemaVersion !== 2) return null;
  if (!isDredgeRuleMode(value.mode)) return null;
  const patterns = normalizeDredgeRulePatterns(value.patterns);
  if (!patterns.valid) return null;
  const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : createDredgeRuleId(timestamp);
  const createdAt = typeof value.createdAt === "string" && value.createdAt.trim() ? value.createdAt : timestamp;
  const name = typeof value.name === "string" && value.name.trim() ? value.name.trim() : "未命名打捞规则";
  return {
    schemaVersion: 2,
    id,
    name,
    enabled: value.enabled !== false,
    mode: value.mode,
    usernames: normalizeRuleUsernames(value.usernames),
    kinds: normalizeActivityKinds(value.kinds, ALL_ACTIVITY_KINDS),
    patterns: patterns.patterns,
    createdAt,
    updatedAt: typeof value.updatedAt === "string" && value.updatedAt.trim() ? value.updatedAt : timestamp
  };
}

export function createDredgeRuleId(timestamp: string = nowIso()): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `dredge-rule:${Date.parse(timestamp) || Date.now()}:${random}`;
}

export function upsertDredgeRule(state: AppState, input: Partial<DredgeRule> & { id?: string }): AppState {
  const timestamp = nowIso();
  const existing = input.id ? state.dredgeRules.find((rule) => rule.id === input.id) : undefined;
  const normalized = normalizeDredgeRule({ ...(existing ?? {}), ...input, updatedAt: timestamp }, timestamp);
  if (!normalized) return state;
  const rules = existing
    ? state.dredgeRules.map((rule) => (rule.id === normalized.id ? normalized : rule))
    : [...state.dredgeRules, normalized];
  const nextState = { ...state, dredgeRules: rules };
  return dredgeRuleSemanticChanged(existing, normalized) ? resetLaoFindsStartedAt(nextState, timestamp) : nextState;
}

export function removeDredgeRule(state: AppState, id: string): AppState {
  const exists = state.dredgeRules.some((rule) => rule.id === id);
  const nextState = {
    ...state,
    dredgeRules: state.dredgeRules.filter((rule) => rule.id !== id),
    laoFindsItems: Object.fromEntries(
      Object.entries(state.laoFindsItems).map(([itemId, item]) => [
        itemId,
        { ...item, matchedRuleIds: item.matchedRuleIds.filter((ruleId) => ruleId !== id) }
      ])
    )
  };
  return exists ? resetLaoFindsStartedAt(nextState) : nextState;
}

export function resetLaoFindsStartedAt(state: AppState, timestamp: string = nowIso()): AppState {
  return { ...state, laoFindsStartedAt: timestamp };
}

export function markLaoFindsItemRead(state: AppState, id: string, read: boolean): AppState {
  const item = state.laoFindsItems[id];
  if (!item) return state;
  return {
    ...state,
    laoFindsItems: {
      ...state.laoFindsItems,
      [id]: { ...item, readAt: read ? (item.readAt ?? nowIso()) : undefined }
    }
  };
}

export function archiveLaoFindsItem(state: AppState, id: string, archived: boolean): AppState {
  const item = state.laoFindsItems[id];
  if (!item) return state;
  return {
    ...state,
    laoFindsItems: {
      ...state.laoFindsItems,
      [id]: { ...item, archivedAt: archived ? (item.archivedAt ?? nowIso()) : undefined }
    }
  };
}

export function collectLaoFindsItems(
  state: AppState,
  candidates: ActivityItem[],
  collectedAt: string = nowIso()
): { state: AppState; collectedCount: number } {
  const activeAllowRules = state.dredgeRules.filter((rule) => rule.enabled && rule.mode === "allow");
  if (activeAllowRules.length === 0) return { state, collectedCount: 0 };
  const activeBlockRules = state.dredgeRules.filter((rule) => rule.enabled && rule.mode === "block");
  const startedAtMs = parseTimestamp(state.laoFindsStartedAt);
  if (startedAtMs === undefined) return { state: resetLaoFindsStartedAt(state, collectedAt), collectedCount: 0 };
  if (candidates.length === 0) return { state, collectedCount: 0 };

  let collectedCount = 0;
  let changed = false;
  const nextItems = { ...state.laoFindsItems };
  for (const candidate of candidates) {
    if (!isCollectableKind(candidate.kind)) continue;
    const occurredAtMs = parseTimestamp(candidate.occurredAt);
    if (occurredAtMs === undefined || occurredAtMs <= startedAtMs) continue;
    if (activeBlockRules.some((rule) => dredgeRuleMatches(rule, candidate))) continue;
    const matchedRuleIds = activeAllowRules.filter((rule) => dredgeRuleMatches(rule, candidate)).map((rule) => rule.id);
    if (matchedRuleIds.length === 0) continue;

    const existing = nextItems[candidate.id];
    const mergedRuleIds = mergeRuleIds(existing?.matchedRuleIds ?? [], matchedRuleIds);
    if (existing) {
      const sameRules = existing.matchedRuleIds.length === mergedRuleIds.length && existing.matchedRuleIds.every((id, index) => id === mergedRuleIds[index]);
      if (existing.activity === candidate && sameRules) continue;
      changed = true;
      nextItems[candidate.id] = {
        ...existing,
        activity: candidate,
        matchedRuleIds: mergedRuleIds
      };
      continue;
    }

    collectedCount += 1;
    changed = true;
    nextItems[candidate.id] = {
      id: candidate.id,
      activityId: candidate.id,
      activity: candidate,
      collectedAt,
      matchedRuleIds: mergedRuleIds
    };
  }

  if (!changed) return { state, collectedCount };
  return { state: { ...state, laoFindsItems: nextItems }, collectedCount };
}

function dredgeRuleSemanticChanged(existing: DredgeRule | undefined, next: DredgeRule): boolean {
  if (!existing) return true;
  return (
    existing.enabled !== next.enabled ||
    existing.mode !== next.mode ||
    !sameRuleUsernames(existing.usernames, next.usernames) ||
    !sameStringList(existing.kinds, next.kinds) ||
    !sameStringList(existing.patterns, next.patterns)
  );
}

function sameRuleUsernames(left: DredgeRule["usernames"], right: DredgeRule["usernames"]): boolean {
  if (left === "all" || right === "all") return left === right;
  return sameStringList(left, right);
}

function sameStringList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function dredgeRuleMatches(rule: DredgeRule, item: ActivityItem): boolean {
  if (!rule.enabled || !isCollectableKind(item.kind)) return false;
  if (!rule.kinds.includes(item.kind)) return false;
  if (!ruleUsernamesMatch(rule.usernames, item)) return false;
  if (rule.patterns.length === 0) return true;
  const text = searchableTextForActivity(item);
  return rule.patterns.some((pattern) => regexMatches(pattern, text));
}

export function searchableTextForActivity(item: ActivityItem): string {
  return [
    item.title,
    item.topicTitle,
    item.excerpt,
    item.boostText,
    item.reactionValue,
    item.username,
    item.actorUsername,
    item.actorName,
    item.targetUsername,
    item.targetName
  ]
    .filter(Boolean)
    .join(" ");
}

export interface DredgeRulePatternValidation {
  valid: boolean;
  patterns: string[];
  invalidPattern?: string;
  error?: string;
}

export function isDredgeRuleMode(value: unknown): value is DredgeRuleMode {
  return value === "allow" || value === "block";
}

export function normalizeDredgeRulePatterns(value: unknown): DredgeRulePatternValidation {
  if (!Array.isArray(value)) return { valid: false, patterns: [] };
  const seen = new Set<string>();
  const patterns: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const pattern = item.trim();
    if (!pattern || seen.has(pattern)) continue;
    const error = validateDredgeRulePattern(pattern);
    if (error) return { valid: false, patterns: [], invalidPattern: pattern, error };
    seen.add(pattern);
    patterns.push(pattern);
  }
  return { valid: true, patterns };
}

export function validateDredgeRulePattern(pattern: string): string | undefined {
  try {
    new RegExp(pattern, "i");
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : "正则表达式不正确。";
  }
}

function regexMatches(pattern: string, text: string): boolean {
  try {
    return new RegExp(pattern, "i").test(text);
  } catch {
    return false;
  }
}

function normalizeRuleUsernames(value: unknown): "all" | Username[] {
  if (value === "all" || value === undefined) return "all";
  if (!Array.isArray(value)) return "all";
  const seen = new Set<Username>();
  const usernames: Username[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const username = normalizeUsername(item);
    if (!username || seen.has(username)) continue;
    seen.add(username);
    usernames.push(username);
  }
  return usernames.length ? usernames : "all";
}

function ruleUsernamesMatch(usernames: "all" | Username[], item: ActivityItem): boolean {
  if (usernames === "all") return true;
  const normalizedUsernames = usernames.map(normalizeUsername).filter(Boolean);
  const possible = [item.username, item.actorUsername].map((username) => normalizeUsername(username ?? "")).filter(Boolean);
  return possible.some((username) => normalizedUsernames.includes(username));
}

function isCollectableKind(kind: ActivityItem["kind"]): kind is ActivityRefreshKind {
  return kind === "topic" || kind === "reply" || kind === "boost" || kind === "reaction";
}

function mergeRuleIds(existing: string[], incoming: string[]): string[] {
  return [...new Set([...existing, ...incoming])];
}

function normalizeStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function timestampOrNow(value: unknown): string {
  return typeof value === "string" && value.trim() ? value : nowIso();
}

function optionalTimestamp(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}
