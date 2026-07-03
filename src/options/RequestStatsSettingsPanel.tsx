import { useState } from "react";
import type { RequestStatsDayView, RequestStatsHourView, RequestStatsView } from "../domain/requestStats";
import { classNames } from "./classNames";
import { SettingsCard } from "./SettingsCard";

export function RequestStatsSettingsPanel({ view }: { view: RequestStatsView }) {
  const [hourlyTab, setHourlyTab] = useState<"today" | "yesterday">("today");
  const hourlyItems = hourlyTab === "today" ? view.todayHours : view.yesterdayHours;
  const hourlyLabel = hourlyTab === "today" ? "今天" : "昨天";
  const hourlySubtitle = hourlyTab === "today" ? "今天 0 点到现在的请求次数。" : "昨天全天的请求次数。";

  return (
    <div className={classNames("settings-card-list request-stats-panel")}>
      <SettingsCard
        title="统计总览"
        subtitle="统计插件已发出的 linux.do 请求，失败和被拦截的请求也会计入。"
        actions={
          <div className={classNames("request-stats-total-badge")} aria-label={`总请求 ${view.total}`}>
            <span>总请求</span>
            <strong>{view.total}</strong>
          </div>
        }
      />
      <SettingsCard
        title="按小时"
        subtitle={hourlySubtitle}
        actions={
          <div className={classNames("segmented-control request-stats-tabs")} role="tablist" aria-label="请求统计小时视图">
            <button
              className={classNames("segmented-option", hourlyTab === "today" && "active")}
              type="button"
              role="tab"
              aria-selected={hourlyTab === "today"}
              aria-controls="request-stats-hourly-chart"
              onClick={() => setHourlyTab("today")}
            >
              今天
            </button>
            <button
              className={classNames("segmented-option", hourlyTab === "yesterday" && "active")}
              type="button"
              role="tab"
              aria-selected={hourlyTab === "yesterday"}
              aria-controls="request-stats-hourly-chart"
              onClick={() => setHourlyTab("yesterday")}
            >
              昨天
            </button>
          </div>
        }
      >
        <RequestStatsBarChart id="request-stats-hourly-chart" ariaLabel={`${hourlyLabel}每小时请求次数柱状图`} density="hourly" items={hourlyItems} />
      </SettingsCard>
      <SettingsCard title="近 7 天" subtitle="含今天在内的 7 天滑动窗口。">
        <RequestStatsBarChart ariaLabel="近 7 天每天请求次数柱状图" density="daily" items={view.last7Days} />
      </SettingsCard>
    </div>
  );
}

function RequestStatsBarChart({
  ariaLabel,
  density,
  id,
  items
}: {
  ariaLabel: string;
  density: "hourly" | "daily";
  id?: string;
  items: Array<RequestStatsHourView | RequestStatsDayView>;
}) {
  const maxTotal = Math.max(1, ...items.map((item) => item.total));
  return (
    <div className={classNames("request-stats-chart-scroll")}>
      <div className={classNames("request-stats-chart", `request-stats-chart-${density}`)} id={id} role="list" aria-label={ariaLabel}>
        {items.map((item) => {
          const height = item.total === 0 ? 0 : Math.max(8, Math.round((item.total / maxTotal) * 100));
          const key = "hour" in item ? item.hour : item.date;
          const itemLabel = `${item.label}：${item.total}`;
          const axisLabel = chartAxisLabel(item, density);
          return (
            <div
              className={classNames("request-stats-bar-item", item.total === 0 && "is-zero")}
              key={key}
              role="listitem"
              aria-label={itemLabel}
              tabIndex={0}
            >
              <span className={classNames("request-stats-bar-tooltip")} aria-hidden="true">
                {itemLabel}
              </span>
              <span className={classNames("request-stats-bar-value")}>{item.total}</span>
              <span className={classNames("request-stats-bar-track")} aria-hidden="true">
                <span className={classNames("request-stats-bar-fill")} style={{ height: `${height}%` }} />
              </span>
              <span className={classNames("request-stats-bar-label")} aria-hidden={axisLabel ? undefined : "true"}>
                {axisLabel}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function chartAxisLabel(item: RequestStatsHourView | RequestStatsDayView, density: "hourly" | "daily"): string {
  if (density === "daily" || !("hour" in item)) return item.label;
  const hour = Number(item.hour);
  return hour % 3 === 0 || item.hour === "23" || item.total > 0 ? item.hour : "";
}
