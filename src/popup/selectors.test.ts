import { describe, expect, it } from "vitest";
import { defaultAppState } from "../domain/defaultState";
import { ALL_ACTIVITY_KINDS, addFriendFromProfile, updateFriend, upsertFollowedUser } from "../domain/friends";
import {
  deriveFeedItems,
  deriveFeedRenderEntries,
  deriveFeedUserOptions,
  deriveFollowedCandidates,
  deriveFriendList,
  deriveActivityFreshness,
  deriveActivityRequestCounts,
  deriveActivityRefreshScope,
  filterFriendCandidates,
  identityForActivityItem,
  mergeFriendCandidates,
  syntheticFriendCandidate,
  orderFollowedCandidates
} from "./selectors";

describe("popup selectors", () => {
  it("uses friendProfiles before followedUsers for friend identity", () => {
    const withFollow = upsertFollowedUser(defaultAppState, {
      username: "Neil",
      name: "Follow Name",
      avatarUrl: "https://linux.do/follow.png",
      source: "manual"
    });
    const state = addFriendFromProfile(withFollow, {
      username: "Neil",
      name: "Profile Name",
      avatarUrl: "https://linux.do/profile.png",
      refreshedAt: "2026-06-28T00:00:00.000Z"
    });

    expect(deriveFriendList(state)).toEqual([
      expect.objectContaining({
        friend: expect.objectContaining({ username: "neil" }),
        identity: {
          username: "neil",
          primary: "Profile Name",
          secondary: "@neil",
          avatarUrl: "https://linux.do/profile.png"
        }
      })
    ]);
  });

  it("renders manually added non-followed friends in friend list, feed options, and feed actors", () => {
    const state = addFriendFromProfile(defaultAppState, {
      username: "Misaka7369",
      name: "御坂",
      avatarUrl: "https://linux.do/misaka.png",
      refreshedAt: "2026-06-28T00:00:00.000Z"
    });
    const item = {
      id: "reply:1",
      username: "misaka7369",
      actorUsername: "misaka7369",
      kind: "reply" as const,
      title: "reply"
    };

    expect(deriveFriendList(state)[0].identity).toMatchObject({ primary: "御坂", secondary: "@misaka7369" });
    expect(deriveFeedUserOptions(state)).toEqual([
      { username: "misaka7369", primary: "御坂", secondary: "@misaka7369", avatarUrl: "https://linux.do/misaka.png" }
    ]);
    expect(identityForActivityItem(state, item)).toEqual({
      username: "misaka7369",
      primary: "御坂",
      secondary: "@misaka7369",
      avatarUrl: "https://linux.do/misaka.png"
    });
  });

  it("prefers cached profile identity before activity actor fields", () => {
    const state = addFriendFromProfile(defaultAppState, {
      username: "Neil",
      name: "Profile Name",
      avatarUrl: "https://linux.do/profile.png",
      refreshedAt: "2026-06-28T00:00:00.000Z"
    });

    expect(
      identityForActivityItem(state, {
        id: "reply:1",
        username: "neil",
        actorUsername: "neil",
        actorName: "Actor Name",
        actorAvatarUrl: "https://linux.do/actor.png",
        kind: "reply",
        title: "reply"
      })
    ).toEqual({
      username: "neil",
      primary: "Profile Name",
      secondary: "@neil",
      avatarUrl: "https://linux.do/profile.png"
    });
  });

  it("prefers cached followed identity before activity actor fields when no profile is cached", () => {
    const state = upsertFollowedUser(defaultAppState, {
      username: "Neil",
      name: "Follow Name",
      avatarUrl: "https://linux.do/follow.png",
      source: "manual"
    });

    expect(
      identityForActivityItem(state, {
        id: "reply:1",
        username: "neil",
        actorUsername: "neil",
        actorName: "Actor Name",
        actorAvatarUrl: "https://linux.do/actor.png",
        kind: "reply",
        title: "reply"
      })
    ).toEqual({
      username: "neil",
      primary: "Follow Name",
      secondary: "@neil",
      avatarUrl: "https://linux.do/follow.png"
    });
  });

  it("derives latest status from newer last_seen_at or last_posted_at", () => {
    const seenNewer = addFriendFromProfile(defaultAppState, {
      username: "Neil",
      lastPostedAt: "2026-06-28T00:00:00.000Z",
      lastSeenAt: "2026-06-28T00:05:00.000Z",
      refreshedAt: "2026-06-28T00:06:00.000Z"
    });
    const postedNewer = addFriendFromProfile(defaultAppState, {
      username: "Ada",
      lastPostedAt: "2026-06-28T00:10:00.000Z",
      lastSeenAt: "2026-06-28T00:05:00.000Z",
      refreshedAt: "2026-06-28T00:11:00.000Z"
    });
    const noStatus = addFriendFromProfile(defaultAppState, {
      username: "Linus",
      refreshedAt: "2026-06-28T00:11:00.000Z"
    });

    expect(deriveFriendList(seenNewer)[0].latestStatus).toEqual({ label: "最后活动", at: "2026-06-28T00:05:00.000Z" });
    expect(deriveFriendList(postedNewer)[0].latestStatus).toEqual({ label: "最后一个帖子", at: "2026-06-28T00:10:00.000Z" });
    expect(deriveFriendList(noStatus)[0].latestStatus).toEqual({ label: "未刷新" });
  });

  it("orders friends by latest status time and falls back to newest add order", () => {
    const oldPost = addFriendFromProfile(defaultAppState, {
      username: "OldPost",
      lastPostedAt: "2026-06-28T00:07:00.000Z",
      lastSeenAt: "2026-06-28T00:01:00.000Z",
      refreshedAt: "2026-06-28T00:08:00.000Z"
    });
    const recentSeen = addFriendFromProfile(oldPost, {
      username: "RecentSeen",
      lastPostedAt: "2026-06-28T00:03:00.000Z",
      lastSeenAt: "2026-06-28T00:09:00.000Z",
      refreshedAt: "2026-06-28T00:10:00.000Z"
    });
    const withoutStatus = {
      ...addFriendFromProfile(recentSeen, {
        username: "NoStatus",
        refreshedAt: "2026-06-28T00:11:00.000Z"
      }),
      friends: {
        ...recentSeen.friends,
        nostatus: {
          username: "nostatus",
          note: "",
          groups: [],
          pinned: true,
          activityKinds: ALL_ACTIVITY_KINDS,
          upgradedAt: "2026-06-28T00:20:00.000Z",
          updatedAt: "2026-06-28T00:20:00.000Z"
        }
      },
      friendProfiles: {
        ...recentSeen.friendProfiles,
        nostatus: {
          username: "nostatus",
          refreshedAt: "2026-06-28T00:11:00.000Z"
        }
      }
    };

    const list = deriveFriendList(withoutStatus);

    expect(list.map((item) => item.friend.username)).toEqual(["recentseen", "oldpost", "nostatus"]);
    expect(list[0].latestStatus).toEqual({ label: "最后活动", at: "2026-06-28T00:09:00.000Z" });
  });

  it("derives followed modal candidates with friends first and add/remove state", () => {
    const withFollow = upsertFollowedUser(defaultAppState, { username: "Neil", source: "manual" });
    const withOtherFollow = upsertFollowedUser(withFollow, { username: "Ada", source: "manual" });
    const state = addFriendFromProfile(withOtherFollow, { username: "Neil", refreshedAt: "2026-06-28T00:00:00.000Z" });

    expect(deriveFollowedCandidates(state).map((candidate) => [candidate.user.username, candidate.isFriend])).toEqual([
      ["neil", true],
      ["ada", false]
    ]);
  });

  it("can keep modal ordering stable after state changes", () => {
    const withFollow = upsertFollowedUser(defaultAppState, { username: "Neil", source: "manual" });
    const withOtherFollow = upsertFollowedUser(withFollow, { username: "Ada", source: "manual" });
    const initial = deriveFollowedCandidates(addFriendFromProfile(withOtherFollow, { username: "Neil", refreshedAt: "2026-06-28T00:00:00.000Z" }));
    const snapshot = initial.map((candidate) => candidate.user.username);
    const changed = deriveFollowedCandidates(addFriendFromProfile(withOtherFollow, { username: "Ada", refreshedAt: "2026-06-28T00:00:00.000Z" }));

    expect(orderFollowedCandidates(changed, snapshot).map((candidate) => [candidate.user.username, candidate.isFriend])).toEqual([
      ["neil", false],
      ["ada", true]
    ]);
  });

  it("merges followed candidates with manually added friends and filters by identity", () => {
    const withFollow = upsertFollowedUser(defaultAppState, { username: "Neil", name: "Neo", source: "manual" });
    const withFollowFriend = addFriendFromProfile(withFollow, { username: "Neil", name: "Neo", refreshedAt: "2026-06-28T00:00:00.000Z" });
    const withManualFriend = addFriendFromProfile(withFollowFriend, {
      username: "Misaka7369",
      name: "御坂",
      refreshedAt: "2026-06-28T00:01:00.000Z"
    });

    const candidates = mergeFriendCandidates(deriveFriendList(withManualFriend), deriveFollowedCandidates(withManualFriend));

    expect(candidates.map((candidate) => [candidate.user.username, candidate.isFriend])).toEqual([
      ["misaka7369", true],
      ["neil", true]
    ]);
    expect(filterFriendCandidates(candidates, "御坂").map((candidate) => candidate.user.username)).toEqual(["misaka7369"]);
    expect(filterFriendCandidates(candidates, "@neil").map((candidate) => candidate.user.username)).toEqual(["neil"]);
  });

  it("creates synthetic modal candidates from typed usernames", () => {
    const state = addFriendFromProfile(defaultAppState, {
      username: "Misaka7369",
      name: "御坂",
      refreshedAt: "2026-06-28T00:01:00.000Z"
    });
    const friends = deriveFriendList(state);
    const candidates = mergeFriendCandidates(friends, deriveFollowedCandidates(state));

    expect(syntheticFriendCandidate(friends, candidates, "ghost")).toMatchObject({
      user: { username: "ghost" },
      identity: { primary: "ghost", secondary: "@ghost" },
      isFriend: false,
      isSynthetic: true
    });
    expect(syntheticFriendCandidate(friends, candidates, "@Misaka7369")).toBeNull();
  });

  it("derives feed items by type and user with deterministic sorting", () => {
    const withFriend = addFriendFromProfile(defaultAppState, { username: "Neil", refreshedAt: "2026-06-28T00:00:00.000Z" });
    const state = {
      ...withFriend,
      activity: {
        neil: {
          username: "neil",
          refreshedAt: "2026-06-27T00:00:00.000Z",
          items: [
            { id: "reaction:2", username: "neil", actorUsername: "neil", kind: "reaction" as const, title: "r", occurredAt: "2026-06-27T00:00:00.000Z" },
            { id: "boost:1", username: "neil", actorUsername: "neil", kind: "boost" as const, title: "b", occurredAt: "2026-06-27T00:00:00.000Z" },
            { id: "reply:3", username: "neil", actorUsername: "neil", kind: "reply" as const, title: "p", occurredAt: "2026-06-28T00:00:00.000Z" }
          ]
        }
      }
    };

    expect(deriveFeedItems(state).map((item) => item.id)).toEqual(["reply:3", "boost:1", "reaction:2"]);
    expect(deriveFeedItems(state, { kind: "boost", username: "all" }).map((item) => item.id)).toEqual(["boost:1"]);
    expect(deriveFeedItems(state, { kind: "all", username: "neil" })).toHaveLength(3);
  });

  it("hides cached feed items disallowed by the watched friend's scope", () => {
    const state = {
      ...updateFriend(addFriendFromProfile(defaultAppState, { username: "Neil", refreshedAt: "2026-06-28T00:00:00.000Z" }), "neil", {
        activityKinds: ["reply"]
      }),
      activity: {
        neil: {
          username: "neil",
          refreshedAt: "2026-06-28T00:05:00.000Z",
          items: [
            { id: "reply:1", username: "neil", actorUsername: "neil", kind: "reply" as const, title: "reply" },
            { id: "boost:1", username: "neil", actorUsername: "ada", kind: "boost" as const, title: "boost" }
          ]
        }
      }
    };

    expect(deriveFeedItems(state).map((item) => item.id)).toEqual(["reply:1"]);
    expect(state.activity.neil.items.map((item) => item.id)).toEqual(["reply:1", "boost:1"]);
  });

  it("filters feed users by watched summary owner instead of activity actor", () => {
    const withNeil = addFriendFromProfile(defaultAppState, { username: "Neil", refreshedAt: "2026-06-28T00:00:00.000Z" });
    const state = {
      ...addFriendFromProfile(withNeil, { username: "Ada", refreshedAt: "2026-06-28T00:00:00.000Z" }),
      activity: {
        neil: {
          username: "neil",
          refreshedAt: "2026-06-28T00:05:00.000Z",
          items: [{ id: "boost:neil", username: "neil", actorUsername: "ada", kind: "boost" as const, title: "neil watched boost" }]
        },
        ada: {
          username: "ada",
          refreshedAt: "2026-06-28T00:05:00.000Z",
          items: [{ id: "boost:ada", username: "ada", actorUsername: "neil", kind: "boost" as const, title: "ada watched boost" }]
        }
      }
    };

    expect(deriveFeedItems(state, { kind: "all", username: "neil" }).map((item) => item.id)).toEqual(["boost:neil"]);
    expect(deriveFeedItems(state, { kind: "all", username: "ada" }).map((item) => item.id)).toEqual(["boost:ada"]);
  });

  it("inserts a feed waterline between items newer and older than the last refresh", () => {
    const withFriend = addFriendFromProfile(defaultAppState, { username: "Neil", refreshedAt: "2026-06-28T00:00:00.000Z" });
    const state = {
      ...withFriend,
      activityFeedWaterlineAt: "2026-06-28T00:02:00.000Z",
      activity: {
        neil: {
          username: "neil",
          refreshedAt: "2026-06-28T00:05:00.000Z",
          items: [
            { id: "old", username: "neil", actorUsername: "neil", kind: "boost" as const, title: "old", occurredAt: "2026-06-28T00:01:00.000Z" },
            { id: "new", username: "neil", actorUsername: "neil", kind: "boost" as const, title: "new", occurredAt: "2026-06-28T00:03:00.000Z" }
          ]
        }
      }
    };

    expect(deriveFeedRenderEntries(state).map((entry) => (entry.type === "activity" ? entry.item.id : "waterline"))).toEqual([
      "new",
      "waterline",
      "old"
    ]);
  });

  it("does not insert a feed waterline when no visible item is newer than the last refresh", () => {
    const withFriend = addFriendFromProfile(defaultAppState, { username: "Neil", refreshedAt: "2026-06-28T00:00:00.000Z" });
    const state = {
      ...withFriend,
      activityFeedWaterlineAt: "2026-06-28T00:02:00.000Z",
      activity: {
        neil: {
          username: "neil",
          refreshedAt: "2026-06-28T00:05:00.000Z",
          items: [{ id: "old", username: "neil", actorUsername: "neil", kind: "boost" as const, title: "old", occurredAt: "2026-06-28T00:01:00.000Z" }]
        }
      }
    };

    expect(deriveFeedRenderEntries(state).map((entry) => entry.type)).toEqual(["activity"]);
  });

  it("derives activity refresh scope and scoped freshness labels", () => {
    const withFriends = addFriendFromProfile(
      addFriendFromProfile(defaultAppState, { username: "Neil", refreshedAt: "2026-06-28T00:00:00.000Z" }),
      { username: "Ada", refreshedAt: "2026-06-28T00:00:00.000Z" }
    );
    const state = {
      ...withFriends,
      activityRefreshLedger: {
        "neil:boost": {
          scopeKey: "neil:boost",
          username: "neil",
          kind: "boost" as const,
          refreshedAt: "2026-06-28T00:01:00.000Z",
          source: "direct_fetch" as const,
          itemCount: 1
        },
        "ada:boost": {
          scopeKey: "ada:boost",
          username: "ada",
          kind: "boost" as const,
          refreshedAt: "2026-06-28T00:02:00.000Z",
          source: "direct_fetch" as const,
          itemCount: 1
        }
      }
    };

    expect(deriveActivityRefreshScope({ kind: "boost", username: "Neil" })).toEqual({ kind: "boost", usernames: ["Neil"] });
    expect(deriveActivityFreshness(state, { kind: "boost" })).toEqual({
      label: "全部佬朋友 Boost 已刷新",
      refreshedAt: "2026-06-28T00:02:00.000Z"
    });
    expect(deriveActivityFreshness(state, { kind: "boost", usernames: ["neil"] })).toEqual({
      label: "@neil Boost 已刷新",
      refreshedAt: "2026-06-28T00:01:00.000Z"
    });
    expect(deriveActivityFreshness(state, { kind: "reaction", usernames: ["neil"] })).toEqual({
      label: "@neil 回应 未刷新",
      refreshedAt: undefined
    });
  });

  it("derives activity request counts from effective per-friend scopes", () => {
    const withNeil = updateFriend(
      addFriendFromProfile(defaultAppState, { username: "Neil", refreshedAt: "2026-06-28T00:00:00.000Z" }),
      "neil",
      { activityKinds: ["reply", "boost"] }
    );
    const state = updateFriend(
      addFriendFromProfile(withNeil, { username: "Ada", refreshedAt: "2026-06-28T00:00:00.000Z" }),
      "ada",
      { activityKinds: [] }
    );

    expect(deriveActivityRequestCounts(state)).toEqual({ all: 2, topic: 0, reply: 1, boost: 1, reaction: 0, like: 0 });
    expect(deriveActivityRequestCounts(state, "ada")).toEqual({ all: 0, topic: 0, reply: 0, boost: 0, reaction: 0, like: 0 });
  });

  it("does not show cached activity for users who are no longer friends", () => {
    const state = {
      ...addFriendFromProfile(defaultAppState, { username: "Neil", refreshedAt: "2026-06-28T00:00:00.000Z" }),
      friends: {},
      activity: {
        neil: {
          username: "neil",
          refreshedAt: "2026-06-27T00:00:00.000Z",
          items: [{ id: "reply:1", username: "neil", actorUsername: "neil", kind: "reply" as const, title: "reply" }]
        }
      }
    };

    expect(deriveFeedItems(state)).toEqual([]);
  });
});
