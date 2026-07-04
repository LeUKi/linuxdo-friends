import { nowIso } from "../shared/time";
import type { ActivityRefreshKind, AppState, FollowedUser, FriendProfileSummary, FriendUser, Username } from "../shared/types";

export const ALL_ACTIVITY_KINDS: ActivityRefreshKind[] = ["topic", "reply", "boost", "reaction", "like"];

export function normalizeUsername(username: string): Username {
  return username.trim().replace(/^@/, "").toLowerCase();
}

export function isActivityRefreshKind(value: unknown): value is ActivityRefreshKind {
  return value === "topic" || value === "reply" || value === "boost" || value === "reaction" || value === "like";
}

export function normalizeActivityKinds(value: unknown, fallback: ActivityRefreshKind[] = ALL_ACTIVITY_KINDS): ActivityRefreshKind[] {
  const source = value === undefined || !Array.isArray(value) ? fallback : value;
  const kinds = source.filter(isActivityRefreshKind);
  return ALL_ACTIVITY_KINDS.filter((kind) => kinds.includes(kind));
}

export function normalizeFriendUser(value: Partial<FriendUser> & { username: string }, fallback?: FriendUser): FriendUser {
  const timestamp = nowIso();
  return {
    username: normalizeUsername(value.username),
    note: typeof value.note === "string" ? value.note : fallback?.note ?? "",
    groups: Array.isArray(value.groups) ? value.groups.filter((item): item is string => typeof item === "string") : fallback?.groups ?? [],
    pinned: typeof value.pinned === "boolean" ? value.pinned : fallback?.pinned ?? false,
    activityKinds: normalizeActivityKinds(value.activityKinds, fallback?.activityKinds ?? ALL_ACTIVITY_KINDS),
    upgradedAt: typeof value.upgradedAt === "string" && value.upgradedAt.trim() ? value.upgradedAt : fallback?.upgradedAt ?? timestamp,
    updatedAt: typeof value.updatedAt === "string" && value.updatedAt.trim() ? value.updatedAt : fallback?.updatedAt ?? timestamp
  };
}

export function upsertFollowedUser(
  state: AppState,
  user: Pick<FollowedUser, "username" | "name" | "avatarUrl"> & Partial<Pick<FollowedUser, "source">>
): AppState {
  const username = normalizeUsername(user.username);
  const existing = state.followedUsers[username];
  const timestamp = nowIso();
  return {
    ...state,
    followedUsers: {
      ...state.followedUsers,
      [username]: {
        username,
        name: user.name,
        avatarUrl: user.avatarUrl,
        source: user.source ?? existing?.source ?? "manual",
        followedAt: existing?.followedAt ?? timestamp,
        updatedAt: timestamp
      }
    }
  };
}

export function addFriendFromProfile(state: AppState, profileInput: FriendProfileSummary): AppState {
  const username = normalizeUsername(profileInput.username);
  const existing = state.friends[username];
  const timestamp = nowIso();
  const friend: FriendUser = {
    ...normalizeFriendUser({ username }, existing),
    upgradedAt: existing?.upgradedAt ?? timestamp,
    updatedAt: timestamp
  };
  return {
    ...state,
    friends: {
      ...state.friends,
      [username]: friend
    },
    friendProfiles: {
      ...state.friendProfiles,
      [username]: {
        ...profileInput,
        username
      }
    }
  };
}

export function addFriendFromKnownUser(
  state: AppState,
  userInput: Pick<FollowedUser, "username" | "name" | "avatarUrl">,
  profileInput?: FriendProfileSummary
): AppState {
  if (profileInput) return addFriendFromProfile(state, profileInput);
  const username = normalizeUsername(userInput.username);
  if (!username) return state;
  const existing = state.friends[username];
  const existingProfile = state.friendProfiles[username];
  const timestamp = nowIso();
  return {
    ...state,
    friends: {
      ...state.friends,
      [username]: {
        ...normalizeFriendUser({ username }, existing),
        upgradedAt: existing?.upgradedAt ?? timestamp,
        updatedAt: timestamp
      }
    },
    friendProfiles: existingProfile || userInput.name || userInput.avatarUrl
      ? {
          ...state.friendProfiles,
          [username]: {
            username,
            name: existingProfile?.name ?? userInput.name,
            avatarUrl: existingProfile?.avatarUrl ?? userInput.avatarUrl,
            lastPostedAt: existingProfile?.lastPostedAt,
            lastSeenAt: existingProfile?.lastSeenAt,
            refreshedAt: existingProfile?.refreshedAt ?? timestamp
          }
        }
      : state.friendProfiles
  };
}

export function upsertFriendProfile(state: AppState, profileInput: FriendProfileSummary): AppState {
  const username = normalizeUsername(profileInput.username);
  return {
    ...state,
    friendProfiles: {
      ...state.friendProfiles,
      [username]: {
        ...profileInput,
        username
      }
    }
  };
}

export function updateFriend(
  state: AppState,
  usernameInput: Username,
  patch: Partial<Pick<FriendUser, "note" | "groups" | "pinned" | "activityKinds">>
): AppState {
  const username = normalizeUsername(usernameInput);
  const existing = state.friends[username];
  if (!existing) return state;
  const next: FriendUser = {
    ...existing,
    ...patch,
    groups: patch.groups ?? existing.groups,
    activityKinds: patch.activityKinds === undefined ? existing.activityKinds : normalizeActivityKinds(patch.activityKinds, existing.activityKinds),
    updatedAt: nowIso()
  };
  return {
    ...state,
    friends: {
      ...state.friends,
      [username]: next
    }
  };
}

export function removeFriend(state: AppState, usernameInput: Username): AppState {
  const username = normalizeUsername(usernameInput);
  const { [username]: _removed, ...friends } = state.friends;
  const { [username]: _removedProfile, ...friendProfiles } = state.friendProfiles;
  const { [username]: _removedActivity, ...activity } = state.activity;
  return {
    ...state,
    friends,
    friendProfiles,
    activity
  };
}

export function getFriendView(state: AppState) {
  return Object.values(state.friends)
    .map((friend) => ({
      username: friend.username,
      note: friend.note,
      groups: friend.groups,
      pinned: friend.pinned,
      activityKinds: normalizeActivityKinds(friend.activityKinds),
      profile: state.friendProfiles[friend.username],
      activity: state.activity[friend.username]
    }))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.username.localeCompare(b.username));
}
