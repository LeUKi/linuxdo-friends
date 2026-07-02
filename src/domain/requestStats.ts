import type { AppState, RequestStatsDayEntry, RequestStatsFamily, RequestStatsState } from "../shared/types";

const RETAIN_DAILY_BUCKETS = 31;

export const defaultRequestStats: RequestStatsState = {
  total: 0,
  byFamily: {},
  days: {}
};

export interface RequestStatsDayView {
  date: string;
  label: string;
  total: number;
}

export interface RequestStatsHourView {
  hour: string;
  label: string;
  total: number;
}

export interface RequestStatsView {
  total: number;
  today: RequestStatsDayView;
  yesterday: RequestStatsDayView;
  todayHours: RequestStatsHourView[];
  yesterdayHours: RequestStatsHourView[];
  last7Days: RequestStatsDayView[];
}

export function recordRequestAttempts(
  state: AppState,
  input: { family: RequestStatsFamily; count: number; at?: Date }
): AppState {
  const count = normalizeCount(input.count);
  if (count === 0) return state;

  const at = input.at ?? new Date();
  const date = localDateKey(at);
  const hour = localHourKey(at);
  const current = normalizeRequestStats(state.requestStats);
  const currentDay = current.days[date] ?? emptyDay(date);
  const nextDay: RequestStatsDayEntry = {
    date,
    total: currentDay.total + count,
    hours: {
      ...currentDay.hours,
      [hour]: (currentDay.hours[hour] ?? 0) + count
    },
    byFamily: {
      ...currentDay.byFamily,
      [input.family]: (currentDay.byFamily[input.family] ?? 0) + count
    }
  };
  const daysWithNextAttempt = {
    ...current.days,
    [date]: nextDay
  };
  const days = pruneDays(daysWithNextAttempt, latestPruneAnchor(daysWithNextAttempt, at));

  return {
    ...state,
    requestStats: {
      total: current.total + count,
      byFamily: {
        ...current.byFamily,
        [input.family]: (current.byFamily[input.family] ?? 0) + count
      },
      days
    }
  };
}

export function normalizeRequestStats(value: unknown): RequestStatsState {
  if (!isRecord(value)) return defaultRequestStats;
  const total = normalizeCount(value.total);
  const byFamily = normalizeFamilyCounts(value.byFamily);
  const days: Record<string, RequestStatsDayEntry> = {};
  if (isRecord(value.days)) {
    for (const [date, entry] of Object.entries(value.days)) {
      const normalized = normalizeDayEntry(date, entry);
      if (normalized) days[normalized.date] = normalized;
    }
  }
  return { total, byFamily, days };
}

export function deriveRequestStatsView(stats: RequestStatsState, now: Date = new Date()): RequestStatsView {
  const normalized = normalizeRequestStats(stats);
  const todayDate = startOfLocalDay(now);
  const yesterdayDate = addLocalDays(todayDate, -1);
  const todayKey = localDateKey(todayDate);
  const yesterdayKey = localDateKey(yesterdayDate);
  const todayEntry = normalized.days[todayKey] ?? emptyDay(todayKey);
  const yesterdayEntry = normalized.days[yesterdayKey] ?? emptyDay(yesterdayKey);
  const currentHour = now.getHours();

  return {
    total: normalized.total,
    today: dayView(todayEntry, todayDate),
    yesterday: dayView(yesterdayEntry, yesterdayDate),
    todayHours: hourViews(todayEntry, currentHour),
    yesterdayHours: hourViews(yesterdayEntry),
    last7Days: Array.from({ length: 7 }, (_, index) => {
      const date = addLocalDays(todayDate, index - 6);
      const key = localDateKey(date);
      return dayView(normalized.days[key] ?? emptyDay(key), date);
    })
  };
}

function normalizeDayEntry(dateFallback: string, value: unknown): RequestStatsDayEntry | null {
  if (!isRecord(value)) return null;
  const date = typeof value.date === "string" && isDateKey(value.date) ? value.date : isDateKey(dateFallback) ? dateFallback : null;
  if (!date) return null;
  return {
    date,
    total: normalizeCount(value.total),
    hours: normalizeHourCounts(value.hours),
    byFamily: normalizeFamilyCounts(value.byFamily)
  };
}

function normalizeFamilyCounts(value: unknown): Partial<Record<RequestStatsFamily, number>> {
  if (!isRecord(value)) return {};
  const next: Partial<Record<RequestStatsFamily, number>> = {};
  for (const family of ["account", "following", "profile", "activity", "avatar"] as const) {
    const count = normalizeCount(value[family]);
    if (count > 0) next[family] = count;
  }
  return next;
}

function normalizeHourCounts(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const next: Record<string, number> = {};
  for (const [hour, count] of Object.entries(value)) {
    if (!/^\d{2}$/.test(hour)) continue;
    const parsedHour = Number(hour);
    if (!Number.isInteger(parsedHour) || parsedHour < 0 || parsedHour > 23) continue;
    const normalized = normalizeCount(count);
    if (normalized > 0) next[hour] = normalized;
  }
  return next;
}

function normalizeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function pruneDays(days: Record<string, RequestStatsDayEntry>, now: Date): Record<string, RequestStatsDayEntry> {
  const keep = new Set<string>();
  const today = startOfLocalDay(now);
  for (let offset = 0; offset < RETAIN_DAILY_BUCKETS; offset += 1) {
    keep.add(localDateKey(addLocalDays(today, -offset)));
  }
  return Object.fromEntries(Object.entries(days).filter(([date]) => keep.has(date)));
}

function latestPruneAnchor(days: Record<string, RequestStatsDayEntry>, fallback: Date): Date {
  let latestKey = localDateKey(fallback);
  for (const date of Object.keys(days)) {
    if (date > latestKey && dateFromLocalDateKey(date)) latestKey = date;
  }
  return dateFromLocalDateKey(latestKey) ?? fallback;
}

function emptyDay(date: string): RequestStatsDayEntry {
  return { date, total: 0, hours: {}, byFamily: {} };
}

function dayView(entry: RequestStatsDayEntry, date: Date): RequestStatsDayView {
  return {
    date: entry.date,
    label: `${date.getMonth() + 1}/${date.getDate()}`,
    total: entry.total
  };
}

function hourViews(entry: RequestStatsDayEntry, maxIncludedHour = 23): RequestStatsHourView[] {
  return Array.from({ length: 24 }, (_, hour) => {
    const key = pad2(hour);
    return {
      hour: key,
      label: `${key}:00`,
      total: hour <= maxIncludedHour ? entry.hours[key] ?? 0 : 0
    };
  });
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addLocalDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function dateFromLocalDateKey(value: string): Date | null {
  if (!isDateKey(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return localDateKey(date) === value ? date : null;
}

function localHourKey(date: Date): string {
  return pad2(date.getHours());
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function isDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}
