import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { createPortal } from "react-dom";
import { friendNoteLength, MAX_FRIEND_NOTE_LENGTH, normalizeFriendNoteInput } from "../domain/friendNote";
import type { Username } from "../shared/types";

export type FriendNoteSurface = "side-panel" | "settings" | "user-card" | "profile" | "post";

export interface FriendNoteSaveResult {
  ok: boolean;
  error?: string;
}

interface TooltipPosition {
  left: number;
  top: number;
  placement: "top" | "bottom";
}

export function friendNoteTooltipPosition(
  trigger: Pick<DOMRect, "left" | "right" | "top" | "bottom">,
  tooltip: { width: number; height: number },
  viewport: { width: number; height: number }
): TooltipPosition {
  const margin = 12;
  const gap = 8;
  const preferredTop = trigger.top - tooltip.height - gap;
  const placement = preferredTop >= margin ? "top" : "bottom";
  const rawTop = placement === "top" ? preferredTop : trigger.bottom + gap;
  const top = Math.min(Math.max(margin, rawTop), Math.max(margin, viewport.height - tooltip.height - margin));
  const centeredLeft = (trigger.left + trigger.right - tooltip.width) / 2;
  const left = Math.min(Math.max(margin, centeredLeft), Math.max(margin, viewport.width - tooltip.width - margin));
  return { left, top, placement };
}

export function FriendNotePreview({
  className,
  note,
  surface,
  tooltipPortalTarget
}: {
  className?: string;
  note: string;
  surface: FriendNoteSurface;
  tooltipPortalTarget?: Element | DocumentFragment;
}) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();
  const [overflowing, setOverflowing] = useState(false);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<TooltipPosition>({ left: 12, top: 12, placement: "top" });

  const measureOverflow = useCallback(() => {
    const trigger = triggerRef.current;
    const nextOverflowing = Boolean(trigger && trigger.scrollWidth > trigger.clientWidth);
    setOverflowing(nextOverflowing);
    if (!nextOverflowing) setVisible(false);
    return nextOverflowing;
  }, []);

  const placeTooltip = useCallback(() => {
    const trigger = triggerRef.current;
    const tooltip = tooltipRef.current;
    if (!trigger || !tooltip) return;
    setPosition(
      friendNoteTooltipPosition(
        trigger.getBoundingClientRect(),
        { width: tooltip.offsetWidth, height: tooltip.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight }
      )
    );
  }, []);

  useLayoutEffect(() => {
    measureOverflow();
    const trigger = triggerRef.current;
    if (!trigger || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measureOverflow);
    observer.observe(trigger);
    return () => observer.disconnect();
  }, [measureOverflow, note, surface]);

  useLayoutEffect(() => {
    if (visible) placeTooltip();
  }, [placeTooltip, visible]);

  useEffect(() => {
    if (!visible) return undefined;
    function dismiss(event: Event) {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event.type === "pointerdown" && eventHappenedInside(event, triggerRef.current)) return;
      setVisible(false);
    }
    window.addEventListener("resize", placeTooltip);
    window.addEventListener("scroll", placeTooltip, true);
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("keydown", dismiss, true);
    return () => {
      window.removeEventListener("resize", placeTooltip);
      window.removeEventListener("scroll", placeTooltip, true);
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("keydown", dismiss, true);
    };
  }, [placeTooltip, visible]);

  function showIfOverflowing() {
    if (measureOverflow()) setVisible(true);
  }

  function togglePreview(event: React.MouseEvent) {
    if (!measureOverflow()) return;
    event.preventDefault();
    event.stopPropagation();
    setVisible((current) => !current);
  }

  const root = triggerRef.current?.getRootNode();
  const portalTarget = tooltipPortalTarget ?? (typeof ShadowRoot !== "undefined" && root instanceof ShadowRoot ? root : document.body);

  return (
    <>
      <span
        className={`friend-note-preview friend-note-preview-${surface}${className ? ` ${className}` : ""}`}
        ref={triggerRef}
        tabIndex={overflowing ? 0 : undefined}
        aria-describedby={visible ? tooltipId : undefined}
        onBlur={() => setVisible(false)}
        onClick={togglePreview}
        onFocus={showIfOverflowing}
        onMouseEnter={showIfOverflowing}
        onMouseLeave={() => setVisible(false)}
      >
        {note}
      </span>
      {visible && portalTarget
        ? createPortal(
            <span
              className="friend-note-tooltip"
              data-placement={position.placement}
              id={tooltipId}
              ref={tooltipRef}
              role="tooltip"
              style={{ left: position.left, top: position.top }}
            >
              {note}
            </span>,
            portalTarget
          )
        : null}
    </>
  );
}

function eventHappenedInside(event: Event, element: HTMLElement | null): boolean {
  if (!element) return false;
  const path = typeof event.composedPath === "function" ? event.composedPath() : [];
  if (path.includes(element)) return true;
  return event.target instanceof Node && element.contains(event.target);
}

export function FriendNoteDialog({
  initialNote,
  onClose,
  onSave,
  username
}: {
  initialNote: string;
  onClose: () => void;
  onSave: (note: string) => Promise<FriendNoteSaveResult>;
  username: Username;
}) {
  const inputId = useId();
  const helpId = useId();
  const [draft, setDraft] = useState(initialNote);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const normalized = normalizeFriendNoteInput(draft);
  const length = friendNoteLength(normalized);
  const overLimit = length > MAX_FRIEND_NOTE_LENGTH;

  useEffect(() => {
    setDraft(initialNote);
    setError(null);
  }, [initialNote, username]);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) onClose();
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose, saving]);

  async function save() {
    if (saving || overLimit) return;
    setSaving(true);
    setError(null);
    const result = await onSave(normalized);
    setSaving(false);
    if (result.ok) {
      onClose();
      return;
    }
    setError(result.error ?? "备注保存失败。");
  }

  return (
    <div className="modal-backdrop friend-note-backdrop" role="presentation" onClick={() => !saving && onClose()}>
      <section
        className="modal friend-note-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${inputId}-title`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h2 id={`${inputId}-title`}>编辑备注</h2>
            <p className="friend-note-dialog-user">@{username}</p>
          </div>
          <button className="icon-button" type="button" disabled={saving} onClick={onClose} aria-label="关闭备注编辑">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <label className="friend-note-field" htmlFor={inputId}>
          <span>备注</span>
          <input
            id={inputId}
            value={draft}
            autoFocus
            autoComplete="off"
            aria-describedby={helpId}
            aria-invalid={overLimit || Boolean(error)}
            disabled={saving}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void save();
              }
            }}
            placeholder="例如：上次聊过 NAS"
          />
        </label>
        <div className="friend-note-field-meta" id={helpId}>
          <span className={overLimit ? "is-error" : undefined}>{length}/{MAX_FRIEND_NOTE_LENGTH}</span>
          <span>留空保存即可清除</span>
        </div>
        {error ? <p className="friend-note-dialog-error" role="alert">{error}</p> : null}
        <div className="friend-note-dialog-actions">
          <button className="primary-action" type="button" disabled={saving || overLimit} onClick={() => void save()}>
            {saving ? "保存中" : "保存"}
          </button>
          <button className="small-action" type="button" disabled={saving} onClick={onClose}>
            取消
          </button>
        </div>
      </section>
    </div>
  );
}
