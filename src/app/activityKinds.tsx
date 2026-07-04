import React from "react";
import { Heart, List, MessageCircleReply, Rocket, Smile, Users } from "lucide-react";
import type { ActivityItem } from "../shared/types";

export function kindText(kind: ActivityItem["kind"]) {
  if (kind === "topic") return "话题";
  if (kind === "reply") return "回复";
  if (kind === "boost") return "Boost";
  if (kind === "reaction") return "回应";
  if (kind === "like") return "点赞";
  return "动态";
}

export function kindIcon(kind: ActivityItem["kind"], size = 15) {
  if (kind === "topic") return <List size={size} aria-hidden="true" />;
  if (kind === "reply") return <MessageCircleReply size={size} aria-hidden="true" />;
  if (kind === "boost") return <Rocket size={size} aria-hidden="true" />;
  if (kind === "reaction") return <Smile size={size} aria-hidden="true" />;
  if (kind === "like") return <Heart size={size} aria-hidden="true" />;
  return <Users size={size} aria-hidden="true" />;
}
