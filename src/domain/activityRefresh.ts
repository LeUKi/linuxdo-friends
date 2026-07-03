import { nowIso } from "../shared/time";
import type {
  ActivityItem,
  ActivityKindFilter,
  ActivityRefreshKind,
  ActivityRefreshLedgerEntry,
  ActivityRefreshRequestKind,
  ActivityRefreshScope,
  ActivityWatermarkEntry,
  AppState,
  FriendActivitySummary,
  RefreshSource,
  TimedActivityRefreshScopeMode,
  Username
} from "../shared/types";
import { sortActivityItems } from "./activity";
import { ALL_ACTIVITY_KINDS, normalizeActivityKinds, normalizeUsername } from "./friends";

export interface ActivityRequestStep {
  username: Username;
  kind: ActivityRefreshRequestKind;
  path: string;
  label: string;
}

export interface ActivityRefreshTarget {
  username: Username;
  steps: ActivityRequestStep[];
  refreshedKinds: ActivityRefreshKind[];
}

export const DREDGE_REFRESH_UNAVAILABLE_MESSAGE = "当前没有可打捞范围，请先调整规则。";

export interface DredgeRefreshAvailability {
  available: boolean;
  scopes: ActivityRefreshScope[];
  unavailableReason?: "no_targets";
  message?: string;
}

export function normalizeActivityRefreshScope(scope?: ActivityRefreshScope, usernames?: Username[]): ActivityRefreshScope {
  return {
    kind: isActivityKindFilter(scope?.kind) ? scope.kind : "all",
    usernames: normalizeScopeUsernames(scope?.usernames ?? usernames)
  };
}

export function normalizeRefreshTargets(state: AppState, usernames?: Username[]): Username[] {
  const rawTargets = usernames?.length ? usernames : Object.keys(state.friends);
  const seen = new Set<Username>();
  const targets: Username[] = [];
  for (const raw of rawTargets) {
    const username = normalizeUsername(raw);
    if (!state.friends[username] || seen.has(username)) continue;
    seen.add(username);
    targets.push(username);
  }
  return targets;
}

export function planActivityRefreshTargets(state: AppState, scope?: ActivityRefreshScope): ActivityRefreshTarget[] {
  const normalizedScope = normalizeActivityRefreshScope(scope);
  return normalizeRefreshTargets(state, normalizedScope.usernames)
    .map((username) => {
      const refreshedKinds = effectiveActivityKindsForFriend(state, username, normalizedScope.kind);
      return {
        username,
        steps: activityRequestStepsForUserKinds(username, refreshedKinds),
        refreshedKinds
      };
    })
    .filter((target) => target.refreshedKinds.length > 0);
}

export function deriveTimedActivityRefreshScopes(state: AppState, mode: TimedActivityRefreshScopeMode): ActivityRefreshScope[] {
  if (mode === "all") return [{ kind: "all" }];

  const usernamesByKind = new Map<ActivityRefreshKind, Set<Username>>();
  for (const rule of state.dredgeRules) {
    if (!rule.enabled || rule.mode !== "allow") continue;
    const candidateUsernames = rule.usernames === "all" ? Object.keys(state.friends) : rule.usernames;
    for (const rawUsername of candidateUsernames) {
      const username = normalizeUsername(rawUsername);
      if (!username || !state.friends[username]) continue;
      const allowedKinds = effectiveActivityKindsForFriend(state, username, "all");
      for (const kind of activityKindsForScope("all")) {
        if (!rule.kinds.includes(kind) || !allowedKinds.includes(kind)) continue;
        const usernames = usernamesByKind.get(kind) ?? new Set<Username>();
        usernames.add(username);
        usernamesByKind.set(kind, usernames);
      }
    }
  }

  return activityKindsForScope("all")
    .map((kind): ActivityRefreshScope | undefined => {
      const usernames = [...(usernamesByKind.get(kind) ?? [])].sort();
      return usernames.length ? { kind, usernames } : undefined;
    })
    .filter((scope): scope is ActivityRefreshScope => Boolean(scope));
}

