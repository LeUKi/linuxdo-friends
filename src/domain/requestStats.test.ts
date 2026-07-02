import { describe, expect, it } from "vitest";
import { defaultAppState } from "./defaultState";
import { deriveRequestStatsView, recordRequestAttempts } from "./requestStats";

describe("request stats", () => {
  it("records attempted requests into all-time, local-day, and hourly buckets", () => {
    const state = recordRequestAttempts(defaultAppState, {
      family: "activity",
      count: 3,
      at: new Date(2026, 6, 2, 9, 15)
    });

    expect(state.requestStats.total).toBe(3);
    expect(state.requestStats.byFamily.activity).toBe(3);
    expect(state.requestStats.days["2026-07-02"]).toMatchObject({
      total: 3,
      hours: { "09": 3 },
      byFamily: { activity: 3 }
    });
  });

  it("keeps newer day buckets when a late attempt from yesterday is recorded", () => {
    const withToday = recordRequestAttempts(defaultAppState, {
      family: "profile",
      count: 2,
      at: new Date(2026, 6, 2, 0, 5)
    });

    const state = recordRequestAttempts(withToday, {
      family: "activity",
      count: 1,
      at: new Date(2026, 6, 1, 23, 59)
    });

    expect(state.requestStats.days["2026-07-01"]).toMatchObject({
      total: 1,
      hours: { "23": 1 }
    });
    expect(state.requestStats.days["2026-07-02"]).toMatchObject({
      total: 2,
      hours: { "00": 2 }
    });
  });

  it("derives 24-hour today/yesterday buckets and the 7-day sliding window with zero buckets", () => {
    const withOld = recordRequestAttempts(defaultAppState, {
      family: "profile",
      count: 2,
      at: new Date(2026, 5, 30, 21)
    });
    const withYesterday = recordRequestAttempts(withOld, {
      family: "following",
      count: 4,
      at: new Date(2026, 6, 1, 18)
    });
    const state = recordRequestAttempts(withYesterday, {
      family: "account",
      count: 1,
      at: new Date(2026, 6, 2, 2)
    });
    const withFutureSameDay = {
      ...state,
      requestStats: {
        ...state.requestStats,
        days: {
          ...state.requestStats.days,
          "2026-07-02": {
            ...state.requestStats.days["2026-07-02"],
            hours: {
              ...state.requestStats.days["2026-07-02"].hours,
              "22": 9
            }
          }
        }
      }
    };

    const view = deriveRequestStatsView(withFutureSameDay.requestStats, new Date(2026, 6, 2, 3, 30));

    expect(view.total).toBe(7);
    expect(view.today).toMatchObject({ date: "2026-07-02", total: 1 });
    expect(view.yesterday).toMatchObject({ date: "2026-07-01", total: 4 });
    expect(view.todayHours).toHaveLength(24);
    expect(view.yesterdayHours).toHaveLength(24);
    expect(view.todayHours.slice(0, 4)).toEqual([
      { hour: "00", label: "00:00", total: 0 },
      { hour: "01", label: "01:00", total: 0 },
      { hour: "02", label: "02:00", total: 1 },
      { hour: "03", label: "03:00", total: 0 }
    ]);
    expect(view.todayHours[22]).toEqual({ hour: "22", label: "22:00", total: 0 });
    expect(view.todayHours[23]).toEqual({ hour: "23", label: "23:00", total: 0 });
    expect(view.yesterdayHours[18]).toEqual({ hour: "18", label: "18:00", total: 4 });
    expect(view.yesterdayHours[23]).toEqual({ hour: "23", label: "23:00", total: 0 });
    expect(view.last7Days.map((item) => [item.date, item.total])).toEqual([
      ["2026-06-26", 0],
      ["2026-06-27", 0],
      ["2026-06-28", 0],
      ["2026-06-29", 0],
      ["2026-06-30", 2],
      ["2026-07-01", 4],
      ["2026-07-02", 1]
    ]);
  });
});
