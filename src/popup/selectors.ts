import { sortActivityItems } from "../domain/activity";
import { effectiveActivityKindsForFriend, latestRefreshForScope, planActivityRefreshTargets, scopeLabel } from "../domain/activityRefresh";
import { normalizeUsername } from "../domain/friends";
import type {
  ActivityItem,
  ActivityKindFilter,
  ActivityRefreshKind,
  ActivityRefreshScope,
  AppState,
  FollowedUser,
  FriendProfileSummary,
  FriendUser,
  LaoFindsItem,
  DredgeRule,
  Username
} from "../shared/types";

export interface UserIdentityView {
  username: Username;
  primary: string;
  secondary: string;
  avatarUrl?: string;
}

export interface LatestStatusView {
  label: "最后一个帖子" | "最后活动" | "未刷新";
  at?: string;
}

export interface FriendListItem {
  friend: FriendUser;
  identity: UserIdentityView;
  profile?: FriendProfileSummary;
  latestStatus: LatestStatusView;
  activity: AppState["activity"][Username] | undefined;
}

export interface FollowedCandidate {
  user: FollowedUser;
  identity: UserIdentityView;
  isFriend: boolean;
}

export interface FriendCandidate {
  user: FollowedUser;
  identity: UserIdentityView;
  isFriend: boolean;
  isSynthetic?: boolean;
}

export interface FeedFilters {
  kind: ActivityKindFilter;
  username: "all" | Username;
}

export interface ActivityFreshnessView {
  label: string;
  refreshedAt?: string;
}

export type ActivityRequestCounts = Record<ActivityKindFilter, number>;

export type FeedRenderEntry =
  | { type: "activity"; item: ActivityItem }
  | { type: "waterline"; id: string; waterlineAt: string };

export interface LaoFindsItemView {
  item: LaoFindsItem;
  identity: UserIdentityView;
  matchedRules: DredgeRule[];
}

export function deriveFriendList(state: AppState): FriendListItem[] {
  return Object.values(state.friends)
    .map((friend) => {
      const profile = state.friendProfiles[friend.username];
      return {
        friend,
        identity: identityForUsername(state, friend.username),
        profile,
        latestStatus: latestStatusForProfile(profile),
        activity: state.activity[friend.username]
      };
    })
    .sort((a, b) => {
      const byLatestStatus = latestStatusTimestamp(b.profile) - latestStatusTimestamp(a.profile);
      if (byLatestStatus !== 0) return byLatestStatus;
      const byAddedAt = timestampValue(b.friend.upgradedAt) - timestampValue(a.friend.upgradedAt);
      if (byAddedAt !== 0) return byAddedAt;
      return a.friend.username.localeCompare(b.friend.username);
    });
}

export function deriveFollowedCandidates(state: AppState): FollowedCandidate[] {
  return Object.values(state.followedUsers)
    .map((user) => ({
      user,
      identity: identityForUsername(state, user.username),
      isFriend: Boolean(state.friends[user.username])
    }))
    .sort((a, b) => Number(b.isFriend) - Number(a.isFriend) || a.user.username.localeCompare(b.user.username));
}

export function orderFollowedCandidates(
  candidates: FollowedCandidate[],
  snapshotOrder?: Username[]
): FollowedCandidate[] {
  if (!snapshotOrder?.length) return candidates;
  const order = new Map(snapshotOrder.map((username, index) => [normalizeUsername(username), index]));
  return [...candidates].sort((a, b) => {
    const bySnapshot = (order.get(a.user.username) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.user.username) ?? Number.MAX_SAFE_INTEGER);
    if (bySnapshot !== 0) return bySnapshot;
    return a.user.username.localeCompare(b.user.username);
  });
}

export function mergeFriendCandidates(
  friends: FriendListItem[],
  followedCandidates: FollowedCandidate[] = []
): FriendCandidate[] {
  const followedUsernames = new Set(followedCandidates.map((candidate) => candidate.user.username));
  const friendOnlyCandidates = friends
    .filter((item) => !followedUsernames.has(item.friend.username))
    .map((item) => ({
      user: {
        username: item.friend.username,
        name: item.identity.primary,
        avatarUrl: item.identity.avatarUrl,
        source: "manual" as const,
        followedAt: item.friend.upgradedAt,
        updatedAt: item.friend.updatedAt
      },
      identity: item.identity,
      isFriend: true
    }));
  return [...friendOnlyCandidates, ...followedCandidates].sort((a, b) => {
    const byFriend = Number(b.isFriend) - Number(a.isFriend);
    if (byFriend !== 0) return byFriend;
    return a.user.username.localeCompare(b.user.username);
  });
}

