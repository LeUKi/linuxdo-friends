import {
  extractBoosts,
  extractReactions,
  extractUserActions,
  normalizeBoost,
  normalizeReaction,
  normalizeUserAction,
  sortActivityItems
} from "../domain/activity";
import {
  activityKindsForRequestKind,
  applyScopedActivityRefresh,
  clearActivityNewFlags,
  latestActivityRefreshAt,
  normalizeActivityRefreshScope,
  normalizeRefreshTargets,
  planActivityRefreshTargets,
  type ActivityRequestStep
} from "../domain/activityRefresh";
import { addFriendFromProfile, normalizeUsername, upsertFollowedUser, upsertFriendProfile } from "../domain/friends";
import { collectLaoFindsItems } from "../domain/laoFinds";
import { nowIso } from "../shared/time";
import type {
  ActivityItem,
  ActivityRefreshScope,
  AppState,
  FriendProfileSummary,
  RefreshFailureResult,
  RefreshResult,
  RequestStatsFamily,
  RefreshSource,
  Username
} from "../shared/types";
import { extractFollowedUsers } from "./followingParser";
import { extractFriendProfile } from "./profileParser";
import { classifyFetchResponse } from "./responseClassifier";

type SafeFetchResult = { ok: true; json: unknown } | { ok: false; result: RefreshFailureResult };
type LoginProbeResult = { ok: true; username: Username } | { ok: false; result: RefreshFailureResult };
export type ActivityProgressCallback = (step: ActivityRequestStep) => void;
export type ProfileProgressCallback = (username: Username) => void;
export type LinuxDoRequestAttemptCallback = (family: RequestStatsFamily, url: string) => void;
type CollectedActivityTarget = {
  username: Username;
  items: ActivityItem[];
  refreshedKinds: ReturnType<typeof activityKindsForRequestKind>;
};

export interface RefreshAdapter {
  identifyCurrentAccount(state: AppState): Promise<{ state: AppState; result: RefreshResult }>;
  syncFollowedUsers(state: AppState): Promise<{ state: AppState; result: RefreshResult }>;
  lookupFriendProfile(username: Username): Promise<FriendProfileFetchResult>;
  addFriendByProfile(state: AppState, username: Username): Promise<{ state: AppState; result: RefreshResult }>;
  refreshFriendProfiles(
    state: AppState,
    usernames?: Username[],
    onProgress?: ProfileProgressCallback
  ): Promise<{ state: AppState; result: RefreshResult }>;
  refreshFriendActivity(
    state: AppState,
    scope?: ActivityRefreshScope,
    onProgress?: ActivityProgressCallback
  ): Promise<{ state: AppState; result: RefreshResult }>;
}