export function deriveDredgeRefreshAvailability(
  state: AppState,
  mode: TimedActivityRefreshScopeMode = state.settings.timedActivityRefreshScopeMode
): DredgeRefreshAvailability {
  const scopes = deriveTimedActivityRefreshScopes(state, mode);
  return scopes.length > 0
    ? { available: true, scopes }
    : {
        available: false,
        scopes,
        unavailableReason: "no_targets",
        message: DREDGE_REFRESH_UNAVAILABLE_MESSAGE
      };
}

export function effectiveActivityKindsForFriend(
  state: AppState,
  usernameInput: Username,
  kind: ActivityKindFilter = "all"
): ActivityRefreshKind[] {
  const username = normalizeUsername(usernameInput);
  const friend = state.friends[username];
  if (!friend) return [];
  const requestedKinds = activityKindsForScope(kind);
  const allowedKinds = normalizeActivityKinds(friend.activityKinds, ALL_ACTIVITY_KINDS);
  return requestedKinds.filter((requestedKind) => allowedKinds.includes(requestedKind));
}

export function activityRequestStepsForUser(usernameInput: Username, kind: ActivityKindFilter): ActivityRequestStep[] {
  return activityRequestStepsForUserKinds(usernameInput, activityKindsForScope(kind));
}

export function activityRequestStepsForUserKinds(usernameInput: Username, kinds: ActivityRefreshKind[]): ActivityRequestStep[] {
  const username = normalizeUsername(usernameInput);
  return activityKindsForScope("all")
    .filter((kind) => kinds.includes(kind))
    .map((kind) => activityRequestStepForKind(username, kind));
}

export function activityKindsForScope(kind: ActivityKindFilter): ActivityRefreshKind[] {
  if (kind === "all") return ["topic", "reply", "boost", "reaction"];
  return [kind];
}

export function activityKindsForRequestKind(kind: ActivityRefreshRequestKind): ActivityRefreshKind[] {
  return kind === "user_actions" ? ["topic", "reply"] : [kind];
}

export function activityRefreshLedgerKey(usernameInput: Username, kind: ActivityRefreshKind): string {
  return `${normalizeUsername(usernameInput)}:${kind}`;
}

export function activityWatermarkKey(usernameInput: Username, kind: ActivityRefreshKind): string {
  return `${normalizeUsername(usernameInput)}:${kind}`;
}

export function applyScopedActivityRefresh(
  state: AppState,
  usernameInput: Username,
  items: ActivityItem[],
  refreshedKinds: ActivityRefreshKind[],
  source: RefreshSource,
  refreshedAt: string = nowIso(),
  options: { clearExistingNew?: boolean; feedWaterlineAt?: string } = {}
): AppState {
  const baseState = options.clearExistingNew === false ? state : clearActivityNewFlags(state);
  const username = normalizeUsername(usernameInput);
  const existing = baseState.activity[username];
  const refreshedKindSet = new Set<ActivityRefreshKind>(refreshedKinds);
  const markedItems = markNewItemsFromWatermarks(baseState.activityWatermarks, username, items, refreshedKinds);
  const mergedItems = sortActivityItems([
    ...(existing?.items ?? []).filter((item) => !isRefreshKind(item.kind) || !refreshedKindSet.has(item.kind)),
    ...markedItems.filter((item) => isRefreshKind(item.kind) && refreshedKindSet.has(item.kind))
  ]);
  const lastPostAt = mergedItems.find((item) => item.occurredAt)?.occurredAt;
  const summary: FriendActivitySummary = {
    username,
    refreshedAt,
    coarseStatus: classifyCoarseStatus(lastPostAt),
    lastPostAt,
    items: mergedItems
  };
  return {
    ...baseState,
    activity: {
      ...baseState.activity,
      [username]: summary
    },
    activityFeedWaterlineAt: options.feedWaterlineAt ?? baseState.activityFeedWaterlineAt,
    activityRefreshLedger: {
      ...baseState.activityRefreshLedger,
      ...ledgerEntriesForRefresh(username, items, refreshedKinds, source, refreshedAt)
    },
    activityWatermarks: {
      ...baseState.activityWatermarks,
      ...watermarkEntriesForRefresh(username, items, refreshedKinds, source, refreshedAt)
    }
  };
}