export function filterFriendCandidates(candidates: FriendCandidate[], query: string): FriendCandidate[] {
  const text = query.trim().toLowerCase();
  if (!text) return candidates;
  return candidates.filter((candidate) =>
    `${candidate.identity.primary} ${candidate.identity.secondary} ${candidate.user.username}`.toLowerCase().includes(text)
  );
}

export function syntheticFriendCandidate(friends: FriendListItem[], candidates: FriendCandidate[], query: string): FriendCandidate | null {
  const username = normalizeUsername(query);
  if (!username || candidates.some((candidate) => candidate.user.username === username)) return null;
  const friend = friends.find((item) => item.friend.username === username);
  return {
    user: { username, source: "manual", followedAt: "", updatedAt: "" },
    identity: friend?.identity ?? identityForRecord({ username }),
    isFriend: Boolean(friend),
    isSynthetic: true
  };
}

export function deriveFeedItems(state: AppState, filters: FeedFilters = { kind: "all", username: "all" }): ActivityItem[] {
  const filteredOwner = filters.username === "all" ? "all" : normalizeUsername(filters.username);
  const entries = Object.values(state.activity)
    .filter((summary) => Boolean(state.friends[summary.username]))
    .flatMap((summary) => {
      const ownerUsername = normalizeUsername(summary.username);
      const allowedKinds = effectiveActivityKindsForFriend(state, ownerUsername, "all");
      return summary.items
        .filter((item) => item.kind !== "summary" && allowedKinds.includes(item.kind))
        .map((item) => ({ ownerUsername, item }));
    })
    .filter(({ ownerUsername, item }) => {
      if (filters.kind !== "all" && item.kind !== filters.kind) return false;
      if (filteredOwner !== "all" && ownerUsername !== filteredOwner) return false;
      return true;
    });
  return sortActivityItems(entries.map(({ item }) => item));
}

export function deriveFeedRenderEntries(state: AppState, filters: FeedFilters = { kind: "all", username: "all" }): FeedRenderEntry[] {
  const items = deriveFeedItems(state, filters);
  const waterlineAt = state.activityFeedWaterlineAt;
  if (!waterlineAt || !items.some((item) => timestampValue(item.occurredAt) > timestampValue(waterlineAt))) {
    return items.map((item) => ({ type: "activity", item }));
  }

  const entries: FeedRenderEntry[] = [];
  let inserted = false;
  for (const item of items) {
    if (!inserted && timestampValue(item.occurredAt) <= timestampValue(waterlineAt)) {
      entries.push({ type: "waterline", id: `waterline:${waterlineAt}`, waterlineAt });
      inserted = true;
    }
    entries.push({ type: "activity", item });
  }
  if (!inserted) {
    entries.push({ type: "waterline", id: `waterline:${waterlineAt}`, waterlineAt });
  }
  return entries;
}

export function deriveFeedUserOptions(state: AppState): UserIdentityView[] {
  return deriveFriendList(state).map((item) => item.identity);
}

export function deriveLaoFindsItems(state: AppState, options: { includeArchived?: boolean } = {}): LaoFindsItemView[] {
  return Object.values(state.laoFindsItems)
    .filter((item) => options.includeArchived || !item.archivedAt)
    .map((item) => ({
      item,
      identity: identityForActivityItem(state, item.activity),
      matchedRules: item.matchedRuleIds.map((id) => state.dredgeRules.find((rule) => rule.id === id)).filter((rule): rule is DredgeRule => Boolean(rule))
    }))
    .sort((a, b) => {
      const byCollected = timestampValue(b.item.collectedAt) - timestampValue(a.item.collectedAt);
      if (byCollected !== 0) return byCollected;
      const byActivity = timestampValue(b.item.activity.occurredAt) - timestampValue(a.item.activity.occurredAt);
      if (byActivity !== 0) return byActivity;
      return a.item.id.localeCompare(b.item.id);
    });
}

