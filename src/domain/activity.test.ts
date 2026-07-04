import { describe, expect, it } from "vitest";
import {
  avatarUrlFromTemplate,
  extractBoosts,
  extractReactions,
  extractUserActions,
  normalizeBoost,
  normalizeFriendActivity,
  normalizeReaction,
  normalizeUserAction,
  plainTextFromHtmlish,
  sortActivityItems
} from "./activity";
import type { ActivityItem } from "../shared/types";

describe("activity normalization", () => {
  it("extracts endpoint payloads and filters malformed entries", () => {
    expect(extractUserActions({ user_actions: [{ id: 1 }, "bad", null] })).toEqual([{ id: 1 }]);
    expect(extractBoosts({ boosts: [{ id: 2 }, "bad", null] })).toEqual([{ id: 2 }]);
    expect(extractReactions([{ id: 3 }, "bad", null])).toEqual([{ id: 3 }]);
  });

  it("normalizes user actions into topic and reply items", () => {
    const topic = normalizeUserAction("RichardZSR", {
      action_type: 4,
      created_at: "2026-06-27T15:46:08.462Z",
      topic_id: 2487322,
      post_id: null,
      post_number: 1,
      username: "RichardZSR",
      name: "",
      acting_username: "RichardZSR",
      acting_name: "",
      avatar_template: "/user_avatar/linux.do/richardzsr/{size}/1.png",
      title: "Codex APP新版疑似bug喜加一｜启动Codex自动发送多次对话信息吃token",
      excerpt: "<a href=\"mailto:test@example.com\">test@example.com</a> &amp; thanks"
    });
    const reply = normalizeUserAction("RichardZSR", {
      action_type: 5,
      created_at: "2026-06-27T15:50:04.325Z",
      topic_id: 2487322,
      post_id: 19680955,
      post_number: 3,
      acting_username: "RichardZSR",
      title: "Codex APP新版疑似bug喜加一｜启动Codex自动发送多次对话信息吃token",
      excerpt: "离谱"
    });

    expect(topic).toMatchObject({
      id: "user_action:richardzsr:4:2487322:1",
      kind: "topic",
      username: "richardzsr",
      actorUsername: "richardzsr",
      actorAvatarUrl: "https://linux.do/user_avatar/linux.do/richardzsr/48/1.png",
      excerpt: "test@example.com & thanks",
      source: "user_actions"
    });
    expect(reply).toMatchObject({
      id: "user_action:richardzsr:5:2487322:19680955",
      kind: "reply",
      postId: 19680955
    });
  });

  it("preserves reply target post number when available", () => {
    expect(
      normalizeUserAction("RichardZSR", {
        action_type: 5,
        topic_id: 2487322,
        post_id: 19680955,
        post_number: 3,
        reply_to_post_number: 2,
        acting_username: "RichardZSR",
        title: "reply"
      })
    ).toMatchObject({
      kind: "reply",
      replyToPostNumber: 2
    });
  });

  it("normalizes likes from user actions without treating unknown action types as replies", () => {
    const like = normalizeUserAction("shark55ovo", {
      action_type: 1,
      created_at: "2026-07-04T02:33:28.511Z",
      slug: "topic",
      topic_id: 2088508,
      post_number: 10,
      post_id: 17370515,
      username: "lafish",
      acting_username: "Shark55OvO",
      acting_name: "Alex奇数君",
      target_username: "Shark55OvO",
      title: "佬们有没有买了一次后相见恨晚的东西"
    });

    expect(like).toMatchObject({
      id: "user_action:shark55ovo:1:2088508:17370515",
      kind: "like",
      username: "shark55ovo",
      actorUsername: "shark55ovo",
      targetUsername: "shark55ovo",
      url: "/t/topic/2088508/10",
      source: "user_actions"
    });
    expect(normalizeUserAction("shark55ovo", { action_type: 999, title: "unknown" })).toBeUndefined();
  });

  it("keeps like ownership on the requested user when the payload username is the liked post author", () => {
    const like = normalizeUserAction("Shark55OvO", {
      action_type: 1,
      created_at: "2026-07-04T02:33:28.511Z",
      topic_id: 2088508,
      post_id: 17370515,
      username: "LaFish",
      name: "帖子作者",
      avatar_template: "/user_avatar/linux.do/lafish/{size}/1.png",
      title: "佬们有没有买了一次后相见恨晚的东西"
    });

    expect(like).toMatchObject({
      id: "user_action:shark55ovo:1:2088508:17370515",
      kind: "like",
      username: "shark55ovo",
      actorUsername: "shark55ovo",
      targetUsername: "lafish",
      targetName: "帖子作者",
      targetAvatarUrl: "https://linux.do/user_avatar/linux.do/lafish/48/1.png"
    });
    expect(like?.actorName).toBeUndefined();
    expect(like?.actorAvatarUrl).toBeUndefined();
  });

  it("normalizes boosts with actor and target post metadata", () => {
    const item = normalizeBoost({
      id: 391850,
      raw: ":bili_052:一个意思",
      cooked: "<p>一个意思</p>",
      created_at: "2026-06-27T13:37:44.816Z",
      post_id: 19677011,
      user: {
        username: "Misaka7369",
        name: "星",
        avatar_template: "/user_avatar/linux.do/misaka7369/{size}/1733663_2.png"
      },
      post: {
        id: 19677011,
        url: "/t/topic/2486397/24",
        excerpt: "我觉得应该是",
        username: "LukeToWorl",
        name: "Evans",
        avatar_template: "/user_avatar/linux.do/luketoworl/{size}/2155280_2.png",
        topic_id: 2486397,
        topic_title: "发一个直接用的渠道",
        category_id: 62
      }
    });

    expect(item).toMatchObject({
      id: "boost:391850",
      kind: "boost",
      source: "boosts",
      username: "misaka7369",
      actorName: "星",
      targetUsername: "luketoworl",
      targetName: "Evans",
      topicTitle: "发一个直接用的渠道",
      postId: 19677011,
      boostText: ":bili_052:一个意思"
    });
  });

  it("normalizes reactions and preserves reaction value", () => {
    const item = normalizeReaction({
      id: 3489565,
      post_id: 19676321,
      created_at: "2026-06-27T13:15:20.551Z",
      user: {
        username: "Misaka7369",
        name: "星",
        avatar_template: "/user_avatar/linux.do/misaka7369/{size}/1733663_2.png"
      },
      post: {
        excerpt: "咱准备专门开发一个奸视插件 <img alt=\":face_savoring_food:\">",
        id: 19676321,
        topic_id: 2314316,
        topic_title: "回复：做了一个web邮箱，想找几位佬友测试下看看",
        url: "/t/topic/2314316/412",
        post_number: 412,
        username: "lafish",
        name: "",
        avatar_template: "/user_avatar/linux.do/lafish/{size}/1677972_2.png"
      },
      reaction: {
        reaction_value: "hugs"
      }
    });

    expect(item).toMatchObject({
      id: "reaction:3489565",
      kind: "reaction",
      source: "reactions",
      username: "misaka7369",
      targetUsername: "lafish",
      reactionValue: "hugs",
      postNumber: 412,
      excerpt: "咱准备专门开发一个奸视插件"
    });
  });

  it("normalizes avatars and text safely", () => {
    expect(avatarUrlFromTemplate("/letter_avatar/ada/{size}/5.png")).toBe("https://linux.do/letter_avatar/ada/48/5.png");
    expect(avatarUrlFromTemplate("//cdn.example/avatar/{size}.png")).toBe("https://cdn.example/avatar/48.png");
    expect(plainTextFromHtmlish("<p>hello&nbsp;<strong>world</strong>&hellip;</p>")).toBe("hello world...");
  });

  it("sorts mixed feed items by time desc and stable id asc", () => {
    const items: ActivityItem[] = [
      { id: "reaction:2", username: "a", kind: "reaction", title: "b", occurredAt: "2026-06-27T00:00:00.000Z" },
      { id: "boost:1", username: "a", kind: "boost", title: "a", occurredAt: "2026-06-27T00:00:00.000Z" },
      { id: "user_action:1", username: "a", kind: "reply", title: "c", occurredAt: "2026-06-28T00:00:00.000Z" }
    ];

    expect(sortActivityItems(items).map((item) => item.id)).toEqual(["user_action:1", "boost:1", "reaction:2"]);
  });

  it("normalizes all sources into one friend summary", () => {
    const summary = normalizeFriendActivity("Misaka7369", {
      userActions: [{ action_type: 4, topic_id: 1, post_number: 1, created_at: "2026-06-25T00:00:00.000Z", title: "topic" }],
      boosts: [{ id: 2, created_at: "2026-06-26T00:00:00.000Z", user: { username: "Misaka7369" }, post: { topic_title: "boosted" } }],
      reactions: [
        {
          id: 3,
          created_at: "2026-06-27T00:00:00.000Z",
          user: { username: "Misaka7369" },
          post: { topic_title: "reacted" },
          reaction: { reaction_value: "hugs" }
        }
      ]
    });

    expect(summary.username).toBe("misaka7369");
    expect(summary.items.map((item) => item.kind)).toEqual(["reaction", "boost", "topic"]);
    expect(summary.lastPostAt).toBe("2026-06-27T00:00:00.000Z");
  });
});
