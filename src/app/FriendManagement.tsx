import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, LoaderCircle, Search } from "lucide-react";
import { ALL_ACTIVITY_KINDS, normalizeUsername } from "../domain/friends";
import type { BackgroundResponse, FollowedUserInput, FriendProfileSummary, ActivityRefreshKind, Username } from "../shared/types";
import type { deriveFollowedCandidates, deriveFriendList } from "../popup/selectors";
import {
  filterFriendCandidates,
  identityForFollowedUser,
  mergeFriendCandidates,
  orderFollowedCandidates,
  syntheticFriendCandidate
} from "../popup/selectors";
import { eventHappenedInside } from "./activityLinks";
import { kindIcon, kindText } from "./activityKinds";
import { UserIdentityRow } from "./UserIdentityRow";

export function ActivityScopeSelect({
  disabled,
  onChange,
  value
}: {
  disabled: boolean;
  onChange: (activityKinds: ActivityRefreshKind[]) => void;
  value: ActivityRefreshKind[];
}) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const selectedKinds = useMemo(() => ALL_ACTIVITY_KINDS.filter((kind) => value.includes(kind)), [value]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (popoverRef.current && !eventHappenedInside(event, popoverRef.current)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function toggleKind(kind: ActivityRefreshKind) {
    if (selectedKinds.includes(kind)) {
      onChange(selectedKinds.filter((item) => item !== kind));
      return;
    }
    onChange(ALL_ACTIVITY_KINDS.filter((item) => item === kind || selectedKinds.includes(item)));
  }

  const triggerLabel = `视奸范围：${scopeSummary(selectedKinds)}`;

  return (
    <div className="scope-select" ref={popoverRef}>
      <button
        className="scope-select-trigger"
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={triggerLabel}
        title={triggerLabel}
      >
        <span className={`scope-trigger-card is-count-${selectedKinds.length}${selectedKinds.length === 0 ? " is-empty" : ""}`} aria-hidden="true">
          {selectedKinds.length === 0 ? (
            <span className="scope-trigger-empty">无</span>
          ) : (
            selectedKinds.map((kind) => (
              <span className={`scope-trigger-icon kind-${kind}`} key={kind}>
                {kindIcon(kind, 13)}
              </span>
            ))
          )}
        </span>
        <ChevronDown className="scope-trigger-arrow" size={12} aria-hidden="true" />
      </button>
      {open ? (
        <div className="scope-select-menu">
          <div className="scope-select-actions">
            <button type="button" onClick={() => onChange(ALL_ACTIVITY_KINDS)}>
              全选
            </button>
            <button type="button" onClick={() => onChange([])}>
              全不选
            </button>
          </div>
          {ALL_ACTIVITY_KINDS.map((kind) => {
            const selected = selectedKinds.includes(kind);
            return (
              <button className={selected ? "selected" : ""} key={kind} type="button" onClick={() => toggleKind(kind)}>
                <span className={`filter-option-icon kind-${kind}`}>{kindIcon(kind)}</span>
                <span>{kindText(kind)}</span>
                {selected ? <Check size={13} aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function scopeSummary(kinds: ActivityRefreshKind[]) {
  if (kinds.length === ALL_ACTIVITY_KINDS.length) return "全部";
  if (kinds.length === 0) return "无";
  return kinds.map(kindText).join(" / ");
}

export function FriendCandidateList({
  candidates,
  emptyText = "没有匹配项。输入完整用户名后先查找用户。",
  friends,
  loading,
  mode,
  onAdd,
  onLookup,
  onRemove,
  onUpdateScope,
  query
}: {
  candidates: ReturnType<typeof deriveFollowedCandidates>;
  emptyText?: string;
  friends: ReturnType<typeof deriveFriendList>;
  loading: boolean;
  mode: "light" | "full";
  onAdd: (user: FollowedUserInput, profile?: FriendProfileSummary) => void;
  onLookup: (username: Username) => Promise<BackgroundResponse<FriendProfileSummary>>;
  onRemove?: (username: Username) => void;
  onUpdateScope?: (username: Username, activityKinds: ActivityRefreshKind[]) => void;
  query: string;
}) {
  const [lookupProfiles, setLookupProfiles] = useState<Record<Username, FriendProfileSummary>>({});
  const [lookupErrors, setLookupErrors] = useState<Record<Username, string>>({});
  const [lookupPending, setLookupPending] = useState<Username | null>(null);
  const baseCandidates = useMemo(() => mergeFriendCandidates(friends, candidates), [candidates, friends]);
  const [snapshotOrder] = useState(() => baseCandidates.map((candidate) => candidate.user.username));
  const orderedCandidates = useMemo(() => orderFollowedCandidates(baseCandidates, snapshotOrder), [baseCandidates, snapshotOrder]);
  const filteredCandidates = useMemo(() => filterFriendCandidates(orderedCandidates, query), [orderedCandidates, query]);
  const syntheticCandidate = useMemo(() => {
    const candidate = syntheticFriendCandidate(friends, orderedCandidates, query);
    if (!candidate) return null;
    const profile = lookupProfiles[candidate.user.username];
    if (!profile) return candidate;
    const username = normalizeUsername(profile.username);
    return {
      user: {
        username,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
        source: "manual" as const,
        followedAt: "",
        updatedAt: profile.refreshedAt
      },
      identity: identityForFollowedUser(profile),
      isFriend: friends.some((item) => item.friend.username === username),
      isSynthetic: true
    };
  }, [friends, lookupProfiles, orderedCandidates, query]);
  const visibleCandidates = syntheticCandidate ? [syntheticCandidate, ...filteredCandidates] : filteredCandidates;
  const actionDisabled = loading || lookupPending != null;

  async function handleLookup(usernameInput: Username) {
    const username = normalizeUsername(usernameInput);
    if (!username || lookupPending) return;
    setLookupPending(username);
    setLookupErrors((current) => omitKey(current, username));
    const response = await onLookup(username);
    setLookupPending(null);
    if (response.ok) {
      const resolvedUsername = normalizeUsername(response.data.username);
      const profile = { ...response.data, username: resolvedUsername };
      setLookupProfiles((current) => ({
        ...current,
        [username]: profile,
        [resolvedUsername]: profile
      }));
      setLookupErrors((current) => omitKeys(current, [username, resolvedUsername]));
    } else {
      setLookupErrors((current) => ({
        ...current,
        [username]: response.error || "用户不存在或公开资料不可用。"
      }));
    }
  }

  if (visibleCandidates.length === 0) {
    return <p className="empty">{emptyText}</p>;
  }

  return (
    <div className="list modal-list">
      {visibleCandidates.map((candidate) => (
        <div className="candidate-row" key={candidate.user.username}>
          <UserIdentityRow identity={candidate.identity} />
          <CandidateAction
            candidate={candidate}
            disabled={actionDisabled}
            lookupError={lookupErrors[candidate.user.username]}
            lookupPending={lookupPending === candidate.user.username}
            lookupVerified={Boolean(lookupProfiles[candidate.user.username])}
            mode={mode}
            onAdd={(user) => onAdd(user, lookupProfiles[user.username])}
            onLookup={handleLookup}
            onRemove={onRemove}
            onUpdateScope={onUpdateScope}
            scope={friends.find((item) => item.friend.username === candidate.user.username)?.friend.activityKinds}
          />
        </div>
      ))}
    </div>
  );
}

function CandidateAction({
  candidate,
  disabled,
  lookupError,
  lookupPending,
  lookupVerified,
  mode,
  onAdd,
  onLookup,
  onRemove,
  onUpdateScope,
  scope
}: {
  candidate: ReturnType<typeof mergeFriendCandidates>[number];
  disabled: boolean;
  lookupError?: string;
  lookupPending: boolean;
  lookupVerified: boolean;
  mode: "light" | "full";
  onAdd: (user: FollowedUserInput) => void;
  onLookup: (username: Username) => void;
  onRemove?: (username: Username) => void;
  onUpdateScope?: (username: Username, activityKinds: ActivityRefreshKind[]) => void;
  scope?: ActivityRefreshKind[];
}) {
  if (candidate.isFriend) {
    if (mode === "light") {
      return (
        <div className="candidate-manage-actions">
          <button className="candidate-action-remove" onClick={() => onRemove?.(candidate.user.username)} disabled={disabled} type="button">
            移除
          </button>
        </div>
      );
    }
    return (
      <div className="candidate-manage-actions">
        <ActivityScopeSelect
          disabled={disabled}
          value={scope ?? ALL_ACTIVITY_KINDS}
          onChange={(activityKinds) => onUpdateScope?.(candidate.user.username, activityKinds)}
        />
        <button className="candidate-action-remove" onClick={() => onRemove?.(candidate.user.username)} disabled={disabled} type="button">
          移除
        </button>
      </div>
    );
  }

  if (candidate.isSynthetic && !lookupVerified) {
    if (lookupError) {
      return (
        <span className="candidate-lookup-status" title={lookupError}>
          {lookupError}
        </span>
      );
    }
    return (
      <button className="candidate-action-lookup" onClick={() => onLookup(candidate.user.username)} disabled={disabled} type="button">
        {lookupPending ? <LoaderCircle className="spin-icon" size={13} aria-hidden="true" /> : <Search size={13} aria-hidden="true" />}
        {lookupPending ? "查找中" : "查找用户"}
      </button>
    );
  }

  return (
    <button className="candidate-action-add" onClick={() => onAdd(candidate.user)} disabled={disabled} type="button">
      视奸 ta
    </button>
  );
}

function omitKey<T>(record: Record<Username, T>, key: Username): Record<Username, T> {
  const { [key]: _removed, ...rest } = record;
  return rest;
}

function omitKeys<T>(record: Record<Username, T>, keys: Username[]): Record<Username, T> {
  let next = record;
  for (const key of keys) {
    next = omitKey(next, key);
  }
  return next;
}
