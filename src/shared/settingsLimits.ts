export const REFRESH_INTERVAL_MINUTES_MIN = 30;
export const REFRESH_INTERVAL_MINUTES_MAX = 720;
export const TIMED_ACTIVITY_REFRESH_INTERVAL_MINUTES_MIN = 5;
export const TIMED_ACTIVITY_REFRESH_INTERVAL_MINUTES_MAX = 720;
export const DEFAULT_TIMED_ACTIVITY_REFRESH_INTERVAL_MINUTES = 20;

export function isValidRefreshIntervalMinutes(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= REFRESH_INTERVAL_MINUTES_MIN &&
    value <= REFRESH_INTERVAL_MINUTES_MAX
  );
}

export function isValidTimedActivityRefreshIntervalMinutes(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= TIMED_ACTIVITY_REFRESH_INTERVAL_MINUTES_MIN &&
    value <= TIMED_ACTIVITY_REFRESH_INTERVAL_MINUTES_MAX
  );
}
