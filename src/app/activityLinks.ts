import type React from "react";
import type { Username } from "../shared/types";

export function eventHappenedInside(event: Event, element: HTMLElement) {
  const path = event.composedPath();
  if (path.length > 0) {
    return path.includes(element);
  }
  return element.contains(event.target as Node | null);
}

export function shouldHandleActivityLinkClick(event: React.MouseEvent<HTMLAnchorElement>) {
  return event.button === 0 && !event.defaultPrevented && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export function isLinuxDoActivityHref(href: string) {
  try {
    const url = new URL(href, "https://linux.do");
    return url.protocol === "https:" && url.hostname === "linux.do";
  } catch {
    return false;
  }
}

export function absoluteLinuxDoUrl(url?: string) {
  if (!url) return "https://linux.do/";
  try {
    return new URL(url, "https://linux.do").toString();
  } catch {
    return "https://linux.do/";
  }
}

export function profileUrl(username: Username) {
  return `https://linux.do/u/${encodeURIComponent(username)}`;
}
