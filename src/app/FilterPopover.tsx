import { type ReactNode, useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";
import type { ActivityKindFilter } from "../shared/types";
import { eventHappenedInside } from "./activityLinks";

export type FilterOption<T extends string> = {
  value: T;
  label: string;
  meta?: number | string;
  icon?: ReactNode;
  content?: ReactNode;
  searchText?: string;
  tone?: ActivityKindFilter;
};

export function FilterPopover<T extends string>({
  label,
  onChange,
  onOpenChange,
  onQueryChange,
  open,
  options,
  query,
  selectedContent,
  variant,
  value
}: {
  label: string;
  onChange: (value: T) => void;
  onOpenChange: (open: boolean) => void;
  onQueryChange: (query: string) => void;
  open: boolean;
  options: Array<FilterOption<T>>;
  query: string;
  selectedContent?: ReactNode;
  variant: "kind" | "user";
  value: T;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const selected = options.find((option) => option.value === value) ?? options[0];
  const filtered = normalizedQuery ? options.filter((option) => optionSearchText(option).includes(normalizedQuery)) : options;

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (popoverRef.current && !eventHappenedInside(event, popoverRef.current)) {
        onOpenChange(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onOpenChange(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onOpenChange, open]);

  return (
    <div className={`filter-popover filter-popover-${variant}`} ref={popoverRef}>
      <span>{label}</span>
      <button className="filter-popover-trigger" type="button" onClick={() => onOpenChange(!open)} aria-expanded={open}>
        <span className="filter-popover-value">{selectedContent ?? optionContent(selected)}</span>
        <ChevronDown className="filter-popover-arrow" size={15} aria-hidden="true" />
      </button>
      {open ? (
        <div className="filter-popover-menu">
          <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={`搜索${label}`} />
          {filtered.map((option) => (
            <button
              className={value === option.value ? "active" : ""}
              key={option.value}
              onClick={() => {
                onChange(option.value);
                onOpenChange(false);
              }}
              type="button"
            >
              {optionContent(option)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function optionContent<T extends string>(option: FilterOption<T>) {
  return option.content ?? (
    <span className="filter-option-content">
      {option.tone ? <span className={`filter-option-icon kind-${option.tone}`}>{option.icon}</span> : option.icon}
      <span className="filter-option-label">{option.label}</span>
      {option.meta !== undefined ? <span className="filter-option-count">{option.meta}</span> : null}
    </span>
  );
}

function optionSearchText<T extends string>(option: FilterOption<T>) {
  return (option.searchText ?? `${option.label} ${option.value}`).toLowerCase();
}