export function createRefreshAdapter(fetchImpl: typeof fetch = fetch, onRequestAttempt?: LinuxDoRequestAttemptCallback): RefreshAdapter {
  return {
    async identifyCurrentAccount(state) {
      const login = await probeCurrentAccount(fetchImpl, onRequestAttempt, "account");
      if (!login.ok) {
        return { state, result: login.result };
      }
      return {
        state: {
          ...state,
          currentAccount: { username: login.username, verifiedAt: nowIso(), source: "latest_header" }
        },
        result: {
          ok: true,
          source: "direct_fetch",
          message: `已识别 @${login.username}。`,
          refreshedAt: nowIso()
        }
      };
    },
    async syncFollowedUsers(state) {
      const login = await probeCurrentAccount(fetchImpl, onRequestAttempt, "following");
      if (!login.ok) {
        return { state, result: login.result };
      }
      const response = await safeFetch(fetchImpl, `/u/${encodeURIComponent(login.username)}/follow/following.json`, "direct_fetch", "following", onRequestAttempt);
      if (!response.ok) {
        return {
          state: {
            ...state,
            currentAccount: { username: login.username, verifiedAt: nowIso(), source: "latest_header" }
          },
          result: response.result
        };
      }
      const followedUsers = extractFollowedUsers(response.json);
      let nextState: AppState = {
        ...state,
        currentAccount: { username: login.username, verifiedAt: nowIso(), source: "latest_header" }
      };
      for (const user of followedUsers) {
        nextState = upsertFollowedUser(nextState, { ...user, source: "sync" });
      }
      return {
        state: nextState,
        result: {
          ok: true,
          source: "direct_fetch",
          message: `已识别 @${login.username}，同步 ${followedUsers.length} 位关注用户。`,
          refreshedAt: nowIso()
        }
      };
    },
    lookupFriendProfile(username) {
      return fetchFriendProfile(fetchImpl, username, onRequestAttempt);
    },
    async addFriendByProfile(state, username) {
      const profileResult = await fetchFriendProfile(fetchImpl, username, onRequestAttempt);
      if (!profileResult.ok) return { state, result: profileResult.result };
      return {
        state: addFriendFromProfile(state, profileResult.profile),
        result: {
          ok: true,
          source: "direct_fetch",
          message: `已添加 @${profileResult.profile.username} 为佬朋友。`,
          refreshedAt: nowIso()
        }
      };
    },
    async refreshFriendProfiles(state, usernames, onProgress) {
      const targets = normalizeRefreshTargets(state, usernames);
      let nextState = state;
      let refreshedCount = 0;
      for (const username of targets) {
        const profileResult = await fetchFriendProfile(fetchImpl, username, onRequestAttempt);
        if (!profileResult.ok) return { state: nextState, result: profileResult.result };
        nextState = upsertFriendProfile(nextState, profileResult.profile);
        refreshedCount += 1;
        onProgress?.(username);
      }
      return {
        state: nextState,
        result: {
          ok: true,
          source: "direct_fetch",
          message: `已刷新 ${refreshedCount} 位佬朋友状态。`,
          refreshedAt: nowIso()
        }
      };
    },
    async refreshFriendActivity(state, scope, onProgress) {
      const normalizedScope = normalizeActivityRefreshScope(scope);
      const targets = planActivityRefreshTargets(state, normalizedScope);
      if (targets.length === 0) {
        return {
          state,
          result: {
            ok: true,
            source: "direct_fetch",
            message: "当前视奸范围没有可刷新的动态。",
            refreshedAt: nowIso()
          }
        };
      }
      const collectedTargets: CollectedActivityTarget[] = [];
      const feedWaterlineAt = latestActivityRefreshAt(state);
      for (const target of targets) {
        const items: ActivityItem[] = [];
        for (const step of target.steps) {
          const stepResult = await fetchFriendActivityStep(fetchImpl, step, onRequestAttempt);
          if (!stepResult.ok) return { state, result: stepResult.result };
          items.push(...stepResult.items);
          onProgress?.(step);
        }
        collectedTargets.push({ username: target.username, items: sortActivityItems(items), refreshedKinds: target.refreshedKinds });
      }
      let nextState = collectedTargets.length ? clearActivityNewFlags(state) : state;
      for (const target of collectedTargets) {
        nextState = applyScopedActivityRefresh(
          nextState,
          target.username,
          target.items,
          target.refreshedKinds,
          "direct_fetch",
          undefined,
          { clearExistingNew: false, feedWaterlineAt }
        );
      }
      const refreshedAt = nowIso();
      const collected = collectLaoFindsItems(nextState, collectedTargets.flatMap((target) => target.items), refreshedAt);
      return {
        state: collected.state,
        result: { ok: true, source: "direct_fetch", message: "好友动态已刷新。", refreshedAt }
      };
    }
  };
}

export type FriendProfileFetchResult =
  | { ok: true; profile: FriendProfileSummary }
  | { ok: false; result: RefreshFailureResult };

