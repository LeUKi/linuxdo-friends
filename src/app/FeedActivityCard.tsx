import type React from "react";
import { ExternalLink } from "lucide-react";
import { formatRelativeTime } from "../shared/time";
import type { ActivityItem } from "../shared/types";
import { identityForActivityItem } from "../popup/selectors";
import { kindIcon, kindText } from "./activityKinds";
import { absoluteLinuxDoUrl } from "./activityLinks";
import { UserIdentityRow } from "./UserIdentityRow";

export function FeedActivityCard({
  item,
  now,
  onOpenActivityLink,
  state
}: {
  item: ActivityItem;
  now: number;
  onOpenActivityLink: (event: React.MouseEvent<HTMLAnchorElement>, href: string) => void;
  state: Parameters<typeof identityForActivityItem>[0];
}) {
  return (
    <article className="feed-card">
      <div className="feed-head">
        <UserIdentityRow identity={identityForActivityItem(state, item)} compact />
        <div className="feed-time">
          {item.isNew ? <span className="new-dot" aria-label="新动态" /> : null}
          <time dateTime={item.occurredAt}>{formatRelativeTime(item.occurredAt, now)}</time>
        </div>
      </div>
      <ActivityCardBody item={item} onOpenActivityLink={onOpenActivityLink} />
    </article>
  );
}

export function FeedWaterline({ onBackToTop }: { onBackToTop: () => void }) {
  return (
    <div className="feed-waterline" role="separator">
      <span>-- 上次更新到此为止，</span>
      <button type="button" onClick={onBackToTop}>
        点我回到顶部
      </button>
      <span> --</span>
    </div>
  );
}

export function ActivityCardBody({
  item,
  onOpenActivityLink
}: {
  item: ActivityItem;
  onOpenActivityLink: (event: React.MouseEvent<HTMLAnchorElement>, href: string) => void;
}) {
  const title = item.topicTitle || item.title;
  const href = absoluteLinuxDoUrl(item.url);
  const kindCard = <ActivityKindCard href={href} item={item} onOpenActivityLink={onOpenActivityLink} />;
  if (item.kind === "boost") {
    return (
      <div className="feed-main">
        {kindCard}
        <div className="feed-primary-block">
          <p className="feed-primary">{item.boostText || "Boost 了帖子"}</p>
          <a className="feed-context-link" href={href} target="_blank" rel="noreferrer" onClick={(event) => onOpenActivityLink(event, href)}>
            <ExternalText text={title} />
          </a>
          {item.excerpt ? <p className="feed-excerpt">{item.excerpt}</p> : null}
        </div>
      </div>
    );
  }
  if (item.kind === "reaction") {
    return (
      <div className="feed-main">
        {kindCard}
        <div className="feed-primary-block">
          <p className="feed-primary">{item.reactionValue ? `回应了 ${item.reactionValue}` : "回应了帖子"}</p>
          <a className="feed-context-link" href={href} target="_blank" rel="noreferrer" onClick={(event) => onOpenActivityLink(event, href)}>
            <ExternalText text={title} />
          </a>
          {item.excerpt ? <p className="feed-excerpt">{item.excerpt}</p> : null}
        </div>
      </div>
    );
  }
  if (item.kind === "reply") {
    return (
      <div className="feed-main">
        {kindCard}
        <div className="feed-primary-block">
          {item.excerpt ? <p className="feed-primary">{item.excerpt}</p> : <p className="feed-primary">回复了话题</p>}
          <a className="feed-context-link" href={href} target="_blank" rel="noreferrer" onClick={(event) => onOpenActivityLink(event, href)}>
            <ExternalText text={title} />
          </a>
        </div>
      </div>
    );
  }
  return (
    <div className="feed-main">
      {kindCard}
      <div className="feed-primary-block">
        <a className="feed-title" href={href} target="_blank" rel="noreferrer" onClick={(event) => onOpenActivityLink(event, href)}>
          <ExternalText text={title} />
        </a>
        {item.excerpt ? <p className="feed-excerpt">{item.excerpt}</p> : null}
      </div>
    </div>
  );
}

function ActivityKindCard({
  href,
  item,
  onOpenActivityLink
}: {
  href: string;
  item: ActivityItem;
  onOpenActivityLink: (event: React.MouseEvent<HTMLAnchorElement>, href: string) => void;
}) {
  return (
    <a
      className={`kind-card kind-${item.kind}`}
      href={href}
      target="_blank"
      rel="noreferrer"
      title={`打开${kindText(item.kind)}动态`}
      onClick={(event) => onOpenActivityLink(event, href)}
    >
      <span className="kind-card-icon">{kindIcon(item.kind, 15)}</span>
      <span className="kind-card-label">{kindText(item.kind)}</span>
      {item.kind === "reply" && item.replyToPostNumber ? <span className="kind-card-floor">#{item.replyToPostNumber}</span> : null}
      <span className="kind-card-link">
        <ExternalLink size={12} aria-hidden="true" />
      </span>
    </a>
  );
}

function ExternalText({ text }: { text: string }) {
  return (
    <span className="external-text">
      <span>{text}</span>
      <ExternalLink size={12} aria-hidden="true" />
    </span>
  );
}
