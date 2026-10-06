import type { HistoryRecord, Metric } from "../types";
export function HistoryChart({
  metric,
  records,
}: {
  metric: Metric;
  records: HistoryRecord[];
}) {
  const values = records
    .map((row) => row.metrics[metric.key].mean)
    .filter((v): v is number => v !== null);
  if (!values.length)
    return (
      <div className="chart">
        <h3>
          {metric.label} <span>{metric.unit}</span>
        </h3>
        <p className="empty">履歴はまだありません</p>
      </div>
    );
  const min = Math.min(...values),
    max = Math.max(...values),
    span = Math.max(max - min, 1),
    start = Date.parse(records[0].ended_at),
    end = Date.parse(records[records.length - 1].ended_at);
  // 欠測部分で線を分割する。横位置は実際の経過時間を表す。
  const paths: string[] = [];
  let current = "";
  records.forEach((row) => {
    const value = row.metrics[metric.key].mean;
    if (value === null) {
      if (current) paths.push(current);
      current = "";
      return;
    }
    const x =
        12 +
        ((Date.parse(row.ended_at) - start) / Math.max(end - start, 1)) * 296,
      y = 82 - ((value - min) / span) * 64;
    current += `${current ? " L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  });
  if (current) paths.push(current);
  return (
    <div className="chart">
      <h3>
        {metric.label}
        <span>
          {min.toFixed(metric.digits)}–{max.toFixed(metric.digits)}{" "}
          {metric.unit}
        </span>
      </h3>
      <svg
        viewBox="0 0 320 100"
        role="img"
        aria-label={`${metric.label}の平均値推移、最小${min.toFixed(metric.digits)}、最大${max.toFixed(metric.digits)}${metric.unit}`}
      >
        <path
          d="M12,82 H308 M12,50 H308 M12,18 H308"
          stroke="#e8ece9"
          fill="none"
        />
        {paths.map((path, i) => (
          <path
            key={i}
            d={path}
            stroke={metric.color}
            strokeWidth="2.5"
            strokeLinecap="round"
            fill="none"
          />
        ))}
        {records.length === 1 && (
          <circle cx="12" cy="82" r="3" fill={metric.color} />
        )}
      </svg>
      <div className="chart-times">
        <span>
          {new Date(start).toLocaleString("ja-JP", {
            month: "numeric",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        <span>
          {new Date(end).toLocaleTimeString("ja-JP", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
    </div>
  );
}