async function fetchFriendProfile(
  fetchImpl: typeof fetch,
  usernameInput: Username,
  onRequestAttempt?: LinuxDoRequestAttemptCallback
): Promise<FriendProfileFetchResult> {
  const username = normalizeUsername(usernameInput);
  if (!username) {
    return { ok: false, result: failure("direct_fetch", "invalid_response", "缺少要添加的用户名。") };
  }
  const profile = await safeFetch(fetchImpl, `/u/${encodeURIComponent(username)}.json`, "direct_fetch", "profile", onRequestAttempt);
  if (!profile.ok) {
    if (profile.result.reason === "network_error" && profile.result.message === "请求失败：404") {
      return { ok: false, result: failure("direct_fetch", "invalid_response", "用户不存在或公开资料不可用。") };
    }
    return { ok: false, result: profile.result };
  }
  try {
    return { ok: true, profile: extractFriendProfile(profile.json) };
  } catch {
    return { ok: false, result: failure("direct_fetch", "invalid_response", "linux.do 返回的用户资料格式不完整。") };
  }
}

type FriendActivityFetchResult =
  | { ok: true; items: ActivityItem[] }
  | { ok: false; result: RefreshResult };

async function fetchFriendActivityStep(
  fetchImpl: typeof fetch,
  step: ActivityRequestStep,
  onRequestAttempt?: LinuxDoRequestAttemptCallback
): Promise<FriendActivityFetchResult> {
  const response = await safeFetch(fetchImpl, step.path, "direct_fetch", "activity", onRequestAttempt);
  if (!response.ok) return { ok: false, result: response.result };
  const items = activityKindsForRequestKind(step.kind).flatMap((kind) => {
    if (kind === "topic" || kind === "reply" || kind === "like") {
      return extractUserActions(response.json)
        .map((action) => normalizeUserAction(step.username, action))
        .filter((item): item is ActivityItem => item !== undefined && item.kind === kind);
    }
    if (kind === "boost") return extractBoosts(response.json).map(normalizeBoost);
    return extractReactions(response.json).map(normalizeReaction);
  });
  return { ok: true, items };
}

async function safeFetch(
  fetchImpl: typeof fetch,
  path: string,
  source: RefreshSource,
  family: RequestStatsFamily,
  onRequestAttempt?: LinuxDoRequestAttemptCallback
): Promise<SafeFetchResult> {
  const url = `https://linux.do${path}`;
  onRequestAttempt?.(family, url);
  try {
    const response = await fetchImpl(url, {
      credentials: "include",
      headers: { Accept: "application/json" }
    });
    const classified = await classifyFetchResponse(response);
    if (!classified.ok) {
      return { ok: false, result: failure(source, classified.reason, classified.message) };
    }
    return { ok: true as const, json: classified.json };
  } catch {
    return { ok: false, result: failure(source, "network_error", "网络请求失败，已停止本轮刷新。") };
  }
}

async function probeCurrentAccount(
  fetchImpl: typeof fetch,
  onRequestAttempt: LinuxDoRequestAttemptCallback | undefined,
  family: RequestStatsFamily
): Promise<LoginProbeResult> {
  const url = "https://linux.do/latest.json";
  onRequestAttempt?.(family, url);
  try {
    const response = await fetchImpl(url, {
      credentials: "include",
      headers: { Accept: "application/json" }
    });
    const classified = await classifyFetchResponse(response.clone());
    if (!classified.ok) {
      return { ok: false, result: failure("direct_fetch", classified.reason, classified.message) };
    }
    const username = response.headers.get("x-discourse-username");
    if (!username) {
      return { ok: false, result: failure("direct_fetch", "unavailable", "没有识别到 linux.do 登录账号，请先在浏览器里登录。") };
    }
    return { ok: true, username: normalizeUsername(username) };
  } catch {
    return { ok: false, result: failure("direct_fetch", "network_error", "登录态验证请求失败，已停止同步。") };
  }
}

function failure(source: RefreshSource, reason: RefreshFailureResult["reason"], message: string): RefreshFailureResult {
  return { ok: false, source, reason, message, refreshedAt: nowIso() };
}