export function clearActivityNewFlags(state: AppState): AppState {
  let changed = false;
  const activity: AppState["activity"] = {};
  for (const [username, summary] of Object.entries(state.activity)) {
    const items = summary.items.map((item) => {
      const next = withoutNewFlag(item);
      if (next !== item) changed = true;
      return next;
    });
    activity[username] = items === summary.items ? summary : { ...summary, items };
  }
  return changed ? { ...state, activity } : state;
}

export function latestRefreshForScope(
  ledger: Record<string, ActivityRefreshLedgerEntry>,
  state: AppState,
  scope: ActivityRefreshScope
): ActivityRefreshLedgerEntry | undefined {
  const normalized = normalizeActivityRefreshScope(scope);
  const usernames = normalizeRefreshTargets(state, normalized.usernames);
  let latest: ActivityRefreshLedgerEntry | undefined;
  for (const username of usernames) {
    const kinds = effectiveActivityKindsForFriend(state, username, normalized.kind);
    for (const kind of kinds) {
      const entry = ledger[activityRefreshLedgerKey(username, kind)];
      if (!entry) continue;
      if (!latest || timestampValue(entry.refreshedAt) > timestampValue(latest.refreshedAt)) {
        latest = entry;
      }
    }
  }
  return latest;
}

export function latestActivityRefreshAt(state: AppState): string | undefined {
  let latest: string | undefined;
  for (const entry of Object.values(state.activityRefreshLedger)) {
    if (!latest || timestampValue(entry.refreshedAt) > timestampValue(latest)) {
      latest = entry.refreshedAt;
    }
  }
  return latest;
}

export function scopeLabel(scope: ActivityRefreshScope): string {
  const normalized = normalizeActivityRefreshScope(scope);
  const userLabel = normalized.usernames?.length === 1 ? `@${normalizeUsername(normalized.usernames[0])}` : "全部佬朋友";
  const kindLabel = kindLabelText(normalized.kind);
  return `${userLabel} ${kindLabel}`;
}

export function kindLabelText(kind: ActivityKindFilter): string {
  if (kind === "topic") return "话题";
  if (kind === "reply") return "回复";
  if (kind === "boost") return "Boost";
  if (kind === "reaction") return "回应";
  return "全部动态";
}

function userActionsStep(username: Username, kind: ActivityRefreshRequestKind, filter: string, label: string): ActivityRequestStep {
  return {
    username,
    kind,
    path: `/user_actions.json?offset=0&username=${encodeURIComponent(username)}&filter=${filter}`,
    label: `${label} @${username}`
  };
}

function activityRequestStepForKind(username: Username, kind: ActivityRefreshKind): ActivityRequestStep {
  if (kind === "topic") return userActionsStep(username, "topic", "4", "话题");
  if (kind === "reply") return userActionsStep(username, "reply", "5", "回复");
  if (kind === "boost") {
    return {
      username,
      kind: "boost",
      path: `/discourse-boosts/users/${encodeURIComponent(username)}/boosts-given.json`,
      label: `Boost @${username}`
    };
  }
  return {
    username,
    kind: "reaction",
    path: `/discourse-reactions/posts/reactions.json?username=${encodeURIComponent(username)}`,
    label: `回应 @${username}`
  };
}

