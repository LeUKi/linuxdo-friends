import { describe, expect, it, vi } from "vitest";
import { createRefreshAdapter } from "./refreshAdapter";
import { defaultAppState } from "../domain/defaultState";
import type { AppState } from "../shared/types";
import { addFriendFromProfile, updateFriend, upsertFollowedUser } from "../domain/friends";

describe("refresh adapter", () => {
  it("syncs followed users through the current linux.do account", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ topic_list: { topics: [] } }), {
        status: 200,
        headers: { "x-discourse-username": "LaFish" }
      }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { id: 1, username: "Neil", name: "Neil", avatar_template: "/user_avatar/linux.do/neil/{size}/1.png", animated_avatar: null },
            { id: 2, username: "ada", name: "", avatar_template: "/letter_avatar/ada/{size}/5.png", animated_avatar: null },
            { id: 3, name: "ignored without username", avatar_template: "/letter_avatar/missing/{size}/5.png" }
          ]),
          { status: 200 }
        )
      ) as unknown as typeof fetch;
    const adapter = createRefreshAdapter(fetchImpl);

    const result = await adapter.syncFollowedUsers(defaultAppState);

    expect(result.result).toMatchObject({ ok: true, source: "direct_fetch" });
    expect(result.state.currentAccount).toMatchObject({ username: "lafish", source: "latest_header" });
    expect(result.state.followedUsers.neil).toMatchObject({
      username: "neil",
      name: "Neil",
      avatarUrl: "https://linux.do/user_avatar/linux.do/neil/48/1.png",
      source: "sync"
    });
    expect(result.state.followedUsers.ada).toMatchObject({ username: "ada", source: "sync" });
    expect(fetchImpl).toHaveBeenNthCalledWith(1, "https://linux.do/latest.json", expect.any(Object));
    expect(fetchImpl).toHaveBeenNthCalledWith(2, "https://linux.do/u/lafish/follow/following.json", expect.any(Object));
  });

  it("reports direct linux.do request attempts before success or failure handling", async () => {
    const attempts: Array<{ family: string; url: string }> = [];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ topic_list: { topics: [] } }), {
        status: 200,
        headers: { "x-discourse-username": "LaFish" }
      }))
      .mockResolvedValueOnce(new Response("blocked", { status: 403 })) as unknown as typeof fetch;
    const adapter = createRefreshAdapter(fetchImpl, (family, url) => attempts.push({ family, url }));

    const result = await adapter.syncFollowedUsers(defaultAppState);

    expect(result.result).toMatchObject({ ok: false, reason: "blocked" });
    expect(attempts).toEqual([
      { family: "following", url: "https://linux.do/latest.json" },
      { family: "following", url: "https://linux.do/u/lafish/follow/following.json" }
    ]);
  });

  it("reports a direct linux.do request attempt when fetch throws", async () => {
    const attempts: string[] = [];
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const adapter = createRefreshAdapter(fetchImpl, (_family, url) => attempts.push(url));

    const result = await adapter.lookupFriendProfile("Neo");

    expect(result).toMatchObject({ ok: false, result: { reason: "network_error" } });
    expect(attempts).toEqual(["https://linux.do/u/neo.json"]);
  });

  it("does not request the following list when the username header is missing", async () => {
    const state = upsertFollowedUser(defaultAppState, { username: "neil", source: "manual" });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ topic_list: { topics: [] } }), { status: 200 })) as unknown as typeof fetch;
    const adapter = createRefreshAdapter(fetchImpl);

    const result = await adapter.syncFollowedUsers(state);

    expect(result.result).toMatchObject({ ok: false, reason: "unavailable" });
    expect(result.state.followedUsers.neil).toBeTruthy();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps existing follows when the following endpoint is blocked", async () => {
    const state = upsertFollowedUser(defaultAppState, { username: "neil", source: "manual" });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ topic_list: { topics: [] } }), {
        status: 200,
        headers: { "x-discourse-username": "lafish" }
      }))
      .mockResolvedValueOnce(new Response("no", { status: 403 })) as unknown as typeof fetch;
    const adapter = createRefreshAdapter(fetchImpl);

    const result = await adapter.syncFollowedUsers(state);

    expect(result.result).toMatchObject({ ok: false, reason: "blocked" });
    expect(result.state.currentAccount).toMatchObject({ username: "lafish" });
    expect(result.state.followedUsers.neil).toBeTruthy();
  });

  it("adds a friend only after /u/{username}.json succeeds", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        user: {
          username: "Neil",
          name: "Neo",
          avatar_template: "/user_avatar/linux.do/neil/{size}/1.png",
          last_posted_at: "2026-06-28T00:10:00.000Z",
          last_seen_at: "2026-06-28T00:12:00.000Z"
        }
      })
    ) as unknown as typeof fetch;
    const adapter = createRefreshAdapter(fetchImpl);

    const result = await adapter.addFriendByProfile(defaultAppState, "NEIL");

    expect(result.result).toMatchObject({ ok: true, source: "direct_fetch" });
    expect(fetchImpl).toHaveBeenCalledWith("https://linux.do/u/neil.json", expect.any(Object));
    expect(result.state.friends.neil).toBeTruthy();
    expect(result.state.friendProfiles.neil).toMatchObject({
      username: "neil",
      name: "Neo",
      avatarUrl: "https://linux.do/user_avatar/linux.do/neil/48/1.png",
      lastSeenAt: "2026-06-28T00:12:00.000Z"
    });
  });

  it("looks up a friend profile without mutating state", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ user: { username: "Neil", name: "Neo" } })) as unknown as typeof fetch;
    const adapter = createRefreshAdapter(fetchImpl);

    const result = await adapter.lookupFriendProfile("NEIL");

    expect(result).toMatchObject({ ok: true, profile: { username: "neil", name: "Neo" } });
    expect(fetchImpl).toHaveBeenCalledWith("https://linux.do/u/neil.json", expect.any(Object));
  });

  it("maps missing profile responses to a user-facing not-found message", async () => {
    const fetchImpl = vi.fn(async () => new Response("missing", { status: 404 })) as unknown as typeof fetch;
    const adapter = createRefreshAdapter(fetchImpl);

    const result = await adapter.lookupFriendProfile("ghost");

    expect(result).toMatchObject({
      ok: false,
      result: { ok: false, reason: "invalid_response", message: "用户不存在或公开资料不可用。" }
    });
  });

  it("does not create a friend when profile validation fails", async () => {
    const fetchImpl = vi.fn(async () => new Response("Enable JavaScript and cookies to continue", { status: 429 })) as unknown as typeof fetch;
    const adapter = createRefreshAdapter(fetchImpl);

    const result = await adapter.addFriendByProfile(defaultAppState, "neil");

    expect(result.result).toMatchObject({ ok: false, reason: "challenge" });
    expect(result.state.friends.neil).toBeUndefined();
    expect(result.state.friendProfiles.neil).toBeUndefined();
  });

  it("refreshes friend profiles through only /u/{username}.json and preserves earlier successes", async () => {
    const state = addFriendFromProfile(
      addFriendFromProfile(defaultAppState, { username: "neil", refreshedAt: "2026-06-27T00:00:00.000Z" }),
      { username: "ada", refreshedAt: "2026-06-27T00:00:00.000Z" }
    );
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ user: { username: "Neil", name: "Neo" } }))
      .mockResolvedValueOnce(new Response("stop", { status: 403 })) as unknown as typeof fetch;
    const adapter = createRefreshAdapter(fetchImpl);

    const result = await adapter.refreshFriendProfiles(state);

    expect(result.result).toMatchObject({ ok: false, reason: "blocked" });
    expect(fetchImpl).toHaveBeenNthCalledWith(1, "https://linux.do/u/neil.json", expect.any(Object));
    expect(fetchImpl).toHaveBeenNthCalledWith(2, "https://linux.do/u/ada.json", expect.any(Object));
    expect(result.state.friendProfiles.neil).toMatchObject({ name: "Neo" });
    expect(result.state.friendProfiles.ada).toMatchObject({ refreshedAt: "2026-06-27T00:00:00.000Z" });
  });

  it("reports profile refresh progress after each completed user", async () => {
    const state = addFriendFromProfile(
      addFriendFromProfile(defaultAppState, { username: "neil", refreshedAt: "2026-06-27T00:00:00.000Z" }),
      { username: "ada", refreshedAt: "2026-06-27T00:00:00.000Z" }
    );
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ user: { username: "Neil", name: "Neo" } }))
      .mockResolvedValueOnce(jsonResponse({ user: { username: "Ada", name: "Ada" } })) as unknown as typeof fetch;
    const adapter = createRefreshAdapter(fetchImpl);
    const progress = vi.fn();

    const result = await adapter.refreshFriendProfiles(state, undefined, progress);

    expect(result.result).toMatchObject({ ok: true });
    expect(progress).toHaveBeenCalledTimes(2);
    expect(progress.mock.calls.map(([username]) => username)).toEqual(["neil", "ada"]);
  });

  it("normalizes direct fetch and challenge failures into one result shape", async () => {
    const state = addFriendFromProfile(defaultAppState, { username: "neil", refreshedAt: "2026-06-28T00:00:00.000Z" });
    const fetchImpl = vi.fn(async () => new Response("<title>Just a moment...</title>", { status: 200 })) as unknown as typeof fetch;
    const adapter = createRefreshAdapter(fetchImpl);
    const result = await adapter.refreshFriendActivity(state);
    expect(result.result).toMatchObject({ ok: false, source: "direct_fetch", reason: "challenge" });
    expect(result.state.activity.neil).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    [403, "blocked"],
    [429, "rate_limited"]
  ] as const)("stops after a %i response without retrying remaining endpoints or friends", async (status, reason) => {
    const withFirstFriend = addFriendFromProfile(defaultAppState, { username: "neil", refreshedAt: "2026-06-28T00:00:00.000Z" });
    const state = addFriendFromProfile(withFirstFriend, { username: "ada", refreshedAt: "2026-06-28T00:00:00.000Z" });
    const fetchImpl = vi.fn(async () => new Response("stop", { status })) as unknown as typeof fetch;
    const adapter = createRefreshAdapter(fetchImpl);

    const result = await adapter.refreshFriendActivity(state);

    expect(result.result).toMatchObject({ ok: false, source: "direct_fetch", reason });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.state.activity.ada).toBeUndefined();
  });

  it("refreshes selected friends through all four activity endpoints and normalizes selected usernames", async () => {
    const state: AppState = {
      ...addFriendFromProfile(defaultAppState, { username: "neil", refreshedAt: "2026-06-28T00:00:00.000Z" }),
      laoFindsStartedAt: "2026-06-26T00:00:00.000Z",
      dredgeRules: [
        {
          id: "rule-topic",
          name: "topic",
          enabled: true,
          usernames: ["neil"],
          kinds: ["topic"],
          keywords: ["topic"],
          createdAt: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:00.000Z"
        }
      ]
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        user_actions: [
          { action_type: 4, topic_id: 1, post_number: 1, created_at: "2026-06-27T00:00:03.000Z", acting_username: "Neil", title: "topic" }
        ]
      }))
      .mockResolvedValueOnce(jsonResponse({
        user_actions: [
          { action_type: 5, topic_id: 1, post_id: 2, created_at: "2026-06-27T00:00:02.000Z", acting_username: "Neil", title: "reply" }
        ]
      }))
      .mockResolvedValueOnce(
        jsonResponse({
          boosts: [
            {
              id: 3,
              created_at: "2026-06-27T00:00:01.000Z",
              user: { username: "Neil" },
              post: { topic_title: "boost", id: 10 }
            }
          ]
        })
      )
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: 4,
            created_at: "2026-06-27T00:00:00.000Z",
            user: { username: "Neil" },
            post: { topic_title: "reaction", id: 11 },
            reaction: { reaction_value: "hugs" }
          }
        ])
      ) as unknown as typeof fetch;
    const adapter = createRefreshAdapter(fetchImpl);

    const result = await adapter.refreshFriendActivity(state, { kind: "all", usernames: ["ghost", "NEIL"] });

    expect(result.result).toMatchObject({ ok: true, source: "direct_fetch" });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://linux.do/user_actions.json?offset=0&username=neil&filter=4",
      expect.any(Object)
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://linux.do/user_actions.json?offset=0&username=neil&filter=5",
      expect.any(Object)
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      "https://linux.do/discourse-boosts/users/neil/boosts-given.json",
      expect.any(Object)
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      "https://linux.do/discourse-reactions/posts/reactions.json?username=neil",
      expect.any(Object)
    );
    expect(result.state.activity.neil.items.map((item) => item.kind)).toEqual(["topic", "reply", "boost", "reaction"]);
    expect(Object.keys(result.state.laoFindsItems)).toEqual(["user_action:neil:4:1:1"]);
    expect(result.state.laoFindsItems["user_action:neil:4:1:1"].matchedRuleIds).toEqual(["rule-topic"]);
    expect(Object.keys(result.state.activityRefreshLedger).sort()).toEqual(["neil:boost", "neil:reaction", "neil:reply", "neil:topic"]);
    expect(vi.mocked(fetchImpl).mock.calls.some(([url]: [RequestInfo | URL, RequestInit?]) => String(url).includes("/u/neil.json"))).toBe(false);
    expect(Object.keys(result.state.activityWatermarks).sort()).toEqual(["neil:boost", "neil:reaction", "neil:reply", "neil:topic"]);
    expect(result.state.activity.neil.items.some((item) => item.isNew)).toBe(false);
  });

  it("succeeds without linux.do requests when effective activity scope is empty", async () => {
    const state = updateFriend(
      addFriendFromProfile(defaultAppState, { username: "Neil", refreshedAt: "2026-06-28T00:00:00.000Z" }),
      "neil",
      { activityKinds: [] }
    );
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const adapter = createRefreshAdapter(fetchImpl);

    const result = await adapter.refreshFriendActivity(state, { kind: "all", usernames: ["Neil"] });

    expect(result.result).toMatchObject({
      ok: true,
      source: "direct_fetch",
      message: "当前视奸范围没有可刷新的动态。"
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.state).toBe(state);
  });

  it("marks scoped activity as new on the second refresh through the adapter path", async () => {
    const state = addFriendFromProfile(defaultAppState, { username: "Neil", refreshedAt: "2026-06-28T00:00:00.000Z" });
    const firstFetch = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        boosts: [
          {
            id: 3,
            created_at: "2026-06-27T00:00:01.000Z",
            user: { username: "Neil" },
            post: { topic_title: "old boost", id: 10 }
          }
        ]
      })
    ) as unknown as typeof fetch;
    const firstAdapter = createRefreshAdapter(firstFetch);
    const first = await firstAdapter.refreshFriendActivity(state, { kind: "boost", usernames: ["Neil"] });

    const secondFetch = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        boosts: [
          {
            id: 4,
            created_at: "2026-06-27T00:00:03.000Z",
            user: { username: "Neil" },
            post: { topic_title: "new boost", id: 11 }
          },
          {
            id: 3,
            created_at: "2026-06-27T00:00:01.000Z",
            user: { username: "Neil" },
            post: { topic_title: "old boost", id: 10 }
          }
        ]
      })
    ) as unknown as typeof fetch;
    const secondAdapter = createRefreshAdapter(secondFetch);
    const second = await secondAdapter.refreshFriendActivity(first.state, { kind: "boost", usernames: ["Neil"] });

    expect(first.state.activity.neil.items.some((item) => item.isNew)).toBe(false);
    expect(first.state.activityFeedWaterlineAt).toBeUndefined();
    expect(second.state.activity.neil.items.map((item) => [item.id, item.isNew])).toEqual([
      ["boost:4", true],
      ["boost:3", undefined]
    ]);
    expect(second.state.activityFeedWaterlineAt).toBe(first.state.activityRefreshLedger["neil:boost"].refreshedAt);
    expect(second.state.activityWatermarks["neil:boost"].latestOccurredAt).toBe("2026-06-27T00:00:03.000Z");
  });

  it("refreshes only the selected activity kind and preserves cached items from other kinds", async () => {
    const state = {
      ...addFriendFromProfile(defaultAppState, { username: "Neil", refreshedAt: "2026-06-28T00:00:00.000Z" }),
      activity: {
        neil: {
          username: "neil",
          refreshedAt: "2026-06-27T00:00:00.000Z",
          items: [
            { id: "old-topic", username: "neil", actorUsername: "neil", kind: "topic" as const, title: "old topic" },
            { id: "old-reaction", username: "neil", actorUsername: "neil", kind: "reaction" as const, title: "old reaction" }
          ]
        }
      }
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        boosts: [
          {
            id: 3,
            created_at: "2026-06-27T00:00:01.000Z",
            user: { username: "Neil" },
            post: { topic_title: "boost", id: 10 }
          }
        ]
      })
    ) as unknown as typeof fetch;
    const adapter = createRefreshAdapter(fetchImpl);

    const result = await adapter.refreshFriendActivity(state, { kind: "boost", usernames: ["NEIL"] });

    expect(result.result).toMatchObject({ ok: true, source: "direct_fetch" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith("https://linux.do/discourse-boosts/users/neil/boosts-given.json", expect.any(Object));
    expect(result.state.activity.neil.items.map((item) => item.kind)).toEqual(["boost", "reaction", "topic"]);
    expect(result.state.activityRefreshLedger["neil:boost"]).toMatchObject({ kind: "boost", itemCount: 1 });
    expect(result.state.activityRefreshLedger["neil:topic"]).toBeUndefined();
  });

  it.each([
    ["topic", "https://linux.do/user_actions.json?offset=0&username=neil&filter=4"],
    ["reply", "https://linux.do/user_actions.json?offset=0&username=neil&filter=5"],
    ["reaction", "https://linux.do/discourse-reactions/posts/reactions.json?username=neil"]
  ] as const)("requests only the %s endpoint for scoped activity refresh", async (kind, expectedUrl) => {
    const state = addFriendFromProfile(defaultAppState, { username: "Neil", refreshedAt: "2026-06-28T00:00:00.000Z" });
    const payload =
      kind === "reaction"
        ? [{ id: 1, user: { username: "Neil" }, post: { topic_title: "reaction" }, reaction: { reaction_value: "hugs" } }]
        : { user_actions: [{ action_type: kind === "topic" ? 4 : 5, topic_id: 1, title: kind, acting_username: "Neil" }] };
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(payload)) as unknown as typeof fetch;
    const adapter = createRefreshAdapter(fetchImpl);

    const result = await adapter.refreshFriendActivity(state, { kind, usernames: ["Neil"] });

    expect(result.result).toMatchObject({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(expectedUrl, expect.any(Object));
    expect(result.state.activity.neil.items).toHaveLength(1);
    expect(result.state.activity.neil.items[0].kind).toBe(kind);
  });

  it("reports progress after each completed endpoint", async () => {
    const state = addFriendFromProfile(defaultAppState, { username: "Neil", refreshedAt: "2026-06-28T00:00:00.000Z" });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ user_actions: [] }))
      .mockResolvedValueOnce(jsonResponse({ user_actions: [] }))
      .mockResolvedValueOnce(jsonResponse({ boosts: [] }))
      .mockResolvedValueOnce(jsonResponse([])) as unknown as typeof fetch;
    const adapter = createRefreshAdapter(fetchImpl);
    const progress = vi.fn();

    const result = await adapter.refreshFriendActivity(state, { kind: "all", usernames: ["Neil"] }, progress);

    expect(result.result).toMatchObject({ ok: true });
    expect(progress).toHaveBeenCalledTimes(4);
    expect(progress.mock.calls.map(([step]) => step.kind)).toEqual(["topic", "reply", "boost", "reaction"]);
  });

  it("does not write a partial summary when a later endpoint fails", async () => {
    const state = {
      ...addFriendFromProfile(defaultAppState, { username: "neil", refreshedAt: "2026-06-28T00:00:00.000Z" }),
      activity: {
        neil: {
          username: "neil",
          refreshedAt: "2026-06-26T00:00:00.000Z",
          items: [{ id: "old", username: "neil", kind: "reply" as const, title: "old" }]
        }
      }
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ user_actions: [{ action_type: 4, topic_id: 1, title: "new" }] }))
      .mockResolvedValueOnce(new Response("Enable JavaScript and cookies to continue", { status: 429 })) as unknown as typeof fetch;
    const adapter = createRefreshAdapter(fetchImpl);

    const result = await adapter.refreshFriendActivity(state);

    expect(result.result).toMatchObject({ ok: false, reason: "challenge" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.state.activity.neil.items).toEqual([{ id: "old", username: "neil", kind: "reply", title: "old" }]);
    expect(result.state.activityWatermarks).toEqual({});
  });

  it("does not commit earlier friends when a later friend activity refresh fails", async () => {
    const withFirstFriend = addFriendFromProfile(defaultAppState, { username: "neil", refreshedAt: "2026-06-28T00:00:00.000Z" });
    const state = {
      ...addFriendFromProfile(withFirstFriend, { username: "ada", refreshedAt: "2026-06-28T00:00:00.000Z" }),
      activity: {
        neil: {
          username: "neil",
          refreshedAt: "2026-06-26T00:00:00.000Z",
          items: [{ id: "old", username: "neil", kind: "reply" as const, title: "old", isNew: true }]
        }
      },
      activityRefreshLedger: {
        "neil:reply": {
          scopeKey: "neil:reply",
          username: "neil",
          kind: "reply" as const,
          refreshedAt: "2026-06-26T00:00:00.000Z",
          source: "direct_fetch" as const,
          itemCount: 1
        }
      },
      activityWatermarks: {
        "neil:reply": {
          scopeKey: "neil:reply",
          username: "neil",
          kind: "reply" as const,
          latestOccurredAt: "2026-06-26T00:00:00.000Z",
          updatedAt: "2026-06-26T00:00:00.000Z",
          source: "direct_fetch" as const
        }
      }
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ user_actions: [] }))
      .mockResolvedValueOnce(jsonResponse({ user_actions: [] }))
      .mockResolvedValueOnce(jsonResponse({ boosts: [] }))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(new Response("Enable JavaScript and cookies to continue", { status: 429 })) as unknown as typeof fetch;
    const adapter = createRefreshAdapter(fetchImpl);

    const result = await adapter.refreshFriendActivity(state, { kind: "all" });

    expect(result.result).toMatchObject({ ok: false, reason: "challenge" });
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(result.state.activity).toEqual(state.activity);
    expect(result.state.activityRefreshLedger).toEqual(state.activityRefreshLedger);
    expect(result.state.activityWatermarks).toEqual(state.activityWatermarks);
  });

});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200 });
}
