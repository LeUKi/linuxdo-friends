import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Pencil, X } from "lucide-react";
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

function useFriendNoteTooltip<T extends HTMLElement>({
  enabled,
  note,
  tooltipPortalTarget,
  triggerRef
}: {
  enabled: boolean;
  note: string;
  tooltipPortalTarget?: Element | DocumentFragment;
  triggerRef: React.RefObject<T | null>;
}) {
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<TooltipPosition>({ left: 12, top: 12, placement: "top" });
  const hide = useCallback(() => setVisible(false), []);
  const show = useCallback(() => setVisible(true), []);
  const toggle = useCallback(() => setVisible((current) => !current), []);
  const tooltipVisible = visible && enabled;

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
  }, [triggerRef]);

  useLayoutEffect(() => {
    if (tooltipVisible) placeTooltip();
  }, [note, placeTooltip, tooltipVisible]);

  useEffect(() => {
    if (!enabled) setVisible(false);
  }, [enabled, note]);

  useEffect(() => {
    if (!tooltipVisible) return undefined;
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
  }, [placeTooltip, tooltipVisible, triggerRef]);

  const root = triggerRef.current?.getRootNode();
  const portalTarget = tooltipPortalTarget ?? (typeof ShadowRoot !== "undefined" && root instanceof ShadowRoot ? root : document.body);

  return {
    hide,
    show,
    toggle,
    tooltipId,
    visible: tooltipVisible,
    tooltip:
      tooltipVisible && portalTarget
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
        : null
  };
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
  const [overflowing, setOverflowing] = useState(false);
  const tooltip = useFriendNoteTooltip({ enabled: overflowing, note, tooltipPortalTarget, triggerRef });
  const hideTooltip = tooltip.hide;

  const measureOverflow = useCallback(() => {
    const trigger = triggerRef.current;
    const nextOverflowing = Boolean(trigger && trigger.scrollWidth > trigger.clientWidth);
    setOverflowing(nextOverflowing);
    if (!nextOverflowing) hideTooltip();
    return nextOverflowing;
  }, [hideTooltip]);

  useLayoutEffect(() => {
    measureOverflow();
    const trigger = triggerRef.current;
    if (!trigger || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measureOverflow);
    observer.observe(trigger);
    return () => observer.disconnect();
  }, [measureOverflow, note, surface]);

  function showIfOverflowing() {
    if (measureOverflow()) tooltip.show();
  }

  function togglePreview(event: React.MouseEvent) {
    if (!measureOverflow()) return;
    event.preventDefault();
    event.stopPropagation();
    tooltip.toggle();
  }

  return (
    <>
      <span
        className={`friend-note-preview friend-note-preview-${surface}${className ? ` ${className}` : ""}`}
        ref={triggerRef}
        tabIndex={overflowing ? 0 : undefined}
        aria-describedby={tooltip.visible ? tooltip.tooltipId : undefined}
        onBlur={tooltip.hide}
        onClick={togglePreview}
        onFocus={showIfOverflowing}
        onMouseEnter={showIfOverflowing}
        onMouseLeave={tooltip.hide}
      >
        {note}
      </span>
      {tooltip.tooltip}
    </>
  );
}

export function FriendNoteEditButton({
  ariaLabel,
  className = "candidate-note-edit",
  disabled,
  note,
  onClick,
  showNoteTooltip = false,
  title,
  tooltipPortalTarget,
  username
}: {
  ariaLabel?: string;
  className?: string;
  disabled: boolean;
  note: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  showNoteTooltip?: boolean;
  title?: string;
  tooltipPortalTarget?: Element | DocumentFragment;
  username: Username;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const hasNote = note.trim().length > 0;
  const tooltipEnabled = showNoteTooltip && hasNote && !disabled;
  const tooltip = useFriendNoteTooltip({
    enabled: tooltipEnabled,
    note,
    tooltipPortalTarget,
    triggerRef
  });
  const nativeTitle = tooltipEnabled ? undefined : title ?? (showNoteTooltip ? undefined : "编辑备注");

  return (
    <>
      <button
        className={`${className} ${hasNote ? "has-note" : "is-empty"}`}
        type="button"
        ref={triggerRef}
        onClick={(event) => {
          tooltip.hide();
          onClick(event);
        }}
        onBlur={tooltip.hide}
        onFocus={tooltipEnabled ? tooltip.show : undefined}
        onMouseEnter={tooltipEnabled ? tooltip.show : undefined}
        onMouseLeave={tooltip.hide}
        disabled={disabled}
        title={nativeTitle}
        aria-describedby={tooltip.visible ? tooltip.tooltipId : undefined}
        aria-label={ariaLabel ?? `编辑 @${username} 的备注`}
      >
        <Pencil size={14} aria-hidden="true" />
      </button>
      {tooltip.tooltip}
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