function ledgerEntriesForRefresh(
  username: Username,
  items: ActivityItem[],
  refreshedKinds: ActivityRefreshKind[],
  source: RefreshSource,
  refreshedAt: string
): Record<string, ActivityRefreshLedgerEntry> {
  const entries: Record<string, ActivityRefreshLedgerEntry> = {};
  for (const kind of refreshedKinds) {
    const scopeKey = activityRefreshLedgerKey(username, kind);
    entries[scopeKey] = {
      scopeKey,
      username,
      kind,
      refreshedAt,
      source,
      itemCount: items.filter((item) => item.kind === kind).length
    };
  }
  return entries;
}

function watermarkEntriesForRefresh(
  username: Username,
  items: ActivityItem[],
  refreshedKinds: ActivityRefreshKind[],
  source: RefreshSource,
  refreshedAt: string
): Record<string, ActivityWatermarkEntry> {
  const entries: Record<string, ActivityWatermarkEntry> = {};
  for (const kind of refreshedKinds) {
    const latestOccurredAt = latestOccurredAtForKind(items, kind);
    if (!latestOccurredAt) continue;
    const scopeKey = activityWatermarkKey(username, kind);
    entries[scopeKey] = {
      scopeKey,
      username,
      kind,
      latestOccurredAt,
      updatedAt: refreshedAt,
      source
    };
  }
  return entries;
}

function markNewItemsFromWatermarks(
  watermarks: Record<string, ActivityWatermarkEntry>,
  username: Username,
  items: ActivityItem[],
  refreshedKinds: ActivityRefreshKind[]
): ActivityItem[] {
  const refreshedKindSet = new Set<ActivityRefreshKind>(refreshedKinds);
  return items.map((item) => {
    if (!isRefreshKind(item.kind) || !refreshedKindSet.has(item.kind)) {
      return withoutNewFlag(item);
    }
    const watermark = watermarks[activityWatermarkKey(username, item.kind)];
    const previous = timestampValue(watermark?.latestOccurredAt);
    const current = timestampValue(item.occurredAt);
    if (previous > 0 && current > previous) {
      return { ...item, isNew: true };
    }
    return withoutNewFlag(item);
  });
}

function latestOccurredAtForKind(items: ActivityItem[], kind: ActivityRefreshKind): string | undefined {
  let latest: string | undefined;
  let latestTimestamp = 0;
  for (const item of items) {
    if (item.kind !== kind) continue;
    const timestamp = timestampValue(item.occurredAt);
    if (timestamp > latestTimestamp) {
      latestTimestamp = timestamp;
      latest = item.occurredAt;
    }
  }
  return latest;
}

function withoutNewFlag(item: ActivityItem): ActivityItem {
  if (!item.isNew) return item;
  const { isNew: _isNew, ...rest } = item;
  return rest;
}

function normalizeScopeUsernames(usernames?: Username[]): Username[] | undefined {
  if (!usernames?.length) return undefined;
  const seen = new Set<Username>();
  const normalized: Username[] = [];
  for (const raw of usernames) {
    const username = normalizeUsername(raw);
    if (!username || seen.has(username)) continue;
    seen.add(username);
    normalized.push(username);
  }
  return normalized.length ? normalized : undefined;
}

function isActivityKindFilter(value: unknown): value is ActivityKindFilter {
  return value === "all" || value === "topic" || value === "reply" || value === "boost" || value === "reaction";
}

function isRefreshKind(value: string): value is ActivityRefreshKind {
  return value === "topic" || value === "reply" || value === "boost" || value === "reaction";
}

function classifyCoarseStatus(value?: string): FriendActivitySummary["coarseStatus"] {
  if (!value) return "unknown";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "unknown";
  const age = Date.now() - timestamp;
  if (age < 3 * 24 * 60 * 60 * 1000) return "recently_active";
  if (age < 7 * 24 * 60 * 60 * 1000) return "active_this_week";
  return "quiet";
}

function timestampValue(value?: string): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