export function deriveDredgeRuleScopeWarning(state: AppState, rule: Pick<DredgeRule, "usernames" | "kinds">): string | undefined {
  const usernames = rule.usernames === "all" ? Object.keys(state.friends) : rule.usernames;
  const missingScope = usernames
    .map(normalizeUsername)
    .filter((username) => state.friends[username])
    .filter((username) => rule.kinds.some((kind) => !friendAllowsKind(state, username, kind)));
  if (missingScope.length === 0) return undefined;
  return "部分用户的视奸范围未包含该类型，刷新时不会产生对应候选动态。";
}

export function deriveActivityRefreshScope(filters: FeedFilters): ActivityRefreshScope {
  return {
    kind: filters.kind,
    usernames: filters.username === "all" ? undefined : [filters.username]
  };
}

export function deriveActivityRequestCounts(state: AppState, username: "all" | Username = "all"): ActivityRequestCounts {
  return {
    all: planActivityRefreshTargets(state, { kind: "all", usernames: username === "all" ? undefined : [username] }).reduce(
      (sum, target) => sum + target.steps.length,
      0
    ),
    topic: planActivityRefreshTargets(state, { kind: "topic", usernames: username === "all" ? undefined : [username] }).reduce(
      (sum, target) => sum + target.steps.length,
      0
    ),
    reply: planActivityRefreshTargets(state, { kind: "reply", usernames: username === "all" ? undefined : [username] }).reduce(
      (sum, target) => sum + target.steps.length,
      0
    ),
    boost: planActivityRefreshTargets(state, { kind: "boost", usernames: username === "all" ? undefined : [username] }).reduce(
      (sum, target) => sum + target.steps.length,
      0
    ),
    reaction: planActivityRefreshTargets(state, { kind: "reaction", usernames: username === "all" ? undefined : [username] }).reduce(
      (sum, target) => sum + target.steps.length,
      0
    ),
    like: planActivityRefreshTargets(state, { kind: "like", usernames: username === "all" ? undefined : [username] }).reduce(
      (sum, target) => sum + target.steps.length,
      0
    )
  };
}

export function deriveActivityFreshness(state: AppState, scope: ActivityRefreshScope): ActivityFreshnessView {
  const entry = latestRefreshForScope(state.activityRefreshLedger, state, scope);
  return {
    label: `${scopeLabel(scope)} ${entry ? "已刷新" : "未刷新"}`,
    refreshedAt: entry?.refreshedAt
  };
}

export function identityForActivityItem(state: AppState, item: ActivityItem): UserIdentityView {
  const username = item.actorUsername ?? item.username;
  return identityForUsername(state, username, {
    name: item.actorName,
    avatarUrl: item.actorAvatarUrl
  });
}

export function identityForUsername(
  state: AppState,
  usernameInput: Username,
  activityFallback?: { name?: string; avatarUrl?: string }
): UserIdentityView {
  const username = normalizeUsername(usernameInput);
  const profile = state.friendProfiles[username];
  const followed = state.followedUsers[username];
  return identityForRecord({
    username,
    name: profile?.name || followed?.name || activityFallback?.name?.trim(),
    avatarUrl: state.avatarCache[username]?.dataUrl || profile?.avatarUrl || followed?.avatarUrl || activityFallback?.avatarUrl
  });
}

export function identityForFollowedUser(user: Pick<FollowedUser, "username" | "name" | "avatarUrl">): UserIdentityView {
  return identityForRecord(user);
}

export function latestStatusForProfile(profile?: FriendProfileSummary): LatestStatusView {
  if (!profile?.lastPostedAt && !profile?.lastSeenAt) return { label: "未刷新" };
  const posted = timestampValue(profile.lastPostedAt);
  const seen = timestampValue(profile.lastSeenAt);
  if (seen > posted) return { label: "最后活动", at: profile.lastSeenAt };
  return { label: "最后一个帖子", at: profile.lastPostedAt ?? profile.lastSeenAt };
}

function latestStatusTimestamp(profile?: FriendProfileSummary): number {
  if (!profile) return 0;
  return Math.max(timestampValue(profile.lastPostedAt), timestampValue(profile.lastSeenAt));
}

function friendAllowsKind(state: AppState, username: Username, kind: ActivityRefreshKind): boolean {
  const friend = state.friends[username];
  if (!friend) return false;
  return friend.activityKinds.includes(kind);
}

function identityForRecord(user: Pick<FollowedUser, "username" | "name" | "avatarUrl">): UserIdentityView {
  return {
    username: user.username,
    primary: user.name?.trim() || user.username,
    secondary: `@${user.username}`,
    avatarUrl: user.avatarUrl
  };
}

function timestampValue(value?: string): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
